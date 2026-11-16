import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { parseMessage } from '../src/server/validate.ts'
import { training } from '../src/shared/economy.ts'
import { defaultMatchSettings } from '../src/shared/match-settings.ts'
import { allocateTraining } from '../src/shared/production.ts'

test('global distribution balances finish times, including large batches and mixed queues', () => {
  assert.deepEqual(allocateTraining([0, 0, 0, 0], 95, 20), [5, 5, 5, 5])
  assert.deepEqual(allocateTraining([500, 0, 0, 0], 95, 5), [0, 2, 2, 1])
  assert.deepEqual(allocateTraining([200, 0], 10, 1000), [490, 510])
})

test('global production shares authoritative affordability, population and queues', () => {
  const settings = defaultMatchSettings()
  settings.starting.gold = 1600
  const match = Match.configured(settings)
  const hall = match.units.get(1)!
  for (let id = 25; id < 32; id++) {
    const kind = id < 29 ? 'barracks' : 'farm'
    match.units.set(id, { ...hall, id, kind, queue: [], buildDuration: id === 28 ? 120 : 0 })
  }
  match.units.set(32, { ...hall, id: 32, kind: 'barracks', faction: 'orc', queue: [] })
  assert.match(match.trainGlobally('human', 'ranged', 1)!, /production building/)
  assert.match(match.trainGlobally('human', 'blade', 22)!, /gold/)
  assert.equal(match.trainGlobally('human', 'blade', 20), null)
  assert.deepEqual([25,26,27,28,32].map(id => match.units.get(id)?.queue[0]?.count ?? 0), [7,7,6,0,0])
  assert.equal(match.snapshot().resources.human.gold, 1600 - 20 * training.blade.gold)
  assert.equal(match.snapshot().population.human.reserved, 20)
  assert.ok(match.command('human', [25], { kind: 'cancel-train', count: 1 }))
  assert.equal(match.snapshot().population.human.reserved, 19)

  const lowCap = new Match()
  assert.match(lowCap.trainGlobally('human', 'worker', 2)!, /population/)
  assert.equal(lowCap.snapshot().resources.human.gold, 300)
  assert.equal(lowCap.trainGlobally('human', 'vanguard', 1), null)
  assert.match(lowCap.trainGlobally('human', 'pathfinder', 1)!, /one active or queued hero/)
  assert.equal(parseMessage('{"type":"global-train","unit":"blade","count":-1}'), null)
})
