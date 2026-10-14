import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "pnpm exec tsx tests/browser-server.ts",
      url: "http://localhost:3000/health/ready",
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter @workspace/web dev",
      url: "http://localhost:5173",
      reuseExistingServer: false,
    },
  ],
});
