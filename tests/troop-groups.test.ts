import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexArmy } from '../src/client/troop-groups.ts'
import { Match } from '../src/server/match.ts'
import { parseMessage } from '../src/server/validate.ts'

test('automatic groups reflect living owned troops, removals and rejoining snapshots', () => {
  const match = new Match()
  const start = match.view('human').entities
  const army = indexArmy(start, 'human')
  assert.equal(army.get('all')?.length, 6)
  assert.equal(army.get('blade')?.length, 3)
  assert.equal(army.get('heroes'), undefined)
  const restored = indexArmy(start.filter(unit => unit.id !== 2).concat({ ...start.find(unit => unit.id === 3)!, id: 50, kind: 'vanguard' }), 'human')
  assert.equal(restored.get('all')?.length, 6)
  assert.equal(restored.get('blade')?.length, 2)
  assert.equal(restored.get('heroes')?.[0].id, 50)
})

test('one authoritative type order applies to every owned member beyond the manual ID limit', () => {
  const match = new Match()
  const unit = match.units.get(2)!
  for (let id = 25; id < 1025; id++) match.units.set(id, { ...unit, id })
  const order = { kind: 'move', to: { x: 990, y: 200 } } as const
  const message = { type: 'group-command', group: 'blade', order } as const
  assert.deepEqual(parseMessage(JSON.stringify(message)), message)
  assert.equal(parseMessage(JSON.stringify({ ...message, order: { kind: 'demolish' } })), null)
  assert.equal(parseMessage(JSON.stringify({ ...message, group: 'worker' })), null)
  assert.ok(match.commandGroup('human', 'blade', order))
  assert.equal([...match.units.values()].filter(unit => unit.order === order).length, 1003)
  assert.equal(match.units.get(9)?.order, null)
  assert.equal(match.units.get(15)?.order, null)
})
