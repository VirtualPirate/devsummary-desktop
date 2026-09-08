import { JOB, JobHandlerRegistry } from '../../../../jobs';
import { CollaboratorJobs } from './collaborator.jobs';
import type { CollaboratorActivities } from './collaborator.activities';

describe('CollaboratorJobs — collaborators.syncRepo', () => {
  function makeJobs() {
    const activities = { syncRepo: jest.fn(async () => undefined) };
    const registry = new JobHandlerRegistry();
    const jobs = new CollaboratorJobs(
      activities as unknown as CollaboratorActivities,
      registry,
    );
    return { jobs, activities, registry };
  }

  it('forwards the repository and trigger to the activity', async () => {
    const { jobs, activities } = makeJobs();

    await jobs.syncRepo({
      repositoryId: 'r1',
      trigger: 'connected',
      organizationId: 'org-1',
    });

    // `organizationId` is the job row's scoping, not the activity's argument —
    // exactly what the workflow passed through.
    expect(activities.syncRepo).toHaveBeenCalledWith({
      repositoryId: 'r1',
      trigger: 'connected',
    });
  });

  it('registers its type and routes a job row to the handler', async () => {
    const { jobs, activities, registry } = makeJobs();
    jobs.onModuleInit();

    expect(registry.get(JOB.syncRepoCollaborators)).toBeDefined();
    await registry.get(JOB.syncRepoCollaborators)!(
      { repositoryId: 'r2', trigger: 'manual' },
      {} as never,
    );
    expect(activities.syncRepo).toHaveBeenCalledWith({
      repositoryId: 'r2',
      trigger: 'manual',
    });
  });
});
