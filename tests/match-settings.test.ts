import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match, TICK_HZ } from '../src/server/match.ts'
import { parseMessage } from '../src/server/validate.ts'
import { GATHERING, training } from '../src/shared/economy.ts'
import { ashfordMap, cellCenter, mapForSettings } from '../src/shared/map.ts'
import { ARMY_SCORE_PER_UNIT, MAX_DEPOSITS, defaultMatchSettings, parseMatchSettings, treeLimit } from '../src/shared/match-settings.ts'
import { applyDelta, makeDelta } from '../src/shared/snapshot-delta.ts'

const advance = (match: Match, ticks: number) => {
  for (let i = 0; i < ticks; i++) match.step()
}
const serialize = (match: Match) => Match.restore(JSON.parse(JSON.stringify(match.checkpoint())))

test('custom maps preserve defaults and provide the requested rotationally symmetric site counts', () => {
  for (const id of ['ashford-original', 'ashford-expanded'] as const) {
    const settings = defaultMatchSettings(id)
    assert.deepEqual(mapForSettings(settings), ashfordMap(id))
    settings.sources.gold.count = MAX_DEPOSITS
    settings.sources.stone.count = 0
    settings.sources.wood.count = 1
    const map = mapForSettings(settings)
    assert.deepEqual(map.tiles, [...map.tiles].reverse())
    assert.equal(map.tiles.filter(tile => tile === 'mine').length, settings.sources.gold.count * 2)
    assert.equal(map.tiles.filter(tile => tile === 'quarry').length, 0)
    assert.equal(map.tiles.filter(tile => tile === 'forest').length, 2)
    assert.deepEqual(map.tiles.map((tile, i) => tile === 'bridge' ? i : -1),
      ashfordMap(id).tiles.map((tile, i) => tile === 'bridge' ? i : -1))
  }
})

test('socket rules accept unlimited values and reject unsafe or malformed settings', () => {
  const settings = defaultMatchSettings('ashford-original')
  const parse = (value: unknown) => parseMessage(JSON.stringify({ type: 'create', faction: 'human', settings: value }))
  assert.deepEqual(parse(settings), { type: 'create', faction: 'human', settings })
  assert.deepEqual(parse(undefined), { type: 'create', faction: 'human' })
  for (const invalid of [
    { ...settings, map: 'other' }, { ...settings, minutes: 0 }, { ...settings, minutes: 0.5 },
    { ...settings, starting: { ...settings.starting, gold: -1 } },
    { ...settings, sources: { ...settings.sources, gold: { count: MAX_DEPOSITS + 1, stock: 1, workers: 4 } } },
    { ...settings, sources: { ...settings.sources, stone: { count: 2, stock: 0, workers: 0 } } },
    { ...settings, sources: { ...settings.sources, wood: { count: treeLimit(settings.map) + 1, stock: null, workers: null } } },
    { ...settings, sources: {} }, null
  ]) {
    assert.equal(parseMatchSettings(invalid), null)
    assert.equal(parse(invalid), null)
  }
})

