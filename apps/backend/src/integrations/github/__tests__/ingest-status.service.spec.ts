import { Logger } from '@nestjs/common';
import type { AppDatabase } from '../../../databases/kysely';
import { createJobsDb } from '../../../jobs/__tests__/jobs-test-db';
import {
  buildStatus,
  IngestStatusService,
} from '../services/ingest-status.service';
import type {
  IngestStatusRepository,
  RepositoryCountsRow,
  TrackedRepositoryRow,
} from '../repositories/ingest-status.repository';

jest.setTimeout(30_000);

const REPO_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '3f1a9c62-2c1f-4f2e-9a52-4b1d0d5f8e11';
const NOW = new Date('2026-08-13T12:00:00.000Z');

function tracked(trackedSince: Date): TrackedRepositoryRow {
  return {
    repositoryId: REPO_ID,
    fullName: 'VirtualPirate/gitbrief',
    branch: 'main',
    trackedSince,
  };
}

function counts(
  over: Partial<RepositoryCountsRow> = {},
): RepositoryCountsRow[] {
  return [
    {
      repositoryId: REPO_ID,
      commitCount: 0,
      processedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      ...over,
    },
  ];
}

const nothingRunning = new Map<
  string,
  { fetching?: { startedAt: Date }; analyzing?: { startedAt: Date } }
>();

const running = (
  phases: Partial<{ fetching: Date; analyzing: Date }>,
): typeof nothingRunning =>
  new Map([
    [
      REPO_ID,
      {
        ...(phases.fetching
          ? { fetching: { startedAt: phases.fetching } }
          : {}),
        ...(phases.analyzing
          ? { analyzing: { startedAt: phases.analyzing } }
          : {}),
      },
    ],
  ]);

/** Minutes before NOW. */
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe('running jobs by repository', () => {
  let db: AppDatabase;

  const repo = {
    listTracked: jest.fn(),
    countsFor: jest.fn(),
  } as unknown as jest.Mocked<IngestStatusRepository>;

  const enqueue = (over: {
    id: string;
    type: string;
    repositoryId?: string | null;
    state?: 'pending' | 'running';
    organizationId?: string;
    createdAt?: Date;
  }) =>
    db
      .insertInto('jobs')
      .values({
        id: over.id,
        type: over.type,
        args: JSON.stringify(
          over.repositoryId === null
            ? {}
            : { repositoryId: over.repositoryId ?? REPO_ID },
        ),
        state: over.state ?? 'running',
        organizationId: over.organizationId ?? ORG_ID,
        ...(over.createdAt ? { createdAt: over.createdAt } : {}),
      })
      .execute();

  beforeAll(async () => {
    db = await createJobsDb();
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom('jobs').execute();
    jest.clearAllMocks();
    repo.listTracked.mockResolvedValue([tracked(ago(30))]);
    repo.countsFor.mockResolvedValue(counts({ commitCount: 5 }));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const service = () => new IngestStatusService(repo, db);

  it('buckets running ingest jobs onto the repository named in args', async () => {
    await enqueue({
      id: `scan:${REPO_ID}:main`,
      type: 'github.scanRepository',
      createdAt: ago(3),
    });
    await enqueue({
      id: `analyze:${REPO_ID}:x`,
      type: 'analysis.analyzeRepo',
      createdAt: ago(2),
    });

    const out = await service().forOrganization(ORG_ID, NOW);

    expect(out.repositories[0].fetching).toEqual({
      state: 'running',
      startedAt: ago(3).toISOString(),
    });
    expect(out.repositories[0].analyzing.state).toBe('running');
    expect(out.ingesting).toBe(true);
  });

  it('ignores pending rows, other orgs, other job types, and args with no repository', async () => {
    await enqueue({
      id: 'queued',
      type: 'github.scanRepository',
      state: 'pending',
    });
    await enqueue({
      id: 'other-org',
      type: 'github.scanRepository',
      organizationId: '22222222-2222-4222-8222-222222222222',
    });
    // Collaborator sync is `fetching` too, but it is not commit ingestion —
    // counting it would hold the onboarding CTA over work the user is not
    // waiting for.
    await enqueue({ id: 'collab', type: 'collaborators.syncRepo' });
    await enqueue({
      id: 'sweep-child',
      type: 'github.ingestNewCommits',
      repositoryId: null,
    });

    const out = await service().forOrganization(ORG_ID, NOW);

    expect(out.repositories[0].fetching.state).toBe('done');
    expect(out.repositories[0].analyzing.state).toBe('incomplete');
  });

  it('keeps the earliest start when two jobs share a phase', async () => {
    await enqueue({
      id: 'scan',
      type: 'github.scanRepository',
      createdAt: ago(9),
    });
    await enqueue({
      id: 'backfill',
      type: 'github.backfillCommits',
      createdAt: ago(4),
    });

    const out = await service().forOrganization(ORG_ID, NOW);
    expect(out.repositories[0].fetching.startedAt).toBe(ago(9).toISOString());
  });

  it('reports nothing running on a non-uuid org id rather than querying', async () => {
    await enqueue({ id: 'scan', type: 'github.scanRepository' });

    const out = await service().forOrganization('org-1', NOW);

    expect(out.repositories[0].fetching.state).toBe('done');
  });
});

describe('buildStatus', () => {
  it('reports pending inside the grace window so the CTA cannot unlock over an empty history', () => {
    // Visibility lags for a few seconds after setBranches: nothing running,
    // nothing fetched. Treating that as "done" is what would unlock the button.
    const status = buildStatus(
      tracked(ago(0.2)),
      counts(),
      nothingRunning,
      NOW,
    );
    expect(status.fetching.state).toBe('pending');
    expect(status.analyzing.state).toBe('waiting');
  });

  it('stops reporting pending once the grace window passes, so an empty repo cannot lock it forever', () => {
    const status = buildStatus(tracked(ago(5)), counts(), nothingRunning, NOW);
    expect(status.fetching.state).toBe('done');
  });

  it('exposes both phases as live at once', () => {
    // One repository fetching while another analyzes is the whole reason the two
    // phases are separate cells rather than one swapping label.
    const status = buildStatus(
      tracked(ago(10)),
      counts({ commitCount: 1109, processedCount: 842 }),
      running({ fetching: ago(3), analyzing: ago(2) }),
      NOW,
    );
    expect(status.fetching.state).toBe('running');
    expect(status.analyzing.state).toBe('running');
    expect(status.fetching.startedAt).toBe(ago(3).toISOString());
  });

  it('distinguishes caught-up from done by whether fetching is still running', () => {
    const stillFetching = buildStatus(
      tracked(ago(10)),
      counts({ commitCount: 312, processedCount: 312 }),
      running({ fetching: ago(4) }),
      NOW,
    );
    expect(stillFetching.analyzing.state).toBe('caughtUp');

    const finished = buildStatus(
      tracked(ago(10)),
      counts({ commitCount: 312, processedCount: 312 }),
      nothingRunning,
      NOW,
    );
    expect(finished.analyzing.state).toBe('done');
  });

  it('marks a stalled-out analysis incomplete rather than done', () => {
    const status = buildStatus(
      tracked(ago(30)),
      counts({ commitCount: 1109, processedCount: 900, failedCount: 4 }),
      nothingRunning,
      NOW,
    );
    expect(status.analyzing.state).toBe('incomplete');
  });

  it('defaults a repository with no counts row to zeros', () => {
    const status = buildStatus(tracked(ago(30)), [], nothingRunning, NOW);
    expect(status.commitCount).toBe(0);
    expect(status.processedCount).toBe(0);
  });
});
