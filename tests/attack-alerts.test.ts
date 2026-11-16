import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AttackAlerts } from '../src/server/attack-alerts.ts'
import { Match, TICK_HZ } from '../src/server/match.ts'
import { applyDelta, makeDelta } from '../src/shared/snapshot-delta.ts'

test('alerts coalesce within an area, prioritize headquarters and expire on cooldown', () => {
  const match = new Match()
  const alerts = new AttackAlerts()
  const troop = match.units.get(2)!
  for (const id of [2, 2, 3]) alerts.hit({ ...troop, id }, 1)
  assert.equal(alerts.current.length, 0)
  alerts.hit({ ...troop, id: 4 }, 2)
  assert.equal(alerts.current[0].kind, 'army')
  for (let id = 100; id < 300; id++) alerts.hit({ ...troop, id }, 3)
  assert.equal(alerts.current.length, 1)
  const hall = match.units.get(1)!
  alerts.hit(hall, 4)
  assert.equal(alerts.current[0].kind, 'base')
  for (let i = 1; i < 5; i++) alerts.hit({ ...hall, kind: 'worker', x: hall.x + i * 500 }, 4)
  assert.equal(alerts.current.length, 3)
  assert.equal(alerts.current[0].kind, 'base')
  alerts.advance(4 + 5 * TICK_HZ)
  assert.equal(alerts.current.length, 0)
  alerts.hit(hall, 5 + 5 * TICK_HZ)
  assert.equal(alerts.current.length, 0)
  alerts.hit(hall, 4 + 8 * TICK_HZ)
  assert.equal(alerts.current[0].kind, 'base')
})

test('only the owner receives an alert at the defender location and deltas clear old alerts', () => {
  const match = new Match()
  const before = match.view('human')
  const hall = match.units.get(1)!
  const orc = match.units.get(9)!
  for (const [id, unit] of match.units) if (id !== 1 && id !== 8 && id !== 9) match.units.delete(id)
  Object.assign(orc, { x: hall.x + 40, y: hall.y })
  match.step()
  match.step()
  const attacked = match.view('human')
  assert.deepEqual(attacked.alerts?.map(({ kind, at }) => ({ kind, at })), [{ kind: 'base', at: { x: hall.x, y: hall.y } }])
  assert.equal(match.view('orc').alerts, undefined)
  assert.deepEqual(applyDelta(before, makeDelta(before, attacked))?.alerts, attacked.alerts)
  match.units.delete(9)
  for (let i = 0; i < 5 * TICK_HZ; i++) match.step()
  assert.deepEqual(applyDelta(attacked, makeDelta(attacked, match.view('human')))?.alerts, [])
})
