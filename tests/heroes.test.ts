import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { training } from '../src/shared/economy.ts'
import { heroHealthPerLevel, heroLevel } from '../src/shared/heroes.ts'
import { isHeroKind } from '../src/shared/protocol.ts'
import { unitStats } from '../src/shared/units.ts'

function advance(match: Match, ticks: number) {
  for (let i = 0; i < ticks; i++) match.step()
}

test('one hero per side can train through the hall, with independent choices and normal population', () => {
  const match = new Match()
  match.checkpoint().resources.human.gold = 600
  match.checkpoint().resources.orc.gold = 600
  const trainingOrder = { kind: 'train', unit: 'vanguard' } as const
  const rangerOrder = { kind: 'train', unit: 'pathfinder' } as const
  assert.equal(match.command('human', [1], { ...trainingOrder, count: 2 }), false)
  assert.ok(match.command('human', [1], trainingOrder))
  assert.equal(match.command('human', [1], rangerOrder), false)
  assert.ok(match.command('orc', [8], rangerOrder))
  assert.equal(match.view('human').population.reserved, 1)
  assert.equal(match.view('human').resources.gold, 600 - training.vanguard.gold)
  advance(match, training.vanguard.ticks)
  const human = [...match.units.values()].find(unit => unit.faction === 'human' && isHeroKind(unit.kind))!
  const orc = [...match.units.values()].find(unit => unit.faction === 'orc' && isHeroKind(unit.kind))!
  assert.equal(human.kind, 'vanguard')
  assert.equal(orc.kind, 'pathfinder')
  assert.equal(human.experience, 0)
  assert.equal(match.view('human').population.used, 10)
  match.checkpoint().resources.human.gold = 600
  assert.equal(match.command('human', [1], rangerOrder), false)
})

test('nearby allied kills level a hero, preserve health and XP across saves and redeployment', () => {
  const match = new Match()
  match.checkpoint().resources.human.gold = 600
  match.checkpoint().resources.orc.gold = 600
  assert.ok(match.command('human', [1], { kind: 'train', unit: 'vanguard' }))
  advance(match, training.vanguard.ticks)
  const hero = [...match.units.values()].find(unit => unit.kind === 'vanguard')!
  const soldier = match.units.get(2)!
  Object.assign(hero, { x: 300, y: 350 })
  Object.assign(soldier, { x: 450, y: 350 })
  for (const id of [9, 10, 11]) {
    Object.assign(match.units.get(id)!, { x: 467, y: 350, hp: 1 })
  }
  advance(match, 65)
  assert.equal(hero.experience, 72)
  assert.equal(heroLevel(hero.experience), 2)
  assert.equal(hero.maxHp, unitStats.human.vanguard.health + heroHealthPerLevel)

  // A separate victory far from the hero does not award more experience.
  Object.assign(soldier, { x: 830, y: 350 })
  Object.assign(match.units.get(12)!, { x: 845, y: 350, hp: 1 })
  advance(match, 25)
  assert.equal(hero.experience, 72)

  const saved = Match.restore(structuredClone(match.checkpoint()))
  const resumed = saved.units.get(hero.id)!
  assert.equal(resumed.experience, 72)
  assert.equal(resumed.maxHp, hero.maxHp)
  const enemy = saved.units.get(13)!
  for (const id of [2, 3, 4, 5, 6, 7]) saved.units.delete(id)
  Object.assign(enemy, { x: resumed.x + 20, y: resumed.y, nextStrike: saved.tick + 5 })
  resumed.hp = 1
  resumed.nextStrike = Number.MAX_SAFE_INTEGER
  advance(saved, 1)
  assert.ok(saved.command('orc', [enemy.id], { kind: 'attack', target: resumed.id }))
  advance(saved, 40)
  assert.equal(saved.units.has(hero.id), false)
  saved.checkpoint().resources.human.gold = 600
  saved.checkpoint().resources.human.wood = 180
  assert.ok(saved.command('human', [1], { kind: 'train', unit: 'vanguard' }))
  advance(saved, training.vanguard.ticks)
  const returned = [...saved.units.values()].find(unit => unit.kind === 'vanguard')!
  assert.notEqual(returned.id, hero.id)
  assert.equal(returned.experience, 72)
  assert.equal(returned.maxHp, hero.maxHp)
})
