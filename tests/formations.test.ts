import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formationSlots } from '../src/server/formations.ts'
import { Match } from '../src/server/match.ts'
import { parseMessage } from '../src/server/validate.ts'
import { formations } from '../src/shared/protocol.ts'
import { unitStats } from '../src/shared/units.ts'

test('formations face their movement direction and rank ranged units and heroes behind melee', () => {
  const match = new Match()
  const seed = match.units.get(2)!
  const troops = ['blade', 'polearm', 'vanguard', 'ranged', 'marksman', 'pathfinder'].map((kind, index) => ({
    ...seed, kind: kind as typeof seed.kind, id: index + 100, x: 500 + index * 15, y: 500
  }))
  const widths = []
  for (const formation of formations) {
    const slots = formationSlots(troops, { x: 500, y: 100 }, formation)
    const ranged = slots.filter(({ unit }) => unitStats.human[unit.kind].range > 64)
    const melee = slots.filter(({ unit }) => unitStats.human[unit.kind].range <= 64)
    assert.ok(Math.max(...melee.map(({ at }) => at.y)) < Math.min(...ranged.map(({ at }) => at.y)))
    assert.equal(new Set(slots.map(({ at }) => at.x + ',' + at.y)).size, troops.length)
    widths.push(Math.max(...slots.map(({ at }) => at.x)) - Math.min(...slots.map(({ at }) => at.x)))
  }
  assert.ok(widths[1] < widths[0] && widths[0] < widths[2])
  assert.equal(parseMessage('{"type":"group-command","group":"all","order":{"kind":"move","to":{"x":10,"y":20},"formation":"fortress"}}'), null)
})
