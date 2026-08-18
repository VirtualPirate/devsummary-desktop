// User interfaces
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserDto {
  email: string;
  name: string;
  password: string;
}

export interface UpdateUserDto {
  email?: string;
  name?: string;
}

// API Response interfaces
export interface ApiResponse<T> {
  data: T;
  message: string;
  success: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Error interfaces
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export * from "./requests/auth.requests";
export * from "./requests/github.requests";
export * from "./responses/auth.responses";
export * from "./responses/github.responses";
export * from "./requests/organization.requests";
export * from "./responses/organization.responses";
export * from "./requests/briefs.requests";
export * from "./responses/briefs.responses";
export * from "./responses/collaborators.responses";
export * from "./responses/slack.responses";
export * from "./requests/analytics.requests";
export * from "./responses/analytics.responses";
export * from "./responses/jobs.responses";
export * from "./responses/health.responses";
export * from "./requests/local-settings.requests";
export * from "./responses/local-settings.responses";
