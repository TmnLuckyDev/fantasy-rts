import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TILE, ashford, cellCenter, distance, isWalkable, tileAt } from '../src/shared/map.ts'
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

test('orders require owned troops, valid destinations and enemy targets', () => {
  const match = new Match()
  assert.equal(match.command('human', [2, 9], { kind: 'halt' }), false)
  assert.equal(match.command('human', [1], { kind: 'halt' }), false)
  assert.equal(match.command('human', [2], { kind: 'move', to: { x: -1, y: 10 } }), false)
  assert.equal(match.command('human', [2], { kind: 'move', to: { x: Infinity, y: 10 } }), false)
  assert.equal(match.command('human', [2], { kind: 'attack', target: 3 }), false)
  assert.equal(match.command('human', [2], { kind: 'attack', target: 8 }), true)
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
  const start = match.units.get(2)!.x
  match.command('orc', [9, 10, 11, 12, 13, 14], { kind: 'move', to: cellCenter(ashford.width - 8, 7) })
  match.command('human', army, { kind: 'attack', target: 8 })
  for (let i = 0; i < 120; i++) match.step()
  assert.ok(army.every(id => (match.units.get(id)?.x ?? 0) > start + 45))
})

test('server resolves damage, projectiles, fatalities and headquarters victory deterministically', () => {
  const run = () => {
    const match = new Match()
    const kinds = new Set<string>()
    match.command('orc', [9, 10, 11, 12, 13, 14], { kind: 'move', to: cellCenter(ashford.width - 8, 7) })
    match.command('human', [2, 3, 4, 5, 6, 7], { kind: 'attack', target: 8 })
    for (let i = 0; i < 1300 && !match.result; i++) {
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
