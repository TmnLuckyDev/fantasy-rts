import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { parseMessage } from '../src/server/validate.ts'
import { defaultMatchSettings, parseMatchSettings } from '../src/shared/match-settings.ts'
import { cellCenter } from '../src/shared/map.ts'
import { applyDelta, makeDelta } from '../src/shared/snapshot-delta.ts'
import { GATHERING } from '../src/shared/economy.ts'

test('match settings validate per-player population cap and support older saved settings', () => {
  const settings = defaultMatchSettings()
  assert.equal(settings.populationCap, 500)
  for (const cap of [10, 50, 250, 500, 1000]) {
    assert.equal(parseMatchSettings({ ...settings, populationCap: cap })?.populationCap, cap)
  }
  for (const cap of [0, 9, 1001, -1, 1.5, '500', null]) {
    assert.equal(parseMatchSettings({ ...settings, populationCap: cap }), null)
  }
  const { populationCap: _ignored, ...legacy } = settings
  assert.equal(parseMatchSettings(legacy)?.populationCap, 500)
})

test('population limit caps farms and blocks training above the configured limit', () => {
  const settings = defaultMatchSettings()
  settings.populationCap = 10
  const game = Match.configured(settings)
  assert.equal(game.view('human').population.limit <= 10, true)
  const initial = game.view('human').population.used
  assert.ok(initial < 10)
  const checkpoint = game.checkpoint()
  checkpoint.resources.human.gold = 10000
  const restored = Match.restore(checkpoint)
  const barracks = [...restored.units.values()].find(unit => unit.faction === 'human' && unit.kind === 'barracks')
  if (!barracks) {
    const base = checkpoint.units.find(unit => unit.faction === 'human' && unit.kind === 'headquarters')!
    checkpoint.units.push({ ...base, id: ++checkpoint.sequence, kind: 'barracks' as const, ...cellCenter(10, 15), buildDuration: 0, hp: 700, maxHp: 700 })
  }
  const gameWithBarracks = Match.restore(checkpoint)
  const building = [...gameWithBarracks.units.values()].find(unit => unit.faction === 'human' && unit.kind === 'barracks')!
  assert.equal(gameWithBarracks.command('human', [building.id], { kind: 'train', unit: 'blade', count: 20 }), false)
  assert.equal(gameWithBarracks.view('human').population.limit <= 10, true)
})

test('players can dismiss only their own peasants and scouts', () => {
  const game = new Match()
  const humanWorker = [...game.units.values()].find(unit => unit.faction === 'human' && unit.kind === 'worker')!
  const humanScout = [...game.units.values()].find(unit => unit.faction === 'human' && unit.kind === 'scout')
  const enemyWorker = [...game.units.values()].find(unit => unit.faction === 'orc' && unit.kind === 'worker')!
  const soldier = [...game.units.values()].find(unit => unit.faction === 'human' && unit.kind === 'blade')!
  assert.equal(game.command('human', [soldier.id], { kind: 'dismiss' }), false)
  assert.equal(game.command('human', [enemyWorker.id], { kind: 'dismiss' }), false)
  assert.equal(game.command('human', [humanWorker.id], { kind: 'dismiss' }), true)
  assert.equal(game.units.has(humanWorker.id), false)
  if (humanScout) {
    assert.equal(game.command('human', [humanScout.id], { kind: 'dismiss' }), true)
    assert.equal(game.units.has(humanScout.id), false)
  }
  assert.equal(parseMessage(JSON.stringify({ type: 'command', ids: [15], order: { kind: 'dismiss' } }))?.type, 'command')
})

test('resource inspection reveals only currently visible deposits, tracks depletion and survives delta compression', () => {
  const settings = defaultMatchSettings()
  settings.sources.wood.stock = GATHERING.wood.amount
  const game = Match.configured(settings)
  const tree = cellCenter(6, 7)
  const index = 7 * game.map.width + 6
  const before = game.view('human')
  assert.equal(before.deposits?.find(deposit => deposit.index === index)?.remaining, settings.sources.wood.stock)
  assert.equal(game.view('orc').deposits?.some(deposit => deposit.index === index), false)
  assert.equal(game.command('human', [15], { kind: 'gather', at: tree }), true)
  for (let i = 0; i < 600 && !game.view('human').depleted?.includes(index); i++) game.step()
  const after = game.view('human')
  assert.equal(after.deposits?.find(deposit => deposit.index === index)?.remaining, 0)
  const delta = makeDelta(before, after)
  assert.equal(applyDelta(before, delta)?.deposits?.find(deposit => deposit.index === index)?.remaining, 0)
})
