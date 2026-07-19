import type { CreateClientConfig } from "@/generated/astraflow-api/client.gen"

export const apiBaseUrl = (
  process.env.EXPO_PUBLIC_ASTRAFLOW_API_BASE_URL ||
  "https://astraflow-desktop.modelverse.cn/astraflow-desktop/api"
).replace(/\/$/, "")

export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl: apiBaseUrl,
})
