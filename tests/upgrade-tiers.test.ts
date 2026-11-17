import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { trainingCost, researchCost, bulkStructureCost, MAX_UPGRADE_LEVEL, structureUpgrade, upgrades } from '../src/shared/economy.ts'
import { cellCenter } from '../src/shared/map.ts'
import { parseMessage } from '../src/server/validate.ts'
import { heroLevel } from '../src/shared/heroes.ts'
import { unitStats } from '../src/shared/units.ts'

function advance(match: Match, ticks: number) {
  for (let i = 0; i < ticks; i++) match.step()
}

test('attacked melee troops obey explicit move and stop orders under repeated attacks', () => {
  const checkpoint = new Match().checkpoint()
  const humanBase = checkpoint.units.find(unit => unit.faction === 'human' && unit.kind === 'headquarters')!
  const orcBase = checkpoint.units.find(unit => unit.faction === 'orc' && unit.kind === 'headquarters')!
  const victim = { ...humanBase, id: ++checkpoint.sequence, kind: 'blade' as const, ...cellCenter(12, 12), hp: 96, maxHp: 96 }
  const ally = { ...humanBase, id: ++checkpoint.sequence, kind: 'blade' as const, ...cellCenter(15, 12), hp: 96, maxHp: 96 }
  const attacker = { ...orcBase, id: ++checkpoint.sequence, kind: 'ranged' as const, ...cellCenter(17, 12), hp: 66, maxHp: 66 }
  checkpoint.units.push(victim, ally, attacker)
  const game = Match.restore(checkpoint)
  const destination = cellCenter(20, 20)
  assert.equal(game.command('human', [victim.id, ally.id], { kind: 'move', to: destination }), true)
  const internal = game as unknown as {
    units: Map<number, { defense: { targetId: number } | null, order: { kind: string } | null }>
    callDefenders(victim: unknown, attacker: unknown): void
    defendedAgainst(unit: unknown): unknown
  }
  const ownVictim = internal.units.get(victim.id)!
  const ownAlly = internal.units.get(ally.id)!
  const enemy = internal.units.get(attacker.id)!
  internal.callDefenders(ownVictim, enemy)
  assert.equal(ownVictim.defense, null)
  assert.equal(ownAlly.defense, null)
  assert.equal(ownVictim.order?.kind, 'move')
  assert.equal(ownAlly.order?.kind, 'move')
  const target = game.units.get(victim.id)!
  const startX = target.x
  advance(game, 15)
  assert.ok(target.x > startX)
  assert.equal(game.command('human', [victim.id], { kind: 'halt' }), true)
  const stopped = { x: target.x, y: target.y }
  for (let i = 0; i < 20; i++) {
    internal.callDefenders(ownVictim, enemy)
    game.step()
  }
  assert.deepEqual({ x: target.x, y: target.y }, stopped)
  assert.equal(ownVictim.defense, null)
  assert.equal(ownVictim.order?.kind, 'halt')
})

test('ships charge both gold and wood, including queued refunds', () => {
  assert.deepEqual(trainingCost('transport'), { gold: 160, wood: 130 })
  assert.deepEqual(trainingCost('warship'), { gold: 230, wood: 185 })
  const match = new Match()
  const checkpoint = match.checkpoint()
  const base = checkpoint.units.find(unit => unit.faction === 'human' && unit.kind === 'headquarters')!
  const port = { ...base, id: ++checkpoint.sequence, kind: 'port' as const, ...cellCenter(10, 15), hp: 750, maxHp: 750 }
  checkpoint.units.push(port)
  checkpoint.units.push({ ...base, id: ++checkpoint.sequence, kind: 'farm' as const, ...cellCenter(12, 15), hp: 310, maxHp: 310 })
  checkpoint.resources.human = { gold: 500, wood: 400, stone: 500 }
  const game = Match.restore(checkpoint)
  assert.equal(game.command('human', [port.id], { kind: 'train', unit: 'transport' }), true)
  assert.equal(game.snapshot().resources.human.gold, 340)
  assert.equal(game.snapshot().resources.human.wood, 270)
  assert.equal(game.command('human', [port.id], { kind: 'cancel-train', count: 1 }), true)
  assert.equal(game.snapshot().resources.human.gold, 500)
  assert.equal(game.snapshot().resources.human.wood, 400)
})

