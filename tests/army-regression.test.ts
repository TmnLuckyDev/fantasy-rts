import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { Visibility } from '../src/server/visibility.ts'
import { ashford, cellCenter, isWalkable, riverColumn, TILE, tileAt } from '../src/shared/map.ts'
import { unitStats } from '../src/shared/units.ts'

test('all 500 troops in a single order eventually cross the river without lost units', () => {
  const checkpoint = new Match().checkpoint()
  checkpoint.units = checkpoint.units.filter(unit => unit.kind === 'headquarters')
  const prototype = checkpoint.units[0]
  const health = unitStats.human.blade.health
  const army: number[] = []
  for (let i = 0; i < 500; i++) {
    const x = riverColumn - 16 + i % 10
    let y = 8 + Math.floor(i / 90)
    while (!isWalkable(tileAt(ashford, x, y))) y++
    const id = ++checkpoint.sequence
    checkpoint.units.push({ ...prototype, ...cellCenter(x, y), id, kind: 'blade', hp: health, maxHp: health })
    army.push(id)
  }
  const match = Match.restore(checkpoint)
  assert.ok(match.command('human', army, { kind: 'move', to: cellCenter(riverColumn + 22, 15) }))
  for (let tick = 0; tick < 650; tick++) match.step()
  assert.equal(match.units.size, 502)
  assert.equal(army.filter(id => (match.units.get(id)?.x ?? 0) > (riverColumn + 2) * TILE).length, 500)
})

test('incremental fog preserves shared coverage and drops stale visibility after restore', () => {
  const initial = [...new Match().units.values()].find(unit => unit.kind === 'blade' && unit.faction === 'human')!
  const one = { ...initial, ...cellCenter(20, 20) }
  const two = { ...one, id: one.id + 1000 }
  const a = cellCenter(14, 20)
  const b = cellCenter(26, 20)
  const visibility = new Visibility(ashford)
  visibility.update([one, two])
  const mask = visibility.mask('human')
  visibility.update([two])
  assert.equal(visibility.mask('human'), mask)
  visibility.update([{ ...one, ...cellCenter(25, 20) }, two])
  assert.equal(visibility.at('human', a), 2)
  visibility.update([{ ...one, ...cellCenter(25, 20) }])
  assert.equal(visibility.at('human', a), 1)
  assert.equal(visibility.at('human', b), 2)
  assert.equal(visibility.at('orc', b), 0)
  const resumed = new Visibility(ashford)
  resumed.restore({ human: visibility.mask('human'), orc: visibility.mask('orc') })
  assert.equal(resumed.at('human', b), 2)
  resumed.update([])
  assert.equal(resumed.at('human', b), 1)
})
