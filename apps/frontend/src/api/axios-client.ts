import axios from "axios";

import { getAppConfig } from "../env/config-env";
import { useActiveOrganizationStore } from "../stores/active-organization-store";

// baseURL is read per request rather than at creation: `resolveAppConfig()` runs
// before render, but this module is imported by the API modules that the router
// pulls in, and import order is not something to depend on.
export const axiosInstance = axios.create();

axiosInstance.interceptors.request.use((config) => {
  const app = getAppConfig();
  config.baseURL = app.baseURL;
  config.headers = config.headers ?? {};
  // Every request. `LocalTokenGuard` 401s without it, health check aside.
  if (app.token) config.headers["x-desktop-token"] = app.token;

  const { activeOrganizationId } = useActiveOrganizationStore.getState();
  if (activeOrganizationId) {
    config.headers["X-Organization-Id"] = activeOrganizationId;
  }
  return config;
});
