import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { ashfordMap, cellCenter, isWalkable, isWater, mapForSettings, tileAt } from '../src/shared/map.ts'
import { defaultMatchSettings } from '../src/shared/match-settings.ts'
import { buildings, trainedAt, training, validPlacement } from '../src/shared/economy.ts'
import { unitStats } from '../src/shared/units.ts'

test('Shattered Isles has separate large landmasses, islands and sea lanes', () => {
  const map = ashfordMap('shattered-isles')
  assert.equal(map.width, 192)
  assert.equal(map.height, 112)
  assert.ok(isWalkable(tileAt(map, 30, 56)))
  assert.ok(isWalkable(tileAt(map, 161, 55)))
  assert.ok(isWater(tileAt(map, 96, 36)))
  assert.ok(isWalkable(tileAt(map, 96, 56)))
  assert.ok(isWater(tileAt(map, 96, 77)))
  const configured = mapForSettings(defaultMatchSettings('shattered-isles'), 2)
  assert.equal(configured.id, 'shattered-isles')
  assert.ok(isWalkable(tileAt(configured, Math.floor(configured.bases.human.x / 32), Math.floor(configured.bases.human.y / 32))))
})

test('ports require a coastline and can train both naval units', () => {
  const map = ashfordMap('shattered-isles')
  assert.ok(buildings.port.cost.wood)
  assert.deepEqual(trainedAt('port'), ['transport', 'warship'])
  assert.equal(training.transport.population, 1)
  assert.ok(unitStats.human.warship.damage > 0)
  assert.equal(validPlacement(map, 'port', cellCenter(30, 56), []), false)
  let coast = false
  for (let y = 20; y < 92; y++) for (let x = 47; x < 64; x++) {
    if (validPlacement(map, 'port', cellCenter(x, y), [])) coast = true
  }
  assert.ok(coast, 'at least one coastal port site should be buildable')
})

