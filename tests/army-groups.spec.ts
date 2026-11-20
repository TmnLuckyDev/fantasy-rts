import { once } from 'node:events'
import { devices, expect, test, webkit } from '@playwright/test'
import { WebSocket } from 'ws'
import { startSavedRoom } from '../scripts/army-room.ts'
import { Match } from '../src/server/match.ts'
import { ashford } from '../src/shared/map.ts'

const useWebKit = process.env.MOBILE_BROWSER === 'webkit'
const phone = devices[useWebKit ? 'iPhone 14' : 'Pixel 7']

test.use({ actionTimeout: 10_000 })

test('mobile Army Groups support selection, transfers, priority, scrolling and management during multiplayer', async ({ browser }) => {
  const engine = useWebKit ? await webkit.launch() : browser
  const mobile = await engine.newContext(phone)
  const match = new Match()
  match['spawn']('human', 'pathfinder', { x: ashford.bases.human.x + 30, y: ashford.bases.human.y + 45 })
  const fixture = await startSavedRoom(match.checkpoint(), match.map)
  const opponent = new WebSocket(fixture.url.replace('http:', 'ws:') + '/socket')
  try {
    await once(opponent, 'open')
    opponent.send(JSON.stringify({ type: 'resume', code: fixture.code, token: fixture.seats[1].token }))
    const page = await mobile.newPage()
    const commands: string[] = []
    page.on('websocket', socket => socket.on('framesent', ({ payload }) => {
      const message = JSON.parse(String(payload))
      if (message.order) commands.push(message.order.kind)
    }))
    await page.addInitScript(seat => sessionStorage.setItem('ash-and-iron-seat', JSON.stringify(seat)),
      { ...fixture.seats[0], code: fixture.code })
    await page.addInitScript(() => {
      const stroke = CanvasRenderingContext2D.prototype.strokeRect
      CanvasRenderingContext2D.prototype.strokeRect = function (x, y, width, height) {
        if (this.canvas.id === 'minimap') this.canvas.dataset.cameraLeft = String(x)
        stroke.call(this, x, y, width, height)
      }
    })
    await page.goto(fixture.url)
    const bar = page.locator('#troop-groups')
    const all = bar.getByRole('button', { name: 'All troops', exact: true })
    const sheet = page.getByRole('dialog', { name: 'Army groups' })
    const selected = page.locator('#selection-name')
    const main = bar.getByRole('button', { name: /^Main Army/ })
    const defense = bar.getByRole('button', { name: /^Defense/ })
    const groupAction = page.locator('#group-menu-open')
    await all.tap()
    await groupAction.tap()
    await sheet.getByRole('button', { name: 'Create Group', exact: true }).tap()
    await expect(sheet).toContainText('Footman × 3')
    await expect(sheet).toContainText('Archer × 2')
    await expect(sheet).toContainText('Total 7')
    await sheet.getByLabel('Group name').fill('Main Army')
    await sheet.getByRole('button', { name: 'Create Group', exact: true }).tap()
    await expect(main).toContainText('7/7')

    await page.getByRole('button', { name: 'Options', exact: true }).tap()
    await page.getByRole('dialog', { name: 'Match options' }).getByRole('button', { name: 'Army groups' }).tap()
    await sheet.getByRole('button', { name: 'Create Empty Army Template' }).tap()
    await sheet.getByLabel('Group name').fill('Defense')
    await sheet.getByLabel('Archer', { exact: true }).fill('1')
    await sheet.getByRole('button', { name: 'Save group', exact: true }).tap()
    await expect(sheet).toContainText('Defense · 0/1')
    await sheet.getByRole('button', { name: 'Close', exact: true }).tap()
    const troopNames = () => bar.locator('button:not([hidden]) > span:first-of-type').allTextContents()
    expect((await troopNames()).slice(0, 5)).toEqual(['All troops', 'Hero', 'Main Army', 'Defense', 'Footman'])

    await bar.getByRole('button', { name: 'Archer', exact: true }).tap()
    await groupAction.tap()
    await sheet.getByRole('button', { name: 'Add to Group', exact: true }).tap()
    await sheet.getByRole('combobox', { name: 'Army Group', exact: true }).selectOption({ label: 'Defense' })
    await expect(sheet).toContainText('2 selected troops to add.')
    await expect(sheet).toContainText('Group members will move from Main Army.')
    await sheet.getByLabel('Expand planned composition to fit the selection').check()
    await sheet.getByRole('button', { name: 'Add Selected Troops' }).tap()
    await expect(main).toContainText('5/7')
    await expect(defense).toContainText('2/2')
    await defense.tap()
    await expect(selected).toHaveText('Defense · 2/2')
    await expect(page.locator('#selection-detail')).toContainText('Archer 2/2')
    await expect(page.locator('#selection-detail')).toContainText('Priority 2')

    await all.tap()
    const pointer = { button: 0, pointerType: 'touch', pointerId: 11, isPrimary: true, clientX: 200, clientY: 700 }
    await defense.dispatchEvent('pointerdown', pointer)
    await defense.dispatchEvent('pointermove', { ...pointer, clientX: 100 })
    await bar.evaluate(element => { element.scrollLeft = 90 })
    expect(await bar.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    await defense.dispatchEvent('pointerup', { ...pointer, clientX: 100 })
    await defense.dispatchEvent('click', { detail: 1 })
    await expect(defense).toHaveAttribute('aria-pressed', 'false')
    await expect(sheet).toBeHidden()
    expect(commands.filter(kind => kind === 'move' || kind === 'advance')).toEqual([])

    await defense.dispatchEvent('pointerdown', pointer)
    await expect(sheet.getByRole('button', { name: 'Rename Group' })).toBeVisible()
    await defense.dispatchEvent('pointerup', pointer)
    await defense.dispatchEvent('click', { detail: 1 })
    await expect(defense).toHaveAttribute('aria-pressed', 'false')
    await sheet.getByRole('button', { name: '↑ Priority' }).tap()
    await expect(sheet).toContainText('Priority 1')
    await sheet.getByRole('button', { name: 'Rename Group' }).tap()
    await sheet.getByLabel('Group name').fill('Home Guard')
    await sheet.getByRole('button', { name: 'Save group', exact: true }).tap()
    await expect(sheet).toContainText('Home Guard · 2/2')
    await sheet.getByRole('button', { name: 'Edit Composition' }).tap()
    await sheet.getByLabel('Archer', { exact: true }).fill('3')
    await sheet.getByRole('button', { name: 'Save group', exact: true }).tap()
    await expect(sheet).toContainText('Home Guard · 2/3')
    await sheet.getByRole('button', { name: 'Close', exact: true }).tap()
    expect((await troopNames()).slice(0, 5)).toEqual(['All troops', 'Hero', 'Home Guard', 'Main Army', 'Footman'])

    await page.reload()
    const guard = bar.getByRole('button', { name: /^Home Guard/ })
    await expect(guard).toContainText('2/3')
    await guard.tap()
    await expect(selected).toHaveText('Home Guard · 2/3')
    const minimap = page.locator('#minimap')
    const viewLeft = async () => Number(await minimap.getAttribute('data-camera-left'))
    const mapBox = (await minimap.boundingBox())!
    await page.touchscreen.tap(mapBox.x + mapBox.width * .8, mapBox.y + mapBox.height * .5)
    await expect.poll(viewLeft).toBeGreaterThan(80)
    await guard.tap()
    await expect.poll(viewLeft).toBeLessThan(50)
    await groupAction.tap()
    await sheet.getByRole('button', { name: 'Remove Selected Units' }).tap()
    await expect(sheet).toContainText('Home Guard · 0/3')
    await sheet.getByRole('button', { name: 'Close', exact: true }).tap()
    await guard.click({ button: 'right' })
    await expect(sheet.getByRole('button', { name: 'Delete Group' })).toBeVisible()
    page.once('dialog', dialog => dialog.accept())
    await sheet.getByRole('button', { name: 'Delete Group' }).tap()
    await expect(guard).toHaveCount(0)
    await sheet.getByRole('button', { name: 'Close', exact: true }).tap()
    await expect(bar.getByRole('button', { name: 'Archer', exact: true })).toHaveAttribute('aria-description', /^2 living/)
  } finally {
    opponent.terminate()
    await Promise.allSettled([mobile.close(), fixture.close()])
    if (engine !== browser) await engine.close().catch(() => {})
  }
})

test('solo saves restore a group created from the battlefield selection', async ({ page, baseURL }) => {
  await page.goto(baseURL!)
  await page.getByRole('button', { name: 'Play vs Computer', exact: true }).click()
  await page.getByRole('button', { name: 'All troops', exact: true }).click()
  await page.locator('#group-menu-open').click()
  const sheet = page.getByRole('dialog', { name: 'Army groups' })
  await sheet.getByRole('button', { name: 'Create Group', exact: true }).click()
  await sheet.getByLabel('Group name').fill('First Patrol')
  await sheet.getByRole('button', { name: 'Create Group', exact: true }).click()
  const shortcut = page.locator('#troop-groups').getByRole('button', { name: /^First Patrol/ })
  await expect(shortcut).toContainText('6/6')
  const shortcuts = page.locator('#troop-groups > button:visible')
  await expect(shortcuts.nth(0)).toHaveAccessibleName('All troops')
  await expect(shortcuts.nth(1)).toHaveAccessibleName('Hero')
  await expect(shortcuts.nth(1)).toBeDisabled()
  await expect(shortcuts.nth(2)).toHaveAccessibleName(/^First Patrol/)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ash-and-iron-solo')?.includes('First Patrol') ?? false)).toBe(true)
  await page.reload()
  await expect(shortcut).toContainText('6/6')
  await shortcut.click()
  await expect(page.locator('#selection-name')).toHaveText('First Patrol · 6/6')
})
