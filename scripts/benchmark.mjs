import { performance } from 'node:perf_hooks'
import { Match } from '../src/server/match.ts'

for (const total of [100, 250, 500, 1000, 2000]) {
  const map = { name: 'Load test', width: 112, height: 88, tiles: Array(112 * 88).fill('grass'),
    bases: { human: { x: 160, y: 160 }, orc: { x: 3360, y: 2600 } } }
  const match = new Match(map)
  for (const [id, unit] of match.units) if (unit.kind !== 'headquarters') match.units.delete(id)
  for (let i = 0; i < total; i++) {
    const faction = i % 2 ? 'orc' : 'human'
    const j = Math.floor(i / 2)
    const kind = i % 5 < 2 ? 'ranged' : 'blade'
    match.spawn(faction, kind, { x: (faction === 'human' ? 780 : 1510) + (j % 32) * 23, y: 420 + Math.floor(j / 32) * 23 })
  }
  for (const faction of ['human', 'orc']) {
    const groups = [...match.units.values()].filter(unit => unit.faction === faction && unit.kind !== 'headquarters')
    for (let i = 0; i < groups.length; i += 100) {
      match.command(faction, groups.slice(i, i + 100).map(unit => unit.id), {
        kind: 'advance', to: { x: faction === 'human' ? 1720 : 1180, y: 570 + i * 0.64 }
      })
    }
  }
  const times = []
  let bytes = 0
  const startCpu = process.cpuUsage()
  for (let i = 0; i < 100; i++) {
    const start = performance.now()
    match.step()
    const world = match.snapshot(true)
    if (i % 2 === 0) bytes += Buffer.byteLength(JSON.stringify(match.view('human', world)))
    times.push(performance.now() - start)
  }
  const cpu = process.cpuUsage(startCpu)
  times.sort((a, b) => a - b)
  console.log(JSON.stringify({ units: total, meanMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2),
    p95Ms: +times[94].toFixed(2), maxMs: +times.at(-1).toFixed(2),
    cpuMs: Math.round((cpu.user + cpu.system) / 1000), meanSnapshotBytes: Math.round(bytes / 50) }))
}
