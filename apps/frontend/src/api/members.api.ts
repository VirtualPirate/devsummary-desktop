import type {
  ApiResponse,
  OrganizationMember,
  UpdateMemberRoleRequest,
} from "@launchstack/api-interfaces";
import { axiosInstance } from "./axios-client";

export const MembersAPI = {
  listCurrent: async (): Promise<ApiResponse<OrganizationMember[]>> => {
    const response = await axiosInstance.request({
      url: "/api/organizations/current/members",
      method: "GET",
    });
    return response.data as ApiResponse<OrganizationMember[]>;
  },

  updateRole: async (
    memberId: string,
    payload: UpdateMemberRoleRequest,
  ): Promise<ApiResponse<OrganizationMember>> => {
    const response = await axiosInstance.request({
      url: `/api/organizations/current/members/${memberId}`,
      method: "PATCH",
      data: payload,
    });
    return response.data as ApiResponse<OrganizationMember>;
  },

  remove: async (memberId: string): Promise<void> => {
    await axiosInstance.request({
      url: `/api/organizations/current/members/${memberId}`,
      method: "DELETE",
    });
  },

  leave: async (): Promise<void> => {
    await axiosInstance.request({
      url: "/api/organizations/current/members/me",
      method: "DELETE",
    });
  },
};
