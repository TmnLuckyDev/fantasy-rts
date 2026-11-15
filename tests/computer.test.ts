import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ComputerOpponent } from '../src/server/computer.ts'
import { Match, TICK_HZ } from '../src/server/match.ts'
import { STARTING_RESOURCES } from '../src/shared/economy.ts'
import { factions, isUnitKind, opposite } from '../src/shared/protocol.ts'

for (const faction of factions) {
  test(`the ${faction} computer builds an economy, fields an army and defeats an idle opponent`, () => {
    const match = new Match()
    const computer = new ComputerOpponent(faction, match.map)
    const other = opposite(faction)

    for (let i = 0; i < 60 * TICK_HZ; i++) {
      computer.think(match)
      match.step()
      match.snapshot(true)
    }
    const view = match.view(faction)
    const base = view.entities.filter(unit => unit.faction === faction)
    assert.equal(view.entities.some(unit => unit.faction === other), false)
    assert.equal(base.filter(unit => unit.kind === 'worker').length, 4)
    for (const kind of ['barracks', 'farm', 'range', 'tower']) {
      assert.ok(base.some(unit => unit.kind === kind && unit.construction === undefined), kind)
    }
    assert.ok(view.resources.wood > STARTING_RESOURCES.wood)
    assert.ok(view.resources.stone > STARTING_RESOURCES.stone)
    assert.ok(base.filter(unit => isUnitKind(unit.kind) && unit.kind !== 'worker').length > 6)

    let attacked = false
    while (!match.result && match.tick < 280 * TICK_HZ) {
      computer.think(match)
      match.step()
      const snapshot = match.snapshot(true)
      attacked ||= snapshot.effects.some(effect => effect.kind === 'hit' && effect.faction === faction)
    }
    assert.ok(attacked)
    assert.deepEqual(match.result, { winner: faction, reason: 'headquarters' })
  })
}
