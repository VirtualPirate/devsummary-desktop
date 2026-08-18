import { useQuery } from "@tanstack/react-query";
import { type ApiResponse } from "@launchstack/api-interfaces";

import { AppAPI } from "../../api/app.api";

export function useGetHello() {
  return useQuery<ApiResponse<{ message: string; version: string }>>({
    queryKey: ["app", "hello"],
    queryFn: () => AppAPI.getHello(),
  });
}
