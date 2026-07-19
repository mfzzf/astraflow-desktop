import { defineConfig } from "@hey-api/openapi-ts"

export default defineConfig({
  input: "../backend/astraflow-api/openapi.yaml",
  output: "lib/generated/astraflow-api",
  plugins: [
    {
      name: "@hey-api/client-next",
      runtimeConfigPath: "./lib/astraflow-api-client-config",
    },
  ],
})
