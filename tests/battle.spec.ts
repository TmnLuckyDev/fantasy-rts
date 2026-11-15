import { chromium, devices, expect, test, webkit } from '@playwright/test'
import type { Page } from '@playwright/test'
import { TILE, ashford, cellCenter, distance } from '../src/shared/map.ts'
import { decodeFog } from '../src/shared/fog.ts'
import { isUnitKind } from '../src/shared/protocol.ts'
import type { Faction, Point, ServerMessage, Snapshot } from '../src/shared/protocol.ts'

const worldWidth = ashford.width * TILE
const worldHeight = ashford.height * TILE

function observe(page: Page) {
  const history = new Map<number, Snapshot>()
  page.on('websocket', socket => {
    if (!socket.url().endsWith('/socket')) return
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(String(payload)) as ServerMessage
      if (message.type === 'snapshot') history.set(message.tick, message)
    })
  })
  return history
}

function newest(history: Map<number, Snapshot>) { return [...history.values()].at(-1) }
function unit(history: Map<number, Snapshot>, id: number) { return newest(history)?.entities.find(entity => entity.id === id) }

async function panTo(page: Page, point: Point, touch: boolean) {
  const rect = (await page.locator('#minimap').boundingBox())!
  const x = rect.x + rect.width * point.x / worldWidth
  const y = rect.y + rect.height * point.y / worldHeight
  if (touch) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

async function screenPoint(page: Page, point: Point, focused: Point) {
  const bounds = (await page.locator('#battlefield').boundingBox())!
  const zoom = bounds.width < 950 ? 0.88 : 1.06
  const clamp = (target: number, size: number, view: number) =>
    view >= size ? size / 2 : Math.min(size - view / 2, Math.max(view / 2, target))
  const cx = clamp(focused.x, worldWidth, bounds.width / zoom)
  const cy = clamp(focused.y, worldHeight, bounds.height / zoom)
  return {
    x: bounds.x + bounds.width / 2 + (point.x - cx) * zoom,
    y: bounds.y + bounds.height / 2 + (point.y - cy) * zoom
  }
}

async function cameraBox(page: Page) {
  return page.locator('#minimap').evaluate((canvas: HTMLCanvasElement) => {
    const { width, height } = canvas
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data
    const xs: number[] = []
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = pixels.subarray(i, i + 3)
      if (r > 173 && g > 148 && r - g > 18 && g - b > 28) xs.push((i / 4) % width)
    }
    return { x: Math.min(...xs), width: Math.max(...xs) - Math.min(...xs) }
  })
}

const mobileBrowser = process.env.MOBILE_BROWSER === 'webkit' ? webkit : chromium
const mobileProfile = process.env.MOBILE_BROWSER === 'webkit' ? 'iPhone 14' : 'Pixel 7'

