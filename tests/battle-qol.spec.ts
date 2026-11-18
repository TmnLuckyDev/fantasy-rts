import { devices, expect, test, webkit } from '@playwright/test'
import { startSavedRoom } from '../scripts/army-room.ts'
import { Match } from '../src/server/match.ts'
import { cellCenter } from '../src/shared/map.ts'

test('portrait player recruits from two buildings, gets a base ping and finds groups after reconnect', async ({ browser }) => {
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
  const mobile = await engine.newContext(phone)
  const host = await browser.newContext()
  try {
    const [human, orc] = await Promise.all([mobile.newPage(), host.newPage()])
    const pageErrors: string[] = []
    for (const page of [human, orc]) page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
    const battlefieldOrders: string[] = []
    human.on('websocket', socket => socket.on('framesent', ({ payload }) => {
      const raw = String(payload)
      const { type } = JSON.parse(raw)
      if (type === 'command' || type === 'group-command') battlefieldOrders.push(raw)
    }))
    await Promise.all([human, orc].map(async (page, i) => {
      await page.addInitScript(seat => sessionStorage.setItem('ash-and-iron-seat', JSON.stringify(seat)),
        { ...fixture.seats[i], code: fixture.code })
      await page.goto(fixture.url)
      await expect(page.locator('#battlefield canvas')).toBeVisible()
    }))
    const baseAlert = human.getByRole('button', { name: 'Base under attack', exact: true })
    await expect(baseAlert).toBeVisible()
    await expect(orc.getByRole('button', { name: 'Base under attack', exact: true })).toHaveCount(0)
    const ping = human.getByRole('button', { name: 'Minimap ping · Base under attack', exact: true })
    await expect(ping).toBeVisible()
    const minimap = human.locator('#minimap')
    const map = (await minimap.boundingBox())!
    const mapButton = (await human.getByRole('button', { name: 'Minimap', exact: true }).boundingBox())!
    expect(map.x).toBeGreaterThanOrEqual(0)
    expect(map.x + map.width).toBeLessThanOrEqual(mapButton.x + mapButton.width)
    expect(map.x + map.width).toBeLessThanOrEqual(phone.viewport.width)
    const box = (await ping.boundingBox())!
    const expectedX = map.x + hall.x / fixture.worldWidth * map.width
    const expectedY = map.y + hall.y / fixture.worldHeight * map.height
    expect(Math.abs(box.x + box.width / 2 - expectedX)).toBeLessThan(2)
    expect(Math.abs(box.y + box.height / 2 - expectedY)).toBeLessThan(2)
    await ping.tap()
    await baseAlert.tap()
    const cameraBack = human.getByRole('button', { name: 'Back to previous position' })
    await expect(cameraBack).toBeVisible()
    await cameraBack.tap()
    await expect(cameraBack).toBeHidden()
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

    await human.getByRole('button', { name: 'Production', exact: true }).tap()
    const sheet = human.getByRole('dialog', { name: 'Production' })
    const production = human.getByRole('region', { name: 'Global production' })
    await expect(production).toBeVisible()
    const panelBox = (await sheet.boundingBox())!
    const fieldBox = (await human.locator('#battlefield').boundingBox())!
    const outside = { x: fieldBox.x + fieldBox.width / 2, y: (fieldBox.y + panelBox.y) / 2 }
    const beforeDismiss = await human.locator('#selection-name').innerText()
    const sent = battlefieldOrders.length
    await human.touchscreen.tap(outside.x, outside.y)
    await expect(sheet).toBeHidden()
    await expect(human.locator('#selection-name')).toHaveText(beforeDismiss)
    expect(battlefieldOrders).toHaveLength(sent)
    await human.getByRole('button', { name: 'Workers', exact: true }).tap()
    await expect(human.locator('#selection-name')).toHaveText('3 workers selected')
    await human.getByRole('button', { name: 'Production', exact: true }).tap()
    await expect(production).toBeVisible()
    await production.getByRole('button', { name: 'Train 10 Footman', exact: true }).tap()
    await expect(production).toContainText('10 queued')
    await human.getByRole('button', { name: 'Upgrades', exact: true }).tap()
    const upgrades = human.getByRole('region', { name: 'Research upgrades' })
    await expect(upgrades).toBeVisible()
    await expect(upgrades).toContainText('Requires Blacksmith')
    await expect(upgrades).toContainText('+0 → +2')
    await human.getByRole('button', { name: 'Recruit', exact: true }).tap()
    await expect(human.getByRole('region', { name: 'Global production' })).toBeVisible()
    await human.getByRole('button', { name: /^Queues/ }).tap()
    const queues = human.getByRole('region', { name: 'Production queues' })
    await expect(queues.getByText(/^Barracks #/)).toHaveCount(2)
    await expect(queues).toContainText(/next .*total/)
    await queues.getByRole('button', { name: /^Cancel Footman ×/ }).first().tap()
    await expect(queues.getByText(/^Barracks #/)).toHaveCount(1)
    await expect.poll(async () => Number(await human.locator('#gold').innerText())).toBeGreaterThan(1000)
    await human.getByRole('button', { name: 'Close', exact: true }).tap()
    const living = async () => Number((await footmen.getAttribute('aria-description'))?.split(' ')[0])
    await expect.poll(living, { timeout: 12000 }).toBeGreaterThanOrEqual(5)

    expect(Number(await human.locator('#gold').innerText())).toBeGreaterThan(1000)
    await human.reload()
    await expect.poll(living).toBeGreaterThanOrEqual(5)
    await expect(human.getByRole('button', { name: 'All troops', exact: true })).toBeVisible()
    await expect(human.getByRole('button', { name: 'Heroes', exact: true })).toHaveCount(0)
    expect(pageErrors).toEqual([])
  } finally {
    await Promise.all([host.close(), mobile.close()])
    if (engine !== browser) await engine.close()
    await fixture.close()
  }
})
