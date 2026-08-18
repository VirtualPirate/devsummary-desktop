import {
  buildStatus,
  repositoryIdFromWorkflowId,
} from '../services/ingest-status.service';
import type {
  RepositoryCountsRow,
  TrackedRepositoryRow,
} from '../repositories/ingest-status.repository';

const REPO_ID = '11111111-1111-4111-8111-111111111111';
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

describe('repositoryIdFromWorkflowId', () => {
  it('reads the repository out of every id shape that carries one', () => {
    expect(repositoryIdFromWorkflowId(`scan:${REPO_ID}:main`)).toBe(REPO_ID);
    expect(
      repositoryIdFromWorkflowId(`backfill:${REPO_ID}:main:2026-05-13`),
    ).toBe(REPO_ID);
    expect(
      repositoryIdFromWorkflowId(
        `analyze:${REPO_ID}:main:2026-05-13T00:00:00.000Z`,
      ),
    ).toBe(REPO_ID);
  });

  it('returns null rather than a bogus key for ids that carry no repository', () => {
    expect(repositoryIdFromWorkflowId('NoopWorkflow:abc')).toBeNull();
    expect(repositoryIdFromWorkflowId('scan')).toBeNull();
    expect(repositoryIdFromWorkflowId('scan:not-a-uuid:main')).toBeNull();
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
