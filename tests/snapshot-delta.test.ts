import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyDelta, makeDelta } from '../src/shared/snapshot-delta.ts'
import type { Entity, Snapshot } from '../src/shared/protocol.ts'

const unit: Entity = { id: 1, x: 30, y: 40, hp: 40, maxHp: 100, kind: 'blade', faction: 'human', facing: 1, moving: false }
const base: Snapshot = {
  type: 'snapshot', tick: 20, fog: '1', resources: { gold: 1, wood: 2, stone: 3 },
  population: { used: 1, reserved: 0, limit: 10 }, upgrades: [], effects: [], entities: [unit]
}
const wire = (before: Snapshot, next: Snapshot) => JSON.parse(JSON.stringify(makeDelta(before, next)))

test('snapshot deltas reconcile movement, fog hides, reappearing entities and skipped sends', () => {
  const seen: Entity = { ...unit, id: 2, faction: 'orc' }
  const middle: Snapshot = { ...base, tick: 22, entities: [{ ...unit, x: 33, moving: true }, seen] }
  const end: Snapshot = { ...middle, tick: 28, entities: [{ ...unit, x: 49, hp: 15, moving: true }], fog: '2' }
  assert.deepEqual(applyDelta(base, wire(base, middle)), middle)
  assert.deepEqual(applyDelta(middle, wire(middle, end)), end)
  assert.deepEqual(applyDelta(base, wire(base, end)), end)
  assert.equal(applyDelta(base, wire(middle, end)), undefined)
  assert.deepEqual(wire(middle, end).removed, [seen.id])
})

test('changes and clearing of private training details are sent as complete entities', () => {
  const training = { ...unit, training: { kind: 'blade', progress: .5, remaining: 1 } } as Entity
  const before = { ...base, entities: [training] }
  const after = { ...base, tick: 22 }
  const delta = wire(before, after)
  assert.deepEqual(delta.upsert, [unit])
  assert.deepEqual(applyDelta(before, delta), after)
})
