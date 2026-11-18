import { devices, expect, test, webkit } from '@playwright/test'

test('the packaged-compatible solo flow plays, pauses and restores without a backend', async ({ browser, baseURL }) => {
  const useWebKit = process.env.MOBILE_BROWSER === 'webkit'
  const engine = useWebKit ? await webkit.launch() : browser
  const context = await engine.newContext(devices[useWebKit ? 'iPhone 14' : 'Pixel 7'])
  try {
    // The local server stands in for the native asset handler. Only packaged resources are reachable.
    const assetOrigin = new URL(baseURL!).origin
    await context.route('**/*', route => new URL(route.request().url()).origin === assetOrigin ?
      route.continue() : route.abort())
    await context.routeWebSocket('**/socket', socket => socket.close())
    const page = await context.newPage()
    const checkpointTick = () => page.evaluate(() => {
      const slot = JSON.parse(localStorage.getItem('ash-and-iron-solo') ?? 'null')
      return Number(slot?.save?.match?.tick ?? 0)
    })
    await page.goto(baseURL!)
    await page.getByRole('button', { name: 'Play vs Computer' }).tap()
    await expect(page.locator('#battlefield canvas')).toBeVisible()
    await expect.poll(checkpointTick).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Pause', exact: true }).tap()
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
    await expect.poll(checkpointTick).toBeGreaterThan(0)
    // The pause command writes a checkpoint even if it lands between periodic saves.
    await expect.poll(async () => {
      const before = await checkpointTick()
      await new Promise(resolve => setTimeout(resolve, 1200))
      return (await checkpointTick()) - before
    }).toBe(0)
    const stopped = await checkpointTick()
    await page.getByRole('button', { name: 'Resume', exact: true }).tap()
    await expect.poll(checkpointTick).toBeGreaterThan(stopped)
    await page.close()
    const resumed = await context.newPage()
    await resumed.goto(baseURL!)
    await resumed.getByRole('button', { name: 'Resume solo match' }).tap()
    await expect(resumed.locator('#battlefield canvas')).toBeVisible()
  } finally {
    await context.close()
    if (engine !== browser) await engine.close()
  }
})