test('tower and wall each reach level five, cannot exceed cap and preserve their level in checkpoints', () => {
  const match = new Match()
  const checkpoint = match.checkpoint()
  const base = checkpoint.units.find(unit => unit.faction === 'human' && unit.kind === 'headquarters')!
  const tower = { ...base, id: ++checkpoint.sequence, kind: 'tower' as const, ...cellCenter(10, 15), hp: 460, maxHp: 460, level: 1 }
  const wall = { ...base, id: ++checkpoint.sequence, kind: 'wall' as const, ...cellCenter(11, 15), hp: 360, maxHp: 360, level: 1 }
  checkpoint.units.push(tower, wall)
  checkpoint.resources.human = { gold: 10000, wood: 10000, stone: 10000 }
  const game = Match.restore(checkpoint)
  for (const site of [tower, wall]) {
    for (let level = 2; level <= MAX_UPGRADE_LEVEL; level++) {
      assert.equal(game.command('human', [site.id], { kind: 'structure-upgrade' }), true)
      advance(game, structureUpgrade(site.kind, level).ticks)
      assert.equal(game.units.get(site.id)?.level, level)
    }
    assert.equal(game.command('human', [site.id], { kind: 'structure-upgrade' }), false)
  }
  const restored = Match.restore(structuredClone(game.checkpoint()))
  assert.equal(restored.units.get(tower.id)?.level, 5)
  assert.equal(restored.units.get(wall.id)?.level, 5)
  assert.ok(restored.units.get(tower.id)!.maxHp > 460)
  assert.ok(restored.units.get(wall.id)!.maxHp > 360)
})

test('blacksmith research has five levels for each upgrade and no sixth level', () => {
  const match = new Match()
  const checkpoint = match.checkpoint()
  const base = checkpoint.units.find(unit => unit.faction === 'human' && unit.kind === 'headquarters')!
  const smith = { ...base, id: ++checkpoint.sequence, kind: 'smithy' as const, ...cellCenter(10, 15), hp: 620, maxHp: 620 }
  checkpoint.units.push(smith)
  checkpoint.resources.human = { gold: 20000, wood: 10000, stone: 10000 }
  const game = Match.restore(checkpoint)
  for (const kind of ['weapons', 'armor', 'precision', 'vitality', 'range', 'speed'] as const) {
    for (let level = 1; level <= MAX_UPGRADE_LEVEL; level++) {
      assert.equal(game.command('human', [smith.id], { kind: 'upgrade', upgrade: kind }), true)
      advance(game, upgrades[kind].ticks)
      assert.equal(game.view('human').upgrades?.filter(value => value === kind).length, level)
    }
    assert.equal(game.command('human', [smith.id], { kind: 'upgrade', upgrade: kind }), false)
  }
})

test('hero experience levels up from combat hits without needing a killing blow', () => {
  const match = new Match()
  const checkpoint = match.checkpoint()
  const base = checkpoint.units.find(unit => unit.faction === 'human' && unit.kind === 'headquarters')!
  const hero = { ...base, id: ++checkpoint.sequence, kind: 'vanguard' as const, ...cellCenter(11, 15), hp: 360, maxHp: 360, experience: 0 }
  const target = { ...base, id: ++checkpoint.sequence, faction: 'orc' as const, kind: 'heavy' as const,
    ...cellCenter(12, 15), hp: 240, maxHp: 240 }
  checkpoint.units.push(hero, target)
  const game = Match.restore(checkpoint)
  advance(game, 1)
  assert.equal(game.command('human', [hero.id], { kind: 'attack', target: target.id }), true)
  advance(game, 45)
  assert.ok((game.units.get(hero.id)?.experience ?? 0) > 0)
  assert.ok(heroLevel(game.units.get(hero.id)?.experience ?? 0) >= 1)
})

test('structure upgrade orders are validated', () => {
  const parsed = parseMessage(JSON.stringify({ type: 'command', ids: [1], order: { kind: 'structure-upgrade' } }))
  assert.equal(parsed?.type, 'command')
})

