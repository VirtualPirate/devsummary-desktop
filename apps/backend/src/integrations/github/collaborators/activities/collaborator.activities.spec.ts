import { CollaboratorActivities } from './collaborator.activities';

function makeMocks() {
  return {
    syncRepo: jest.fn().mockResolvedValue(undefined),
  };
}

describe('CollaboratorActivities', () => {
  it('delegates to CollaboratorSyncService.syncRepo with repositoryId and trigger', async () => {
    const mockSync = makeMocks();
    const activities = new CollaboratorActivities(mockSync as any);

    await activities.syncRepo({ repositoryId: 'r1', trigger: 'manual' });

    expect(mockSync.syncRepo).toHaveBeenCalledWith('r1', 'manual');
  });
});
