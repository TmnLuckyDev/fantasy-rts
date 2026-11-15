import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ashford, cellCenter, distance, riverColumn, TILE } from '../src/shared/map.ts'
import { GATHERING, REPAIR, STARTING_RESOURCES, buildings, training } from '../src/shared/economy.ts'
import { Match } from '../src/server/match.ts'
import { canStand, findPath } from '../src/server/navigation.ts'
import { parseMessage } from '../src/server/validate.ts'

function advance(match: Match, ticks: number) {
  for (let i = 0; i < ticks; i++) match.step()
}

test('each resource is credited to its own stockpile only after delivery', () => {
  const sources = [['gold', 5, 18], ['wood', 6, 7], ['stone', 4, 15]] as const
  for (const [kind, x, y] of sources) {
    const match = new Match()
    assert.equal(match.command('human', [15], { kind: 'gather', at: cellCenter(10, 18) }), false)
    assert.equal(match.command('human', [2], { kind: 'gather', at: cellCenter(x, y) }), false)
    assert.ok(match.command('human', [15], { kind: 'gather', at: cellCenter(x, y) }))
    for (let i = 0; i < 350 && !match.units.get(15)!.cargo; i++) match.step()
    assert.equal(match.units.get(15)!.cargo, kind)
    assert.deepEqual(match.snapshot().resources.human, STARTING_RESOURCES)
    advance(match, 600)
    const stock = match.snapshot().resources
    assert.ok(stock.human[kind] >= STARTING_RESOURCES[kind] + 2 * GATHERING[kind].amount)
    assert.deepEqual({ ...stock.human, [kind]: STARTING_RESOURCES[kind] }, STARTING_RESOURCES)
    assert.deepEqual(stock.orc, STARTING_RESOURCES)
  }
})

