import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const root = resolve(process.argv[2] ?? '.')
const count = Number(process.argv[3] ?? 100)
const configs = (process.argv[4] ?? 'normal,normal').split(',')
const { Match, TICK_HZ } = await import(pathToFileURL(resolve(root, 'src/server/match.ts')).href)
const { ComputerOpponent } = await import(pathToFileURL(resolve(root, 'src/server/computer.ts')).href)
const strategies = ['balanced', 'rush', 'defensive', 'counter']

function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

const results = { human: 0, orc: 0, unresolved: 0 }
let ticks = 0
let decisionMs = 0
let activeWorkers = 0
let military = 0
const start = performance.now()
for (let seed = 1; seed <= count; seed++) {
  const rand = random(seed)
  const match = new Match()
  for (const unit of match.units.values()) {
    if (unit.kind !== 'headquarters') {
      unit.x += Math.floor(rand() * 9) - 4
      unit.y += Math.floor(rand() * 9) - 4
    }
  }
  const strategy = [strategies[seed % 4], strategies[Math.floor(seed / 4) % 4]]
  const human = new ComputerOpponent('human', match.map, configs[0], strategy[0])
  const orc = new ComputerOpponent('orc', match.map, configs[1], strategy[1])
  while (!match.result && match.tick < 210 * TICK_HZ) {
    if (match.tick % TICK_HZ === 0) {
      const before = performance.now()
      human.think(match)
      orc.think(match)
      decisionMs += performance.now() - before
    }
    match.step()
    match.snapshot(true)
  }
  const survivors = [...match.units.values()]
  activeWorkers += survivors.filter(unit => unit.kind === 'worker' && unit.job).length
  military += survivors.filter(unit => ['blade', 'polearm', 'ranged', 'marksman', 'heavy'].includes(unit.kind)).length
  results[match.result?.winner ?? 'unresolved']++
  ticks += match.tick
}
console.log(JSON.stringify({ count, configs, ...results, meanSeconds: +(ticks / count / TICK_HZ).toFixed(2),
  meanActiveWorkers: +(activeWorkers / count).toFixed(2), meanMilitarySurvivors: +(military / count).toFixed(2),
  decisionMs: +decisionMs.toFixed(2), runtimeSeconds: +((performance.now() - start) / 1000).toFixed(2) }))
