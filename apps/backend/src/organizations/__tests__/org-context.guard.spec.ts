import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgContextGuard } from '../guards/org-context.guard';
import { OrganizationMembersRepository } from '../repositories/members.repository';
import { REQUIRE_ORG_ROLE_KEY } from '../decorators/require-org-role.decorator';
import { LOCAL_ORG_ID, LOCAL_USER_ID } from '../../local/local-identity';

// A real uuid: the guard now rejects anything Postgres' uuid parser would,
// so the happy paths have to carry a header the DB would actually accept.
const ORG_ID = '3f1a9c62-2c1f-4f2e-9a52-4b1d0d5f8e11';

function makeContext(opts: {
  header?: string;
  session?: { user?: { id?: string } };
  membership?: { role: 'owner' | 'admin' | 'viewer' } | null;
  level?: 'owner' | 'admin' | 'member';
}) {
  const request: any = {
    headers: opts.header ? { 'x-organization-id': opts.header } : {},
    session: opts.session ?? { user: { id: 'user-1' } },
  };
  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(opts.level),
  } as unknown as Reflector;

  const membersRepo = {
    findByOrgAndUser: jest.fn().mockResolvedValue(
      opts.membership
        ? {
            id: 'm1',
            organizationId: opts.header,
            userId: opts.session?.user?.id ?? 'user-1',
            role: opts.membership.role,
          }
        : null,
    ),
  } as unknown as OrganizationMembersRepository;

  return { ctx, request, reflector, membersRepo };
}

describe('OrgContextGuard', () => {
  it('is a no-op when @RequireOrgRole is absent', async () => {
    const { ctx, reflector, membersRepo } = makeContext({ level: undefined });
    const guard = new OrgContextGuard(reflector, membersRepo);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  // A desktop client that has not picked a workspace yet still gets one: the
  // header is how the switcher moves between workspaces, not how the app
  // proves who it is (docs/DELTAS.md D-A).
  it('falls back to the default workspace when the header is absent', async () => {
    const { ctx, request, reflector, membersRepo } = makeContext({
      level: 'member',
      session: { user: { id: LOCAL_USER_ID } },
      membership: { role: 'owner' },
    });
    const guard = new OrgContextGuard(reflector, membersRepo);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(membersRepo.findByOrgAndUser).toHaveBeenCalledWith(
      LOCAL_ORG_ID,
      LOCAL_USER_ID,
    );
    expect(request.orgMembership).toEqual({
      organizationId: LOCAL_ORG_ID,
      userId: LOCAL_USER_ID,
      role: 'owner',
    });
  });

  it('404s on the fallback workspace when its membership row is missing', async () => {
    const { ctx, reflector, membersRepo } = makeContext({
      level: 'member',
      membership: null,
    });
    const guard = new OrgContextGuard(reflector, membersRepo);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 404,
      code: 'ORG_NOT_FOUND',
    });
  });

  it.each([
    ['not a uuid at all', 'org-1'],
    ['a uuid missing a character', '3f1a9c62-2c1f-4f2e-9a52-4b1d0d5f8e1'],
    ['a uuid with sql-ish junk appended', `${ORG_ID}' OR '1'='1`],
    ['whitespace-padded', ` ${ORG_ID} `],
  ])(
    '400 ORG_HEADER_REQUIRED when the header is %s, and never queries the DB',
    async (_label, header) => {
      const { ctx, reflector, membersRepo } = makeContext({
        level: 'member',
        header,
      });
      const guard = new OrgContextGuard(reflector, membersRepo);
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        status: 400,
        code: 'ORG_HEADER_REQUIRED',
      });
      // The whole point: a malformed id must not reach the uuid column, where
      // Postgres would raise 22P02 and the filter would report a 500.
      expect(membersRepo.findByOrgAndUser).not.toHaveBeenCalled();
    },
  );

  it('401 when no session on an org-scoped route', async () => {
    const { ctx, reflector, membersRepo } = makeContext({
      level: 'member',
      header: ORG_ID,
      session: {},
    });
    const guard = new OrgContextGuard(reflector, membersRepo);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 401,
    });
  });

  // No membership row is the single answer for "org never existed", "org was
  // deleted", and "member was just removed" — all 404, never 403, so the
  // response can't be used to probe which orgs exist.
  it('404 when a well-formed uuid has no membership row', async () => {
    const { ctx, reflector, membersRepo } = makeContext({
      level: 'member',
      header: ORG_ID,
      membership: null,
    });
    const guard = new OrgContextGuard(reflector, membersRepo);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 404,
      code: 'ORG_NOT_FOUND',
    });
    expect(membersRepo.findByOrgAndUser).toHaveBeenCalledWith(ORG_ID, 'user-1');
  });

  it('403 when role is insufficient', async () => {
    const { ctx, reflector, membersRepo } = makeContext({
      level: 'owner',
      header: ORG_ID,
      membership: { role: 'admin' },
    });
    const guard = new OrgContextGuard(reflector, membersRepo);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('allows owner when admin is required', async () => {
    const { ctx, request, reflector, membersRepo } = makeContext({
      level: 'admin',
      header: ORG_ID,
      membership: { role: 'owner' },
    });
    const guard = new OrgContextGuard(reflector, membersRepo);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.orgMembership).toEqual({
      organizationId: ORG_ID,
      userId: 'user-1',
      role: 'owner',
    });
  });

  it('allows viewer when member is required', async () => {
    const { ctx, reflector, membersRepo } = makeContext({
      level: 'member',
      header: ORG_ID,
      membership: { role: 'viewer' },
    });
    const guard = new OrgContextGuard(reflector, membersRepo);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

// Force ts to not strip imports; keep the test file focused.
void REQUIRE_ORG_ROLE_KEY;
void HttpException;
