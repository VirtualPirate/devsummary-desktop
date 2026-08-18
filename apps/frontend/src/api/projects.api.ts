import type {
  ApiResponse,
  CreateProjectRequest,
  Project,
  SetProjectRepositoriesRequest,
  UpdateProjectRequest,
} from "@launchstack/api-interfaces";
import { axiosInstance } from "./axios-client";

const BASE = "/api/organizations/current/projects";

export const ProjectsAPI = {
  list: async (): Promise<ApiResponse<Project[]>> => {
    const response = await axiosInstance.request({ url: BASE, method: "GET" });
    return response.data as ApiResponse<Project[]>;
  },

  get: async (projectId: string): Promise<ApiResponse<Project>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/${projectId}`,
      method: "GET",
    });
    return response.data as ApiResponse<Project>;
  },

  create: async (data: CreateProjectRequest): Promise<ApiResponse<Project>> => {
    const response = await axiosInstance.request({
      url: BASE,
      method: "POST",
      data,
    });
    return response.data as ApiResponse<Project>;
  },

  update: async (
    projectId: string,
    data: UpdateProjectRequest,
  ): Promise<ApiResponse<Project>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/${projectId}`,
      method: "PATCH",
      data,
    });
    return response.data as ApiResponse<Project>;
  },

  setRepositories: async (
    projectId: string,
    data: SetProjectRepositoriesRequest,
  ): Promise<ApiResponse<Project>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/${projectId}/repositories`,
      method: "PUT",
      data,
    });
    return response.data as ApiResponse<Project>;
  },

  delete: async (projectId: string): Promise<void> => {
    await axiosInstance.request({
      url: `${BASE}/${projectId}`,
      method: "DELETE",
    });
  },
};
