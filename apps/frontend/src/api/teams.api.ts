import type {
  ApiResponse,
  CreateTeamRequest,
  SetTeamCollaboratorsRequest,
  Team,
  UpdateTeamRequest,
} from "@launchstack/api-interfaces";
import { axiosInstance } from "./axios-client";

const BASE = "/api/organizations/current/teams";

export const TeamsAPI = {
  list: async (): Promise<ApiResponse<Team[]>> => {
    const response = await axiosInstance.request({ url: BASE, method: "GET" });
    return response.data as ApiResponse<Team[]>;
  },

  get: async (teamId: string): Promise<ApiResponse<Team>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/${teamId}`,
      method: "GET",
    });
    return response.data as ApiResponse<Team>;
  },

  create: async (data: CreateTeamRequest): Promise<ApiResponse<Team>> => {
    const response = await axiosInstance.request({
      url: BASE,
      method: "POST",
      data,
    });
    return response.data as ApiResponse<Team>;
  },

  update: async (
    teamId: string,
    data: UpdateTeamRequest,
  ): Promise<ApiResponse<Team>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/${teamId}`,
      method: "PATCH",
      data,
    });
    return response.data as ApiResponse<Team>;
  },

  setCollaborators: async (
    teamId: string,
    data: SetTeamCollaboratorsRequest,
  ): Promise<ApiResponse<Team>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/${teamId}/collaborators`,
      method: "PUT",
      data,
    });
    return response.data as ApiResponse<Team>;
  },

  delete: async (teamId: string): Promise<void> => {
    await axiosInstance.request({
      url: `${BASE}/${teamId}`,
      method: "DELETE",
    });
  },
};
