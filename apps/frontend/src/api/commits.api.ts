import type {
  ApiResponse,
  ListCommitsQuery,
  PaginatedCommits,
} from "@launchstack/api-interfaces";
import { axiosInstance } from "./axios-client";

const BASE = "/api/organizations/current/commits";

export const CommitsAPI = {
  list: async (
    params: Partial<ListCommitsQuery> = {},
  ): Promise<ApiResponse<PaginatedCommits>> => {
    const response = await axiosInstance.request({
      url: BASE,
      method: "GET",
      params,
    });
    return response.data as ApiResponse<PaginatedCommits>;
  },
};
