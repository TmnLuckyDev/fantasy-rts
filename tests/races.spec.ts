import { devices, expect, test, webkit } from '@playwright/test'

test('desktop and portrait touch can choose the same race and play', async ({ browser, page, baseURL }) => {
  const mobileEngine = process.env.MOBILE_BROWSER === 'webkit' ? await webkit.launch() : browser
  const phone = devices[mobileEngine === browser ? 'Pixel 7' : 'iPhone 14']
  const mobile = await mobileEngine.newContext(phone)
  try {
    await page.goto(baseURL!)
    await expect(page.locator('#connection')).toHaveText('Online')
    await page.locator('[data-faction="elf"]').click()
    await page.getByRole('button', { name: 'Create room' }).click()
    const code = page.locator('#room-code')
    await expect(code).toHaveText(/^[A-Z2-9]{5}$/)
    const guest = await mobile.newPage()
    const invite = await code.innerText()
    await guest.goto(baseURL + '/?room=' + invite)
    await expect(guest.locator('#room-code')).toHaveText(invite)
    await guest.locator('[data-faction="dwarf"]').tap()
    await expect(page.locator('#seats')).toContainText('Ironbound Clans')
    await guest.locator('[data-faction="elf"]').tap()
    for (const client of [page, guest]) {
      await expect(client.locator('#seats')).toContainText('Sylvan Covenant')
      await expect(client.locator('#seats')).toContainText('Sylvan Covenant · You')
    }
    await page.getByRole('button', { name: 'Ready', exact: true }).click()
    await guest.getByRole('button', { name: 'Ready', exact: true }).tap()
    for (const client of [page, guest]) {
      await expect(client.locator('#battlefield canvas')).toBeVisible()
      await expect(client.locator('#banner')).toContainText('Sylvan Covenant')
    }
    await guest.getByRole('button', { name: /Sylvan Archer/ }).tap()
    await expect(guest.locator('#selection-name')).toHaveText('2 troops selected')
  } finally {
    await mobile.close()
    if (mobileEngine !== browser) await mobileEngine.close()
  }
})
