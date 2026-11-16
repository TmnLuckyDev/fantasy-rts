import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { validPlacement, buildingFootprint, trainedAt, training } from '../src/shared/economy.ts'
import { cellCenter } from '../src/shared/map.ts'
import { parseMessage } from '../src/server/validate.ts'
import { unitStats } from '../src/shared/units.ts'
import { indexArmy } from '../src/client/troop-groups.ts'

test('scout can be recruited at headquarters and appears in automatic troop groups', () => {
  const match = new Match()
  assert.ok(trainedAt('headquarters').includes('scout'))
  assert.equal(training.scout.population, 1)
  assert.ok(unitStats.human.scout.speed > unitStats.human.heavy.speed)
  assert.equal(parseMessage('{"type":"command","ids":[1],"order":{"kind":"explore"}}')?.type, 'command')
  assert.ok(match.command('human', [1], { kind: 'train', unit: 'scout' }))
  const hall = match.checkpoint().units.find(unit => unit.id === 1)!
  assert.equal(hall.queue[0].kind, 'scout')
  const seed = match.view('human').entities
  assert.equal(indexArmy(seed.concat({ ...seed[0], id: 999, kind: 'scout' }), 'human').get('scout')?.length, 1)
})

test('only scouts can receive autonomous exploration orders', () => {
  const match = new Match()
  const seed = match.checkpoint().units.find(unit => unit.id === 2)!
  const checkpoint = match.checkpoint()
  checkpoint.units.push({ ...seed, id: ++checkpoint.sequence, kind: 'scout', order: null, assigned: null })
  const restored = Match.restore(checkpoint)
  assert.equal(restored.command('human', [2], { kind: 'explore' }), false)
  assert.equal(restored.command('human', [checkpoint.sequence], { kind: 'explore' }), true)
  for (let i = 0; i < 3; i++) restored.step()
  const scout = restored.checkpoint().units.find(unit => unit.id === checkpoint.sequence)!
  assert.equal(scout.order?.kind, 'explore')
  assert.ok(scout.assigned)
})

test('buildings use smaller footprints while headquarters remain full size', () => {
  const match = new Match()
  assert.ok(buildingFootprint('barracks') < unitStats.human.barracks.radius)
  const at = cellCenter(45, 15)
  assert.ok(validPlacement({ ...match.map, tiles: match.map.tiles.map(() => 'grass' as const) }, 'barracks', at, []))
})

test('workers can place a building in explored fog without current vision', () => {
  const match = new Match()
  const checkpoint = match.checkpoint()
  const size = match.map.width * match.map.height
  checkpoint.fog.human = (size * 3 + 1).toString(36)
  const restored = Match.restore(checkpoint, match.map)
  const worker = checkpoint.units.find(unit => unit.faction === 'human' && unit.kind === 'worker')!
  let site
  for (let y = 3; y < match.map.height - 3 && !site; y++) {
    for (let x = 3; x < match.map.width - 3; x++) {
      const at = cellCenter(x, y)
      if (validPlacement(match.map, 'farm', at, restored.units.values())) { site = at; break }
    }
  }
  assert.ok(site)
  assert.equal(restored.command('human', [worker.id], { kind: 'build', building: 'farm', at: site }), true)
  assert.ok(restored.checkpoint().units.some(unit => unit.kind === 'farm' && unit.faction === 'human'))
})
