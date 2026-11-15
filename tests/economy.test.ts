import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ashford, cellCenter, distance, riverColumn, TILE } from '../src/shared/map.ts'
import { GOLD_LOAD, STARTING_GOLD, buildings, training } from '../src/shared/economy.ts'
import { Match } from '../src/server/match.ts'
import { canStand, findPath } from '../src/server/navigation.ts'
import { parseMessage } from '../src/server/validate.ts'

function advance(match: Match, ticks: number) {
  for (let i = 0; i < ticks; i++) match.step()
}

test('workers repeatedly mine gold and only credit their own faction upon returning to the hall', () => {
  const match = new Match()
  assert.equal(match.command('human', [15], { kind: 'gather', mine: cellCenter(10, 18) }), false)
  assert.equal(match.command('human', [2], { kind: 'gather', mine: cellCenter(5, 18) }), false)
  assert.ok(match.command('human', [15], { kind: 'gather', mine: cellCenter(5, 18) }))
  for (let i = 0; i < 200 && !match.units.get(15)!.cargo; i++) match.step()
  assert.ok(match.units.get(15)!.cargo)
  assert.equal(match.snapshot().gold.human, STARTING_GOLD)
  advance(match, 600)
  assert.ok(match.snapshot().gold.human >= STARTING_GOLD + 2 * GOLD_LOAD)
  assert.equal(match.snapshot().gold.orc, STARTING_GOLD)
})

test('building placement is charged once, pauses without a worker, then resumes and trains troops', () => {
  const match = new Match()
  const at = cellCenter(10, 15)
  assert.equal(match.command('human', [18], { kind: 'build', building: 'barracks', at }), false)
  assert.ok(match.command('human', [15], { kind: 'build', building: 'barracks', at }))
  const foundation = [...match.units.values()].find(unit => unit.kind === 'barracks')!
  assert.equal(match.snapshot().gold.human, STARTING_GOLD - buildings.barracks.gold)
  assert.equal(match.command('human', [16], { kind: 'build', building: 'wall', at }), false)
  assert.equal(match.command('human', [16], { kind: 'build', building: 'wall', at: cellCenter(riverColumn, 8) }), false)
  assert.equal(match.command('human', [21], { kind: 'train', unit: 'blade' }), false)
  advance(match, 65)
  assert.ok(match.command('human', [15], { kind: 'halt' }))
  const paused = foundation.buildTicks
  advance(match, 200)
  assert.equal(foundation.buildTicks, paused)
  assert.ok(match.command('human', [16], { kind: 'resume-build', target: foundation.id }))
  advance(match, 260)
  assert.equal(foundation.hp, foundation.maxHp)
  assert.equal(foundation.buildDuration, 0)
  assert.ok(match.command('human', [foundation.id], { kind: 'train', unit: 'blade' }))
  assert.equal(match.command('human', [foundation.id], { kind: 'train', unit: 'ranged' }), false)
  assert.equal(match.snapshot().gold.human, STARTING_GOLD - buildings.barracks.gold - training.blade.gold)
  const count = match.units.size
  advance(match, training.blade.ticks - 1)
  assert.equal(match.units.size, count)
  advance(match, 1)
  assert.equal(match.units.size, count + 1)
  assert.equal([...match.units.values()].at(-1)?.kind, 'blade')
})

test('both factions start farther apart with three workers and stronger headquarters', () => {
  const match = new Match()
  assert.ok(distance(ashford.bases.human, ashford.bases.orc) > 50 * TILE)
  for (const faction of ['human', 'orc']) {
    const army = match.snapshot().entities.filter(unit => unit.faction === faction)
    assert.equal(army.filter(unit => unit.kind === 'worker').length, 3)
    assert.ok((army.find(unit => unit.kind === 'headquarters')?.hp ?? 0) >= 1500)
  }
})

test('built walls obstruct the path and can sit directly beside another wall', () => {
  const match = new Match()
  const at = cellCenter(10, 15)
  assert.ok(match.command('human', [15], { kind: 'build', building: 'wall', at }))
  assert.ok(match.command('human', [16], { kind: 'build', building: 'wall', at: cellCenter(10, 16) }))
  advance(match, 180)
  const obstacles = [...match.units.values()].filter(unit => unit.kind === 'wall').map(unit => ({ ...unit, radius: 16 }))
  assert.equal(obstacles.length, 2)
  assert.ok(obstacles.every(unit => unit.buildDuration === 0))
  assert.equal(canStand(ashford, at, obstacles, 9), false)
  const route = findPath(ashford, cellCenter(9, 15), cellCenter(11, 15), obstacles, 9)
  assert.ok(route.length > 2)
  assert.ok(route.every(point => canStand(ashford, point, obstacles, 9)))
})

test('towers deal ranged damage after construction and ignore friendly units', () => {
  const match = new Match()
  const enemy = match.units.get(9)!
  Object.assign(enemy, cellCenter(14, 15))
  const enemyHp = enemy.hp
  assert.ok(match.command('human', [15], { kind: 'build', building: 'tower', at: cellCenter(11, 15) }))
  advance(match, 40)
  assert.equal(enemy.hp, enemyHp)
  advance(match, 240)
  const effects = match.snapshot(true).effects
  assert.ok(effects.some(effect => effect.kind === 'shot' && effect.entityKind === 'tower'))
  assert.ok(enemy.hp < enemyHp)
  assert.equal(match.units.get(15)?.hp, 55)
})

test('invalid construction and training packets are rejected', () => {
  assert.equal(parseMessage('{"type":"command","ids":[15],"order":{"kind":"build","building":"headquarters","at":{"x":10,"y":12}}}'), null)
  assert.equal(parseMessage('{"type":"command","ids":[1],"order":{"kind":"train","unit":"tower"}}'), null)
})
