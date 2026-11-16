import { devices, expect, test, webkit } from '@playwright/test'

test('mobile can customize a solo game and see the timed match statistics', async ({ browser, baseURL }) => {
  test.setTimeout(100_000)
  const mobile = process.env.MOBILE_BROWSER === 'webkit' ? await webkit.launch() : browser
  const context = await mobile.newContext(devices[mobile === browser ? 'Pixel 7' : 'iPhone 14'])
  try {
    const page = await context.newPage()
    await page.goto(baseURL!)
    await page.getByRole('button', { name: 'Match settings', exact: true }).tap()
    const menu = page.getByRole('dialog', { name: 'Match settings' })
    await menu.getByLabel('Map size').selectOption('ashford-original')
    await expect(menu.locator('[name="gold-count"]')).toHaveValue('3')
    await menu.getByLabel('Time limit (minutes)').fill('1')
    await menu.getByLabel('Starting gold', { exact: true }).fill('123')
    for (const resource of ['gold', 'wood', 'stone']) {
      await menu.locator('[name="' + resource + '-count"]').fill('0')
    }
    await menu.getByRole('button', { name: 'Save settings' }).tap()
    await page.reload()
    await page.getByRole('button', { name: 'Match settings', exact: true }).tap()
    await expect(menu.getByLabel('Map size')).toHaveValue('ashford-original')
    await expect(menu.getByLabel('Time limit (minutes)')).toHaveValue('1')
    await menu.getByRole('button', { name: 'Close settings' }).tap()
    await page.getByRole('button', { name: 'Play vs Computer' }).tap()
    await expect(page.locator('#match-clock')).toBeVisible()
    await expect(page.locator('#gold')).toHaveText('123')
    await expect(page.getByRole('region', { name: 'Match statistics' })).toBeVisible({ timeout: 80_000 })
    await expect(page.locator('#result-detail')).toContainText('Time expired')
    await expect(page.getByRole('rowheader', { name: 'Gold gathered' })).toBeVisible()
    await expect(page.getByRole('rowheader', { name: 'Final score' })).toBeVisible()
    await expect(page.getByRole('rowheader', { name: 'Enemy buildings razed' })).toBeVisible()
    await page.getByRole('button', { name: 'Back to lobby' }).tap()
    await expect(page.getByRole('button', { name: 'Play vs Computer' })).toBeVisible()
  } finally {
    await context.close()
    if (mobile !== browser) await mobile.close()
  }
})
