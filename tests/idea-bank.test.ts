import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match, TICK_HZ } from '../src/server/match.ts'
import { parseMessage } from '../src/server/validate.ts'
import { hallUpgrades, researchTicks, training } from '../src/shared/economy.ts'
import { ashfordClassic, cellCenter } from '../src/shared/map.ts'
import { defaultMatchSettings } from '../src/shared/match-settings.ts'

test('new matches enforce both headquarters tiers and preserve them across a save', () => {
  const settings = { ...defaultMatchSettings('ashford-original'), randomStarts: false, starting: { gold: 3000, wood: 3000, stone: 3000 } }
  const match = Match.start(settings)
  const upgrade = { kind: 'structure-upgrade' } as const
  const hall = match.units.get(1)!
  assert.equal(match.hallLevel('human'), 1)
  assert.equal(match.command('human', [1], upgrade), false)
  assert.match(match.trainGlobally('human', 'vanguard', 1)!, /level 3/)
  assert.equal(match.command('human', [15], { kind: 'build', building: 'tower', at: cellCenter(11, 14) }), false)
  match['spawn']('human', 'barracks', cellCenter(10, 12))
  const smithy = match['spawn']('human', 'smithy', cellCenter(12, 13))
  assert.ok(match.command('human', [1], upgrade))
  assert.equal(match.command('human', [1], upgrade), false)
  for (let tick = 0; tick < hallUpgrades[2].ticks; tick++) match.step()
  assert.equal(hall.level, 2)
  const range = match['spawn']('human', 'range', cellCenter(12, 15), 30)
  match['spawn']('human', 'tower', cellCenter(13, 17))
  assert.equal(match.command('human', [1], upgrade), false)
  range.buildDuration = 0
  assert.ok(match.command('human', [1], upgrade))
  const restored = Match.restore(structuredClone(match.checkpoint()))
  for (let tick = 0; tick < hallUpgrades[3].ticks; tick++) restored.step()
  assert.equal(restored.view('human').hallLevel, 3)
  assert.equal(restored.trainGlobally('human', 'vanguard', 1), null)
  restored.checkpoint().upgrades!.human.push('weapons')
  assert.ok(restored.command('human', [smithy.id], { kind: 'upgrade', upgrade: 'weapons' }))
  assert.equal(restored.units.get(smithy.id)?.upgradeJob?.left, researchTicks('weapons', 2))
})

test('templates reserve no extra population, fill in order, replace losses and reload', () => {
  const match = new Match(ashfordClassic, { ...defaultMatchSettings('ashford-original'), starting: { gold: 3000, wood: 3000, stone: 3000 } })
  match['spawn']('human', 'barracks', cellCenter(10, 12))
  match['spawn']('human', 'farm', cellCenter(10, 15))
  for (const name of ['First', 'Second']) {
    assert.ok(match.command('human', [1], { kind: 'template-save', template: 0, name, targets: [{ kind: 'blade', count: 1 }] }))
  }
  const [first, second] = match.view('human').templates!
  assert.equal(match.view('orc').templates, undefined)
  assert.ok(match.command('human', [1], { kind: 'template-replenish', template: second.id }))
  assert.equal(match.view('human').population.reserved, 2)
  for (let tick = 0; tick < training.blade.ticks * 2; tick++) match.step()
  const filled = match.view('human').templates!
  assert.deepEqual(filled.map(group => group.members.length), [1, 1])
  match['destroy'](match.units.get(filled[0].members[0].id)!)
  assert.deepEqual(match.view('human').templates!.map(group => group.members.length), [0, 1])
  const restored = Match.restore(structuredClone(match.checkpoint()))
  assert.ok(restored.command('human', [1], { kind: 'template-replenish', template: first.id }))
  for (let tick = 0; tick < training.blade.ticks; tick++) restored.step()
  assert.deepEqual(restored.view('human').templates!.map(group => group.members.length), [1, 1])
  assert.equal(parseMessage(JSON.stringify({ type: 'command', ids: [1],
    order: { kind: 'template-save', template: 0, name: 'Invalid', targets: [{ kind: 'worker', count: 1 }] } })), null)
})

test('heroes regenerate slowly after time out of combat', () => {
  const match = new Match()
  const hero = match['spawn']('human', 'vanguard', cellCenter(10, 12))
  hero.hp -= 60
  const wounded = hero.hp
  hero.recoverAt = match.tick + 8 * TICK_HZ
  for (let tick = 1; tick < 8 * TICK_HZ; tick++) match.step()
  assert.equal(hero.hp, wounded)
  const resumed = Match.restore(structuredClone(match.checkpoint()))
  resumed.step()
  assert.ok(resumed.units.get(hero.id)!.hp > wounded)
  assert.ok(resumed.units.get(hero.id)!.hp < hero.maxHp)
})
