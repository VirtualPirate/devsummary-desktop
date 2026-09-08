import type {
  ApiResponse,
  CommitActivityResponse,
  CommitHoursResponse,
  GetCommitActivityQuery,
  GetCommitHoursQuery,
} from "@launchstack/api-interfaces";
import { axiosInstance } from "./axios-client";

const BASE = "/api/organizations/current/analytics";

export const AnalyticsAPI = {
  getCommitActivity: async (
    params: GetCommitActivityQuery,
  ): Promise<ApiResponse<CommitActivityResponse>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/commit-activity`,
      method: "GET",
      params,
    });
    return response.data as ApiResponse<CommitActivityResponse>;
  },

  getCommitHours: async (
    params: GetCommitHoursQuery,
  ): Promise<ApiResponse<CommitHoursResponse>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/commit-hours`,
      method: "GET",
      params,
    });
    return response.data as ApiResponse<CommitHoursResponse>;
  },
};
