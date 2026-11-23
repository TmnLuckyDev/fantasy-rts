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
