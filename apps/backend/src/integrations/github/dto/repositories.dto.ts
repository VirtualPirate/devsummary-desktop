import { GITHUB_LOOKBACK_DAYS } from '@launchstack/api-interfaces';
import { z } from 'zod';

export const RepositoryIdParamSchema = z.object({
  repoId: z.string().uuid(),
});

/**
 * A git branch name we are willing to store and later hand to the GitHub API as
 * a `sha` parameter. Not a full `git check-ref-format` implementation — it
 * rejects the shapes that would be actively harmful (empty, absurdly long,
 * control characters, leading `-` which reads as a flag) and lets GitHub be the
 * authority on the rest. A branch that does not exist surfaces as a failed
 * fetch on that repository, which the UI has a state for; we deliberately do
 * not fall back to the default branch.
 */
const BranchName = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !/[\s~^:?*[\\]/.test(value) &&
      // Control characters, checked by code point — a character class for them
      // is what `no-control-regex` exists to flag.
      ![...value].some((ch) => {
        const code = ch.charCodeAt(0);
        return code < 0x20 || code === 0x7f;
      }) &&
      !value.startsWith('-'),
    { message: 'invalid branch name' },
  );

export const SetRepositoryBranchesBodySchema = z.object({
  // Derived from the tuple rather than indexed into it: the positional form
  // stopped compiling the moment a window was dropped, which is exactly when
  // nobody wants to be editing validation.
  lookbackDays: z.literal(GITHUB_LOOKBACK_DAYS),
  // Capped so one request cannot fan out an unbounded number of workflow
  // starts; the setup screen never sends more than an installation's repo count.
  selections: z
    .array(
      z.object({
        repositoryId: z.string().uuid(),
        // One repository reads one branch. To leave a repository unconfigured,
        // omit it from `selections` — there is no "clear it" value, since
        // write-once forbids untracking.
        branch: BranchName,
      }),
    )
    .min(1)
    .max(200),
});

export type SetRepositoryBranchesBody = z.infer<
  typeof SetRepositoryBranchesBodySchema
>;
