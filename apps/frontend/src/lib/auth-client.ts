import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { globalEnv } from "@/env/config-env";

export const authClient = createAuthClient({
  baseURL: globalEnv.apiBaseUri,
  plugins: [emailOTPClient()],
});