test('transport capacity is exactly 30 population and unloading restores passengers', () => {
  const map = ashfordMap('shattered-isles')
  const match = new Match(map, defaultMatchSettings('shattered-isles'))
  const checkpoint = match.checkpoint()
  const base = checkpoint.units.find(unit => unit.faction === 'human' && unit.kind === 'headquarters')!
  const shipX = 54, shipY = 56
  assert.ok(isWater(tileAt(map, shipX, shipY)))
  const ship = { ...base, id: ++checkpoint.sequence, kind: 'transport' as const,
    ...cellCenter(shipX, shipY), hp: 550, maxHp: 550, passengers: [] as number[] }
  checkpoint.units.push(ship)
  const passengers: number[] = []
  for (let i = 0; i < 31; i++) {
    const unit = { ...base, id: ++checkpoint.sequence, kind: 'blade' as const,
      ...cellCenter(52, 56), hp: 96, maxHp: 96 }
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

test('automatic boarding brings workers, soldiers and a friendly ship to the same connected coast', () => {
  const map = ashfordMap('shattered-isles')
  const game = new Match(map, defaultMatchSettings('shattered-isles'))
  const worker = game['spawn']('human', 'worker', cellCenter(31, 56))
  const soldier = game['spawn']('human', 'blade', cellCenter(32, 56))
  const transport = game['spawn']('human', 'transport', cellCenter(90, 37))
  const enemy = game['spawn']('orc', 'transport', cellCenter(89, 37))
  assert.equal(game.command('human', [worker.id, soldier.id], { kind: 'board', transport: enemy.id }), false)
  assert.equal(game.command('human', [worker.id, soldier.id], { kind: 'board' }), true)
  assert.ok(transport.pickup)
  const start = { x: transport.x, y: transport.y }
  const restored = Match.restore(game.checkpoint(), map)
  for (let i = 0; i < 1200 && !restored.units.get(soldier.id)?.embarkedOn; i++) restored.step()
  assert.equal(restored.units.get(worker.id)?.embarkedOn, transport.id)
  assert.equal(restored.units.get(soldier.id)?.embarkedOn, transport.id)
  assert.notDeepEqual({ x: transport.x, y: transport.y }, start)
  assert.equal(restored.command('human', [transport.id], { kind: 'unload' }), true)
  assert.equal(restored.units.get(worker.id)?.embarkedOn, undefined)
  assert.ok(isWalkable(tileAt(map, Math.floor(worker.x / 32), Math.floor(worker.y / 32))))
})

test('a move or stop order cancels a pending pickup and frees the transport', () => {
  const map = ashfordMap('shattered-isles')
  const game = new Match(map, defaultMatchSettings('shattered-isles'))
  const worker = game['spawn']('human', 'worker', cellCenter(31, 56))
  const transport = game['spawn']('human', 'transport', cellCenter(90, 37))
  assert.equal(game.command('human', [worker.id], { kind: 'board' }), true)
  assert.equal(game.command('human', [worker.id], { kind: 'halt' }), true)
  game.step()
  assert.equal(worker.order?.kind, 'halt')
  assert.equal(transport.pickup, undefined)
  assert.equal(worker.embarkedOn, undefined)
})

test('moving friendly ships and land units spread out without leaving navigable terrain', () => {
  const map = ashfordMap('shattered-isles')
  const game = new Match(map, defaultMatchSettings('shattered-isles'))
  const ships = (['transport', 'warship'] as const).map(kind => game['spawn']('human', kind, cellCenter(90, 37)))
  const troops = [1, 2].map(() => game['spawn']('human', 'blade', cellCenter(31, 56)))
  assert.equal(game.command('human', ships.map(u => u.id), { kind: 'move', to: cellCenter(98, 37), formation: 'compact' }), true)
  assert.equal(game.command('human', troops.map(u => u.id), { kind: 'move', to: cellCenter(37, 56), formation: 'compact' }), true)
  for (let i = 0; i < 40; i++) game.step()
  assert.ok(Math.hypot(ships[0].x - ships[1].x, ships[0].y - ships[1].y) > 30)
  assert.ok(Math.hypot(troops[0].x - troops[1].x, troops[0].y - troops[1].y) > 12)
  assert.ok(ships.every(u => isWater(tileAt(map, Math.floor(u.x / 32), Math.floor(u.y / 32)))))
  assert.ok(troops.every(u => isWalkable(tileAt(map, Math.floor(u.x / 32), Math.floor(u.y / 32)))))
})

test('walls leave the coast open while inland walls remain buildable', () => {
  const map = ashfordMap('shattered-isles')
  const coast = map.tiles.findIndex((tile, index) => (tile === 'grass' || tile === 'road') &&
    isWater(tileAt(map, index % map.width + 1, Math.floor(index / map.width))))
  assert.ok(coast >= 0)
  const beach = cellCenter(coast % map.width, Math.floor(coast / map.width))
  assert.equal(validPlacement(map, 'wall', beach, []), false)
  assert.equal(validPlacement(map, 'wall', cellCenter(30, 56), []), true)
})

test('selected transports sail to a chosen coast and unload only their own passengers', () => {
  const map = ashfordMap('shattered-isles')
  const match = new Match(map, defaultMatchSettings('shattered-isles'))
  const ships = [
    match['spawn']('human', 'transport', cellCenter(54, 56)),
    match['spawn']('human', 'transport', cellCenter(54, 55)),
    match['spawn']('human', 'transport', cellCenter(54, 54)),
    match['spawn']('orc', 'transport', cellCenter(54, 56))
  ]
  const passengers = ships.map(ship => {
    const passenger = match['spawn'](ship.faction, 'blade', ship)
    passenger.embarkedOn = ship.id
    ship.passengers = [passenger.id]
    return passenger
  })
  const destination = cellCenter(52, 61)
  assert.ok(match.command('human', [ships[0].id, ships[1].id], { kind: 'unload', at: destination }))
  assert.equal(passengers[0].embarkedOn, ships[0].id)
  for (let i = 0; i < 300 && passengers.slice(0, 2).some(unit => unit.embarkedOn); i++) match.step()
  assert.equal(passengers[0].embarkedOn, undefined)
  assert.equal(passengers[1].embarkedOn, undefined)
  assert.notDeepEqual([passengers[0].x, passengers[0].y], [passengers[1].x, passengers[1].y])
  assert.equal(passengers[2].embarkedOn, ships[2].id)
  assert.equal(passengers[3].embarkedOn, ships[3].id)
})
