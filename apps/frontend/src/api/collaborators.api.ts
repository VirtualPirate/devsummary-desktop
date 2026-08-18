import type { ApiResponse, Collaborator } from "@launchstack/api-interfaces";
import { axiosInstance } from "./axios-client";

export const CollaboratorsAPI = {
  list: async (): Promise<ApiResponse<Collaborator[]>> => {
    const response = await axiosInstance.request({
      url: "/api/organizations/current/collaborators",
      method: "GET",
    });
    return response.data as ApiResponse<Collaborator[]>;
  },
};
