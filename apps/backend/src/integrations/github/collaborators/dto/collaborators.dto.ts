import { z } from 'zod';

export const RepositoryIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type RepositoryIdParam = z.infer<typeof RepositoryIdParamSchema>;

export interface CollaboratorDto {
  id: string;
  collaboratorId: string;
  githubUserId: string;
  login: string;
  avatarUrl: string | null;
  htmlUrl: string | null;
  type: string | null;
  siteAdmin: boolean;
  roleName: string;
  permissions: {
    admin: boolean;
    maintain: boolean;
    push: boolean;
    triage: boolean;
    pull: boolean;
  };
  updatedAt: string;
}
