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
