import type {
  AgentCliProviderName,
  AgentCliStatus,
  ApiResponse,
  EmailVerificationStatus,
  LocalSettingsStatus,
  LocalSettingsTestResult,
  RequestEmailVerificationRequest,
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

  /** `refresh` forces a re-detect past the backend's 60 s cache. */
  agents: async (refresh = false): Promise<ApiResponse<AgentCliStatus[]>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/agents`,
      method: "GET",
      params: refresh ? { refresh: "1" } : undefined,
    });
    return response.data as ApiResponse<AgentCliStatus[]>;
  },

  /** One poll of the magic-link gate. The backend talks to the API, not us. */
  verification: async (): Promise<ApiResponse<EmailVerificationStatus>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/verification`,
      method: "GET",
    });
    return response.data as ApiResponse<EmailVerificationStatus>;
  },

  /** Mail a link. Resend is the same call with the same address. */
  requestVerification: async (
    payload: RequestEmailVerificationRequest,
  ): Promise<ApiResponse<EmailVerificationStatus>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/verification`,
      method: "POST",
      data: payload,
    });
    return response.data as ApiResponse<EmailVerificationStatus>;
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
