import { defineConfig } from "@hey-api/openapi-ts"

export default defineConfig({
  input: "backend/astraflow-api/openapi.yaml",
  output: "mobile-app/src/generated/astraflow-api",
  plugins: [
    {
      name: "@hey-api/client-fetch",
      runtimeConfigPath: "./mobile-app/src/lib/api-client-config",
    },
  ],
})
