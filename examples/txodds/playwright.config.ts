import { defineConfig } from '@playwright/test'

// End-to-end smoke against the dev servers. Playwright boots the API (:8801) and
// the Vite dashboard (:3020); the spec injects window.FREELANCE_API so the
// browser reaches the API cross-origin (see AGENTS.md dev-proxy note).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://localhost:3020', headless: true },
  webServer: [
    { command: 'npm run proxy', port: 8801, reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: 'npm run web', port: 3020, reuseExistingServer: !process.env.CI, timeout: 60_000 },
  ],
})
