import type { CreateClientConfig } from "@/lib/generated/astraflow-api/client.gen"

import { getAstraFlowApiBaseUrl } from "@/lib/astraflow-api"

export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl: getAstraFlowApiBaseUrl(),
  cache: "no-store",
})
