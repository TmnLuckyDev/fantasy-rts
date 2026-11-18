import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Match, TICK_HZ } from '../src/server/match.ts'
import { parseMessage } from '../src/server/validate.ts'
import { replenishPlan } from '../src/shared/army-templates.ts'
import { ashfordClassic, cellCenter } from '../src/shared/map.ts'
import { defaultMatchSettings } from '../src/shared/match-settings.ts'
import { buildings, placementError, repairPrice, repairPulse, trainingCost } from '../src/shared/economy.ts'
import { makeDelta, applyDelta } from '../src/shared/snapshot-delta.ts'

test('automatic construction selects an idle reachable worker without interrupting construction', () => {
  const match = new Match()
  const first = match.units.get(15)!
  const second = match.units.get(16)!
  assert.equal(match.execute('human', [first.id], { kind: 'build', building: 'farm', at: cellCenter(10, 15) }), null)
  const previous = first.job
  assert.equal(match.execute('human', [], { kind: 'build', building: 'wall', at: cellCenter(11, 15) }), null)
  assert.equal(first.job, previous)
  assert.ok([second, match.units.get(17)!].some(worker => worker.job?.kind === 'construct'))
  const wire = (order: object) => parseMessage(JSON.stringify({ type: 'command', ids: [], order }))
  assert.ok(wire({ kind: 'build', building: 'farm', at: cellCenter(10, 15) }))
  assert.equal(wire({ kind: 'halt' }), null)
  assert.match(match.execute('human', [], { kind: 'build', building: 'farm', at: cellCenter(10, 15) })!, /Too close/)
  for (const worker of [...match.units.values()]) if (worker.faction === 'human' && worker.kind === 'worker') match['destroy'](worker)
  assert.match(match.execute('human', [], { kind: 'build', building: 'wall', at: cellCenter(12, 15) })!, /No available worker/)
})

test('build reasons and repair estimates share the game rules', () => {
  const settings = { ...defaultMatchSettings('ashford-original'), randomStarts: false, progression: true }
  const match = Match.configured(settings)
  assert.equal(match.execute('human', [], { kind: 'build', building: 'tower', at: cellCenter(10, 15) }), 'Requires Town Hall Level 2.')
  assert.match(placementError(ashfordClassic, 'farm', cellCenter(5, 18), [])!, /terrain/)
  assert.equal(placementError(ashfordClassic, 'port', cellCenter(10, 15), []), 'A harbor needs a navigable coastline.')
  assert.deepEqual(repairPrice({ kind: 'wall', hp: 59, maxHp: 100 }), { stone: 3 })
  const pulse = repairPulse('dwarf', true, 'tower')
  assert.equal(pulse, 22)
  assert.deepEqual(repairPrice({ kind: 'tower', hp: 57, maxHp: 100 }, pulse), { wood: 2, stone: 2 })
})

test('finite mines can redirect overflow and keep workers already assigned to that mine', () => {
  const settings = defaultMatchSettings('ashford-original')
  settings.sources.gold = { ...settings.sources.gold, workers: 1, stock: 600 }
  const match = Match.configured(settings)
  const at = cellCenter(5, 18)
  const next = cellCenter(7, 18)
  const other = match.map.tiles.flatMap((tile, i) => tile === 'mine' && i !== 18 * match.map.width + 5 ?
    [cellCenter(i % match.map.width, Math.floor(i / match.map.width))] : [])
    .sort((a, b) => Math.hypot(a.x - next.x, a.y - next.y) - Math.hypot(b.x - next.x, b.y - next.y))[0]
  match['spawn']('human', 'scout', { x: other.x + 32, y: other.y })
  match.step()
  assert.equal(match.execute('human', [16], { kind: 'gather', at }), null)
  assert.equal(match.execute('human', [15, 16], { kind: 'gather', at }), null)
  assert.deepEqual(match.units.get(16)?.job, { kind: 'gather', resource: 'gold', at, workTicks: 0 })
  const overflow = match.units.get(15)?.job
  assert.equal(overflow?.kind, 'gather')
  assert.notDeepEqual(overflow?.kind === 'gather' && overflow.at, at)
})

