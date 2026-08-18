export const SA_ORG = 'OrganizationId';
export const SA_PHASE = 'Phase';
export type Phase = 'fetching' | 'analyzing' | 'generating';

export function buildSearchAttributes(opts: {
  organizationId?: string;
  phase?: Phase;
}): Record<string, string[]> {
  // Present-but-empty is a bug, never "system-scoped": the workflow still mutates
  // that org's rows, but JobActivityService counts Running executions per
  // OrganizationId, so the org's background-jobs toast reports "done" while the
  // work is still going. Throwing is the only channel available here — this
  // module is imported by Nest providers *and* by workflow-sandbox code, which
  // share no logger. System-scoped callers omit the key entirely.
  if ('organizationId' in opts && !opts.organizationId) {
    throw new Error(
      'buildSearchAttributes: organizationId key present but empty — omit it for system-scoped work',
    );
  }

  const sa: Record<string, string[]> = {};
  if (opts.organizationId) sa[SA_ORG] = [opts.organizationId];
  if (opts.phase) sa[SA_PHASE] = [opts.phase];
  return sa;
}
