import { test, expect } from '@playwright/test'

// The dashboard fetches same-origin by default; point it at the dev API.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { FREELANCE_API: string }).FREELANCE_API = 'http://localhost:8801'
  })
})

test('operator logs in and the dashboard loads live data', async ({ page }) => {
  await page.goto('/')

  // Login screen renders.
  await expect(page.getByRole('heading', { name: /open your escrow workspace/i })).toBeVisible()

  // Default account is the Northstar employer; continue into the workspace.
  await page.getByRole('button', { name: /^Continue$/ }).click()

  // The workspace shell renders with data and no error banner.
  await expect(page.getByText('Overview')).toBeVisible()
  await expect(page.getByText(/is not valid JSON|operator authentication required/i)).toHaveCount(0)
})

test('seeding a sample contract adds a job', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^Continue$/ }).click()

  await page.getByText('Settings').click()
  await page.getByRole('button', { name: /Seed sample contract/i }).click()

  // My postings badge / list should reflect at least one job.
  await page.getByText(/My postings/i).click()
  await expect(page.getByText(/Build a landing page checkout section/i).first()).toBeVisible()
})
