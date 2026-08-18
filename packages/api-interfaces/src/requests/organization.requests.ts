import { z } from "zod";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const CreateOrganizationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
});
export type CreateOrganizationRequest = z.infer<typeof CreateOrganizationSchema>;

export const UpdateOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    slug: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .regex(slugRegex, "Slug must be lowercase letters, numbers, and dashes")
      .optional(),
  })
  .refine((v) => v.name !== undefined || v.slug !== undefined, {
    message: "Provide at least one of name or slug",
  });
export type UpdateOrganizationRequest = z.infer<typeof UpdateOrganizationSchema>;

export const TransferOwnershipSchema = z.object({
  newOwnerUserId: z.string().min(1),
});
export type TransferOwnershipRequest = z.infer<typeof TransferOwnershipSchema>;

export const UpdateMemberRoleSchema = z.object({
  role: z.enum(["admin", "viewer"]),
});
export type UpdateMemberRoleRequest = z.infer<typeof UpdateMemberRoleSchema>;

export const CreateInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["admin", "viewer"]),
});
export type CreateInviteRequest = z.infer<typeof CreateInviteSchema>;

const InviteIdentifierSchema = z
  .object({
    token: z.string().min(1).optional(),
    inviteId: z.string().uuid().optional(),
  })
  .refine((v) => (v.token ? 1 : 0) + (v.inviteId ? 1 : 0) === 1, {
    message: "Provide exactly one of token or inviteId",
  });

export const AcceptInviteSchema = InviteIdentifierSchema;
export type AcceptInviteRequest = z.infer<typeof AcceptInviteSchema>;

export const DeclineInviteSchema = InviteIdentifierSchema;
export type DeclineInviteRequest = z.infer<typeof DeclineInviteSchema>;

export const InviteListQuerySchema = z.object({
  status: z
    .enum(["pending", "accepted", "revoked", "expired", "all"])
    .optional()
    .default("pending"),
});
export type InviteListQuery = z.infer<typeof InviteListQuerySchema>;
