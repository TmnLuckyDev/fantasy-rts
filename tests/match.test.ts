import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TILE, ashford, cellCenter, distance, isWalkable, riverColumn, tileAt } from '../src/shared/map.ts'
import { decodeFog } from '../src/shared/fog.ts'
import { Match } from '../src/server/match.ts'
import { canStand, findPath } from '../src/server/navigation.ts'
import { parseMessage } from '../src/server/validate.ts'

test('the map is rotationally symmetric and both armies start on walkable ground', () => {
  assert.deepEqual([...ashford.tiles].reverse(), ashford.tiles)
  const match = new Match()
  for (const unit of match.snapshot().entities) {
    assert.ok(canStand(ashford, unit, [], unit.kind === 'headquarters' ? 20 : 12), `Blocked spawn ${unit.id}`)
  }
})

test('A* finds a bridge and never steps onto a blocked tile', () => {
  const path = findPath(ashford, cellCenter(16, 15), cellCenter(46, 15), [], 12)
  assert.ok(path.length > 10)
  assert.ok(path.some(point => tileAt(ashford, Math.floor(point.x / TILE), Math.floor(point.y / TILE)) === 'bridge'))
  assert.ok(path.every(point => isWalkable(tileAt(ashford, Math.floor(point.x / TILE), Math.floor(point.y / TILE)))))
  assert.deepEqual(path.at(-1), cellCenter(46, 15))
})

test('both bridges provide four unobstructed lanes on both banks', () => {
  for (const startRow of [7, ashford.height - 11]) {
    for (let y = startRow; y < startRow + 4; y++) {
      for (const x of [riverColumn, riverColumn + 1]) assert.equal(tileAt(ashford, x, y), 'bridge')
      const start = cellCenter(riverColumn - 5, y)
      const goal = cellCenter(riverColumn + 6, y)
      const path = findPath(ashford, start, goal, [], 15)
      assert.deepEqual(path.at(-1), goal)
      assert.ok(path.every(point => point.y === start.y))
    }
  }
})

test('orders require owned troops, valid destinations and enemy targets', () => {
  const match = new Match()
  assert.equal(match.command('human', [2, 9], { kind: 'halt' }), false)
  assert.equal(match.command('human', [1], { kind: 'halt' }), false)
  assert.equal(match.command('human', [2], { kind: 'move', to: { x: -1, y: 10 } }), false)
  assert.equal(match.command('human', [2], { kind: 'move', to: { x: Infinity, y: 10 } }), false)
  assert.equal(match.command('human', [2], { kind: 'attack', target: 3 }), false)
  assert.equal(match.command('human', [2], { kind: 'attack', target: 8 }), false)
})

test('group movement crosses the river, separates troops and keeps advancing', () => {
  const ids = [2, 3, 4, 5, 6, 7]
  const match = new Match()
  assert.ok(match.command('human', ids, { kind: 'move', to: cellCenter(47, 11) }))
  for (let i = 0; i < 520; i++) match.step()
  const troops = [...match.units.values()].filter(unit => ids.includes(unit.id))
  assert.equal(troops.length, 6)
  assert.ok(troops.every(unit => unit.x > ashford.width / 2 * TILE && distance(unit, cellCenter(47, 11)) < 65),
    JSON.stringify(troops.map(({ id, x, y }) => ({ id, x, y }))))
  assert.ok(troops.every(unit => troops.every(other => unit === other || distance(unit, other) >= 12)))
})

test('troops can path to an attack position whose tile center is obstructed', () => {
  const match = new Match()
  const army = [2, 3, 4, 5, 6, 7]
  match.command('orc', [9, 10, 11, 12, 13, 14], { kind: 'move', to: cellCenter(ashford.width - 8, 7) })
  assert.ok(match.command('human', army, { kind: 'move', to: cellCenter(75, 24) }))
  for (let i = 0; i < 850; i++) match.step()
  const target = ashford.bases.orc
  const ranges = army.map(id => distance(match.units.get(id)!, target))
  assert.ok(match.command('human', army, { kind: 'attack', target: 8 }))
  for (let i = 0; i < 120; i++) match.step()
  assert.ok(army.every((id, index) => distance(match.units.get(id)!, target) < ranges[index] - 45))
  assert.ok(match.units.get(8)!.hp < 1500)
})

test('server resolves damage, projectiles, fatalities and headquarters victory deterministically', () => {
  const run = () => {
    const match = new Match()
    const kinds = new Set<string>()
    match.command('orc', [9, 10, 11, 12, 13, 14], { kind: 'move', to: cellCenter(ashford.width - 8, 7) })
    assert.ok(match.command('human', [2, 3, 4, 5, 6, 7], { kind: 'advance', to: ashford.bases.orc }))
    for (let i = 0; i < 1500 && !match.result; i++) {
      match.step()
      for (const effect of match.snapshot(true).effects) kinds.add(effect.kind)
    }
    assert.deepEqual(match.result, { winner: 'human', reason: 'headquarters' })
    assert.deepEqual([...kinds].sort(), ['fallen', 'hit', 'shot'])
    assert.equal(match.units.has(8), false)
    assert.equal(match.command('human', [2], { kind: 'halt' }), false)
    return match.snapshot()
  }
  assert.deepEqual(run(), run())
})

test('rejects invalid protocol payloads and strips excess fields from valid commands', () => {
  for (const raw of ['null', '[1]', '{', '{"type":"ready","ready":1}', '{"type":"resume","code":"Q2345","token":"foo"}',
    '{"type":"command","ids":[1.2],"order":{"kind":"halt"}}',
    '{"type":"command","ids":[2],"order":{"kind":"move","to":{"x":1e999,"y":1}}}']) {
    assert.equal(parseMessage(raw), null)
  }
  assert.deepEqual(parseMessage('{"type":"command","ids":[2],"order":{"kind":"halt","hp":9000}}'), {
    type: 'command', ids: [2], order: { kind: 'halt' }
  })
})

