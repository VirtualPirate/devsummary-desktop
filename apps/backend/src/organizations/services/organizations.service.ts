import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  MyOrganization,
  Organization,
  OrganizationRole,
} from '@launchstack/api-interfaces';
import { KYSELY_DB } from '../../databases/kysely';
import type {
  AppDatabase,
  OrganizationMemberSelect,
  OrganizationSelect,
} from '../../databases/kysely';
import { OrganizationsRepository } from '../repositories/organizations.repository';
import { OrganizationMembersRepository } from '../repositories/members.repository';
import { OrganizationTeardownService } from './organization-teardown.service';
import { AppError } from '../../common/errors';

/** Postgres `unique_violation`. */
const PG_UNIQUE_VIOLATION = '23505';
/** Unique index on `organizations.slug` (migrations/00001_init.ts). */
const SLUG_UNIQUE_INDEX = 'organizations_slug_unique';
const SLUG_ATTEMPTS = 5;

function isSlugUniqueViolation(err: unknown): boolean {
  const e = err as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
  } | null;
  if (!e || e.code !== PG_UNIQUE_VIOLATION) {
    return false;
  }
  // pg reports the offending index in `constraint`; the message names it too.
  return (
    e.constraint === SLUG_UNIQUE_INDEX ||
    (typeof e.message === 'string' && e.message.includes(SLUG_UNIQUE_INDEX))
  );
}

function buildSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const suffix = randomBytes(4).toString('hex').slice(0, 6);
  return `${base || 'org'}-${suffix}`;
}

export function serializeOrganization(row: OrganizationSelect): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly orgs: OrganizationsRepository,
    private readonly members: OrganizationMembersRepository,
    @Inject(KYSELY_DB) private readonly db: AppDatabase,
    private readonly teardown: OrganizationTeardownService,
  ) {}

  async createOrganization(
    ownerUserId: string,
    input: { name: string },
  ): Promise<{
    organization: Organization;
    membership: OrganizationMemberSelect;
  }> {
    // Postgres arbitrates the slug: an in-transaction pre-check cannot see a
    // concurrent uncommitted insert, so we let the unique index reject the
    // clash and retry with a fresh suffix (buildSlug appends 6 random hex
    // chars, so a genuine collision is rare).
    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
      try {
        const result = await this.db.transaction().execute(async (tx) => {
          const org = await this.orgs.create(
            {
              name: input.name,
              slug: buildSlug(input.name),
              ownerId: ownerUserId,
            },
            tx,
          );
          const membership = await this.members.create(
            { organizationId: org.id, userId: ownerUserId, role: 'owner' },
            tx,
          );
          return { org, membership };
        });

        return {
          organization: serializeOrganization(result.org),
          membership: result.membership,
        };
      } catch (err) {
        if (!isSlugUniqueViolation(err)) {
          throw err;
        }
      }
    }

    throw AppError.ORG_SLUG_CONFLICT();
  }

  async listMyOrganizations(userId: string): Promise<MyOrganization[]> {
    const rows = await this.members.listByUser(userId);
    return rows.map((r) => ({
      organization: serializeOrganization(r.organization),
      role: r.member.role,
    }));
  }

  async getCurrentOrganization(
    organizationId: string,
    role: OrganizationRole,
  ): Promise<{ organization: Organization; role: OrganizationRole }> {
    const row = await this.orgs.findById(organizationId);
    if (!row) {
      throw AppError.ORG_NOT_FOUND();
    }
    return { organization: serializeOrganization(row), role };
  }

  async updateOrganization(
    organizationId: string,
    patch: { name?: string; slug?: string },
  ): Promise<Organization> {
    if (patch.slug) {
      const clash = await this.orgs.findBySlug(patch.slug);
      if (clash && clash.id !== organizationId) {
        throw AppError.ORG_SLUG_CONFLICT();
      }
    }

    let updated: OrganizationSelect | null;
    try {
      updated = await this.orgs.update(organizationId, patch);
    } catch (err) {
      // The pre-check above cannot see a concurrent uncommitted rename, so
      // Postgres arbitrates here too — same as the create path, minus the
      // retry: the caller chose this slug, so a fresh one is not ours to pick.
      if (isSlugUniqueViolation(err)) {
        throw AppError.ORG_SLUG_CONFLICT();
      }
      throw err;
    }
    if (!updated) {
      throw AppError.ORG_NOT_FOUND();
    }
    return serializeOrganization(updated);
  }

  async deleteOrganization(organizationId: string): Promise<void> {
    // Before the row goes: the delete cascades to every child, so afterwards
    // nothing names the Slack token, the GitHub installation, or the workflows
    // still running for this org. Best-effort — it never blocks the delete.
    await this.teardown.run(organizationId);

    const deleted = await this.orgs.delete(organizationId);
    if (deleted === 0) {
      throw AppError.ORG_NOT_FOUND();
    }
  }

  async transferOwnership(input: {
    organizationId: string;
    currentOwnerUserId: string;
    newOwnerUserId: string;
  }): Promise<Organization> {
    if (input.currentOwnerUserId === input.newOwnerUserId) {
      throw AppError.ORG_TRANSFER_TO_SELF();
    }

    return await this.db.transaction().execute(async (tx) => {
      // First statement, before any membership read: two transfers started from
      // the same owner would otherwise both see their target as `admin` and
      // both promote it, leaving two owner rows and one unremovable owner.
      const locked = await this.orgs.lockById(input.organizationId, tx);
      if (!locked) {
        throw AppError.ORG_NOT_FOUND();
      }

      const target = await this.members.findByOrgAndUser(
        input.organizationId,
        input.newOwnerUserId,
        tx,
      );
      if (!target || target.role !== 'admin') {
        throw AppError.ORG_TRANSFER_TARGET_NOT_ADMIN();
      }

      const currentOwnerMembership = await this.members.findByOrgAndUser(
        input.organizationId,
        input.currentOwnerUserId,
        tx,
      );
      if (!currentOwnerMembership || currentOwnerMembership.role !== 'owner') {
        throw AppError.ORG_TRANSFER_CALLER_NOT_OWNER();
      }

      const updatedOrg = await this.orgs.setOwner(
        input.organizationId,
        input.newOwnerUserId,
        tx,
      );
      if (!updatedOrg) {
        throw AppError.ORG_NOT_FOUND();
      }

      // Demote before promote: `organization_members_single_owner_unique` is a
      // plain unique index, so it is enforced per statement — promoting first
      // would hold two owner rows for the length of a statement and abort.
      await this.members.updateRole(currentOwnerMembership.id, 'admin', tx);
      await this.members.updateRole(target.id, 'owner', tx);

      return serializeOrganization(updatedOrg);
    });
  }
}
