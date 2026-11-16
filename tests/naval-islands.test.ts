import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { ashfordMap, cellCenter, isWalkable, isWater, mapForSettings, tileAt } from '../src/shared/map.ts'
import { defaultMatchSettings } from '../src/shared/match-settings.ts'
import { buildings, trainedAt, training, validPlacement } from '../src/shared/economy.ts'
import { unitStats } from '../src/shared/units.ts'

test('Shattered Isles has separate large landmasses, islands and sea lanes', () => {
  const map = ashfordMap('shattered-isles')
  assert.equal(map.width, 160)
  assert.equal(map.height, 96)
  assert.ok(isWalkable(tileAt(map, 24, 48)))
  assert.ok(isWalkable(tileAt(map, 135, 47)))
  assert.ok(isWater(tileAt(map, 80, 30)))
  assert.ok(isWalkable(tileAt(map, 80, 48)))
  assert.ok(isWater(tileAt(map, 80, 65)))
  const configured = mapForSettings(defaultMatchSettings('shattered-isles'), 2)
  assert.equal(configured.id, 'shattered-isles')
  assert.ok(isWalkable(tileAt(configured, Math.floor(configured.bases.human.x / 32), Math.floor(configured.bases.human.y / 32))))
})

test('ports require a coastline and can train both naval units', () => {
  const map = ashfordMap('shattered-isles')
  assert.ok(buildings.port.cost.wood)
  assert.deepEqual(trainedAt('port'), ['transport', 'warship'])
  assert.equal(training.transport.population, 3)
  assert.ok(unitStats.human.warship.damage > 0)
  assert.equal(validPlacement(map, 'port', cellCenter(24, 48), []), false)
  let coast = false
  for (let y = 15; y < 80; y++) for (let x = 40; x < 57; x++) {
    if (validPlacement(map, 'port', cellCenter(x, y), [])) coast = true
  }
  assert.ok(coast, 'at least one coastal port site should be buildable')
})

test('transport capacity is exactly 30 population and unloading restores passengers', () => {
  const map = ashfordMap('shattered-isles')
  const match = new Match(map, defaultMatchSettings('shattered-isles'))
  const checkpoint = match.checkpoint()
  const base = checkpoint.units.find(unit => unit.faction === 'human' && unit.kind === 'headquarters')!
  const shipX = 52, shipY = 48
  assert.ok(isWater(tileAt(map, shipX, shipY)))
  const ship = { ...base, id: ++checkpoint.sequence, kind: 'transport' as const,
    ...cellCenter(shipX, shipY), hp: 550, maxHp: 550, passengers: [] as number[] }
  checkpoint.units.push(ship)
  const passengers: number[] = []
  for (let i = 0; i < 31; i++) {
    const unit = { ...base, id: ++checkpoint.sequence, kind: 'blade' as const,
      ...cellCenter(49, 45 + i % 7), hp: 96, maxHp: 96 }
    checkpoint.units.push(unit)
    passengers.push(unit.id)
  }
  const restored = Match.restore(checkpoint, map)
  assert.equal(restored.command('human', passengers.slice(0, 30), { kind: 'board', transport: ship.id }), true)
  assert.equal(restored.command('human', [passengers[30]], { kind: 'board', transport: ship.id }), false)
  assert.equal(restored.units.get(ship.id)?.passengers?.length, 30)
  assert.equal(restored.view('human').entities.some(entity => entity.id === passengers[0]), false)
  assert.equal(restored.command('human', [ship.id], { kind: 'unload' }), true)
  assert.equal(restored.units.get(ship.id)?.passengers?.length, 0)
  assert.ok(restored.view('human').entities.some(entity => entity.id === passengers[0]))
})
