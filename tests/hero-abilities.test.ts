import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { heroAbilities, heroDamagePerLevel, heroHealthPerLevel } from '../src/shared/heroes.ts'
import { unitStats } from '../src/shared/units.ts'
import { training } from '../src/shared/economy.ts'

test('heroes have upgraded health, damage, and individual skills', () => {
  assert.ok(unitStats.human.vanguard.health >= 350)
  assert.ok(unitStats.human.pathfinder.health >= 250)
  assert.ok(unitStats.human.vanguard.damage > unitStats.human.heavy.damage)
  assert.ok(heroHealthPerLevel >= 20)
  assert.ok(heroDamagePerLevel >= 3)
  assert.notEqual(heroAbilities.vanguard.name, heroAbilities.pathfinder.name)
})

test('hero active skills are server-authoritative and respect cooldown', () => {
  const match = new Match()
  match.checkpoint().resources.human.gold = 600
  match.checkpoint().resources.orc.gold = 600
  assert.ok(match.command('human', [1], { kind: 'train', unit: 'vanguard' }))
  for (let i = 0; i < training.vanguard.ticks + 2; i++) match.step()
  const hero = [...match.units.values()].find(unit => unit.faction === 'human' && unit.kind === 'vanguard')!
  assert.ok(hero)
  assert.equal(match.command('human', [hero.id], { kind: 'hero-ability' }), true)
  assert.ok((hero.abilityActiveUntil ?? 0) > match.tick)
  assert.equal(match.command('human', [hero.id], { kind: 'hero-ability' }), false)
  assert.equal(match.command('human', [2], { kind: 'hero-ability' }), false)
  for (let i = 0; i < heroAbilities.vanguard.cooldown; i++) match.step()
  assert.equal(match.command('human', [hero.id], { kind: 'hero-ability' }), true)
  const saved = Match.restore(structuredClone(match.checkpoint()))
  assert.equal(saved.units.get(hero.id)?.abilityReadyAt, hero.abilityReadyAt)
})

test('Arrow Storm hits the six nearest visible enemies in a packed formation', () => {
  const match = new Match()
  const at = match.units.get(1)!
  const hero = match['spawn']('human', 'pathfinder', { x: at.x, y: at.y + 80 })
  hero.nextStrike = Infinity
  const targets = Array.from({ length: 8 }, (_, i) =>
    match['spawn']('orc', 'worker', { x: hero.x + 30 + i * 8, y: hero.y }))
  match.step()
  assert.ok(match.command('human', [hero.id], { kind: 'hero-ability' }))
  assert.deepEqual(targets.map(unit => unit.hp < unit.maxHp), [true, true, true, true, true, true, false, false])
  assert.equal(match.command('human', [hero.id], { kind: 'hero-ability' }), false)
})