test('enemy troops exchange ranged and melee damage and can die', () => {
  const match = new Match()
  const blade = match.units.get(2)!
  const archer = match.units.get(5)!
  const enemy = match.units.get(9)!
  Object.assign(blade, cellCenter(15, 13))
  Object.assign(archer, cellCenter(13, 13))
  Object.assign(enemy, { x: blade.x + 29, y: blade.y })
  let sawProjectile = false
  for (let i = 0; i < 130; i++) {
    match.step()
    sawProjectile ||= match.snapshot(true).effects.some(effect => effect.kind === 'shot')
  }
  assert.ok(sawProjectile)
  assert.ok(archer.hp === archer.maxHp && blade.hp < blade.maxHp)
  assert.equal(match.units.has(enemy.id), false)
  assert.equal(match.result, null)
})

test('scouting reveals enemy units and leaving preserves only explored terrain', () => {
  const match = new Match()
  const scout = match.units.get(15)!
  const opponent = match.units.get(8)!
  const index = Math.floor(opponent.y / TILE) * ashford.width + Math.floor(opponent.x / TILE)
  const vision = () => decodeFog(match.view('human').fog, ashford.tiles.length)[index]
  const spotted = () => match.view('human').entities.some(entity => entity.id === opponent.id)

  assert.equal(vision(), 0)
  assert.equal(spotted(), false)
  assert.equal(match.command('human', [15], { kind: 'build', building: 'wall', at: cellCenter(81, 21) }), false)
  assert.equal(match.command('human', [15], { kind: 'gather', at: cellCenter(34, 33) }), false)

  match.command('orc', [9, 10, 11, 12, 13, 14], { kind: 'move', to: cellCenter(ashford.width - 8, 7) })
  assert.ok(match.command('human', [scout.id], { kind: 'move', to: cellCenter(76, 26) }))
  for (let i = 0; i < 1000 && !spotted(); i++) match.step()
  assert.equal(vision(), 2)
  assert.equal(spotted(), true)
  assert.ok(match.command('human', [2], { kind: 'attack', target: opponent.id }))

  assert.ok(match.command('human', [scout.id], { kind: 'move', to: ashford.bases.human }))
  assert.ok(match.command('human', [2], { kind: 'halt' }))
  for (let i = 0; i < 100 && spotted(); i++) match.step()
  assert.equal(vision(), 1)
  assert.equal(spotted(), false)
  assert.equal(match.command('human', [2], { kind: 'attack', target: opponent.id }), false)
})

test('combat effects do not disclose origins or destinations hidden by fog', () => {
  const match = new Match()
  const effect = { kind: 'shot', at: ashford.bases.human, faction: 'human', entityKind: 'ranged' } as const
  const world = {
    ...match.snapshot(),
    effects: [
      { ...effect, id: 1, to: cellCenter(11, 11) },
      { ...effect, id: 2, to: ashford.bases.orc },
      { ...effect, id: 3, at: ashford.bases.orc, to: ashford.bases.human }
    ]
  }
  assert.deepEqual(match.view('human', world).effects.map(event => event.id), [1])
  assert.deepEqual(match.view('orc', world).effects, [])
})

for (const protectedKind of ['worker', 'headquarters'] as const) {
  test(`nearby troops defend an allied ${protectedKind} against a ranged attack`, () => {
    const match = new Match()
    const victim = match.units.get(protectedKind === 'worker' ? 15 : 1)!
    const guard = match.units.get(2)!
    const remote = match.units.get(3)!
    const ordered = match.units.get(4)!
    const attacker = match.units.get(12)!
    Object.assign(victim, cellCenter(28, 11))
    Object.assign(guard, { x: victim.x - 78, y: victim.y - 26 })
    Object.assign(remote, { x: victim.x - 220, y: victim.y })
    Object.assign(ordered, { x: victim.x - 60, y: victim.y + 50 })
    Object.assign(attacker, { x: victim.x + 108, y: victim.y })
    const start = { x: guard.x, y: guard.y }
    const retreat = { x: ordered.x - 165, y: ordered.y }
    assert.ok(match.command('human', [ordered.id], { kind: 'move', to: retreat }))

    for (let i = 0; i < 85; i++) match.step()

    assert.ok(victim.hp < victim.maxHp, 'the ranged attack hit')
    assert.ok(attacker.hp < attacker.maxHp, 'the nearby melee guard struck back')
    assert.ok(distance(guard, start) > 70, 'the guard went out to intercept')
    assert.equal(remote.x, victim.x - 220, 'troops stationed farther away hold position')
    assert.ok(distance(ordered, retreat) < 10, 'an explicit move order takes priority')
  })
}

test('defenders break pursuit when attackers leave the area', () => {
  const match = new Match()
  const victim = match.units.get(15)!
  const guard = match.units.get(2)!
  const attacker = match.units.get(12)!
  Object.assign(victim, cellCenter(28, 11))
  Object.assign(guard, { x: victim.x - 78, y: victim.y - 26 })
  Object.assign(attacker, { x: victim.x + 108, y: victim.y })
  for (let i = 0; i < 12; i++) match.step()
  assert.equal(guard.defense?.targetId, attacker.id)

  Object.assign(attacker, cellCenter(39, 10))
  match.step()
  const stopped = { x: guard.x, y: guard.y }
  for (let i = 0; i < 65; i++) match.step()
  assert.equal(guard.defense, null)
  assert.deepEqual({ x: guard.x, y: guard.y }, stopped)
})