test('each resource enforces active worker limits and delivers the exact last partial load across saves', () => {
  for (const [resource, x, y] of [['gold', 5, 18], ['wood', 6, 7], ['stone', 4, 15]] as const) {
    const settings = defaultMatchSettings()
    settings.sources[resource].stock = GATHERING[resource].amount + 7
    settings.sources[resource].workers = 1
    const match = Match.configured(settings)
    const at = cellCenter(x, y)
    const index = y * match.map.width + x
    const nearby = resource === 'wood' ? cellCenter(x, y + 1) : cellCenter(x + 1, y)
    for (const id of [15, 16, 17]) Object.assign(match.units.get(id)!, nearby)
    const before = match.view('human')
    assert.ok(match.command('human', [15, 16, 17], { kind: 'gather', at }))
    advance(match, GATHERING[resource].ticks)
    assert.equal([...match.units.values()].filter(unit => unit.cargo).length, 1)
    assert.equal(match.snapshot().resources.human[resource], settings.starting[resource])
    advance(match, GATHERING[resource].ticks)
    assert.equal(match.units.get(16)?.cargoAmount, 7)
    const after = match.view('human')
    assert.deepEqual(after.depleted, [index])
    assert.equal(match.view('orc').depleted, undefined)
    assert.deepEqual(applyDelta(before, makeDelta(before, after))?.depleted, [index])
    const restored = serialize(match)
    assert.deepEqual(restored.view('human').depleted, [index])
    assert.equal(restored.command('human', [17], { kind: 'gather', at }), false)
    advance(restored, 360)
    const expected = settings.starting[resource] + settings.sources[resource].stock!
    if (resource === 'wood') {
      assert.ok(restored.snapshot().resources.human[resource] >= expected)
      assert.ok(restored.report().sides.human.gathered[resource] >= settings.sources[resource].stock!)
      assert.ok([15, 16, 17].some(id => restored.units.get(id)?.job?.kind === 'gather'))
    } else {
      assert.equal(restored.snapshot().resources.human[resource], expected)
      assert.equal(restored.report().sides.human.gathered[resource], settings.sources[resource].stock)
      assert.ok([15, 16, 17].every(id => restored.view('human').entities.find(unit => unit.id === id)?.idle))
    }
  }
})

test('time limit resolves by live army and resources, ties draw, and unlimited games continue', () => {
  const settings = defaultMatchSettings('ashford-original')
  settings.minutes = 1
  settings.starting = { gold: 99, wood: 2, stone: 7 }
  const match = Match.configured(settings)
  assert.deepEqual(match.snapshot().resources, { human: settings.starting, orc: settings.starting })
  match.tick = 60 * TICK_HZ - 2
  match.step()
  assert.equal(match.result, null)
  assert.equal(match.report().sides.human.score, 108 + 6 * ARMY_SCORE_PER_UNIT)
  const tied = serialize(match)
  tied.step()
  assert.deepEqual(tied.result, { reason: 'time', winner: null })
  match.units.delete(9)
  match.step()
  assert.deepEqual(match.result, { reason: 'time', winner: 'human' })
  assert.equal(serialize(match).report().elapsedSeconds, 60)
  const headquarters = Match.configured(settings)
  headquarters.tick = 60 * TICK_HZ - 1
  headquarters.units.delete(1)
  headquarters.step()
  assert.deepEqual(headquarters.result, { reason: 'headquarters', winner: 'orc' })
  const endless = new Match()
  endless.tick = 120 * 60 * TICK_HZ
  endless.step()
  assert.equal(endless.result, null)
})

test('completed production, construction and combat count once and survive restore', () => {
  const match = new Match()
  assert.ok(match.command('human', [15], { kind: 'build', building: 'barracks', at: cellCenter(10, 15) }))
  advance(match, 360)
  const barracks = [...match.units.values()].find(unit => unit.kind === 'barracks')!
  assert.ok(match.command('human', [barracks.id], { kind: 'train', unit: 'blade' }))
  advance(match, training.blade.ticks + 1)
  assert.equal(match.report().sides.human.troopsTrained, 1)
  assert.equal(match.report().sides.human.buildingsBuilt, 1)
  const attacker = match.units.get(2)!
  const at = { x: attacker.x + 20, y: attacker.y }
  Object.assign(match.units.get(9)!, { ...at, hp: 1 })
  advance(match, 40)
  assert.equal(match.report().sides.human.enemiesKilled, 1)
  Object.assign(match.units.get(8)!, { ...at, hp: 1 })
  advance(match, 40)
  assert.deepEqual(match.result, { winner: 'human', reason: 'headquarters' })
  const { human, orc } = serialize(match).report().sides
  assert.equal(human.enemiesKilled, 1)
  assert.equal(human.buildingsRazed, 1)
  assert.equal(orc.unitsLost, 1)
  assert.equal(orc.buildingsLost, 1)
})
