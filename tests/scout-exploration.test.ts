import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { ashford, cellCenter, isWalkable, tileAt } from '../src/shared/map.ts'
import { buildingFootprint, trainedAt, training, validPlacement } from '../src/shared/economy.ts'
import { unitStats } from '../src/shared/units.ts'
import { Visibility } from '../src/server/visibility.ts'

test('scouts are trainable at headquarters and can explore automatically', () => {
  assert.ok(trainedAt('headquarters').includes('scout'))
  assert.ok(unitStats.human.scout.speed > unitStats.human.worker.speed)
  assert.ok(training.scout.gold > 0)
  const match = new Match()
  const base = [...match.units.values()].find(unit => unit.kind === 'headquarters' && unit.faction === 'human')!
  assert.ok(match.command('human', [base.id], { kind: 'train', unit: 'scout' }))
  for (let i = 0; i < training.scout.ticks + 5; i++) match.step()
  const scout = [...match.units.values()].find(unit => unit.kind === 'scout' && unit.faction === 'human')!
  assert.ok(scout)
  assert.equal(match.command('human', [scout.id], { kind: 'explore' }), true)
  assert.equal(match.command('human', [scout.id], { kind: 'attack', target: base.id }), false)
  const start = { x: scout.x, y: scout.y }
  for (let i = 0; i < 150; i++) match.step()
  assert.ok(Math.hypot(scout.x - start.x, scout.y - start.y) > 15, 'scout should travel')
})

test('explored fog is retained after sight moves away', () => {
  const match = new Match()
  const scout = [...match.units.values()].find(unit => unit.faction === 'human' && unit.kind === 'blade')!
  const fog = new Visibility(ashford)
  const position = cellCenter(20, 20)
  fog.update([{ ...scout, ...position }])
  assert.equal(fog.at('human', position), 2)
  fog.update([])
  assert.equal(fog.at('human', position), 1)
})

test('smaller building footprints permit nearby structures without overlapping', () => {
  const farmRadius = buildingFootprint('farm')
  assert.ok(farmRadius < unitStats.human.farm.radius)
  const a = cellCenter(12, 12)
  const b = cellCenter(13, 12)
  assert.ok(isWalkable(tileAt(ashford, 12, 12)))
  const farm = { ...[...new Match().units.values()][0], ...a, kind: 'farm' as const }
  assert.equal(validPlacement(ashford, 'farm', a, [farm]), false)
  assert.equal(validPlacement(ashford, 'farm', b, [farm]), true)
})
