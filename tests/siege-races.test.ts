import { Match } from '../src/server/match.ts'
import { ashfordClassic, cellCenter } from '../src/shared/map.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { races, entityNames } from '../src/shared/protocol.ts'
import { trainedAt, trainingRule } from '../src/shared/economy.ts'
import { unitStats } from '../src/shared/units.ts'

test('every race can train siege weapons at its elite building', () => {
  for (const race of races) {
    assert.ok(trainedAt('elite', race).includes('siege'), `${race} cannot produce siege`)
    assert.ok(trainingRule('siege', race).population > 0)
    assert.ok(unitStats[race].siege.damage > 0)
    assert.ok(unitStats[race].siege.range > 0)
  }
})

test('specialist siege units have distinct tradeoffs', () => {
  const baseline = unitStats.human.siege
  assert.deepEqual(unitStats.orc.siege, baseline)
  assert.ok(unitStats.dwarf.siege.damage > baseline.damage)
  assert.ok(unitStats.dwarf.siege.armor > baseline.armor)
  assert.ok(unitStats.dwarf.siege.speed < baseline.speed)
  assert.ok(unitStats.elf.siege.range > baseline.range)
  assert.ok(unitStats.elf.siege.health < baseline.health)
  assert.ok(unitStats.undead.siege.speed > baseline.speed)
  assert.ok(unitStats.undead.siege.armor < baseline.armor)
  assert.equal(entityNames.dwarf.siege, 'Siege Cannon')
  assert.equal(entityNames.elf.siege, 'Thorn Ballista')
  assert.equal(entityNames.undead.siege, 'Bone Catapult')
})

test('scouted siege outranges fully researched towers and threatens walls without gaining troop range', () => {
  for (const race of races) {
    const match = new Match(ashfordClassic, undefined, { human: race, orc: 'dwarf' })
    for (let level = 0; level < 5; level++) {
      match.checkpoint().upgrades!.human.push('range')
      match.checkpoint().upgrades!.orc.push('range')
    }
    const at = cellCenter(11, 11)
    const siege = match['spawn']('human', 'siege', at)
    const tower = match['spawn']('orc', 'tower', { x: at.x + 281, y: at.y })
    tower.level = 5
    const scout = match['spawn']('human', 'scout', { x: tower.x, y: tower.y - 310 })
    match.step()
    const hp = siege.hp
    const towerHp = tower.hp
    assert.ok(match.command('human', [siege.id], { kind: 'attack', target: tower.id }))
    for (let tick = 0; tick < 90; tick++) match.step()
    assert.ok(tower.hp < towerHp)
    assert.equal(siege.hp, hp)
    const wall = match['spawn']('orc', 'wall', { x: at.x + 200, y: at.y + 50 })
    const troops = match['spawn']('orc', 'blade', { x: tower.x, y: tower.y - 2 })
    assert.ok(match['attackRange'](siege, wall) > match['attackRange'](siege, troops))
    match['destroy'](scout)
  }
})
