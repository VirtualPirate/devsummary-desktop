import type {
  AgentCliProviderName,
  AgentCliStatus,
  ApiResponse,
  LocalSettingsStatus,
  LocalSettingsTestResult,
  LocalSettingsUsage,
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

  usage: async (): Promise<ApiResponse<LocalSettingsUsage>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/usage`,
      method: "GET",
    });
    return response.data as ApiResponse<LocalSettingsUsage>;
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

  /** `refresh` forces a re-detect past the backend's 60 s cache. */
  agents: async (refresh = false): Promise<ApiResponse<AgentCliStatus[]>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/agents`,
      method: "GET",
      params: refresh ? { refresh: "1" } : undefined,
    });
    return response.data as ApiResponse<AgentCliStatus[]>;
  },

  testAgentCli: async (
    id: AgentCliProviderName,
  ): Promise<ApiResponse<LocalSettingsTestResult>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/agents/${id}/test`,
      method: "POST",
    });
    return response.data as ApiResponse<LocalSettingsTestResult>;
  },
};
