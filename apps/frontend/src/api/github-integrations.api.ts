import type {
  ApiResponse,
  GithubInstallationWithRepos,
  ListRepositoryBranchesResponse,
  RepositoryIngestStatusResponse,
  SetRepositoryBranchesRequest,
  SetRepositoryBranchesResponse,
  StartGithubConnectResponse,
} from "@launchstack/api-interfaces"
import { axiosInstance } from "./axios-client"

const REPOS_BASE = "/api/integrations/github/repositories"

export const GithubIntegrationsAPI = {
  list: async (): Promise<ApiResponse<GithubInstallationWithRepos[]>> => {
    const response = await axiosInstance.request({
      url: "/api/integrations/github/installations",
      method: "GET",
    })
    return response.data as ApiResponse<GithubInstallationWithRepos[]>
  },

  start: async (): Promise<ApiResponse<StartGithubConnectResponse>> => {
    const response = await axiosInstance.request({
      url: "/api/integrations/github/installations/start",
      method: "POST",
    })
    return response.data as ApiResponse<StartGithubConnectResponse>
  },

  sync: async (
    installationId: string,
  ): Promise<ApiResponse<GithubInstallationWithRepos>> => {
    const response = await axiosInstance.request({
      url: `/api/integrations/github/installations/${installationId}/sync`,
      method: "POST",
    })
    return response.data as ApiResponse<GithubInstallationWithRepos>
  },

  disconnect: async (installationId: string): Promise<void> => {
    await axiosInstance.request({
      url: `/api/integrations/github/installations/${installationId}`,
      method: "DELETE",
    })
  },

  listBranches: async (
    repositoryId: string,
  ): Promise<ApiResponse<ListRepositoryBranchesResponse>> => {
    const response = await axiosInstance.request({
      url: `${REPOS_BASE}/${repositoryId}/branches`,
      method: "GET",
    })
    return response.data as ApiResponse<ListRepositoryBranchesResponse>
  },

  ingestStatus: async (): Promise<
    ApiResponse<RepositoryIngestStatusResponse>
  > => {
    const response = await axiosInstance.request({
      url: `${REPOS_BASE}/ingest-status`,
      method: "GET",
    })
    return response.data as ApiResponse<RepositoryIngestStatusResponse>
  },

  setBranches: async (
    payload: SetRepositoryBranchesRequest,
  ): Promise<ApiResponse<SetRepositoryBranchesResponse>> => {
    const response = await axiosInstance.request({
      url: `${REPOS_BASE}/branches`,
      method: "POST",
      data: payload,
    })
    return response.data as ApiResponse<SetRepositoryBranchesResponse>
  },
}
