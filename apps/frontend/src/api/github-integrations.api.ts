import type {
  ApiResponse,
  ConnectGithubTokenRequest,
  GithubInstallationWithRepos,
  ListRepositoryBranchesResponse,
  RepositoryIngestStatusResponse,
  SetRepositoryBranchesRequest,
  SetRepositoryBranchesResponse,
} from "@launchstack/api-interfaces"
import { axiosInstance } from "./axios-client"

const BASE = "/api/integrations/github"
const REPOS_BASE = `${BASE}/repositories`

export const GithubIntegrationsAPI = {
  /**
   * Still an array: a workspace holds at most one PAT, but the setup screen
   * reads `repositories` off each entry and that shape did not change.
   */
  list: async (): Promise<ApiResponse<GithubInstallationWithRepos[]>> => {
    const response = await axiosInstance.request({ url: BASE, method: "GET" })
    return response.data as ApiResponse<GithubInstallationWithRepos[]>
  },

  connectToken: async (
    payload: ConnectGithubTokenRequest,
  ): Promise<ApiResponse<GithubInstallationWithRepos>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/token`,
      method: "POST",
      data: payload,
    })
    return response.data as ApiResponse<GithubInstallationWithRepos>
  },

  sync: async (
    installationId: string,
  ): Promise<ApiResponse<GithubInstallationWithRepos>> => {
    const response = await axiosInstance.request({
      url: `${BASE}/installations/${installationId}/sync`,
      method: "POST",
    })
    return response.data as ApiResponse<GithubInstallationWithRepos>
  },

  disconnect: async (): Promise<void> => {
    await axiosInstance.request({ url: BASE, method: "DELETE" })
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
