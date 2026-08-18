export const WORKFLOW = {
  noop: 'NoopWorkflow',
  syncRepoCollaborators: 'SyncRepoCollaboratorsWorkflow',
  scanRepository: 'ScanRepositoryWorkflow',
  backfillCommits: 'BackfillCommitsWorkflow',
  ingestNewCommits: 'IngestNewCommitsWorkflow',
  sweepRepositories: 'SweepRepositoriesWorkflow',
  analyzeRepo: 'AnalyzeRepoWorkflow',
  generateBrief: 'GenerateBriefWorkflow',
  backfillBriefs: 'BackfillBriefsWorkflow',
  dispatchDueBriefs: 'DispatchDueBriefsWorkflow',
  backfillLocStats: 'BackfillLocStatsWorkflow',
  backfillRepoLocStats: 'BackfillRepoLocStatsWorkflow',
} as const;

export type WorkflowType = (typeof WORKFLOW)[keyof typeof WORKFLOW];