test('desktop and landscape touch players can finish an authoritative match', async ({ browser, baseURL }, info) => {
  test.setTimeout(210_000)
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 750 } })
  const mobileEngine = mobileBrowser === webkit ? await webkit.launch() : browser
  const phone = devices[mobileProfile]
  const touch = await mobileEngine.newContext({
    ...phone,
    viewport: { width: phone.viewport.height, height: phone.viewport.width }
  })
  const human = await desktop.newPage()
  const orc = await touch.newPage()
  const humanHistory = observe(human)
  const orcHistory = observe(orc)
  const pageErrors: string[] = []
  for (const page of [human, orc]) page.on('pageerror', error => pageErrors.push(error.message))
  const troops = (state: Map<number, Snapshot>, faction: Faction) => newest(state)?.entities
    .filter(entity => entity.faction === faction && isUnitKind(entity.kind) && entity.kind !== 'worker') ?? []

  try {
    await human.goto(baseURL!)
    await expect(human.locator('#connection')).toHaveText('Online')
    if (process.env.CAPTURE_BROWSER === '1') await human.screenshot({ path: info.outputPath('lobby.png') })
    await human.getByRole('button', { name: 'Create room' }).click()
    await expect(human.locator('#room-code')).toHaveText(/^[A-Z2-9]{5}$/)
    const code = await human.locator('#room-code').innerText()

    await orc.goto(baseURL + '/?room=' + code)
    await expect(orc.getByLabel('Room code')).toHaveValue(code)
    await orc.getByRole('button', { name: 'Join', exact: true }).tap()
    await expect(orc.locator('#seats')).toContainText('Orcish Horde · You')
    await human.getByRole('button', { name: 'Ready', exact: true }).click()
    await orc.getByRole('button', { name: 'Ready', exact: true }).tap()
    await expect(human.locator('#battlefield canvas')).toBeVisible()
    await expect(orc.locator('#battlefield canvas')).toBeVisible()
    await expect.poll(() => troops(humanHistory, 'human').length).toBe(6)
    await expect.poll(() => troops(orcHistory, 'orc').length).toBe(6)
    const shared = [...humanHistory.keys()].find(tick => orcHistory.has(tick))
    expect(shared).toBeDefined()
    const humanStart = humanHistory.get(shared!)!
    const orcStart = orcHistory.get(shared!)!
    expect(humanStart.entities.every(entity => entity.faction === 'human')).toBe(true)
    expect(orcStart.entities.every(entity => entity.faction === 'orc')).toBe(true)
    expect(humanStart.fog).not.toBe(orcStart.fog)
    const base = ashford.bases.orc
    const baseCell = Math.floor(base.y / TILE) * ashford.width + Math.floor(base.x / TILE)
    expect(decodeFog(humanStart.fog, ashford.tiles.length)[baseCell]).toBe(0)
    const hiddenBase = await human.locator('#minimap').evaluate((map: HTMLCanvasElement, fraction) => {
      const pixel = map.getContext('2d')!.getImageData(Math.floor(map.width * fraction.x), Math.floor(map.height * fraction.y), 1, 1)
      return Array.from(pixel.data)
    }, { x: base.x / worldWidth, y: base.y / worldHeight })
    expect(hiddenBase).toEqual([13, 19, 16, 255])

    const firstOrc = unit(orcHistory, 9)!
    const orcTap = await screenPoint(orc, { x: firstOrc.x, y: firstOrc.y - 13 }, ashford.bases.orc)
    await orc.touchscreen.tap(orcTap.x, orcTap.y)
    await expect(orc.locator('#selection-name')).toHaveText('Grunt')
    if (mobileBrowser === chromium) {
      const session = await touch.newCDPSession(orc)
      const touchEvent = (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: Point[]) =>
        session.send('Input.dispatchTouchEvent', { type, touchPoints: touchPoints.map(({ x, y }, id) => ({ x, y, id })) })
      const bounds = (await orc.locator('#battlefield').boundingBox())!
      const a = { x: bounds.x + bounds.width * 0.37, y: bounds.y + bounds.height * 0.44 }
      const b = { x: a.x + 100, y: a.y }
      const before = await cameraBox(orc)
      await touchEvent('touchStart', [a, b])
      await touchEvent('touchMove', [{ ...a, x: a.x + 100 }, { ...b, x: b.x + 100 }])
      await touchEvent('touchEnd', [])
      await expect.poll(() => cameraBox(orc).then(box => box.x)).toBeLessThan(before.x - 4)
      expect(Math.abs((await cameraBox(orc)).width - before.width)).toBeLessThanOrEqual(2)
      await expect(orc.locator('#selection-name')).toHaveText('Grunt')
      expect(unit(orcHistory, 9)).toEqual(firstOrc)

      await touchEvent('touchStart', [a, b])
      await touchEvent('touchMove', [{ ...a, x: a.x - 36 }, { ...b, x: b.x + 36 }])
      await touchEvent('touchEnd', [])
      await expect.poll(() => cameraBox(orc).then(box => box.width)).toBeLessThan(before.width - 3)
      await expect(orc.locator('#selection-name')).toHaveText('Grunt')

      // Recenter without resetting zoom, then reset the zoom with the inverse pinch.
      await touchEvent('touchStart', [{ ...a, x: a.x - 36 }, { ...b, x: b.x + 36 }])
      await touchEvent('touchMove', [a, b])
      await touchEvent('touchEnd', [])
      await orc.getByRole('button', { name: 'Base', exact: true }).tap()
      const boxStart = await screenPoint(orc, { x: base.x - 122, y: base.y - 57 }, base)
      const boxEnd = await screenPoint(orc, { x: base.x - 27, y: base.y + 48 }, base)
      await touchEvent('touchStart', [boxStart])
      await touchEvent('touchMove', [boxEnd])
      await touchEvent('touchEnd', [])
      await session.detach()
    } else {
      await orc.getByRole('button', { name: 'All troops' }).tap()
    }
    await expect(orc.locator('#selection-name')).toHaveText('6 troops selected')
    if (process.env.CAPTURE_BROWSER === '1') await orc.screenshot({ path: info.outputPath('landscape-touch.png') })

    const retreat = cellCenter(ashford.width - 8, 7)
    await panTo(orc, retreat, true)
    const retreatTap = await screenPoint(orc, retreat, retreat)
    await orc.touchscreen.tap(retreatTap.x, retreatTap.y)
    await expect.poll(() => unit(orcHistory, 9)?.y ?? Infinity).toBeLessThan(firstOrc.y - 35)

    await human.getByRole('button', { name: 'Workers', exact: true }).click()
    await expect(human.locator('#selection-name')).toHaveText('3 workers selected')
    const mine = await screenPoint(human, cellCenter(5, 18), ashford.bases.human)
    await human.mouse.click(mine.x, mine.y, { button: 'right' })
    await expect.poll(() => newest(humanHistory)?.resources.gold ?? 0, { timeout: 18_000 }).toBeGreaterThan(300)

    const tree = await screenPoint(human, cellCenter(6, 7), ashford.bases.human)
    await human.mouse.click(tree.x, tree.y, { button: 'right' })
    await expect.poll(() => newest(humanHistory)?.resources.wood ?? 0, { timeout: 18_000 }).toBeGreaterThan(180)

    const barracks = cellCenter(11, 15)
    const barracksSpot = await screenPoint(human, barracks, ashford.bases.human)
    await human.getByRole('button', { name: 'Barracks · 90 wood · 45 stone', exact: true }).click()
    await expect(human.locator('#placement-tip')).toBeVisible()
    await human.mouse.click(barracksSpot.x, barracksSpot.y)
    await expect.poll(() => newest(humanHistory)?.entities.some(entity =>
      entity.kind === 'barracks' && entity.construction === undefined), { timeout: 23_000 }).toBe(true)
    await human.mouse.click(barracksSpot.x, barracksSpot.y - 20)
    await expect(human.locator('#selection-name')).toHaveText('Barracks')
    await human.getByRole('button', { name: 'Footman · 75 gold', exact: true }).click()
    await expect.poll(() => troops(humanHistory, 'human').length, { timeout: 12_000 }).toBe(7)
    await expect(human.locator('#population')).toHaveText('10/10')
    await expect(human.getByRole('button', { name: 'Footman · 75 gold', exact: true })).toBeDisabled()

    await human.getByRole('button', { name: 'Workers', exact: true }).click()
    const farm = await screenPoint(human, cellCenter(14, 15), ashford.bases.human)
    await human.getByRole('button', { name: 'Farm · 70 wood · 20 stone', exact: true }).click()
    await human.mouse.click(farm.x, farm.y)
    await expect(human.locator('#population')).toHaveText('10/15', { timeout: 20_000 })

    await orc.getByRole('button', { name: 'Workers', exact: true }).tap()
    const quarry = cellCenter(ashford.width - 5, ashford.height - 16)
    await panTo(orc, quarry, true)
    const quarryTap = await screenPoint(orc, quarry, quarry)
    await orc.touchscreen.tap(quarryTap.x, quarryTap.y)
    await expect.poll(() => newest(orcHistory)?.resources.stone ?? 0, { timeout: 18_000 }).toBeGreaterThan(120)
    const tower = cellCenter(ashford.width - 3, ashford.height - 11)
    await panTo(orc, tower, true)
    const towerSpot = await screenPoint(orc, tower, tower)
    await orc.getByRole('button', { name: 'Watch Tower · 55 wood · 85 stone', exact: true }).tap()
    await orc.touchscreen.tap(towerSpot.x, towerSpot.y)
    await expect.poll(() => newest(orcHistory)?.entities.some(entity =>
      entity.kind === 'tower' && entity.faction === 'orc' && entity.construction === undefined), { timeout: 18_000 }).toBe(true)

    const before = unit(humanHistory, 2)!
    const start = await screenPoint(human, { x: 229, y: 310 }, ashford.bases.human)
    const end = await screenPoint(human, { x: 350, y: 418 }, ashford.bases.human)
    await human.mouse.move(start.x, start.y)
    await human.mouse.down()
    await human.mouse.move(end.x, end.y, { steps: 7 })
    await human.mouse.up()
    await expect(human.locator('#selection-name')).toContainText('troops selected')
    await human.getByRole('button', { name: 'All troops', exact: true }).click()
    if (process.env.CAPTURE_BROWSER === '1') await human.screenshot({ path: info.outputPath('battlefield.png') })
    await human.getByRole('button', { name: 'Attack move', exact: true }).click()
    await panTo(human, base, false)
    const destination = await screenPoint(human, base, base)
    await human.mouse.click(destination.x, destination.y, { button: 'right' })
    await expect.poll(() => distance(before, unit(humanHistory, 2) ?? before)).toBeGreaterThan(45)
    expect(unit(orcHistory, 2)).toBeUndefined()
    expect(unit(humanHistory, 8)).toBeUndefined()

    await orc.reload()
    await expect(orc.locator('#battlefield canvas')).toBeVisible()
    await expect(orc.locator('#banner')).toContainText('Orcish Horde')
    expect(unit(orcHistory, 1)).toBeUndefined()
    await expect.poll(() => unit(humanHistory, 8)?.id, { timeout: 55_000 }).toBe(8)
    expect(decodeFog(newest(humanHistory)!.fog, ashford.tiles.length)[baseCell]).toBe(2)
    const target = await screenPoint(human, { x: base.x, y: base.y - 29 }, base)
    await human.mouse.click(target.x, target.y, { button: 'right' })
    await expect.poll(() => unit(orcHistory, 8)?.hp ?? Infinity, { timeout: 20_000 }).toBeLessThan(1500)
    await expect(human.getByRole('heading', { name: 'Victory' })).toBeVisible({ timeout: 60_000 })
    await expect(orc.getByRole('heading', { name: 'Defeat' })).toBeVisible()
    expect(unit(humanHistory, 8)).toBeUndefined()
    expect(pageErrors).toEqual([])
  } finally {
    await desktop.close()
    await touch.close()
    if (mobileEngine !== browser) await mobileEngine.close()
  }
})


