import { devices, expect, test, webkit } from '@playwright/test'
import type { Page } from '@playwright/test'
import { startArmyRoom } from '../scripts/army-room.ts'
import { applyDelta } from '../src/shared/snapshot-delta.ts'
import type { SnapshotDelta } from '../src/shared/snapshot-delta.ts'
import { inTroopGroup } from '../src/shared/protocol.ts'
import type { ClientMessage, Snapshot } from '../src/shared/protocol.ts'

function observe(page: Page, faction: 'human' | 'orc') {
  let snapshot: Snapshot | undefined
  let ordered = 0
  let shots = 0
  let bytes = 0
  page.on('websocket', socket => {
    socket.on('framesent', ({ payload }) => {
      const message = JSON.parse(String(payload)) as ClientMessage
      if (message.type === 'command') ordered = message.ids.length
      if (message.type === 'group-command' && message.group === 'all') {
        ordered = snapshot?.entities.filter(entity => entity.faction === faction && inTroopGroup(entity.kind, message.group)).length ?? 0
      }
    })
    socket.on('framereceived', ({ payload }) => {
      const packet = JSON.parse(String(payload)) as Snapshot | SnapshotDelta
      if (packet.type !== 'snapshot' && packet.type !== 'delta') return
      snapshot = packet.type === 'snapshot' ? packet : applyDelta(snapshot, packet)
      if (!snapshot) return
      shots += snapshot.effects.filter(effect => effect.kind === 'shot').length
      bytes += Buffer.byteLength(String(payload))
    })
  })
  return {
    snapshot: () => snapshot, ordered: () => ordered, shots: () => shots, bytes: () => bytes
  }
}

function frameSample(page: Page) {
  return page.evaluate(() => new Promise<{ fps: number, p95Ms: number | null, maxMs: number | null }>(resolve => {
    const start = performance.now()
    let last = 0
    const gaps: number[] = []
    const frame = (time: number) => {
      if (last) gaps.push(time - last)
      last = time
      if (performance.now() - start < 5500) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    setTimeout(() => {
      const sorted = gaps.sort((a, b) => a - b)
      resolve({ fps: gaps.length * 1000 / (performance.now() - start), p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] ?? null,
        maxMs: sorted.at(-1) ?? null })
    }, 5500)
  }))
}

test('two browser players issue orders to 500 troops each and receive authoritative combat', async ({ browser }) => {
  test.setTimeout(75_000)
  const fixture = await startArmyRoom(process.env.BENCH_SOURCE)
  const isWebKit = process.env.MOBILE_BROWSER === 'webkit'
  const phone = devices[isWebKit ? 'iPhone 14' : 'Pixel 7']
  const engine = isWebKit ? await webkit.launch() : browser
  const host = await browser.newContext({ viewport: { width: 1280, height: 750 } })
  const guest = await engine.newContext({ ...phone, viewport: { width: phone.viewport.height, height: phone.viewport.width } })
  try {
    const clients = await Promise.all([host.newPage(), guest.newPage()])
    const state = clients.map((page, i) => observe(page, fixture.seats[i].faction))
    await Promise.all(clients.map(async (page, i) => {
      await page.addInitScript(seat => sessionStorage.setItem('ash-and-iron-seat', JSON.stringify(seat)),
        { ...fixture.seats[i], code: fixture.code })
      await page.goto(fixture.url)
      await expect(page.locator('#battlefield canvas')).toBeVisible()
      await expect.poll(() => state[i].snapshot()?.entities.filter(entity =>
        entity.faction === fixture.seats[i].faction && entity.kind !== 'headquarters').length).toBe(500)
      await page.getByRole('button', { name: 'All troops', exact: true }).click()
      await expect(page.locator('#selection-name')).toHaveText('500 troops selected')
      const map = (await page.locator('#minimap').boundingBox())!
      const focus = { x: map.x + map.width * .50, y: map.y + map.height * 384 / fixture.worldHeight }
      if (i) await page.touchscreen.tap(focus.x, focus.y)
      else await page.mouse.click(focus.x, focus.y)
      await page.getByRole('button', { name: 'Attack move', exact: true }).click()
    }))
    const first = state.map(client => client.snapshot()!)
    await Promise.all(clients.map(async (page, i) => {
      const box = (await page.locator('#battlefield').boundingBox())!
      const x = box.x + box.width * (i ? .27 : .73)
      const y = box.y + box.height * .44
      if (i) await page.touchscreen.tap(x, y)
      else await page.mouse.click(x, y, { button: 'right' })
    }))
    const samples = Promise.all(clients.map(frameSample))
    await Promise.all(state.map(async (client, i) => {
      await expect.poll(client.ordered).toBe(500)
      await expect.poll(() => client.snapshot()?.entities.some(entity => entity.faction === fixture.seats[i].faction &&
        entity.moving), { timeout: 3500 }).toBe(true)
      await expect.poll(client.shots, { timeout: 15000 }).toBeGreaterThan(0)
    }))
    const frames = await samples
    for (let i = 0; i < state.length; i++) {
      const snap = state[i].snapshot()!
      expect(snap.tick).toBeGreaterThan(first[i].tick)
      expect(new Set(snap.entities.map(entity => entity.id)).size).toBe(snap.entities.length)
      console.log('ASH_BROWSER_BENCH ' + JSON.stringify({
        player: fixture.seats[i].faction, mobileEngine: isWebKit ? 'webkit' : 'chromium',
        ...frames[i], bytes: state[i].bytes(), shots: state[i].shots(), tick: snap.tick
      }))
    }
  } finally {
    await Promise.all([host.close(), guest.close()])
    if (engine !== browser) await engine.close()
    await fixture.close()
  }
})