test('five ranged reach levels extend tower, warship and archer attacks, but not melee', () => {
  const checkpoint = new Match().checkpoint()
  const base = checkpoint.units.find(unit => unit.faction === 'human' && unit.kind === 'headquarters')!
  const smith = { ...base, id: ++checkpoint.sequence, kind: 'smithy' as const, ...cellCenter(10, 15), hp: 620, maxHp: 620 }
  const tower = { ...base, id: ++checkpoint.sequence, kind: 'tower' as const, ...cellCenter(11, 15), hp: 460, maxHp: 460 }
  const warship = { ...base, id: ++checkpoint.sequence, kind: 'warship' as const, ...cellCenter(12, 15), hp: 650, maxHp: 650 }
  const archer = { ...base, id: ++checkpoint.sequence, kind: 'ranged' as const, ...cellCenter(13, 15), hp: 66, maxHp: 66 }
  const blade = { ...base, id: ++checkpoint.sequence, kind: 'blade' as const, ...cellCenter(14, 15), hp: 96, maxHp: 96 }
  checkpoint.units.push(smith, tower, warship, archer, blade)
  checkpoint.resources.human = { gold: 10000, wood: 10000, stone: 10000 }
  const game = Match.restore(checkpoint)
  const rangeOf = (unit: { id: number }) => (game as unknown as { attackRange(unit: unknown): number }).attackRange(unit)
  const before = [tower, warship, archer, blade].map(rangeOf)
  for (let i = 0; i < 5; i++) {
    assert.equal(game.command('human', [smith.id], { kind: 'upgrade', upgrade: 'range' }), true)
    advance(game, upgrades.range.ticks)
  }
  assert.deepEqual([tower, warship, archer].map(rangeOf), before.slice(0, 3).map(value => value + 5 * upgrades.range.bonus))
  assert.equal(rangeOf(blade), before[3])
  assert.equal(game.command('human', [smith.id], { kind: 'upgrade', upgrade: 'range' }), false)
  const restored = Match.restore(structuredClone(game.checkpoint()))
  assert.equal(restored.view('human').entities.find(unit => unit.id === tower.id)?.rangeLevel, 5)
  assert.equal(restored.view('human').entities.find(unit => unit.id === warship.id)?.rangeLevel, 5)
})

test('all races reach 265 tower range after five research levels', () => {
  for (const race of ['human', 'orc', 'dwarf', 'elf', 'undead'] as const) {
    assert.equal(unitStats[race].tower.range, 205)
    assert.equal(unitStats[race].tower.range + 5 * upgrades.range.bonus, 265)
  }
})

test('five speed research levels accelerate both land troops and ships without changing static buildings', () => {
  const checkpoint = new Match().checkpoint()
  const base = checkpoint.units.find(unit => unit.faction === 'human' && unit.kind === 'headquarters')!
  const smith = { ...base, id: ++checkpoint.sequence, kind: 'smithy' as const, ...cellCenter(10, 15), hp: 620, maxHp: 620 }
  const soldier = checkpoint.units.find(unit => unit.faction === 'human' && unit.kind === 'blade')!
  const ship = { ...base, id: ++checkpoint.sequence, kind: 'warship' as const, ...cellCenter(12, 15), hp: 650, maxHp: 650 }
  checkpoint.units.push(smith, ship)
  checkpoint.resources.human = { gold: 10000, wood: 10000, stone: 10000 }
  const game = Match.restore(checkpoint)
  const moveSpeed = (unit: unknown) => (game as unknown as { moveSpeed(unit: unknown): number }).moveSpeed(unit)
  const before = [soldier, ship, smith].map(moveSpeed)
  for (let i = 0; i < 5; i++) {
    assert.equal(game.command('human', [smith.id], { kind: 'upgrade', upgrade: 'speed' }), true)
    advance(game, upgrades.speed.ticks)
  }
  assert.equal(moveSpeed(soldier), before[0] * 1.25)
  assert.equal(moveSpeed(ship), before[1] * 1.25)
  assert.equal(moveSpeed(smith), 0)
  assert.equal(game.command('human', [smith.id], { kind: 'upgrade', upgrade: 'speed' }), false)
  const restored = Match.restore(structuredClone(game.checkpoint()))
  assert.equal(restored.view('human').entities.find(unit => unit.id === soldier.id)?.speedLevel, 5)
  assert.equal(restored.view('human').entities.find(unit => unit.id === ship.id)?.speedLevel, 5)
})

