import { defineConfig } from '@playwright/test'

const port = 4371
const baseURL = `http://127.0.0.1:${port}`
const executablePath = process.env.CHROMIUM_PATH

export default defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 6000 },
  use: {
    browserName: 'chromium',
    baseURL,
    launchOptions: executablePath ? { executablePath } : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm start',
    url: baseURL + '/healthz',
    env: { PORT: String(port) },
    reuseExistingServer: false,
    timeout: 15_000
  },
  reporter: 'list'
})
