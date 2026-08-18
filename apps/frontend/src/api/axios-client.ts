import axios from "axios";

import { globalEnv } from "../env/config-env";
import { useActiveOrganizationStore } from "../stores/active-organization-store";

export const axiosInstance = axios.create({
  baseURL: globalEnv.apiBaseUri,
  withCredentials: true,
});

axiosInstance.interceptors.request.use((config) => {
  const { activeOrganizationId } = useActiveOrganizationStore.getState();
  if (activeOrganizationId) {
    config.headers = config.headers ?? {};
    config.headers["X-Organization-Id"] = activeOrganizationId;
  }
  return config;
});
