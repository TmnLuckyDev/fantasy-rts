import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { combatKinds } from '../src/shared/protocol.ts'
import { unitStats } from '../src/shared/units.ts'

test('mirrored duels leave comparable health margins by combat role', () => {
  for (const kind of combatKinds) {
    let margin = 0
    const distances = [19, 32, 70, 138, 168, 250, 360, 420]
    for (const gap of distances) {
      for (const mirrored of [false, true]) {
        const match = new Match()
        const human = match.units.get(2)!
        const orc = match.units.get(9)!
        for (const id of match.units.keys()) if (![1, 2, 8, 9].includes(id)) match.units.delete(id)
        if (mirrored) {
          match.units.delete(human.id)
          match.units.set(human.id, human)
        }
        for (const [unit, side] of [[human, -1], [orc, 1]] as const) {
          const direction = side * (mirrored ? -1 : 1)
          const health = unitStats[unit.faction][kind].health
          Object.assign(unit, { kind, x: 890 + direction * gap / 2, y: 312, hp: health, maxHp: health })
          match.command(unit.faction, [unit.id], { kind: 'advance', to: { x: 890 - direction * gap / 2, y: 312 } })
        }
        let aftermath = 0
        for (let tick = 0; tick < 540; tick++) {
          match.step()
          if ((!human.hp || !orc.hp) && ++aftermath > 12) break
        }
        assert.ok(!human.hp || !orc.hp, kind + ' duel did not resolve')
        margin += (human.hp / human.maxHp - orc.hp / orc.maxHp)
      }
    }
    const mean = Math.abs(margin / (2 * distances.length))
    // A margin of exactly ten percentage points meets the target.
    assert.ok(mean <= 0.1 + 1e-9, kind + ' mean surviving health advantage: ' + mean.toFixed(3))
  }
})
