import { QueryClient } from "@tanstack/react-query";

/**
 * The app's single QueryClient. Lives here rather than in `main.tsx` so
 * non-React code — the router's `beforeLoad` guards — can clear cached
 * per-user data when a session ends without a click on Sign out.
 */
export const queryClient = new QueryClient();
