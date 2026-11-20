import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attackRange, selectedAttackRange, upgrades } from '../src/shared/economy.ts'
import { cellCenter } from '../src/shared/map.ts'
import { races } from '../src/shared/protocol.ts'
import { Match } from '../src/server/match.ts'

test('a construction assignment finishes its existing jobs and releases the worker to idle', () => {
  const match = new Match()
  const worker = match.units.get(15)!
  const at = cellCenter(14, 17)
  Object.assign(worker, at)
  const completed = match['spawn']('human', 'farm', at, 2)
  const cancelled = match['spawn']('human', 'farm', at, 1)
  const destroyed = match['spawn']('human', 'farm', at, 1)
  assert.ok(match.command('human', [worker.id], { kind: 'build-queue' }))
  assert.equal(worker.job?.kind === 'construct' && worker.job.site, completed.id)
  assert.ok(match.command('human', [cancelled.id], { kind: 'cancel-build' }))
  match['destroy'](destroyed)
  match.step()
  assert.equal(match.view('human').entities.find(entity => entity.id === worker.id)?.idle, false)
  match.step()
  assert.equal(completed.buildDuration, 0)
  assert.equal(worker.order, null)
  assert.equal(worker.job, null)
  const entity = () => match.view('human').entities.find(entity => entity.id === worker.id)
  assert.equal(entity()?.idle, true)
  assert.equal(entity()?.workerTask, undefined)

  const future = match['spawn']('human', 'farm', at, 1)
  for (let i = 0; i < 25; i++) match.step()
  assert.equal(future.buildTicks, 0)
  assert.equal(entity()?.idle, true)
})

test('cancelling an active site advances to an assigned site and discards demolished entries', () => {
  const match = new Match()
  const worker = match.units.get(15)!
  const at = cellCenter(14, 17)
  Object.assign(worker, at)
  const active = match['spawn']('human', 'farm', at, 3)
  const destroyed = match['spawn']('human', 'farm', at, 2)
  const remaining = match['spawn']('human', 'farm', at, 2)
  worker.job = { kind: 'construct', site: active.id }
  worker.buildQueue = [destroyed.id, remaining.id]
  assert.ok(match.command('human', [worker.id], { kind: 'build-queue' }))
  match['destroy'](destroyed)
  assert.ok(match.command('human', [active.id], { kind: 'cancel-build' }))
  match.step()
  assert.equal(worker.job?.site, remaining.id)
  match.step()
  match.step()
  assert.equal(remaining.buildDuration, 0)
  assert.equal(worker.order, null)
  assert.equal(worker.job, null)
})

test('range previews match authoritative research, race and ability rules', () => {
  for (const race of races) {
    const match = new Match(undefined, undefined, { human: race, orc: 'orc' })
    const target = [...match.units.values()].find(unit => unit.kind === 'headquarters' && unit.faction === 'orc')!
    const at = cellCenter(15, 14)
    for (const kind of ['ranged', 'marksman', 'pathfinder', 'siege', 'tower', 'warship'] as const) {
      const unit = match['spawn']('human', kind, at)
      const before = attackRange(race, kind, 0)
      match['upgrades'].human.length = 0
      const entity = () => match.snapshot().entities.find(entity => entity.id === unit.id)!
      assert.equal(selectedAttackRange(entity(), match.tick), before)
      match['upgrades'].human.push('range')
      const bonus = race === 'elf' && kind === 'pathfinder' ? 24 : 0
      unit.abilityActiveUntil = match.tick + 1
      assert.equal(selectedAttackRange(entity(), match.tick), before + upgrades.range.bonus + bonus)
      assert.equal(selectedAttackRange(entity(), match.tick), match['attackRange'](unit))
      assert.equal(selectedAttackRange(entity(), match.tick + 1), before + upgrades.range.bonus)
      if (kind === 'siege') {
        assert.equal(selectedAttackRange(entity(), match.tick, true), match['attackRange'](unit, target))
      }
    }
  }
})