test('a versioned cancellation refunds only the selected run and rejects double cancellation after restore', () => {
  const match = new Match()
  match.checkpoint().resources.human.gold = 1100
  const hall = match['spawn']('human', 'barracks', cellCenter(11, 15))
  match['spawn']('human', 'farm', cellCenter(12, 13))
  for (const unit of ['blade', 'polearm', 'blade'] as const) assert.ok(match.command('human', [hall.id], { kind: 'train', unit }))
  const view = match.view('human')
  const before = view.resources.gold
  const revision = view.entities.find(unit => unit.id === hall.id)!.training!.revision!
  const cancel = { kind: 'cancel-training-run', index: 1, revision } as const
  assert.equal(match.execute('human', [hall.id], cancel), null)
  assert.equal(match.view('human').resources.gold, before + trainingCost('polearm', 'human').gold!)
  assert.deepEqual(hall.queue.map(run => run.kind), ['blade', 'blade'])
  assert.equal(match.view('human').population.reserved, view.population.reserved - 1)
  const restored = Match.restore(JSON.parse(JSON.stringify(match.checkpoint())))
  assert.match(restored.execute('human', [hall.id], cancel)!, /queue changed/)
  assert.equal(restored.view('human').resources.gold, match.view('human').resources.gold)
})

test('Army Group priority survives restore and replenish confirmation rejects a stale preview', () => {
  const match = new Match()
  const trainer = match['spawn']('human', 'barracks', cellCenter(11, 15))
  match['spawn']('human', 'farm', cellCenter(12, 13))
  for (const name of ['First', 'Second']) {
    assert.ok(match.command('human', [1], { kind: 'template-save', template: 0, name, targets: [{ kind: 'blade', count: 1 }] }))
  }
  const [first, second] = match.view('human').templates!
  assert.ok(match.command('human', [1], { kind: 'template-priority', template: second.id, direction: -1 }))
  const restored = Match.restore(JSON.parse(JSON.stringify(match.checkpoint())))
  const [high, low] = restored.view('human').templates!
  assert.deepEqual([high.id, low.id], [second.id, first.id])
  const view = restored.view('human')
  const plan = replenishPlan([high, low], high, new Map(), 'human', view.resources, view.population, () => true)
  assert.deepEqual(plan.rows, [{ kind: 'blade', missing: 1, queued: 0, add: 1 }])
  assert.ok(restored.command('human', [trainer.id], { kind: 'train', unit: 'blade' }))
  assert.match(restored.execute('human', [1], { kind: 'template-replenish', template: high.id,
    expected: [{ kind: 'blade', count: 1 }] })!, /queue changed/)
  for (let tick = 0; tick < 110; tick++) restored.step()
  assert.equal(restored.view('human').templates![0].members.length, 1)
  assert.equal(restored.view('human').templates![1].members.length, 0)
})

test('economy income only includes delivered resources and worker tasks are private', () => {
  const match = new Match()
  const at = cellCenter(5, 18)
  assert.ok(match.command('human', [15], { kind: 'gather', at }))
  const before = match.view('human')
  assert.equal(before.entities.find(unit => unit.id === 15)?.workerTask, 'gold')
  assert.equal(match.view('orc').entities.some(unit => unit.faction === 'human' && unit.workerTask), false)
  for (let tick = 0; tick < 30 * TICK_HZ; tick++) match.step()
  const view = match.view('human')
  assert.equal(view.income?.gold, 2 * match.report().sides.human.gathered.gold)
  assert.ok(view.income!.gold > 0)
  assert.equal(view.income?.wood, 0)
  assert.deepEqual(applyDelta(before, makeDelta(before, view))?.income, view.income)
  assert.deepEqual(Match.restore(JSON.parse(JSON.stringify(match.checkpoint()))).view('human').income, view.income)
})

test('construction estimate stops if the assigned worker is stopped and repair cost is separate from construction cost', () => {
  const match = new Match()
  assert.ok(match.command('human', [15], { kind: 'build', building: 'farm', at: cellCenter(10, 15) }))
  for (let tick = 0; tick < 35; tick++) match.step()
  const building = () => match.view('human').entities.find(entity => entity.kind === 'farm')!
  assert.ok(building().constructionSeconds && building().constructionSeconds! <= buildings.farm.ticks / TICK_HZ)
  assert.ok(match.command('human', [15], { kind: 'halt' }))
  assert.equal(building().constructionStatus, 'paused')
  assert.equal(building().constructionSeconds, undefined)
})
