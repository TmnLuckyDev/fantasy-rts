import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { training } from '../src/shared/economy.ts'

function stocked() {
  const state = new Match().checkpoint()
  state.resources.human.gold = 100_000
  state.settings = { ...state.settings!, populationCap: 2000 }
  const prototype = state.units[0]
  for (let i = 0; i < 102; i++) {
    state.units.push({ ...prototype, id: ++state.sequence, kind: 'farm', x: -1000 - 64 * i, queue: [] })
  }
  return Match.restore(state)
}

test('1, 5, 6, 20, 100 and 1000 workers reserve resources in one compact run', () => {
  for (const count of [1, 5, 6, 20, 100, 1000]) {
    const match = stocked()
    assert.ok(match.command('human', [1], { kind: 'train', unit: 'worker', count }))
    const copy = Match.restore(structuredClone(match.checkpoint()))
    assert.deepEqual(copy.view('human'), match.view('human'))
    assert.deepEqual(match.view('human').entities[0].training?.queue, [{ kind: 'worker', count }])
    assert.equal(match.view('human').population.reserved, count)
    assert.equal(match.view('human').resources.gold, 100_000 - count * training.worker.gold)
    assert.ok(match.command('human', [1], { kind: 'cancel-train', count }))
    assert.equal(match.view('human').population.reserved, 0)
    assert.equal(match.view('human').resources.gold, 100_000)
  }
})

test('repeated single training orders queue more than five units and each reserves its own cost', () => {
  const match = stocked()
  for (let i = 0; i < 12; i++) assert.ok(match.command('human', [1], { kind: 'train', unit: 'worker' }))
  assert.equal(match.view('human').population.reserved, 12)
  assert.equal(match.view('human').resources.gold, 100_000 - 12 * training.worker.gold)
  assert.deepEqual(match.view('human').entities[0].training?.queue, [{ kind: 'worker', count: 12 }])
})

test('mixed batches produce in order and cancellation and destruction release reservations', () => {
  const match = stocked()
  const barracks = { ...match.units.get(1)!, id: 2000, kind: 'barracks' as const, x: 336, y: 496, queue: [] }
  match.units.set(barracks.id, barracks)
  for (const unit of ['blade', 'polearm', 'blade'] as const) {
    assert.ok(match.command('human', [barracks.id], { kind: 'train', unit, count: 2 }))
  }
  assert.ok(match.command('human', [barracks.id], { kind: 'cancel-train', count: 1 }))
  assert.deepEqual(match.view('human').entities.find(unit => unit.id === barracks.id)?.training?.queue?.map(run => run.count), [2, 2, 1])
  for (let tick = 0; tick < training.blade.ticks - 1; tick++) match.step()
  assert.equal(match.view('human').population.used, 9)
  match.step()
  assert.equal(match.view('human').population.used, 10)
  assert.equal(match.view('human').population.reserved, 4)
  match.units.delete(barracks.id)
  assert.equal(match.view('human').population.reserved, 0)
  assert.equal(match.view('human').resources.gold, 100_000 - 3 * training.blade.gold - 2 * training.polearm.gold)
})

test('insufficient gold or farm capacity rejects the entire order', () => {
  const match = new Match()
  assert.equal(match.command('human', [1], { kind: 'train', unit: 'worker', count: 2 }), false)
  assert.equal(match.command('human', [1], { kind: 'train', unit: 'worker', count: 1000 }), false)
  assert.equal(match.view('human').population.reserved, 0)
  assert.equal(match.view('human').resources.gold, 300)
})
