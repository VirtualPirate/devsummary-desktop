import type {
  ApiResponse,
  SlackChannel,
  SlackInstallation,
} from "@launchstack/api-interfaces";
import { axiosInstance } from "./axios-client";

const BASE = "/api/integrations/slack/installations";
const ROOT = "/api/integrations/slack";

export const SlackAPI = {
  listInstallations: async (): Promise<ApiResponse<SlackInstallation[]>> => {
    const response = await axiosInstance.request({ url: BASE, method: "GET" });
    return response.data as ApiResponse<SlackInstallation[]>;
  },

  connectToken: async (
    token: string,
  ): Promise<ApiResponse<SlackInstallation>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/token`,
      method: "POST",
      data: { token },
    });
    return response.data as ApiResponse<SlackInstallation>;
  },

  disconnect: async (installationId: string): Promise<void> => {
    await axiosInstance.request({
      url: `${BASE}/${installationId}`,
      method: "DELETE",
    });
  },

  listChannels: async (): Promise<ApiResponse<SlackChannel[]>> => {
    const response = await axiosInstance.request({
      url: `${ROOT}/channels`,
      method: "GET",
    });
    return response.data as ApiResponse<SlackChannel[]>;
  },

  joinChannel: async (channelId: string): Promise<void> => {
    await axiosInstance.request({
      url: `${ROOT}/channels/${channelId}/join`,
      method: "POST",
    });
  },

  postMessage: async (payload: {
    channelId: string;
    text: string;
  }): Promise<ApiResponse<{ success: true; ts: string }>> => {
    const response = await axiosInstance.request({
      url: `${ROOT}/messages`,
      method: "POST",
      data: payload,
    });
    return response.data as ApiResponse<{ success: true; ts: string }>;
  },
};
