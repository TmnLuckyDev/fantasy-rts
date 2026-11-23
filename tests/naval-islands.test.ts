import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match, TICK_HZ } from '../src/server/match.ts'
import { ashfordMap, cellCenter, isWalkable, isWater, mapForSettings, tileAt } from '../src/shared/map.ts'
import { defaultMatchSettings } from '../src/shared/match-settings.ts'
import { buildings, trainedAt, training, validPlacement } from '../src/shared/economy.ts'
import { unitStats } from '../src/shared/units.ts'
import { races } from '../src/shared/protocol.ts'

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

test('four loaded transports spread out and unload their entire fleet onto the chosen coast', () => {
  const map = ashfordMap('shattered-isles')
  const match = new Match(map, defaultMatchSettings('shattered-isles'))
  const fleet = [54, 55, 56, 57].map(y => match['spawn']('human', 'transport', cellCenter(54, y)))
  for (const ship of fleet) {
    for (let i = 0; i < 30; i++) match['embark'](match['spawn']('human', 'blade', ship), ship)
  }
  assert.ok(match.command('human', fleet.map(ship => ship.id), { kind: 'unload', at: cellCenter(52, 61) }))
  assert.equal(new Set(fleet.map(ship => JSON.stringify(ship.assigned))).size, 4)
  for (let i = 0; i < 900 && fleet.some(ship => ship.passengers?.length); i++) match.step()
  assert.deepEqual(fleet.map(ship => ship.passengers?.length), [0, 0, 0, 0])
  const view = match.view('human')
  assert.equal(view.entities.filter(entity => entity.landing?.total === 30).length, 4)
})

test('a blocked landing stays active, survives a checkpoint and retries once the beach clears', () => {
  const map = ashfordMap('shattered-isles')
  const match = new Match(map, defaultMatchSettings('shattered-isles'))
  const ship = match['spawn']('human', 'transport', cellCenter(54, 56))
  const passenger = match['spawn']('human', 'blade', ship)
  match['embark'](passenger, ship)
  const blocking = []
  for (let y = 48; y <= 64; y++) {
    for (let x = 45; x <= 60; x++) {
      if (isWalkable(tileAt(map, x, y))) blocking.push(match['spawn']('human', 'blade', cellCenter(x, y)))
    }
  }
  assert.ok(match.command('human', [ship.id], { kind: 'unload', at: cellCenter(52, 56) }))
  for (let i = 0; i < 30; i++) match.step()
  assert.equal(match.view('human').entities.find(entity => entity.id === ship.id)?.landing?.waiting, true)
  assert.equal(passenger.embarkedOn, ship.id)
  const restored = Match.restore(structuredClone(match.checkpoint()), map)
  for (const blocker of blocking) restored['destroy'](restored.units.get(blocker.id)!)
  for (let i = 0; i < 30; i++) restored.step()
  assert.equal(restored.units.get(passenger.id)?.embarkedOn, undefined)
})

test('coastal defenders can hit an exposed warship before it is close enough to return fire', () => {
  const map = ashfordMap('shattered-isles')
  for (const race of races) {
    const match = new Match(map, undefined, { human: race, orc: race })
    const tower = match['spawn']('human', 'tower', cellCenter(52, 56))
    const enemy = match['spawn']('orc', 'warship', cellCenter(57, 56))
    assert.ok(match.command('orc', [enemy.id], { kind: 'advance', to: cellCenter(54, 56) }))
    for (let i = 0; i < TICK_HZ && enemy.hp === enemy.maxHp; i++) match.step()
    assert.ok(enemy.hp < enemy.maxHp, race)
    assert.equal(tower.hp, tower.maxHp, race)
    for (let i = 0; i < 4 * TICK_HZ; i++) match.step()
    assert.ok(enemy.hp < enemy.maxHp, race)
    assert.ok(tower.hp < tower.maxHp, race)
    assert.ok(enemy.hp > 0, race)
  }
})

test('a single Transfer order boards and disembarks selected land units on the far island', () => {
  const map = ashfordMap('shattered-isles')
  const game = new Match(map, defaultMatchSettings('shattered-isles'))
  const worker = game['spawn']('human', 'worker', cellCenter(38, 55))
  const ship = game['spawn']('human', 'transport', cellCenter(85, 45))
  assert.equal(game.command('human', [worker.id], { kind: 'transfer', at: { x: -1, y: -1 } }), false)
  assert.equal(game.command('human', [worker.id], { kind: 'transfer', at: cellCenter(139, 55) }), true)
  const restored = Match.restore(structuredClone(game.checkpoint()), map)
  for (let i = 0; i < 3000 && restored.units.get(worker.id)!.x < 125 * 32; i++) restored.step()
  assert.equal(restored.units.get(worker.id)?.embarkedOn, undefined)
  assert.ok(restored.units.get(worker.id)!.x > 125 * 32)
  assert.equal(restored.units.get(ship.id)?.passengers?.length, 0)
})
