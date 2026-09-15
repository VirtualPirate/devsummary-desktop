import type {
  ApiResponse,
  BriefCommitsQuery,
  BriefPreviewQuery,
  BriefPreviewResponse,
  BriefReportResponse,
  BriefResponse,
  DeliverBriefRequest,
  GenerateBriefEnqueueResponse,
  GenerateBriefRequest,
  ListBriefsQuery,
  PaginatedBriefCommits,
  PaginatedBriefs,
} from "@launchstack/api-interfaces";
import { axiosInstance } from "./axios-client";

const BASE = "/api/organizations/current/briefs";

export const BriefsAPI = {
  list: async (
    params: Partial<ListBriefsQuery> = {},
  ): Promise<ApiResponse<PaginatedBriefs>> => {
    const response = await axiosInstance.request({
      url: BASE,
      method: "GET",
      params,
    });
    return response.data as ApiResponse<PaginatedBriefs>;
  },

  get: async (briefId: string): Promise<ApiResponse<BriefResponse>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/${briefId}`,
      method: "GET",
    });
    return response.data as ApiResponse<BriefResponse>;
  },

  remove: async (briefId: string): Promise<void> => {
    await axiosInstance.request({
      url: `${BASE}/${briefId}`,
      method: "DELETE",
    });
  },

  listCommits: async (
    briefId: string,
    params: Partial<BriefCommitsQuery> = {},
  ): Promise<ApiResponse<PaginatedBriefCommits>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/${briefId}/commits`,
      method: "GET",
      params,
    });
    return response.data as ApiResponse<PaginatedBriefCommits>;
  },

  getReport: async (
    briefId: string,
  ): Promise<ApiResponse<BriefReportResponse>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/${briefId}/report`,
      method: "GET",
    });
    return response.data as ApiResponse<BriefReportResponse>;
  },

  preview: async (
    params: BriefPreviewQuery,
  ): Promise<ApiResponse<BriefPreviewResponse>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/preview`,
      method: "GET",
      params,
    });
    return response.data as ApiResponse<BriefPreviewResponse>;
  },

  /** Re-send a brief that already exists. Synchronous — the error
   *  (`not_in_channel`) is the point. */
  deliver: async (
    briefId: string,
    channel: DeliverBriefRequest["channel"],
  ): Promise<ApiResponse<BriefResponse>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/${briefId}/deliver`,
      method: "POST",
      data: { channel },
    });
    return response.data as ApiResponse<BriefResponse>;
  },

  generate: async (
    data: GenerateBriefRequest,
  ): Promise<ApiResponse<GenerateBriefEnqueueResponse>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/generate`,
      method: "POST",
      data,
    });
    return response.data as ApiResponse<GenerateBriefEnqueueResponse>;
  },
};
