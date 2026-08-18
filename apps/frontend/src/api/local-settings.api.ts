import type {
  ApiResponse,
  LocalSettingsStatus,
  LocalSettingsTestResult,
  TestEmailRequest,
  UpdateLocalCredentialsRequest,
} from "@launchstack/api-interfaces";
import { axiosInstance } from "./axios-client";

const BASE = "/api/local-settings";

/**
 * Credentials go in and never come back out — `status` answers booleans only,
 * so nothing here ever reads a stored secret.
 */
export const LocalSettingsAPI = {
  status: async (): Promise<ApiResponse<LocalSettingsStatus>> => {
    const response = await axiosInstance.request({ url: BASE, method: "GET" });
    return response.data as ApiResponse<LocalSettingsStatus>;
  },

  updateCredentials: async (
    payload: UpdateLocalCredentialsRequest,
  ): Promise<ApiResponse<LocalSettingsStatus>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/credentials`,
      method: "PUT",
      data: payload,
    });
    return response.data as ApiResponse<LocalSettingsStatus>;
  },

  testEmail: async (
    payload: TestEmailRequest,
  ): Promise<ApiResponse<LocalSettingsTestResult>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/test-email`,
      method: "POST",
      data: payload,
    });
    return response.data as ApiResponse<LocalSettingsTestResult>;
  },
};
