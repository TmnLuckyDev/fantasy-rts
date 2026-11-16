import { trainingRule } from './economy.ts'
import type { Race, UnitKind } from './protocol.ts'

export type TrainingRun = { kind: UnitKind, count?: number }
export const runCount = (run: TrainingRun) => run.count ?? 1

export function trainingTimeline(queue: readonly TrainingRun[], headTicks: number, race?: Race) {
  let ticks = 0
  const runs = queue.map((run, index) => {
    const count = runCount(run)
    const duration = trainingRule(run.kind, race).ticks
    ticks += index ? count * duration : headTicks + (count - 1) * duration
    return { kind: run.kind, count, end: ticks }
  })
  return { runs, ticks }
}

// Find the earliest finishing batch even when queues have different workloads.
export function allocateTraining(loads: readonly number[], duration: number, count: number) {
  const by = (finish: number, load: number) => Math.max(0, Math.floor((finish - load) / duration))
  let low = loads.reduce((min, load) => Math.min(min, load), Infinity)
  let high = low + duration * count
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (loads.reduce((total, load) => total + by(middle, load), 0) >= count) high = middle
    else low = middle + 1
  }
  const result = loads.map(load => by(low - 1, load))
  let remaining = count - result.reduce((sum, n) => sum + n, 0)
  for (let i = 0; i < loads.length && remaining; i++) {
    if (by(low, loads[i]) > result[i]) {
      result[i]++
      remaining--
    }
  }
  return result
}
