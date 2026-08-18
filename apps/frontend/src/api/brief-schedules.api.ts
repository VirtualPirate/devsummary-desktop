import type {
  ApiResponse,
  BriefScheduleResponse,
  CreateBriefScheduleRequest,
  UpdateBriefScheduleRequest,
} from "@launchstack/api-interfaces";
import { axiosInstance } from "./axios-client";

const BASE = "/api/organizations/current/brief-schedules";

export const BriefSchedulesAPI = {
  list: async (): Promise<ApiResponse<BriefScheduleResponse[]>> => {
    const response = await axiosInstance.request({ url: BASE, method: "GET" });
    return response.data as ApiResponse<BriefScheduleResponse[]>;
  },

  get: async (id: string): Promise<ApiResponse<BriefScheduleResponse>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/${id}`,
      method: "GET",
    });
    return response.data as ApiResponse<BriefScheduleResponse>;
  },

  create: async (
    data: CreateBriefScheduleRequest,
  ): Promise<ApiResponse<BriefScheduleResponse>> => {
    const response = await axiosInstance.request({
      url: BASE,
      method: "POST",
      data,
    });
    return response.data as ApiResponse<BriefScheduleResponse>;
  },

  update: async (
    id: string,
    data: UpdateBriefScheduleRequest,
  ): Promise<ApiResponse<BriefScheduleResponse>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/${id}`,
      method: "PATCH",
      data,
    });
    return response.data as ApiResponse<BriefScheduleResponse>;
  },

  pause: async (id: string): Promise<ApiResponse<BriefScheduleResponse>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/${id}/pause`,
      method: "POST",
    });
    return response.data as ApiResponse<BriefScheduleResponse>;
  },

  resume: async (id: string): Promise<ApiResponse<BriefScheduleResponse>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/${id}/resume`,
      method: "POST",
    });
    return response.data as ApiResponse<BriefScheduleResponse>;
  },

  delete: async (id: string): Promise<void> => {
    await axiosInstance.request({
      url: `${BASE}/${id}`,
      method: "DELETE",
    });
  },
};
