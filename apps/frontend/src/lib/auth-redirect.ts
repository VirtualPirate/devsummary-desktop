export const DEFAULT_AUTH_REDIRECT_PATH = "/";
export const GOOGLE_SIGN_IN_ROUTE_PATH = "/google-sign-in";
export const GOOGLE_SIGN_UP_ROUTE_PATH = "/google-sign-up";
export const AUTH_ERROR_ROUTE_PATH = "/auth/error";
export const VERIFY_EMAIL_ROUTE_PATH = "/verify-email";

type AuthMode = "sign-in" | "sign-up";

function isSafeRedirectPath(path: string) {
  return path.startsWith("/") && !path.startsWith("//");
}

export function normalizeRedirectPath(redirect?: string) {
  if (typeof redirect !== "string" || redirect.length === 0) {
    return DEFAULT_AUTH_REDIRECT_PATH;
  }

  if (!isSafeRedirectPath(redirect)) {
    return DEFAULT_AUTH_REDIRECT_PATH;
  }

  return redirect;
}

export function toAbsoluteCallbackURL(path: string) {
  return new URL(normalizeRedirectPath(path), window.location.origin).toString();
}

export function buildAuthRouteWithRedirect(routePath: string, redirectPath: string) {
  const normalizedRedirectPath = normalizeRedirectPath(redirectPath);
  if (normalizedRedirectPath === DEFAULT_AUTH_REDIRECT_PATH) {
    return routePath;
  }

  const params = new URLSearchParams({
    redirect: normalizedRedirectPath,
  });
  return `${routePath}?${params.toString()}`;
}

export function buildVerifyEmailRoute(email: string, redirectPath?: string) {
  const params = new URLSearchParams({ email });
  const normalizedRedirectPath = normalizeRedirectPath(redirectPath);

  if (normalizedRedirectPath !== DEFAULT_AUTH_REDIRECT_PATH) {
    params.set("redirect", normalizedRedirectPath);
  }

  return `${VERIFY_EMAIL_ROUTE_PATH}?${params.toString()}`;
}

type BuildAuthErrorRouteOptions = {
  redirect?: string;
  mode?: AuthMode;
  message?: string;
  error?: string;
  errorDescription?: string;
};

export function buildAuthErrorRoute(options: BuildAuthErrorRouteOptions = {}) {
  const params = new URLSearchParams();
  const redirectPath = normalizeRedirectPath(options.redirect);

  if (redirectPath !== DEFAULT_AUTH_REDIRECT_PATH) {
    params.set("redirect", redirectPath);
  }

  if (options.mode) {
    params.set("mode", options.mode);
  }

  if (options.message) {
    params.set("message", options.message);
  }

  if (options.error) {
    params.set("error", options.error);
  }

  if (options.errorDescription) {
    params.set("error_description", options.errorDescription);
  }

  const queryString = params.toString();
  return queryString.length > 0
    ? `${AUTH_ERROR_ROUTE_PATH}?${queryString}`
    : AUTH_ERROR_ROUTE_PATH;
}

export function toAbsoluteAuthErrorCallbackURL(
  redirectPath?: string,
  mode?: AuthMode,
) {
  return new URL(
    buildAuthErrorRoute({ redirect: redirectPath, mode }),
    window.location.origin,
  ).toString();
}
