import type {
  ApiResponse,
  CreateOrganizationRequest,
  MyOrganization,
  Organization,
  OrganizationRole,
  TransferOwnershipRequest,
  UpdateOrganizationRequest,
} from "@launchstack/api-interfaces";
import { axiosInstance } from "./axios-client";

export const OrganizationsAPI = {
  create: async (
    payload: CreateOrganizationRequest,
  ): Promise<ApiResponse<Organization>> => {
    const response = await axiosInstance.request({
      url: "/api/organizations",
      method: "POST",
      data: payload,
    });
    return response.data as ApiResponse<Organization>;
  },

  listMine: async (): Promise<ApiResponse<MyOrganization[]>> => {
    const response = await axiosInstance.request({
      url: "/api/organizations/me",
      method: "GET",
    });
    return response.data as ApiResponse<MyOrganization[]>;
  },

  getCurrent: async (): Promise<
    ApiResponse<{ organization: Organization; role: OrganizationRole }>
  > => {
    const response = await axiosInstance.request({
      url: "/api/organizations/current",
      method: "GET",
    });
    return response.data as ApiResponse<{
      organization: Organization;
      role: OrganizationRole;
    }>;
  },

  updateCurrent: async (
    payload: UpdateOrganizationRequest,
  ): Promise<ApiResponse<Organization>> => {
    const response = await axiosInstance.request({
      url: "/api/organizations/current",
      method: "PATCH",
      data: payload,
    });
    return response.data as ApiResponse<Organization>;
  },

  deleteCurrent: async (): Promise<void> => {
    await axiosInstance.request({
      url: "/api/organizations/current",
      method: "DELETE",
    });
  },

  transferOwnership: async (
    payload: TransferOwnershipRequest,
  ): Promise<ApiResponse<Organization>> => {
    const response = await axiosInstance.request({
      url: "/api/organizations/current/transfer-ownership",
      method: "POST",
      data: payload,
    });
    return response.data as ApiResponse<Organization>;
  },
};