test('a phone can resume a saved solo match and use worker commands without a server socket', async ({ browser, baseURL }) => {
  const mobileEngine = mobileBrowser === webkit ? await webkit.launch() : browser
  const phone = devices[mobileProfile]
  const context = await mobileEngine.newContext({
    ...phone,
    viewport: { width: phone.viewport.height, height: phone.viewport.width }
  })
  try {
    let page = await context.newPage()
    await page.goto(baseURL!)
    await page.locator('button[data-faction="orc"]').tap()
    await page.getByRole('button', { name: 'Play vs Computer', exact: true }).tap()
    await expect(page.locator('#battlefield canvas')).toBeVisible()
    await expect(page.locator('#banner')).toContainText('Orcish Horde vs Computer')
    const hall = ashford.bases.orc
    const hallTap = await screenPoint(page, { x: hall.x, y: hall.y - 28 }, hall)
    await page.touchscreen.tap(hallTap.x, hallTap.y)
    await expect(page.getByRole('button', { name: 'Peon · 60 gold', exact: true })).toBeVisible()

    const idle = () => page.getByRole('button', { name: /^Idle worker/ })
    await expect(idle()).toHaveText(/3/)
    await idle().tap()
    await expect(page.locator('#selection-name')).toHaveText('Peon')
    await expect(page.getByRole('button', { name: 'Boar Farm · 70 wood · 20 stone', exact: true })).toBeVisible()
    // After loading the game assets the browser can play solo without any connection.
    await context.setOffline(true)
    await page.getByRole('button', { name: 'Mine gold', exact: true }).tap()
    await expect(idle()).toHaveText(/2/)
    await expect.poll(async () => Number(await page.locator('#gold').textContent()), { timeout: 15_000 }).toBeGreaterThan(300)
    await context.setOffline(false)

    await page.reload()
    await expect(page.locator('#banner')).toContainText('Orcish Horde vs Computer')
    await expect(idle()).toHaveText(/2/)
    await page.close()
    page = await context.newPage()
    await page.goto(baseURL!)
    await page.getByRole('button', { name: 'Resume solo match', exact: true }).tap()
    await expect(idle()).toHaveText(/2/)
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Leave', exact: true }).tap()
    await expect(page.getByRole('button', { name: 'Play vs Computer', exact: true })).toBeEnabled()
  } finally {
    await context.close()
    if (mobileEngine !== browser) await mobileEngine.close()
  }
})
