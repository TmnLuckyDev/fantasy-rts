import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match, TICK_HZ } from '../src/server/match.ts'
import { parseMessage } from '../src/server/validate.ts'
import { GATHERING, training } from '../src/shared/economy.ts'
import { ashfordMap, cellCenter, mapForSettings } from '../src/shared/map.ts'
import { MAX_DEPOSITS, defaultMatchSettings, parseMatchSettings, treeLimit } from '../src/shared/match-settings.ts'
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
    for (let i = 0; i < 2 * GATHERING[resource].ticks && !match.view('human').depleted?.includes(index); i++) match.step()
    assert.ok([...match.units.values()].some(unit => unit.cargo === resource && unit.cargoAmount === 7))
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
  assert.equal(match.report().sides.human.score, 108 + 3 * 75 + 2 * 90 + 105)
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

test('timed score credits research and uncontested objectives, excluding temporary summons', () => {
  const settings = { ...defaultMatchSettings('ashford-original'), minutes: 1, randomStarts: false }
  const match = Match.configured(settings)
  const smithy = match['spawn']('human', 'smithy', cellCenter(12, 13))
  const [objective] = match.view('human').controlSites!
  const unresearched = match.report().sides.human.score
  assert.ok(match.command('human', [smithy.id], { kind: 'upgrade', upgrade: 'weapons' }))
  for (let i = 0; i < 250; i++) match.step()
  const researched = match.report().sides.human
  assert.equal(researched.research, 108)
  assert.equal(researched.score, unresearched)
  const temporary = match['spawn']('human', 'blade', objective)
  temporary.summonedUntil = match.tick + 2 * TICK_HZ
  for (let i = 0; i < TICK_HZ; i++) match.step()
  assert.equal(match.report().sides.human.score, researched.score)
  match['spawn']('human', 'blade', objective)
  for (let i = 0; i < TICK_HZ; i++) match.step()
  assert.equal(match.report().sides.human.territory, 1)
  assert.equal(serialize(match).report().sides.human.territory, 1)
})

test('default mines and quarries share five worker slots and divert excess workers to explored deposits', () => {
  const settings = defaultMatchSettings('ashford-original')
  assert.equal(settings.sources.wood.workers, null)
  for (const source of Object.values(settings.sources)) assert.equal(source.stock, null)
  for (const [resource, tile, coordinates] of [['gold', 'mine', [5, 18]], ['stone', 'quarry', [4, 15]]] as const) {
    assert.equal(settings.sources[resource].workers, 5)
    const match = Match.configured(settings)
    const at = cellCenter(coordinates[0], coordinates[1])
    const home = match.map.bases.human
    const next = match.map.tiles.flatMap((value, i) => value === tile ? [cellCenter(i % match.map.width, Math.floor(i / match.map.width))] : [])
      .filter(point => point.x < match.map.width * 16 && (point.x !== at.x || point.y !== at.y))
      .sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))[0]
    const workers = Array.from({ length: 6 }, (_, i) => match['spawn']('human', 'worker', cellCenter(coordinates[0] + 1, coordinates[1] + i % 3 - 1)))
    const reveal = match['spawn']('human', 'scout', { x: next.x + 32, y: next.y })
    match.step()
    assert.ok(match.availableDeposit('human', next))
    match['destroy'](reveal)
    assert.ok(match.command('human', workers.slice(0, 5).map(worker => worker.id), { kind: 'gather', at }))
    assert.ok(match.command('human', [workers[5].id], { kind: 'gather', at }))
    const overflow = workers[5].job
    assert.ok(overflow?.kind === 'gather')
    assert.notDeepEqual(overflow.at, at)
    advance(match, 5 * 60 * TICK_HZ)
    assert.ok(match.report().sides.human.gathered[resource] > 2500)
    assert.equal(match.view('human').depleted, undefined)
    assert.equal(serialize(match).settings.sources[resource].workers, 5)
    for (const worker of match.units.values()) {
      if (worker.faction === 'human' && worker.kind === 'worker') match['destroy'](worker)
    }
    match.checkpoint().resources.human.gold = training.worker.gold
    const before = match.report().sides.human.gathered[resource]
    assert.ok(match.command('human', [1], { kind: 'train', unit: 'worker' }))
    advance(match, training.worker.ticks + 1)
    const newcomer = [...match.units.values()].filter(unit => unit.faction === 'human' && unit.kind === 'worker').at(-1)!
    assert.ok(match.command('human', [newcomer.id], { kind: 'gather', at }))
    advance(match, 30 * TICK_HZ)
    assert.ok(match.report().sides.human.gathered[resource] > before)
  }
})

test('a full unlimited mine with no explored alternative leaves extra workers idle', () => {
  const settings = defaultMatchSettings('ashford-original')
  settings.sources.gold.count = 1
  const match = Match.configured(settings)
  const at = cellCenter(5, 18)
  const workers = Array.from({ length: 6 }, (_, i) => match['spawn']('human', 'worker', cellCenter(6, 15 + i)))
  assert.ok(match.command('human', workers.map(worker => worker.id), { kind: 'gather', at }))
  assert.equal(workers.filter(worker => worker.job?.kind === 'gather').length, 5)
  assert.equal(workers[5].job, null)
  assert.ok(!match.command('human', [workers[5].id], { kind: 'gather', at }))
})

test('large bank reserves contribute less than the same resources invested in a living army', () => {
  const invested = Match.configured({ ...defaultMatchSettings('ashford-original'), starting: { gold: 3000, wood: 0, stone: 0 } })
  const hoarded = Match.configured({ ...defaultMatchSettings('ashford-original'), starting: { gold: 3300, wood: 0, stone: 0 } })
  invested['spawn']('human', 'farm', cellCenter(10, 15))
  const barracks = invested['spawn']('human', 'barracks', cellCenter(10, 12))
  assert.ok(invested.command('human', [barracks.id], { kind: 'train', unit: 'blade', count: 4 }))
  advance(invested, training.blade.ticks * 4)
  assert.equal(invested.report().sides.human.score, hoarded.report().sides.human.score)
})
