import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match, TICK_HZ } from '../src/server/match.ts'
import { defaultMatchSettings, CONTROL_VICTORY_SCORE, parseMatchSettings } from '../src/shared/match-settings.ts'
import { applyDelta, makeDelta } from '../src/shared/snapshot-delta.ts'

test('Control Points is opt-in and survives a checkpoint and snapshot delta', () => {
  const defaults = defaultMatchSettings('pinewatch-vale')
  const classic = Match.start(defaults)
  assert.equal(classic.view('human').controlScore, undefined)
  const settings = { ...defaults, objective: 'control' as const, randomStarts: false }
  assert.equal(parseMatchSettings(settings)?.objective, 'control')
  assert.equal(parseMatchSettings({ ...settings, objective: 'invalid' }), null)
  const match = Match.start(settings)
  const previous = match.view('human')
  const [site] = previous.controlSites!
  match['spawn']('human', 'blade', site)
  match['territory'].human = CONTROL_VICTORY_SCORE - 1
  const restored = Match.restore(structuredClone(match.checkpoint()))
  for (let i = 0; i < TICK_HZ; i++) restored.step()
  assert.deepEqual(restored.result, { winner: 'human', reason: 'control' })
  const current = restored.view('human')
  assert.deepEqual(current.controlScore, { human: CONTROL_VICTORY_SCORE, orc: 0 })
  assert.deepEqual(applyDelta(previous, makeDelta(previous, current))?.controlScore, current.controlScore)
})

test('a timed Control Points match ignores the resource bank while Classic counts it', () => {
  for (const objective of ['control', 'classic'] as const) {
    const settings = { ...defaultMatchSettings('pinewatch-vale'), objective, minutes: 1 }
    const match = Match.start(settings)
    match['territory'].human = 1
    match['resources'].orc.gold += 10_000
    for (let tick = 0; tick < 60 * TICK_HZ; tick++) match.step()
    assert.deepEqual(match.result, { winner: objective === 'control' ? 'human' : 'orc', reason: 'time' })
  }
})

test('hero, reinforcement and transport lessons start with the necessary practice units', () => {
  const races = { human: 'human', orc: 'orc' } as const
  const hero = Match.practice('human', races, 'hero')
  assert.ok(hero.view('human').entities.some(unit => unit.kind === 'vanguard' && unit.faction === 'human'))
  const group = Match.practice('human', races, 'replenish').view('human').templates![0]
  assert.equal(group.targets[0].count, group.members.length + 1)
  const naval = Match.practice('human', races, 'naval')
  const view = naval.view('human')
  assert.equal(naval.map.id, 'shattered-isles')
  assert.ok(view.entities.some(unit => unit.kind === 'transport'))
  assert.ok(naval.command('human', view.entities.filter(unit => unit.kind === 'worker' && unit.faction === 'human').map(unit => unit.id), { kind: 'board' }))
})
