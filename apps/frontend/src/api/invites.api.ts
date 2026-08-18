import type {
  AcceptInviteRequest,
  ApiResponse,
  CreateInviteRequest,
  DeclineInviteRequest,
  InvitePreview,
  InviteStatus,
  Organization,
  OrganizationInvite,
} from "@launchstack/api-interfaces";
import { axiosInstance } from "./axios-client";

export const InvitesAPI = {
  createForCurrentOrg: async (
    payload: CreateInviteRequest,
  ): Promise<ApiResponse<OrganizationInvite>> => {
    const response = await axiosInstance.request({
      url: "/api/organizations/current/invites",
      method: "POST",
      data: payload,
    });
    return response.data as ApiResponse<OrganizationInvite>;
  },

  listForCurrentOrg: async (
    status: InviteStatus | "all" = "pending",
  ): Promise<ApiResponse<OrganizationInvite[]>> => {
    const response = await axiosInstance.request({
      url: "/api/organizations/current/invites",
      method: "GET",
      params: { status },
    });
    return response.data as ApiResponse<OrganizationInvite[]>;
  },

  revoke: async (inviteId: string): Promise<void> => {
    await axiosInstance.request({
      url: `/api/organizations/current/invites/${inviteId}`,
      method: "DELETE",
    });
  },

  resend: async (
    inviteId: string,
  ): Promise<ApiResponse<OrganizationInvite>> => {
    const response = await axiosInstance.request({
      url: `/api/organizations/current/invites/${inviteId}/resend`,
      method: "POST",
    });
    return response.data as ApiResponse<OrganizationInvite>;
  },

  listMine: async (): Promise<ApiResponse<OrganizationInvite[]>> => {
    const response = await axiosInstance.request({
      url: "/api/invites/me",
      method: "GET",
    });
    return response.data as ApiResponse<OrganizationInvite[]>;
  },

  accept: async (
    payload: AcceptInviteRequest,
  ): Promise<ApiResponse<{ organization: Organization }>> => {
    const response = await axiosInstance.request({
      url: "/api/invites/accept",
      method: "POST",
      data: payload,
    });
    return response.data as ApiResponse<{ organization: Organization }>;
  },

  decline: async (payload: DeclineInviteRequest): Promise<void> => {
    await axiosInstance.request({
      url: "/api/invites/decline",
      method: "POST",
      data: payload,
    });
  },

  preview: async (token: string): Promise<ApiResponse<InvitePreview>> => {
    const response = await axiosInstance.request({
      url: "/api/invites/preview",
      method: "GET",
      params: { token },
    });
    return response.data as ApiResponse<InvitePreview>;
  },
};
