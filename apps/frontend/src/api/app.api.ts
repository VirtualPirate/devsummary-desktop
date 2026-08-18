import { type ApiResponse } from "@launchstack/api-interfaces";

import { axiosInstance } from "./axios-client";

export const AppAPI = {
  getHello: async (): Promise<
    ApiResponse<{ message: string; version: string }>
  > => {
    const response = await axiosInstance.request({
      url: "/",
      method: "GET",
    });
    return response.data as ApiResponse<{ message: string; version: string }>;
  },
};
