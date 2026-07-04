import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 150_000,
  expect: {
    timeout: 10_000,
  },
  outputDir: "test-results",
  workers: 1,
  use: {
    baseURL: "http://localhost:3011",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
