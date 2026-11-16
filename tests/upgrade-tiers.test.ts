import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { trainingCost, MAX_UPGRADE_LEVEL, structureUpgrade, upgrades } from '../src/shared/economy.ts'
import { cellCenter } from '../src/shared/map.ts'
import { parseMessage } from '../src/server/validate.ts'
import { heroLevel } from '../src/shared/heroes.ts'

function advance(match: Match, ticks: number) {
  for (let i = 0; i < ticks; i++) match.step()
}

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
  checkpoint.resources.human = { gold: 10000, wood: 10000, stone: 10000 }
  const game = Match.restore(checkpoint)
  for (const kind of ['weapons', 'armor', 'precision', 'vitality', 'range'] as const) {
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
