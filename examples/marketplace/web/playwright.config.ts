import { defineConfig, devices } from '@playwright/test'

/**
 * E2E of the REAL read pipeline, deterministically and with no devnet:
 *   real feed server (FEED_FIXTURE = a recorded coral transcript) → real React app.
 * Playwright starts both servers. The only thing not live is coral itself — replaced by a recorded
 * extended-state response — so this exercises the actual collectMessages + foldRounds + HTTP + UI path.
 */
export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://localhost:5173', ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: 'npm start',
      cwd: '../feed',
      env: { FEED_FIXTURE: 'tests/coral-session.json', PORT: '4000' },
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
