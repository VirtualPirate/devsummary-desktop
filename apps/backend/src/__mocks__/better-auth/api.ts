export class APIError extends Error {
  status: number;
  constructor(status: string, options?: { message?: string }) {
    super(options?.message ?? status);
    this.status = 400;
  }

  static fromStatus(status: string, options?: { message?: string }) {
    return new APIError(status, options);
  }
}

export function createAuthMiddleware(fn: any) {
  return fn;
}

export function isAPIError(error: unknown): error is APIError {
  return error instanceof APIError;
}
