import { chromium, devices, expect, test, webkit } from '@playwright/test'
import type { Page } from '@playwright/test'
import { TILE, ashford, cellCenter, distance } from '../src/shared/map.ts'
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

const mobileBrowser = process.env.MOBILE_BROWSER === 'webkit' ? webkit : chromium
const mobileProfile = process.env.MOBILE_BROWSER === 'webkit' ? 'iPhone 14' : 'Pixel 7'

test('desktop and landscape touch players can finish an authoritative match', async ({ browser, baseURL }, info) => {
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
    .filter(entity => entity.faction === faction && entity.kind !== 'headquarters') ?? []

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
    expect(humanHistory.get(shared!)).toEqual(orcHistory.get(shared!))

    const firstOrc = unit(orcHistory, 9)!
    const orcTap = await screenPoint(orc, { x: firstOrc.x, y: firstOrc.y - 13 }, ashford.bases.orc)
    await orc.touchscreen.tap(orcTap.x, orcTap.y)
    await expect(orc.locator('#selection-name')).toHaveText('Grunt')
    await orc.getByRole('button', { name: 'All troops' }).tap()
    await expect(orc.locator('#selection-name')).toHaveText('6 troops selected')
    if (process.env.CAPTURE_BROWSER === '1') await orc.screenshot({ path: info.outputPath('landscape-touch.png') })

    const retreat = cellCenter(40, 7)
    await panTo(orc, retreat, true)
    const retreatTap = await screenPoint(orc, retreat, retreat)
    await orc.touchscreen.tap(retreatTap.x, retreatTap.y)
    await expect.poll(() => unit(humanHistory, 9)?.y ?? Infinity).toBeLessThan(firstOrc.y - 35)

    const before = unit(humanHistory, 2)!
    const start = await screenPoint(human, { x: 229, y: 310 }, ashford.bases.human)
    const end = await screenPoint(human, { x: 350, y: 418 }, ashford.bases.human)
    await human.mouse.move(start.x, start.y)
    await human.mouse.down()
    await human.mouse.move(end.x, end.y, { steps: 7 })
    await human.mouse.up()
    await expect(human.locator('#selection-name')).toHaveText('6 troops selected')
    if (process.env.CAPTURE_BROWSER === '1') await human.screenshot({ path: info.outputPath('battlefield.png') })
    const base = ashford.bases.orc
    await panTo(human, base, false)
    const target = await screenPoint(human, { x: base.x, y: base.y - 29 }, base)
    await human.mouse.click(target.x, target.y, { button: 'right' })
    await expect.poll(() => distance(before, unit(orcHistory, 2) ?? before)).toBeGreaterThan(45)

    await orc.reload()
    await expect(orc.locator('#battlefield canvas')).toBeVisible()
    await expect(orc.locator('#banner')).toContainText('Orcish Horde')
    await expect.poll(() => unit(humanHistory, 8)?.hp ?? 0, { timeout: 30_000 }).toBeLessThan(420)
    await expect(human.getByRole('heading', { name: 'Victory' })).toBeVisible({ timeout: 30_000 })
    await expect(orc.getByRole('heading', { name: 'Defeat' })).toBeVisible()
    expect(unit(humanHistory, 8)).toBeUndefined()
    expect(pageErrors).toEqual([])
  } finally {
    await desktop.close()
    await touch.close()
    if (mobileEngine !== browser) await mobileEngine.close()
  }
})
