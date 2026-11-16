import { performance, PerformanceObserver } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(process.env.BENCH_SOURCE ?? '.')
const load = path => import(pathToFileURL(resolve(root, path)).href)
const { Match } = await load('src/server/match.ts')
const { ComputerOpponent } = await load('src/server/computer.ts')
const { Visibility } = await load('src/server/visibility.ts')
const { ashford, cellCenter } = await load('src/shared/map.ts')
const counts = (process.env.BENCH_COUNTS ?? '200,500,1000,1500,2000').split(',').map(Number)
const cases = (process.env.BENCH_CASES ?? 'idle,move,combat,bridge,ai,churn').split(',')
const formation = process.env.BENCH_FORMATION
const [human, orc] = (process.env.BENCH_RACES ?? 'human,orc').split(',')
const ticks = Number(process.env.BENCH_TICKS ?? 120)
const clearMap = { name: 'Load test', width: 88, height: 40, tiles: Array(88 * 40).fill('grass'), bases: { human: { x: 208, y: 368 }, orc: { x: 2608, y: 912 } } }
let timings
let garbage = 0
const gc = new PerformanceObserver(list => { for (const entry of list.getEntries()) garbage += entry.duration })
gc.observe({ entryTypes: ['gc'] })
function timed(key, fn) {
  const start = performance.now()
  const result = fn()
  timings[key] = (timings[key] ?? 0) + performance.now() - start
  return result
}
for (const [prototype, methods] of [[Match.prototype, ['approach', 'walk', 'fight', 'callDefenders', 'snapshot', 'view']],
  [Visibility.prototype, ['update', 'mask']], [ComputerOpponent.prototype, ['think']]]) {
  for (const method of methods) {
    const original = prototype[method]
    prototype[method] = function (...args) { return timed(method, () => original.apply(this, args)) }
  }
}
function setup(scenario, count) {
  const bridge = scenario === 'bridge'
  const match = new Match(bridge ? ashford : clearMap, undefined, { human, orc })
  if (scenario !== 'ai' && scenario !== 'churn') {
    for (const [id, unit] of match.units) if (unit.kind !== 'headquarters') match.units.delete(id)
  }
  const armies = { human: [], orc: [] }
  for (const [index, faction] of ['human', 'orc'].entries()) {
    const direction = index ? -1 : 1
    for (let j = 0; j < count / 2; j++) {
      const x = (index ? 1570 : 1180) - direction * (j % 24) * (bridge ? 4 : 12)
      const y = (bridge ? 260 : 320) + Math.floor(j / 24) * (bridge ? 2 : 18)
      // Use a known walkable approach on Ashford, with deliberate stacking near the bridge.
      const point = bridge ? cellCenter(ashford.width / 2 + (index ? 4 : -5) + j % 3, 7 + j % 4) : { x, y }
      const kind = j % 3 === 0 ? 'ranged' : j % 3 === 1 ? 'blade' : 'heavy'
      armies[faction].push(match.spawn(faction, kind, point).id)
    }
  }
  const issue = () => {
    if (scenario === 'idle') return
    for (const faction of ['human', 'orc']) {
      if (scenario === 'ai' && faction === 'orc') continue
      const order = {
        kind: scenario === 'move' ? 'move' : 'advance',
        to: { x: (bridge ? ashford.width : clearMap.width) * 16 + (faction === 'human' ? 332 : -318), y: bridge ? 288 : 510 }
      }
      if (formation && scenario !== 'churn' && scenario !== 'ai') {
        match.commandGroup(faction, 'all', { ...order, formation })
      } else {
        const ids = armies[faction].filter(id => match.units.has(id))
        for (let start = 0; start < ids.length; start += 500) match.command(faction, ids.slice(start, start + 500), order)
      }
    }
  }
  if (scenario === 'idle') {
    // Separate both sides so this case measures stationary armies without combat.
    for (const id of armies.orc) match.units.get(id).x += 600
  }
  return { match, armies, issue, computer: scenario === 'ai' ? new ComputerOpponent('orc', match.map, 'hard') : null }
}

for (const count of counts) {
  for (const scenario of cases) {
    timings = {}
    const { match, armies, issue, computer } = setup(scenario, count)
    match.step()
    timed('issue', issue)
    await new Promise(resolve => setImmediate(resolve))
    global.gc?.()
    const heapBefore = process.memoryUsage().heapUsed
    const gcBefore = garbage
    let bytes = 0
    let effects = 0
    const durations = []
    const cpu = process.cpuUsage()
    for (let tick = 0; tick < ticks; tick++) {
      const start = performance.now()
      if (scenario === 'churn' && tick % 40 === 0) {
        for (const faction of ['human', 'orc']) {
          match.units.delete(armies[faction].shift())
          armies[faction].push(match.spawn(faction, 'blade', { x: faction === 'human' ? 1150 : 1610, y: 510 }).id)
        }
        issue()
      }
      computer?.think(match)
      match.step()
      if (tick % 2 === 0) {
        const world = match.snapshot(true)
        effects += world.effects.length
        for (const faction of ['human', 'orc']) {
          const view = match.view(faction, world)
          bytes += Buffer.byteLength(timed('json', () => JSON.stringify(view)))
        }
      }
      durations.push(performance.now() - start)
    }
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    const used = process.cpuUsage(cpu)
    const heap = process.memoryUsage().heapUsed
    global.gc?.()
    durations.sort((a, b) => a - b)
    const round = value => +value.toFixed(2)
    console.log(JSON.stringify({
      scenario, ...(formation ? { formation } : {}), units: count, ticks, survivors: match.units.size, effects, snapshotBytesPerTick: round(bytes / ticks),
      p50Ms: round(durations[Math.ceil(.50 * ticks) - 1]), p95Ms: round(durations[Math.ceil(.95 * ticks) - 1]),
      maxMs: round(durations.at(-1)), cpuMs: round((used.user + used.system) / 1000), gcMs: round(garbage - gcBefore),
      heapBefore, heap, retainedHeap: process.memoryUsage().heapUsed,
      phasesMs: Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, round(value)]))
    }))
  }
}
gc.disconnect()
