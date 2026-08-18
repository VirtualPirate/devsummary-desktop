import type {
  ApiResponse,
  JobActivityResponse,
} from "@launchstack/api-interfaces";
import { axiosInstance } from "./axios-client";

const BASE = "/api/organizations/current/jobs";

export const JobsAPI = {
  activity: async (): Promise<ApiResponse<JobActivityResponse>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/activity`,
      method: "GET",
    });
    return response.data as ApiResponse<JobActivityResponse>;
  },
};
