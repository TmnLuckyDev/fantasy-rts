import { devices, expect, test, webkit } from '@playwright/test'
import { startSavedRoom } from '../scripts/army-room.ts'
import { Match } from '../src/server/match.ts'
import { cellCenter } from '../src/shared/map.ts'

test('landscape player recruits from two buildings, gets a base ping and finds groups after reconnect', async ({ browser }) => {
  const match = new Match()
  const checkpoint = match.checkpoint()
  checkpoint.resources.human.gold = 1750
  const hall = checkpoint.units.find(unit => unit.id === 1)!
  for (const unit of checkpoint.units) {
    if (unit.faction === 'human' && unit.id !== 1) Object.assign(unit, cellCenter(23, 15))
    if (unit.id === 9) Object.assign(unit, { x: hall.x + 45, y: hall.y })
  }
  for (const [kind, x, y] of [['barracks', 10, 14], ['barracks', 11, 11], ['farm', 14, 14], ['farm', 15, 11]] as const) {
    checkpoint.units.push({ ...hall, ...cellCenter(x, y), kind, id: ++checkpoint.sequence, queue: [] })
  }
  const fixture = await startSavedRoom(checkpoint, match.map)
  const isWebKit = process.env.MOBILE_BROWSER === 'webkit'
  const engine = isWebKit ? await webkit.launch() : browser
  const phone = devices[isWebKit ? 'iPhone 14' : 'Pixel 7']
  const mobile = await engine.newContext({ ...phone, viewport: { width: phone.viewport.height, height: phone.viewport.width } })
  const host = await browser.newContext()
  try {
    const [human, orc] = await Promise.all([mobile.newPage(), host.newPage()])
    await Promise.all([human, orc].map(async (page, i) => {
      await page.addInitScript(seat => sessionStorage.setItem('ash-and-iron-seat', JSON.stringify(seat)),
        { ...fixture.seats[i], code: fixture.code })
      await page.goto(fixture.url)
      await expect(page.locator('#battlefield canvas')).toBeVisible()
    }))
    const baseAlert = human.getByRole('button', { name: 'Base under attack' })
    await expect(baseAlert).toBeVisible()
    await expect(orc.getByRole('button', { name: 'Base under attack' })).toHaveCount(0)
    const minimap = human.locator('#minimap')
    const at = { x: hall.x / fixture.worldWidth, y: hall.y / fixture.worldHeight }
    await expect.poll(() => minimap.evaluate((canvas: HTMLCanvasElement, at) => {
      const ctx = canvas.getContext('2d')!
      return [...ctx.getImageData(Math.floor(at.x * canvas.width), Math.floor(at.y * canvas.height), 1, 1).data]
    }, at)).toEqual([255, 247, 173, 255])
    const map = (await minimap.boundingBox())!
    const target = { x: map.x + hall.x / fixture.worldWidth * map.width, y: map.y + hall.y / fixture.worldHeight * map.height }
    await human.touchscreen.tap(target.x, target.y)
    await baseAlert.tap()
    const footmen = human.getByRole('button', { name: 'Footman', exact: true })
    await footmen.tap()
    await expect(human.locator('#selection-name')).toHaveText('3 troops selected')
    await expect(footmen).toHaveAttribute('aria-pressed', 'true')
    await footmen.tap()
    await human.getByRole('button', { name: 'Army formation' }).tap()
    await human.getByRole('button', { name: 'Spread', exact: true }).tap()
    await expect(human.getByRole('button', { name: 'Army formation' })).toHaveText('Spread')
    await orc.getByRole('button', { name: 'All troops', exact: true }).click()
    await expect(orc.getByRole('button', { name: 'Army formation' })).toHaveText('Line')

    await human.getByRole('button', { name: 'Recruit', exact: true }).tap()
    const production = human.getByRole('region', { name: 'Global production' })
    await expect(production).toBeVisible()
    const panelBox = (await production.boundingBox())!
    const groupsBox = (await human.getByRole('navigation', { name: 'Troop groups' }).boundingBox())!
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(groupsBox.y + 1)
    await production.getByRole('button', { name: 'Train 10 Footman', exact: true }).tap()
    await expect(production).toContainText('10 queued')
    await expect(human.locator('#gold')).toHaveText('1000')
    await human.getByRole('button', { name: /^Queues/ }).tap()
    const queues = human.getByRole('region', { name: 'Production queues' })
    await expect(queues.getByText(/Barracks · Footman/)).toHaveCount(2)
    const living = async () => Number((await footmen.getAttribute('aria-description'))?.split(' ')[0])
    await expect.poll(living, { timeout: 12000 }).toBeGreaterThanOrEqual(5)

    await human.reload()
    await expect.poll(living).toBeGreaterThanOrEqual(5)
    await expect(human.getByRole('button', { name: 'All troops', exact: true })).toBeVisible()
    await expect(human.getByRole('button', { name: 'Heroes', exact: true })).toHaveCount(0)
  } finally {
    await Promise.all([host.close(), mobile.close()])
    if (engine !== browser) await engine.close()
    await fixture.close()
  }
})
