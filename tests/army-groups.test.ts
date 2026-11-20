import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { parseMessage } from '../src/server/validate.ts'
import { training } from '../src/shared/economy.ts'
import { cellCenter } from '../src/shared/map.ts'
import { applyDelta, makeDelta } from '../src/shared/snapshot-delta.ts'
import type { Order } from '../src/shared/protocol.ts'

test('groups created from a selection own its unique living troops and derive their targets', () => {
  const match = new Match()
  const temporary = match['spawn']('human', 'blade', cellCenter(14, 16))
  temporary.summonedUntil = 100
  assert.ok(match.command('human', [1], {
    kind: 'template-create', template: 0, name: 'Main Army', members: [2, 2, 3, 5, 15, 9, temporary.id]
  }))
  const [army] = match.view('human').templates!
  assert.deepEqual(army.targets, [{ kind: 'blade', count: 2 }, { kind: 'ranged', count: 1 }])
  assert.deepEqual(army.members.map(member => member.id), [2, 3, 5])
  assert.equal(match.view('orc').templates, undefined)
  assert.equal(match.command('orc', [1], { kind: 'template-remove', template: army.id }), false)
  assert.deepEqual(Match.restore(structuredClone(match.checkpoint())).view('human').templates, [army])
})

test('moves are exclusive, may expand the plan, and keep composition independent of manual membership', () => {
  const match = new Match()
  const order = (order: Order) => match.command('human', [1], order)
  assert.ok(order({ kind: 'template-create', template: 0, name: 'Main', members: [2, 3, 5] }))
  assert.ok(order({ kind: 'template-save', template: 0, name: 'Defense', targets: [{ kind: 'blade', count: 1 }] }))
  const previous = match.view('human')
  const [main, defense] = previous.templates!
  assert.ok(order({ kind: 'template-assign', template: defense.id, members: [2, 2, 3], expand: false }))
  assert.ok(order({ kind: 'template-assign', template: defense.id, members: [5], expand: true }))
  assert.ok(order({ kind: 'template-rename', template: defense.id, name: 'Home guard' }))
  match.step()
  const next = match.view('human')
  assert.deepEqual(next.templates!.map(group => group.name), ['Main', 'Home guard'])
  assert.deepEqual(next.templates!.map(group => group.members.map(member => member.id)), [[], [2, 3, 5]])
  assert.deepEqual(next.templates![1].targets, [{ kind: 'blade', count: 1 }, { kind: 'ranged', count: 1 }])
  assert.equal(previous.templates![0].members.length, 3)
  assert.deepEqual(applyDelta(previous, makeDelta(previous, next))?.templates, next.templates)

  assert.ok(order({ kind: 'template-release', template: defense.id, members: [2] }))
  assert.ok(order({ kind: 'template-priority', template: defense.id, direction: -1 }))
  assert.deepEqual(match.view('human').templates!.map(group => group.id), [defense.id, main.id])
  assert.ok(order({ kind: 'template-remove', template: defense.id }))
  assert.ok(match.units.has(2) && match.units.has(3) && match.units.has(5))
  assert.deepEqual(match.view('human').templates!.map(group => group.id), [main.id])
})

test('recruits refill a practiced army after a loss according to its updated priority', () => {
  const match = new Match()
  match['spawn']('human', 'barracks', cellCenter(11, 13))
  match['spawn']('human', 'farm', cellCenter(12, 15))
  assert.ok(match.command('human', [1], { kind: 'template-save', template: 0, name: 'Reserve', targets: [{ kind: 'blade', count: 1 }] }))
  assert.ok(match.command('human', [1], { kind: 'template-create', template: 0, name: 'Main', members: [2] }))
  const main = match.view('human').templates![1]
  assert.ok(match.command('human', [1], { kind: 'template-priority', template: main.id, direction: -1 }))
  match['destroy'](match.units.get(2)!)
  assert.equal(match.view('human').templates![0].members.length, 0)
  assert.deepEqual(match.view('human').templates![0].targets, main.targets)
  assert.ok(match.command('human', [1], { kind: 'template-replenish', template: main.id, expected: [{ kind: 'blade', count: 1 }] }))
  const resumed = Match.restore(structuredClone(match.checkpoint()))
  for (let tick = 0; tick <= training.blade.ticks; tick++) resumed.step()
  assert.deepEqual(resumed.view('human').templates!.map(group => group.members.length), [1, 0])
})

test('group orders validate member IDs, names, sizes and the expansion flag', () => {
  const message = (order: object) => parseMessage(JSON.stringify({ type: 'command', ids: [1], order }))
  assert.ok(message({ kind: 'template-create', template: 0, name: ' Army ', members: [2, 3] }))
  assert.equal(message({ kind: 'template-create', template: 0, name: ' ', members: [2] }), null)
  assert.equal(message({ kind: 'template-create', template: 9, name: 'Army', members: [2] }), null)
  assert.equal(message({ kind: 'template-create', template: 0, name: 'Army', members: Array(501).fill(2) }), null)
  assert.equal(message({ kind: 'template-assign', template: 4, members: [2], expand: 'true' }), null)
  assert.ok(message({ kind: 'template-assign', template: 4, members: [2], expand: false }))
})

test('a full plan rejects extra members atomically and their old group keeps them', () => {
  const match = new Match()
  const order = (order: Order) => match.command('human', [1], order)
  assert.ok(order({ kind: 'template-create', template: 0, name: 'Archers', members: [5] }))
  assert.ok(order({ kind: 'template-save', template: 0, name: 'Footmen', targets: [{ kind: 'blade', count: 500 }] }))
  const [archers, footmen] = match.view('human').templates!
  for (const expand of [true, false]) {
    assert.equal(order({ kind: 'template-assign', template: footmen.id, members: [5], expand }), false)
    assert.deepEqual(match.view('human').templates, [archers, footmen])
  }
})