test('building placement is charged once, pauses without a worker, then resumes and trains troops', () => {
  const match = new Match()
  const at = cellCenter(10, 15)
  assert.equal(match.command('human', [18], { kind: 'build', building: 'barracks', at }), false)
  assert.ok(match.command('human', [15], { kind: 'build', building: 'barracks', at }))
  const foundation = [...match.units.values()].find(unit => unit.kind === 'barracks')!
  const buildingStock = { gold: 300, wood: 90, stone: 75 }
  assert.deepEqual(match.snapshot().resources.human, buildingStock)
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
  assert.deepEqual(match.snapshot().resources.human, { ...buildingStock, gold: 300 - training.blade.gold })
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
  assert.deepEqual(match.snapshot().resources.human, { ...STARTING_RESOURCES, stone: 120 - 2 * buildings.wall.cost.stone! })
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

test('barracks infantry and archery-range units use separate queues with one shared population limit', () => {
  const match = new Match()
  assert.ok(match.command('human', [15], { kind: 'build', building: 'range', at: cellCenter(10, 15) }))
  assert.equal(match.command('human', [16], { kind: 'build', building: 'barracks', at: cellCenter(12, 16) }), false)
  advance(match, 360)
  const range = [...match.units.values()].find(unit => unit.kind === 'range')!
  assert.equal(range.buildDuration, 0)
  assert.equal(match.command('human', [range.id], { kind: 'train', unit: 'blade' }), false)
  assert.equal(match.command('human', [range.id], { kind: 'train', unit: 'heavy' }), false)
  assert.ok(match.command('human', [range.id], { kind: 'train', unit: 'ranged' }))
  assert.deepEqual(match.snapshot().population.human, { used: 9, reserved: 1, limit: 10 })
  assert.equal(match.command('human', [1], { kind: 'train', unit: 'worker' }), false)
  assert.equal(match.command('human', [range.id], { kind: 'train', unit: 'marksman' }), false)
  assert.ok(match.command('human', [16], { kind: 'build', building: 'farm', at: cellCenter(12, 16) }))
  assert.equal(match.snapshot().population.human.limit, 10)
  advance(match, 260)
  assert.deepEqual(match.snapshot().population.human, { used: 10, reserved: 0, limit: 20 })
  assert.ok(match.command('human', [range.id], { kind: 'train', unit: 'marksman' }))
  advance(match, 170)
  assert.deepEqual(match.snapshot().population.human, { used: 11, reserved: 0, limit: 20 })
  assert.equal([...match.units.values()].at(-1)?.kind, 'marksman')
})

for (const faction of ['human', 'orc'] as const) {
  test(`${faction} elite costs more gold and two slots, and farm loss blocks its spawn until space opens`, () => {
    const match = new Match()
    const worker = faction === 'human' ? 15 : 18
    const footman = faction === 'human' ? 2 : 9
    const mirror = (x: number, y: number) => faction === 'human'
      ? cellCenter(x, y) : cellCenter(ashford.width - 1 - x, ashford.height - 1 - y)
    assert.ok(match.command(faction, [worker], { kind: 'gather', at: mirror(6, 7) }))
    advance(match, 440)
    assert.ok(match.command(faction, [worker], { kind: 'build', building: 'elite', at: mirror(10, 15) }))
    assert.ok(match.command(faction, [worker + 1], { kind: 'build', building: 'farm', at: mirror(12, 16) }))
    const elite = [...match.units.values()].find(unit => unit.kind === 'elite')!
    const farm = [...match.units.values()].find(unit => unit.kind === 'farm')!
    assert.equal(match.command(faction, [elite.id], { kind: 'train', unit: 'heavy' }), false)
    advance(match, 400)
    assert.equal(elite.buildDuration, 0)
    assert.equal(farm.buildDuration, 0)
    assert.ok(match.command(faction, [elite.id], { kind: 'train', unit: 'heavy' }))
    assert.equal(match.snapshot().resources[faction].gold, 80)
    assert.deepEqual(match.snapshot().population[faction], { used: 9, reserved: 2, limit: 20 })
    match.units.delete(farm.id)
    advance(match, 210)
    assert.deepEqual(match.snapshot().population[faction], { used: 9, reserved: 2, limit: 10 })
    assert.equal([...match.units.values()].some(unit => unit.kind === 'heavy'), false)
    match.units.delete(footman)
    advance(match, 2)
    assert.deepEqual(match.snapshot().population[faction], { used: 10, reserved: 0, limit: 10 })
    const heavy = [...match.units.values()].at(-1)!
    assert.equal(heavy.kind, 'heavy')
    assert.equal(heavy.faction, faction)
    assert.ok(heavy.hp > 200)
  })
}

test('one worker builds paid wall segments in order and farms have no aggregate capacity ceiling', () => {
  const saved = new Match().checkpoint()
  saved.resources.human = { gold: 300, wood: 500, stone: 500 }
  const match = Match.restore(saved)
  const worker = 15
  const from = cellCenter(10, 15)
  const to = cellCenter(13, 15)
  assert.ok(match.command('human', [worker], { kind: 'wall-line', from, to }))
  const start = match.view('human').entities.filter(entity => entity.kind === 'wall')
  assert.deepEqual(start.map(entity => entity.constructionStatus), ['building', 'queued', 'queued', 'queued'])
  assert.equal(match.view('human').resources.stone, 500 - 4 * buildings.wall.cost.stone!)
  assert.equal(match.command('human', [worker], { kind: 'wall-line', from, to }), false)
  advance(match, 700)
  assert.ok(start.every(entity => match.units.get(entity.id)?.buildDuration === 0))
  for (const [x, y] of [[10, 12], [12, 12], [14, 12]]) {
    assert.ok(match.command('human', [worker], { kind: 'build', building: 'farm', at: cellCenter(x, y) }))
  }
  advance(match, 760)
  assert.equal(match.view('human').population.limit, 40)
})

test('a completed blacksmith researches one upgrade at a time and improves current troops', () => {
  const match = new Match()
  assert.equal(match.command('human', [1], { kind: 'upgrade', upgrade: 'weapons' }), false)
  assert.ok(match.command('human', [15], { kind: 'build', building: 'smithy', at: cellCenter(10, 15) }))
  const smithy = [...match.units.values()].find(unit => unit.kind === 'smithy')!
  assert.equal(match.command('human', [smithy.id], { kind: 'upgrade', upgrade: 'weapons' }), false)
  advance(match, 360)
  assert.ok(match.command('human', [smithy.id], { kind: 'upgrade', upgrade: 'weapons' }))
  assert.equal(match.command('human', [smithy.id], { kind: 'upgrade', upgrade: 'armor' }), false)
  assert.equal(match.view('human').resources.gold, 130)
  const copy = Match.restore(structuredClone(match.checkpoint()))
  advance(copy, 240)
  assert.deepEqual(copy.view('human').upgrades, ['weapons'])
  assert.equal(copy.command('human', [smithy.id], { kind: 'upgrade', upgrade: 'weapons' }), false)
  const footman = copy.units.get(2)!
  const grunt = copy.units.get(9)!
  Object.assign(footman, { x: 850, y: 312 })
  Object.assign(grunt, { x: 877, y: 312 })
  copy.step()
  copy.step()
  assert.equal(grunt.hp, grunt.maxHp - 15)
})


test('a worker repairs only friendly damaged buildings and charges materials after doing the work', () => {
  const match = new Match()
  const hall = match.units.get(1)!
  const worker = match.units.get(15)!
  Object.assign(worker, { x: hall.x + 45, y: hall.y })
  const order = { kind: 'repair', target: hall.id } as const
  assert.equal(match.command('human', [worker.id], order), false)
  hall.hp -= 25
  assert.equal(match.command('orc', [18], order), false)
  assert.equal(match.command('human', [2], order), false)
  assert.equal(match.command('human', [worker.id], { kind: 'repair', target: 2 }), false)
  assert.ok(match.command('human', [worker.id], order))
  assert.equal(match.command('human', [16], order), false)
  assert.equal(match.view('human').entities.find(unit => unit.id === hall.id)?.repairing, true)
  advance(match, REPAIR.ticks - 1)
  assert.equal(hall.hp, hall.maxHp - 25)
  assert.deepEqual(match.view('human').resources, STARTING_RESOURCES)

  const restored = Match.restore(structuredClone(match.checkpoint()))
  advance(restored, REPAIR.ticks + 1)
  const view = restored.view('human')
  assert.equal(view.entities.find(unit => unit.id === hall.id)?.hp, hall.maxHp)
  assert.equal(view.entities.find(unit => unit.id === hall.id)?.repairing, undefined)
  assert.equal(view.entities.find(unit => unit.id === worker.id)?.idle, true)
  assert.deepEqual(view.resources, { gold: 300, wood: 178, stone: 118 })
})

test('wall repairs use only stone and stop when stock runs out', () => {
  const match = new Match()
  assert.ok(match.command('human', [15], { kind: 'build', building: 'wall', at: cellCenter(10, 15) }))
  const wall = [...match.units.values()].find(unit => unit.kind === 'wall')!
  wall.hp--
  assert.equal(match.command('human', [16], { kind: 'repair', target: wall.id }), false)
  assert.equal(match.command('human', [wall.id], { kind: 'demolish' }), false)
  advance(match, 200)
  const saved = match.checkpoint()
  saved.resources.human.wood = 0
  saved.resources.human.stone = 1
  wall.hp = wall.maxHp - 35
  const restored = Match.restore(saved)
  assert.ok(restored.command('human', [15], { kind: 'repair', target: wall.id }))
  advance(restored, 100)
  assert.equal(restored.units.get(wall.id)!.hp, wall.maxHp - 15)
  assert.equal(restored.view('human').resources.stone, 0)
  assert.equal(restored.view('human').entities.find(unit => unit.id === 15)?.idle, true)
  assert.equal(restored.command('human', [15], { kind: 'repair', target: wall.id }), false)
})

test('demolition validates ownership, releases queued capacity and ends the match for headquarters', () => {
  const match = new Match()
  assert.ok(match.command('human', [15], { kind: 'build', building: 'barracks', at: cellCenter(10, 15) }))
  advance(match, 220)
  const barracks = [...match.units.values()].find(unit => unit.kind === 'barracks')!
  const order = { kind: 'demolish' } as const
  assert.ok(match.command('human', [barracks.id], { kind: 'train', unit: 'blade' }))
  assert.equal(match.view('human').population.reserved, 1)
  assert.equal(match.command('orc', [barracks.id], order), false)
  assert.equal(match.command('human', [15], order), false)
  const paid = match.view('human').resources
  assert.ok(match.command('human', [barracks.id], order))
  assert.equal(match.command('human', [barracks.id], order), false)
  assert.equal(match.view('human').population.reserved, 0)
  assert.deepEqual(match.view('human').resources, paid)
  assert.ok(match.snapshot(true).effects.some(effect => effect.kind === 'fallen' && effect.entityKind === 'barracks'))
  assert.ok(match.command('human', [1], order))
  match.step()
  assert.deepEqual(match.result, { winner: 'orc', reason: 'headquarters' })
})

test('building repair and demolition parse through the multiplayer protocol', () => {
  const packet = (order: object) => parseMessage(JSON.stringify({ type: 'command', ids: [15], order }))
  assert.deepEqual(packet({ kind: 'repair', target: 1 }), { type: 'command', ids: [15], order: { kind: 'repair', target: 1 } })
  assert.equal(packet({ kind: 'repair', target: -1 }), null)
  assert.deepEqual(packet({ kind: 'demolish', faction: 'orc' }), { type: 'command', ids: [15], order: { kind: 'demolish' } })
})
