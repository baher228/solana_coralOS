import { test, expect } from '@playwright/test'

/**
 * No route mocking — the app polls the REAL feed server, which folds a real recorded coral transcript
 * (a settled devnet round: cheap wins on price, premium loses, lazy declined coingecko).
 */
test('renders the live auction from the real feed pipeline', async ({ page }) => {
  await page.goto('/?session=fixture')

  const settled = page.locator('[data-testid="round"][data-round="1"]')
  await expect(settled).toBeVisible()
  await expect(settled.getByTestId('status')).toHaveText('settled')

  // two real bids; the cheaper one won; lazy self-selected out
  await expect(settled.getByTestId('bid')).toHaveCount(2)
  await expect(settled.getByTestId('declined')).toHaveText(/seller-lazy/)
  const winner = settled.locator('[data-testid="bid"][data-seller="seller-cheap"]')
  await expect(winner).toHaveClass(/bid-won/)

  // the buyer's reasoning carried into the transcript, and a real devnet release link
  await expect(settled.getByTestId('reason')).toBeVisible()
  const release = settled.getByTestId('settle').last()
  await expect(release).toHaveAttribute('href', /explorer\.solana\.com\/tx\/.+cluster=devnet/)
})

test('shows the connection indicator', async ({ page }) => {
  await page.goto('/?session=fixture')
  await expect(page.getByTestId('conn')).toBeVisible()
})
