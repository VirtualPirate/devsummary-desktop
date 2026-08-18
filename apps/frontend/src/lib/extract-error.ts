export function extractErrorMessage(error: unknown): string {
  if (!error) return "Unknown error";
  const anyErr = error as {
    response?: { data?: { message?: string; details?: unknown } };
    message?: string;
  };
  return (
    anyErr.response?.data?.message ??
    anyErr.message ??
    "Something went wrong"
  );
}
