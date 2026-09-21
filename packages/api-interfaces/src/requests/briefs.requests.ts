import { z } from 'zod';
import { BRIEF_COMMIT_TYPES } from '../responses/briefs.responses';

const hhmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

export const CadenceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('daily'), time: hhmmSchema }),
  z.object({
    type: z.literal('weekly'),
    time: hhmmSchema,
    dayOfWeek: z.number().int().min(0).max(6),
  }),
  z.object({
    type: z.literal('monthly'),
    time: hhmmSchema,
    dayOfMonth: z.number().int().min(1).max(31),
  }),
]);
export type CadenceInput = z.infer<typeof CadenceSchema>;

export const ScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project'), projectId: z.string().uuid() }),
  z.object({ type: z.literal('team'), teamId: z.string().uuid() }),
  z.object({
    type: z.literal('collaborator'),
    collaboratorId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('repository'),
    repositoryId: z.string().uuid(),
    /**
     * Optional: narrows the scope to commits seen on this branch. Omitted means
     * every branch the repository is tracked on.
     */
    branch: z.string().min(1).max(255).optional(),
  }),
]);
export type ScopeInput = z.infer<typeof ScopeSchema>;

// Projects
export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  color: z.string().max(16).optional(),
  repositoryIds: z.array(z.string().uuid()).default([]),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  color: z.string().max(16).nullable().optional(),
});
export type UpdateProjectRequest = z.infer<typeof UpdateProjectSchema>;

export const SetProjectRepositoriesSchema = z.object({
  repositoryIds: z.array(z.string().uuid()),
});
export type SetProjectRepositoriesRequest = z.infer<
  typeof SetProjectRepositoriesSchema
>;

// Teams
export const CreateTeamSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  color: z.string().max(16).optional(),
  collaboratorIds: z.array(z.string().uuid()).default([]),
});
export type CreateTeamRequest = z.infer<typeof CreateTeamSchema>;

export const UpdateTeamSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  color: z.string().max(16).nullable().optional(),
});
export type UpdateTeamRequest = z.infer<typeof UpdateTeamSchema>;

export const SetTeamCollaboratorsSchema = z.object({
  collaboratorIds: z.array(z.string().uuid()),
});
export type SetTeamCollaboratorsRequest = z.infer<
  typeof SetTeamCollaboratorsSchema
>;

// Brief schedules
export const CreateBriefScheduleSchema = z.object({
  name: z.string().min(1).max(200),
  cadence: CadenceSchema,
  timezone: z.string().min(1),
  scope: ScopeSchema,
  /**
   * Months of history to generate briefs for at creation time; `0` skips the
   * backfill entirely. Each generated brief is one OpenAI call, so this is the
   * user-facing brake on a create request that would otherwise fan out up to
   * `BRIEFS_BACKFILL_MAX_BRIEFS` generations. Omitted → server default.
   *
   * Capped at 3 because `MAX_HISTORY_DAYS` is the ceiling on history anywhere
   * in the product; the server clamps the resolved window to it regardless.
   */
  backfillMonths: z.number().int().min(0).max(3).optional(),
});
export type CreateBriefScheduleRequest = z.infer<
  typeof CreateBriefScheduleSchema
>;

export const UpdateBriefScheduleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  cadence: CadenceSchema.optional(),
  timezone: z.string().min(1).optional(),
  scope: ScopeSchema.optional(),
});
export type UpdateBriefScheduleRequest = z.infer<
  typeof UpdateBriefScheduleSchema
>;

// Briefs (ad-hoc generate)
export const GenerateBriefSchema = z.object({
  scope: ScopeSchema,
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  /**
   * IANA zone the brief's days are tiled and labelled in — snapshotted onto the
   * row as `period_timezone`. A scheduled brief takes this from its schedule; an
   * on-demand one has no schedule, so the caller sends its own zone. Omitted
   * falls back to UTC.
   */
  timezone: z.string().optional(),
});
export type GenerateBriefRequest = z.infer<typeof GenerateBriefSchema>;

/**
 * Scope arrives flattened rather than as the nested `ScopeSchema` because this
 * is a GET — same flattening `ListBriefsQuerySchema` already uses. `refine`
 * rebuilds the discriminated union's guarantee: the id matching `scopeType`
 * must be present.
 */
export const BriefPreviewQuerySchema = z
  .object({
    scopeType: z.enum(['project', 'team', 'collaborator', 'repository']),
    scopeProjectId: z.string().uuid().optional(),
    scopeTeamId: z.string().uuid().optional(),
    scopeCollaboratorId: z.string().uuid().optional(),
    scopeRepositoryId: z.string().uuid().optional(),
    branch: z.string().min(1).max(255).optional(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
  })
  .refine(
    (q) =>
      (q.scopeType === 'project' && !!q.scopeProjectId) ||
      (q.scopeType === 'team' && !!q.scopeTeamId) ||
      (q.scopeType === 'collaborator' && !!q.scopeCollaboratorId) ||
      (q.scopeType === 'repository' && !!q.scopeRepositoryId),
    { message: 'The id matching scopeType is required' },
  );
export type BriefPreviewQuery = z.infer<typeof BriefPreviewQuerySchema>;

export const ListBriefsQuerySchema = z.object({
  scheduleId: z.string().uuid().optional(),
  scopeType: z.enum(['project', 'team', 'collaborator', 'repository']).optional(),
  scopeProjectId: z.string().uuid().optional(),
  scopeTeamId: z.string().uuid().optional(),
  scopeCollaboratorId: z.string().uuid().optional(),
  scopeRepositoryId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  excludeNoActivity: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type ListBriefsQuery = z.infer<typeof ListBriefsQuerySchema>;

export const BriefCommitsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  /**
   * Matches `authorGithubLogin`, falling back to `authorName` — the same key the
   * `contributors` facet returns, so a facet value always filters to itself.
   */
  contributor: z.string().min(1).max(200).optional(),
  /** `unclassified` means "no analysed analysis", matching `commitTypeCounts`. */
  commitType: z.enum(BRIEF_COMMIT_TYPES).optional(),
});
export type BriefCommitsQuery = z.infer<typeof BriefCommitsQuerySchema>;
