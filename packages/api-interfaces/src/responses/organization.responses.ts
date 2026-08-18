export type OrganizationRole = "owner" | "admin" | "viewer";
export type InviteRole = "admin" | "viewer";
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
  createdAt: string;
}

export interface OrganizationInviteUserRef {
  id: string;
  name: string;
  email: string;
}

export interface OrganizationInvite {
  id: string;
  organizationId: string;
  email: string;
  role: InviteRole;
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
  invitedBy: OrganizationInviteUserRef | null;
  acceptedBy: OrganizationInviteUserRef | null;
  acceptedAt?: string | null;
}

export interface InvitePreview {
  organizationName: string;
  inviterName: string | null;
  invitedEmail: string;
  role: InviteRole;
  expiresAt: string;
}

export interface MyOrganization {
  organization: Organization;
  role: OrganizationRole;
}
