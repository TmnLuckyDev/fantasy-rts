import { chromium, devices, expect, test, webkit } from '@playwright/test'
import type { Page } from '@playwright/test'
import { defaultMatchSettings } from '../src/shared/match-settings.ts'
import { TILE, ashford, cellCenter, distance } from '../src/shared/map.ts'
import { applyDelta } from '../src/shared/snapshot-delta.ts'
import type { SnapshotDelta } from '../src/shared/snapshot-delta.ts'
import { decodeFog } from '../src/shared/fog.ts'
import { isUnitKind } from '../src/shared/protocol.ts'
import type { Faction, Point, ServerMessage, Snapshot } from '../src/shared/protocol.ts'

const worldWidth = ashford.width * TILE
const worldHeight = ashford.height * TILE

function observe(page: Page) {
  const history = new Map<number, Snapshot>()
  page.on('websocket', socket => {
    if (!socket.url().endsWith('/socket')) return
    let base: Snapshot | undefined
    socket.on('framereceived', ({ payload }) => {
      const message = JSON.parse(String(payload)) as ServerMessage | SnapshotDelta
      if (message.type === 'snapshot') base = message
      else if (message.type === 'delta') base = applyDelta(base, message)
      else return
      if (base) history.set(base.tick, base)
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
  await page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
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

// These scenarios exercise exact map coordinates for gathering and touch construction.
const defaults = defaultMatchSettings()
const fixedAshford = {
  ...defaults,
  randomStarts: false,
  progression: false,
  sources: {
    ...defaults.sources,
    gold: { ...defaults.sources.gold, stock: 600 },
    stone: { ...defaults.sources.stone, stock: 400 }
  }
}

test('desktop and portrait touch players can finish an authoritative match', async ({ browser, baseURL }, info) => {
  test.setTimeout(265_000)
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 750 } })
  const mobileEngine = mobileBrowser === webkit ? await webkit.launch() : browser
  const phone = devices[mobileProfile]
  const touch = await mobileEngine.newContext(phone)
  await desktop.addInitScript(settings => localStorage.setItem('ash-and-iron-match-settings', JSON.stringify(settings)), fixedAshford)
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
    await expect(orc.locator('#seats')).toContainText('Bloodfang Horde · You')
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

    const minimapBounds = (await human.locator('#minimap').boundingBox())!
    const mapY = minimapBounds.y + minimapBounds.height / 2
    await human.mouse.move(minimapBounds.x + minimapBounds.width * .25, mapY)
    await human.mouse.down()
    try {
      const from = await cameraBox(human)
      await human.mouse.move(minimapBounds.x + minimapBounds.width * .75, mapY, { steps: 5 })
      await expect.poll(async () => (await cameraBox(human)).x).toBeGreaterThan(from.x + 30)
    } finally {
      await human.mouse.up()
    }
    await panTo(human, ashford.bases.human, false)

    const firstOrc = unit(orcHistory, 9)!
    const orcTap = await screenPoint(orc, { x: firstOrc.x, y: firstOrc.y - 13 }, ashford.bases.orc)
    await orc.touchscreen.tap(orcTap.x, orcTap.y)
    await expect(orc.locator('#selection-name')).toHaveText('Grunt')
    {
      const session = mobileBrowser === chromium ? await touch.newCDPSession(orc) : null
      let lastPoints: Point[] = []
      const touchEvent = async (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: Point[]) => {
        if (session) {
          await session.send('Input.dispatchTouchEvent', { type, touchPoints: touchPoints.map(({ x, y }, id) => ({ x, y, id })) })
          return
        }
        // WebKit's Playwright transport exposes taps but has no multi-pointer touch API.
        const event = type === 'touchStart' ? 'pointerdown' : type === 'touchMove' ? 'pointermove' : 'pointerup'
        const points = touchPoints.length ? touchPoints : lastPoints
        await orc.locator('#battlefield').evaluate((board, { event, points }) => {
          points.forEach(({ x, y }, i) => board.dispatchEvent(new PointerEvent(event, {
            pointerType: 'touch', pointerId: i + 10, clientX: x, clientY: y, button: 0, bubbles: true
          })))
        }, { event, points })
        lastPoints = touchPoints
      }
      const bounds = (await orc.locator('#battlefield').boundingBox())!
      const a = { x: bounds.x + bounds.width * 0.37, y: bounds.y + bounds.height * 0.44 }
      const b = { x: a.x + 100, y: a.y }
      const before = await cameraBox(orc)
      await touchEvent('touchStart', [a, b])
      await touchEvent('touchMove', [{ ...a, x: a.x + 100 }, { ...b, x: b.x + 100 }])
      await touchEvent('touchEnd', [])
      await expect.poll(() => cameraBox(orc).then(box => box.x)).toBeLessThan(before.x - 1)
      expect(Math.abs((await cameraBox(orc)).width - before.width)).toBeLessThanOrEqual(2)
      await expect(orc.locator('#selection-name')).toHaveText('Grunt')
      expect(unit(orcHistory, 9)).toEqual(firstOrc)

      await touchEvent('touchStart', [a, b])
      await touchEvent('touchMove', [{ ...a, x: a.x - 36 }, { ...b, x: b.x + 36 }])
      await touchEvent('touchEnd', [])
      await expect.poll(() => cameraBox(orc).then(box => box.width)).toBeLessThan(before.width - 1)
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
      await session?.detach()
    }
    await expect(orc.locator('#selection-name')).toHaveText('6 troops selected')
    if (process.env.CAPTURE_BROWSER === '1') await orc.screenshot({ path: info.outputPath('portrait-touch.png') })

    const retreat = cellCenter(ashford.width - 8, ashford.height - 32)
    await panTo(orc, retreat, true)
    const retreatTap = await screenPoint(orc, retreat, retreat)
    await orc.touchscreen.tap(retreatTap.x, retreatTap.y)
    await expect.poll(() => unit(orcHistory, 9)?.y ?? Infinity).toBeLessThan(firstOrc.y - 35)

    const archer = unit(humanHistory, 5)!
    const archerPoint = await screenPoint(human, { x: archer.x, y: archer.y - 13 }, ashford.bases.human)
    await human.mouse.dblclick(archerPoint.x, archerPoint.y)
    await expect(human.locator('#selection-name')).toHaveText('2 troops selected')
    await human.getByRole('button', { name: 'Workers', exact: true }).click()
    await expect(human.locator('#selection-name')).toHaveText('3 workers selected')
    const mine = await screenPoint(human, cellCenter(5, 18), ashford.bases.human)
    await expect(human.getByRole('group', { name: 'Gather resources' })).toBeVisible()
    await human.mouse.click(mine.x, mine.y)
    await human.mouse.click(mine.x, mine.y)
    await expect(human.locator('#selection-name')).toHaveText('Gold mine')
    await expect(human.locator('#selection-detail')).toHaveText('600 gold remaining')
    await human.getByRole('button', { name: 'Gather here', exact: true }).click()
    await expect(human.locator('#selection-detail')).not.toHaveText('600 gold remaining')
    await expect.poll(() => newest(humanHistory)?.resources.gold ?? 0, { timeout: 18_000 }).toBeGreaterThan(300)

    const quarry = await screenPoint(human, cellCenter(4, 15), ashford.bases.human)
    await human.mouse.click(quarry.x, quarry.y)
    await expect(human.locator('#selection-name')).toHaveText('Stone quarry')
    await expect(human.locator('#selection-detail')).toHaveText('400 stone remaining')

    const tree = await screenPoint(human, cellCenter(6, 7), ashford.bases.human)
    await human.mouse.click(tree.x, tree.y, { button: 'right' })
    await expect.poll(() => newest(humanHistory)?.resources.wood ?? 0, { timeout: 18_000 }).toBeGreaterThan(180)

    const barracks = cellCenter(11, 15)
    const barracksSpot = await screenPoint(human, barracks, ashford.bases.human)
    await human.getByRole('button', { name: 'Deselect selected units' }).click()
    await human.getByRole('button', { name: 'Build', exact: true }).click()
    await human.getByRole('button', { name: 'Barracks · 90 wood · 45 stone', exact: true }).click()
    await expect(human.locator('#placement-tip')).toBeVisible()
    await human.mouse.click(mine.x, mine.y)
    await expect(human.locator('#placement-message')).toHaveText('Blocked by terrain.')
    await human.mouse.click(barracksSpot.x, barracksSpot.y)
    await expect(human.locator('#placement-tip')).toBeVisible()
    await human.getByRole('button', { name: 'Deselect selected units' }).click()
    await expect(human.locator('#placement-tip')).toBeHidden()
    await human.getByRole('button', { name: 'Production', exact: true }).click()
    await human.getByRole('button', { name: 'Queues', exact: true }).click()
    await expect(human.getByRole('region', { name: 'Production queues' })).toContainText(/Barracks #\d+\s*Building/)
    await expect.poll(() => newest(humanHistory)?.entities.some(entity =>
      entity.kind === 'barracks' && entity.construction === undefined), { timeout: 23_000 }).toBe(true)
    await human.getByRole('button', { name: 'Close', exact: true }).click()
    await human.mouse.click(barracksSpot.x, barracksSpot.y - 20)
    await expect(human.locator('#selection-name')).toHaveText('Barracks')
    await human.getByRole('button', { name: 'Footman · 75 gold', exact: true }).click()
    await expect.poll(() => troops(humanHistory, 'human').length, { timeout: 12_000 }).toBe(7)
    await expect(human.locator('#population')).toHaveText('10/10')
    await expect(human.getByRole('button', { name: 'Footman · 75 gold', exact: true })).toBeDisabled()

    await human.getByRole('button', { name: 'Workers', exact: true }).click()
    await expect(human.locator('#selection-name')).toHaveText('Barracks')
    await human.getByRole('button', { name: 'Workers', exact: true }).click()
    const farm = await screenPoint(human, cellCenter(14, 15), ashford.bases.human)
    await human.getByRole('button', { name: 'Build', exact: true }).click()
    await human.getByRole('button', { name: 'Farm · 70 wood · 20 stone', exact: true }).click()
    await human.mouse.move(farm.x - 30, farm.y)
    await human.mouse.down()
    await human.mouse.move(farm.x, farm.y, { steps: 4 })
    await human.mouse.up()
    await expect(human.locator('#placement-tip')).toBeHidden()
    await expect(human.locator('#selection-name')).toHaveText('No units selected')
    expect(newest(humanHistory)?.entities.some(entity => entity.kind === 'farm')).toBe(false)
    await human.getByRole('button', { name: 'Workers', exact: true }).click()
    await human.getByRole('button', { name: 'Build', exact: true }).click()
    await human.getByRole('button', { name: 'Farm · 70 wood · 20 stone', exact: true }).click()
    await human.mouse.click(farm.x, farm.y)
    await expect(human.locator('#population')).toHaveText('10/20', { timeout: 20_000 })

    await orc.getByRole('button', { name: 'Workers', exact: true }).tap()
    await orc.getByRole('button', { name: 'Quarry stone', exact: true }).tap()
    await expect.poll(() => newest(orcHistory)?.resources.stone ?? 0, { timeout: 18_000 }).toBeGreaterThan(120)
    const tower = cellCenter(ashford.width - 11, ashford.height - 14)
    await orc.getByRole('button', { name: 'Base', exact: true }).tap()
    await orc.getByRole('button', { name: 'Workers', exact: true }).tap()
    await orc.getByRole('button', { name: 'Build', exact: true }).tap()
    await orc.getByRole('button', { name: 'Watch Tower · 55 wood · 85 stone', exact: true }).tap()
    const towerSpot = await screenPoint(orc, tower, base)
    await orc.touchscreen.tap(towerSpot.x, towerSpot.y)
    await expect.poll(() => newest(orcHistory)?.entities.some(entity =>
      entity.kind === 'tower' && entity.faction === 'orc')).toBe(true)
    await expect.poll(() => newest(orcHistory)?.entities.some(entity =>
      entity.kind === 'tower' && entity.faction === 'orc' && entity.construction === undefined), { timeout: 25_000 }).toBe(true)

    await orc.locator('#cancel-placement').tap()
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
    await expect(human.locator('#placement-message')).toHaveText('Choose where to attack-move.')
    await human.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(human.locator('#placement-tip')).toBeHidden()
    await human.getByRole('button', { name: 'Attack move', exact: true }).click()
    await panTo(human, base, false)
    const destination = await screenPoint(human, base, base)
    await human.mouse.click(destination.x, destination.y, { button: 'right' })
    await expect(human.locator('#placement-tip')).toBeHidden()
    await expect.poll(() => distance(before, unit(humanHistory, 2) ?? before)).toBeGreaterThan(45)
    expect(unit(orcHistory, 2)).toBeUndefined()
    expect(unit(humanHistory, 8)).toBeUndefined()

    await orc.reload()
    await expect(orc.locator('#battlefield canvas')).toBeVisible()
    await expect(orc.locator('#banner')).toContainText('Bloodfang Horde')
    expect(unit(orcHistory, 1)).toBeUndefined()
    await expect.poll(() => unit(humanHistory, 8)?.id, { timeout: 110_000 }).toBe(8)
    expect(decodeFog(newest(humanHistory)!.fog, ashford.tiles.length)[baseCell]).toBe(2)
    const target = await screenPoint(human, { x: base.x, y: base.y - 29 }, base)
    await human.mouse.click(target.x, target.y, { button: 'right' })
    await expect.poll(() => unit(orcHistory, 8)?.hp ?? Infinity, { timeout: 20_000 }).toBeLessThan(1500)
    await expect(human.getByRole('button', { name: 'Match statistics' })).toBeVisible({ timeout: 60_000 })
    await expect(human.locator('#result')).not.toBeVisible()
    await expect.poll(() => decodeFog(newest(humanHistory)!.fog, ashford.tiles.length).every(cell => cell === 2)).toBe(true)
    await human.getByRole('button', { name: 'Match statistics' }).click()
    await orc.getByRole('button', { name: 'Match statistics' }).tap()
    await expect(human.getByRole('heading', { name: 'Victory' })).toBeVisible()
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
  const context = await mobileEngine.newContext(phone)
  await context.addInitScript(settings => localStorage.setItem('ash-and-iron-match-settings', JSON.stringify(settings)), fixedAshford)
  try {
    let page = await context.newPage()
    await page.goto(baseURL!)
    await page.locator('button[data-faction="orc"]').tap()
    await page.getByRole('button', { name: 'Play vs Computer', exact: true }).tap()
    await expect(page.locator('#battlefield canvas')).toBeVisible()
    await expect(page.locator('#banner')).toContainText('Bloodfang Horde vs Computer')
    const hall = ashford.bases.orc
    const hallTap = await screenPoint(page, { x: hall.x, y: hall.y - 28 }, hall)
    await page.touchscreen.tap(hallTap.x, hallTap.y)
    await page.getByRole('button', { name: 'Train', exact: true }).tap()
    const peon = page.getByRole('button', { name: 'Peon · 60 gold', exact: true })
    await expect(peon).toBeVisible()
    await expect(page.getByRole('button', { name: /^Repair ·/ })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Mute sound' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('spinbutton', { name: 'Training quantity' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^\+(5|10)$/ })).toHaveCount(0)
    await peon.tap()
    await expect(page.locator('#production-count')).toHaveText('1')
    await expect(page.locator('#gold')).toHaveText('240')
    await page.getByRole('button', { name: 'Cancel last', exact: true }).tap()
    await expect(page.locator('#production-count')).toHaveText('0')
    await expect(page.locator('#gold')).toHaveText('300')
    const vanguard = page.getByRole('button', { name: 'Gorak Ironhand · 460 gold · 80 wood', exact: true })
    const ranger = page.getByRole('button', { name: 'Vesha Emberbow · 460 gold · 80 wood', exact: true })
    await expect(vanguard).toBeDisabled()
    await expect(ranger).toBeDisabled()
    await page.getByRole('button', { name: 'Mute sound' }).tap()
    await expect(peon).toBeHidden()
    await expect(page.getByRole('button', { name: 'Mute sound' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Mute sound' }).tap()
    await expect(page.getByRole('button', { name: 'Enable sound' })).toHaveAttribute('aria-pressed', 'false')

    const idle = () => page.getByRole('button', { name: /^Idle worker/ })
    await expect(idle()).toHaveText(/3/)
    await idle().tap()
    await expect(page.locator('#selection-name')).toHaveText('Peon')
    const gather = page.getByRole('group', { name: 'Gather resources' })
    for (const name of ['Mine gold', 'Chop wood', 'Quarry stone']) {
      await expect(gather.getByRole('button', { name, exact: true })).toBeVisible()
    }
    const build = page.getByRole('button', { name: 'Build', exact: true })
    const farm = page.getByRole('button', { name: 'Boar Farm · 70 wood · 20 stone', exact: true })
    await expect(farm).toBeHidden()
    await build.tap()
    await expect(gather).toBeHidden()
    await expect(farm).toBeVisible()
    const fieldBox = (await page.locator('#battlefield').boundingBox())!
    const openGround = { x: fieldBox.x + fieldBox.width * .65, y: fieldBox.y + 22 }
    await page.touchscreen.tap(openGround.x, openGround.y)
    await expect(farm).toBeHidden()
    await expect(page.locator('#selection-name')).toHaveText('Peon')
    await expect(idle()).toHaveText(/3/)
    await page.getByRole('button', { name: 'Gather', exact: true }).tap()
    await expect(gather).toBeVisible()
    // After loading the game assets the browser can play solo without any connection.
    await context.setOffline(true)
    await page.getByRole('button', { name: 'Mine gold', exact: true }).tap()
    await expect(idle()).toHaveText(/2/)
    await expect.poll(async () => Number(await page.locator('#gold').textContent()), { timeout: 15_000 }).toBeGreaterThan(300)
    await context.setOffline(false)

    await page.reload()
    await expect(page.locator('#banner')).toContainText('Bloodfang Horde vs Computer')
    await expect(page.getByRole('button', { name: 'Enable sound' })).toBeVisible()
    await expect(idle()).toHaveText(/2/)
    await page.close()
    page = await context.newPage()
    await page.goto(baseURL!)
    await page.getByRole('button', { name: 'Resume solo match', exact: true }).tap()
    await expect(idle()).toHaveText(/2/)
    await idle().tap()
    await expect(page.locator('#selection-name')).toHaveText('Peon')
    await page.getByRole('button', { name: 'Build', exact: true }).tap()
    await page.getByRole('button', { name: 'Stone Rampart · 28 stone', exact: true }).tap()
    await page.getByRole('button', { name: 'Base', exact: true }).tap()
    const start = await screenPoint(page, cellCenter(ashford.width - 12, ashford.height - 15), hall)
    const end = await screenPoint(page, cellCenter(ashford.width - 13, ashford.height - 15), hall)
    const last = await screenPoint(page, cellCenter(ashford.width - 14, ashford.height - 15), hall)
    // Inject pointer events for the drag so both engines exercise the same path
    // and can continue with Playwright touchscreen taps after the gesture.
    const field = page.locator('#battlefield')
    const dragPointer = { button: 0, pointerId: 7, pointerType: 'touch' }
    await field.dispatchEvent('pointerdown', { ...dragPointer, clientX: start.x, clientY: start.y })
    await field.dispatchEvent('pointermove', { ...dragPointer, clientX: end.x, clientY: end.y })
    await expect(page.locator('#placement-message')).toContainText('2 wall segments')
    await field.dispatchEvent('pointerup', { ...dragPointer, clientX: end.x, clientY: end.y })
    await expect(page.locator('#stone')).toHaveText('64')
    await expect(page.locator('#placement-tip')).toBeVisible()
    await page.touchscreen.tap(last.x, last.y)
    await expect(page.locator('#stone')).toHaveText('36')
    await page.locator('#cancel-placement').tap()
    await expect(page.locator('#production-count')).toHaveText('3')
    await expect(page.locator('#placement-tip')).toBeHidden()
    await page.getByRole('button', { name: 'Production', exact: true }).tap()
    await expect(page.getByRole('dialog', { name: 'Production', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Queues', exact: true }).tap()
    await expect(page.getByRole('region', { name: 'Production queues' })).toContainText(/Stone Rampart #\d+\s*Queued/)
    await page.getByRole('button', { name: 'Close', exact: true }).tap()
    await idle().tap()
    await page.setViewportSize({ width: phone.viewport.height, height: phone.viewport.width })
    await expect(page.locator('#portrait-prompt')).toBeVisible()
    await page.setViewportSize(phone.viewport)
    await expect(idle()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Minimap' })).toBeVisible()
    await expect(page.locator('#portrait-prompt')).toBeHidden()
    await expect(page.locator('#selection-name')).toHaveText('Peon')

    await page.getByRole('button', { name: 'Gather', exact: true }).tap()
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Leave', exact: true }).tap()
    await expect(page.getByRole('button', { name: 'Play vs Computer', exact: true })).toBeEnabled()
    await page.close()
    page = await context.newPage()
    await page.goto(baseURL!)
    await page.locator('button[data-faction="orc"]').tap()
    await page.getByRole('button', { name: 'Play vs Computer', exact: true }).tap()
    await expect(page.locator('#battlefield canvas')).toBeVisible()
    const demolishSpot = await screenPoint(page, { x: hall.x, y: hall.y - 28 }, hall)
    await page.touchscreen.tap(demolishSpot.x, demolishSpot.y)
    await expect(page.locator('#selection-name')).toHaveText('Great Hall')
    await page.getByRole('button', { name: 'Train', exact: true }).tap()
    await expect(page.getByRole('button', { name: 'Demolish', exact: true })).toHaveCount(0)
    const repair = page.getByRole('button', { name: /^Repair ·/ })
    await expect(repair).toBeVisible()
    const leave = page.getByRole('button', { name: 'Leave', exact: true })
    await leave.tap()
    await expect(repair).toBeHidden()
    await expect(page.locator('#battlefield')).toBeVisible()
    page.once('dialog', dialog => dialog.accept())
    await leave.tap()
    await expect(page.getByRole('button', { name: 'Play vs Computer', exact: true })).toBeEnabled()
  } finally {
    await context.close()
    if (mobileEngine !== browser) await mobileEngine.close()
  }
})

test('small portrait match supports double tap, filters, persistent graphics and a real solo pause', async ({ browser, baseURL }) => {
  const mobileEngine = mobileBrowser === webkit ? await webkit.launch() : browser
  const context = await mobileEngine.newContext({ ...devices[mobileProfile], viewport: { width: 360, height: 740 } })
  try {
    await context.addInitScript(settings => localStorage.setItem('ash-and-iron-match-settings', JSON.stringify(settings)), fixedAshford)
    const page = await context.newPage()
    await page.goto(baseURL!)
    await page.getByRole('button', { name: 'Play vs Computer' }).tap()
    await expect(page.locator('#battlefield canvas')).toBeVisible()
    const options = page.getByRole('button', { name: 'Options', exact: true })
    const dialog = page.getByRole('dialog', { name: 'Match options' })
    expect((await options.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await options.tap()
    await expect(dialog.getByRole('region', { name: 'Economy breakdown' })).toContainText('Idle 3')
    await dialog.getByLabel('Box selection').selectOption('workers')
    await dialog.getByLabel('Graphics').selectOption('low')
    await dialog.getByRole('button', { name: 'Close', exact: true }).tap()

    const base = ashford.bases.human
    const archer = await screenPoint(page, { x: base.x + 40, y: base.y - 37 }, base)
    await page.evaluate(({ x, y }) => {
      const field = document.getElementById('battlefield')!
      for (const id of [21, 22]) for (const event of ['pointerdown', 'pointerup']) {
        field.dispatchEvent(new PointerEvent(event, { pointerType: 'touch', pointerId: id, isPrimary: true,
          bubbles: true, clientX: x, clientY: y, button: 0 }))
      }
    }, archer)
    await expect(page.locator('#selection-name')).toHaveText('2 troops selected')

    const a = await screenPoint(page, { x: base.x - 65, y: base.y - 50 }, base)
    const b = await screenPoint(page, { x: base.x + 130, y: base.y + 65 }, base)
    await page.locator('#battlefield').evaluate((field, { a, b }) => {
      for (const [event, point] of [['pointerdown', a], ['pointermove', b], ['pointerup', b]] as const) {
        field.dispatchEvent(new PointerEvent(event, { pointerType: 'touch', pointerId: 31, isPrimary: true,
          bubbles: true, clientX: point.x, clientY: point.y, button: 0 }))
      }
    }, { a, b })
    await expect(page.locator('#selection-name')).toHaveText('3 workers selected')

    await page.getByRole('button', { name: 'Pause', exact: true }).tap()
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
    const savedTick = () => page.evaluate(() => JSON.parse(localStorage.getItem('ash-and-iron-solo') ?? 'null')?.save?.match?.tick ?? 0)
    await expect.poll(savedTick).toBeGreaterThan(0)
    await page.waitForTimeout(250)
    const tick = await savedTick()
    await page.waitForTimeout(1250)
    expect(await savedTick()).toBe(tick)
    await page.getByRole('button', { name: 'Resume', exact: true }).tap()
    await expect.poll(savedTick).toBeGreaterThan(tick)
    await page.reload()
    await expect(options).toBeVisible()
    await options.tap()
    await expect(dialog.getByLabel('Graphics')).toHaveValue('low')
  } finally {
    await context.close()
    if (mobileEngine !== browser) await mobileEngine.close()
  }
})