test('bulk fortification upgrades charge 20% extra per eligible building and complete together', () => {
  const checkpoint = new Match().checkpoint()
  const base = checkpoint.units.find(unit => unit.faction === 'human' && unit.kind === 'headquarters')!
  const wallA = { ...base, id: ++checkpoint.sequence, kind: 'wall' as const, ...cellCenter(10, 15), hp: 360, maxHp: 360, level: 1 }
  const wallB = { ...base, id: ++checkpoint.sequence, kind: 'wall' as const, ...cellCenter(11, 15), hp: 360, maxHp: 360, level: 1 }
  const tower = { ...base, id: ++checkpoint.sequence, kind: 'tower' as const, ...cellCenter(12, 15), hp: 460, maxHp: 460, level: 1 }
  checkpoint.units.push(wallA, wallB, tower)
  checkpoint.resources.human = { gold: 1000, wood: 1000, stone: 1000 }
  const game = Match.restore(checkpoint)
  const before = { ...game.view('human').resources }
  assert.equal(game.command('human', [base.id], { kind: 'bulk-structure-upgrade', building: 'wall' }), true)
  const price = bulkStructureCost('wall', 2)
  assert.equal(game.view('human').resources.stone, before.stone - 2 * (price.stone ?? 0))
  assert.equal(game.view('human').resources.wood, before.wood - 2 * (price.wood ?? 0))
  assert.equal(game.command('human', [base.id], { kind: 'bulk-structure-upgrade', building: 'wall' }), false)
  advance(game, structureUpgrade('wall', 2).ticks)
  assert.equal(game.units.get(wallA.id)?.level, 2)
  assert.equal(game.units.get(wallB.id)?.level, 2)
  assert.equal(game.units.get(tower.id)?.level, 1)
  assert.equal(game.command('human', [base.id], { kind: 'bulk-structure-upgrade', building: 'tower' }), true)
  advance(game, structureUpgrade('tower', 2).ticks)
  assert.equal(game.units.get(tower.id)?.level, 2)
})

test('bulk upgrade rejects insufficient funds atomically and rejects enemy-owned commands', () => {
  const checkpoint = new Match().checkpoint()
  const base = checkpoint.units.find(unit => unit.faction === 'human' && unit.kind === 'headquarters')!
  const wallA = { ...base, id: ++checkpoint.sequence, kind: 'wall' as const, ...cellCenter(10, 15), hp: 360, maxHp: 360, level: 1 }
  const wallB = { ...base, id: ++checkpoint.sequence, kind: 'wall' as const, ...cellCenter(11, 15), hp: 360, maxHp: 360, level: 1 }
  checkpoint.units.push(wallA, wallB)
  checkpoint.resources.human = { gold: 0, wood: 0, stone: 150 }
  const game = Match.restore(checkpoint)
  assert.equal(game.command('orc', [base.id], { kind: 'bulk-structure-upgrade', building: 'wall' }), false)
  assert.equal(game.command('human', [base.id], { kind: 'bulk-structure-upgrade', building: 'wall' }), false)
  assert.equal(game.view('human').resources.stone, 150)
  assert.equal(game.units.get(wallA.id)?.structureJob, undefined)
  assert.equal(game.units.get(wallB.id)?.structureJob, undefined)
  const parsed = parseMessage(JSON.stringify({ type: 'command', ids: [base.id], order: { kind: 'bulk-structure-upgrade', building: 'tower' } }))
  assert.equal(parsed?.type, 'command')
  assert.equal(parseMessage(JSON.stringify({ type: 'command', ids: [base.id], order: { kind: 'bulk-structure-upgrade', building: 'headquarters' } })), null)
})

test('unit research charges the next level and rejects orders when the bank only covers an earlier level', () => {
  const match = new Match()
  const smith = match['spawn']('human', 'smithy', cellCenter(10, 13))
  const resources = match.checkpoint().resources.human
  Object.assign(resources, { gold: 4000, wood: 2500, stone: 0 })
  const start = { ...resources }
  const order = { kind: 'upgrade', upgrade: 'weapons' } as const
  assert.deepEqual([1, 2, 3, 4, 5].map(level => researchCost('weapons', level).gold), [85, 170, 340, 680, 1360])
  assert.equal(match.command('human', [smith.id], order), true)
  assert.equal(resources.gold, start.gold - 85)
  assert.equal(resources.wood, start.wood - 23)
  advance(match, upgrades.weapons.ticks)
  const restored = Match.restore(structuredClone(match.checkpoint()), match.map)
  const bank = restored.checkpoint().resources.human
  Object.assign(bank, { gold: 169, wood: 45 })
  assert.equal(restored.command('human', [smith.id], order), false)
  assert.equal(bank.gold, 169)
  bank.gold++
  assert.equal(restored.command('human', [smith.id], order), true)
  assert.deepEqual(bank, { gold: 0, wood: 0, stone: 0 })
})
