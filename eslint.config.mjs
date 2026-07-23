import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "examples/**",
    ".data/**",
    ".claude/**",
    "agents/**",
    "chatgpt/**",
    "landing-page/**",
    "admin-console/**",
    "integration-projects/**",
    "backend/astraflow-api/migration/workbuddy/**",
    "lib/generated/astraflow-api/**",
    "runtime/python/distributions/**",
    "runtime/sandbox/darwin-*/**",
    "runtime/sandbox/linux-*/**",
    "runtime/sandbox/win32-*/**",
    ".cache/**",
    "**/.npm-cache/**",
    "next-env.d.ts",
  ]),
])

export default eslintConfig
