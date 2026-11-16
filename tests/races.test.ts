import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { cellCenter } from '../src/shared/map.ts'
import type { BattleMap, Tile } from '../src/shared/map.ts'
import { defaultMatchSettings } from '../src/shared/match-settings.ts'
import { trainedAt, trainingRule, upgrades } from '../src/shared/economy.ts'
import { races, raceOf } from '../src/shared/protocol.ts'
import type { PlayerRaces } from '../src/shared/protocol.ts'
import { unitStats } from '../src/shared/units.ts'
import { applyDelta, makeDelta } from '../src/shared/snapshot-delta.ts'

function arena(race: PlayerRaces, populationCap = 500) {
  const width = 48, height = 20
  const tiles = Array<Tile>(width * height).fill('grass')
  tiles[9 * width + 20] = 'forest'
  const map: BattleMap = { name: 'Race test', width, height, tiles, bases: { human: cellCenter(4, 10), orc: cellCenter(43, 10) } }
  return new Match(map, { ...defaultMatchSettings(), populationCap }, race)
}

test('all five races support mirror starts, naval production and checkpoint recovery', () => {
  for (const race of races) {
    const match = arena({ human: race, orc: race })
    for (const side of ['human', 'orc'] as const) {
      const view = match.view(side)
      const fortress = view.entities.find(entity => entity.kind === 'headquarters')!
      assert.equal(raceOf(fortress), race)
      assert.equal(fortress.hp, unitStats[race].headquarters.health)
      assert.equal(fortress.faction, side)
      assert.ok(view.entities.every(entity => entity.faction === side))
      assert.deepEqual(trainedAt('port', race), ['transport', 'warship'])
      assert.equal(trainingRule('transport', race).population, 1)
      assert.equal(trainingRule('warship', race).population, 2)
    }
    assert.equal(match.command('orc', [2], { kind: 'halt' }), false)
    const restored = Match.restore(structuredClone(match.checkpoint()), match.map)
    assert.deepEqual(restored.races, match.races)
    assert.deepEqual(restored.view('orc').entities, match.view('orc').entities)
  }
  const legacy = arena({ human: 'human', orc: 'orc' })
  const checkpoint = structuredClone(legacy.checkpoint())
  delete checkpoint.races
  assert.deepEqual(Match.restore(checkpoint, legacy.map).races, { human: 'human', orc: 'orc' })
})

test('Dwarf hero armor aura absorbs damage only locally while active', () => {
  const match = arena({ human: 'dwarf', orc: 'human' })
  const hero = match['spawn']('human', 'vanguard', cellCenter(19, 11))
  const guard = match['spawn']('human', 'blade', cellCenter(20, 11))
  const enemy = match['spawn']('orc', 'blade', cellCenter(21, 11))
  match['hit'](enemy, guard.id)
  const baseDamage = guard.maxHp - guard.hp
  guard.hp = guard.maxHp
  assert.ok(match.command('human', [hero.id], { kind: 'hero-ability' }))
  match['hit'](enemy, guard.id)
  assert.equal(guard.maxHp - guard.hp, baseDamage - 3)
  assert.equal(match.command('human', [hero.id], { kind: 'hero-ability' }), false)
  assert.ok(unitStats.dwarf.tower.health > unitStats.human.tower.health)
  assert.ok(unitStats.dwarf.blade.speed < unitStats.human.blade.speed)
})

test('Elf ambush hides stationary units from precise orders and snapshots until a scout approaches', () => {
  const match = arena({ human: 'elf', orc: 'orc' })
  const archer = match['spawn']('human', 'ranged', cellCenter(20, 10))
  const scout = match['spawn']('orc', 'scout', cellCenter(30, 10))
  const warrior = match['spawn']('orc', 'blade', cellCenter(25, 10))
  for (let i = 0; i < 12; i++) match.step()
  const hidden = match.view('orc')
  assert.equal(match.view('human').entities.find(unit => unit.id === archer.id)?.concealed, true)
  assert.ok(!hidden.entities.some(unit => unit.id === archer.id))
  assert.equal(match.command('orc', [warrior.id], { kind: 'attack', target: archer.id }), false)
  Object.assign(scout, cellCenter(23, 10))
  match.step()
  const detected = match.view('orc')
  assert.ok(detected.entities.some(unit => unit.id === archer.id))
  assert.ok(applyDelta(hidden, makeDelta(hidden, detected))?.entities.some(unit => unit.id === archer.id))
  assert.ok(match.command('human', [archer.id], { kind: 'move', to: cellCenter(20, 12) }))
  assert.equal(archer.concealed, undefined)
  match['upgrades'].human.push('range')
  assert.equal(match['attackRange'](archer), unitStats.elf.ranged.range + upgrades.range.bonus)
})

test('Raise the Fallen accounts for reserved population, keeps checkpoint state and cannot chain', () => {
  const match = arena({ human: 'undead', orc: 'elf' }, 11)
  const caster = match['spawn']('human', 'support', cellCenter(20, 11))
  const doomed = match['spawn']('orc', 'blade', cellCenter(21, 11))
  match['spawn']('human', 'farm', cellCenter(16, 11))
  match.step()
  doomed.hp = 0
  match['destroy'](doomed)
  assert.ok(match.view('human').corpses?.some(corpse => corpse.id === doomed.id))
  assert.equal(match.command('human', [1], { kind: 'train', unit: 'worker' }), true)
  assert.equal(match.command('human', [caster.id], { kind: 'unit-ability' }), false)
  assert.equal(match.command('human', [1], { kind: 'cancel-train', count: 1 }), true)
  const restored = Match.restore(structuredClone(match.checkpoint()), match.map)
  assert.ok(restored.command('human', [caster.id], { kind: 'unit-ability' }))
  assert.equal(restored.view('human').population.used, 11)
  assert.ok(!restored.view('human').corpses?.length)
  const summon = [...restored.units.values()].find(unit => unit.summonedUntil)!
  assert.equal(raceOf(summon), 'undead')
  summon.hp = 0
  restored['destroy'](summon)
  assert.ok(!restored.view('human').corpses?.length)
  assert.equal(restored.view('human').population.used, 10)
  assert.equal(restored.command('human', [caster.id], { kind: 'unit-ability' }), false)
})
