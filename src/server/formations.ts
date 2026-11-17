import { isShipKind, raceOf } from '../shared/protocol.ts'
import { TILE } from '../shared/map.ts'
import type { Entity, Formation, Point } from '../shared/protocol.ts'
import { unitStats } from '../shared/units.ts'

const layout: Record<Formation, { gap: number, width: number, arc: number }> = {
  line: { gap: 30, width: 1.5, arc: 0.30 },
  compact: { gap: 22, width: 0.8, arc: 0.16 },
  spread: { gap: 43, width: 1.5, arc: 0.56 }
}

export function formationSlots<T extends Entity>(troops: readonly T[], target: Point, formation: Formation) {
  const { gap: baseGap, width, arc } = layout[formation]
  const gap = isShipKind(troops[0]?.kind) ? Math.max(52, baseGap) : baseGap
  let dx = 0
  let dy = 0
  for (const unit of troops) {
    dx += target.x - unit.x
    dy += target.y - unit.y
  }
  if (Math.hypot(dx, dy) < troops.length) {
    dx = troops[0]?.facing ?? 1
    dy = 0
  }
  const length = Math.hypot(dx, dy)
  const forward = { x: dx / length, y: dy / length }
  const right = { x: -forward.y, y: forward.x }
  const columns = Math.max(1, Math.ceil(Math.sqrt(troops.length) * width))
  const melee: T[] = []
  const ranged: T[] = []
  for (const unit of troops) {
    const stats = unitStats[raceOf(unit)][unit.kind]
    const rank = stats.damage && stats.range <= 2 * TILE ? melee : ranged
    rank.push(unit)
  }
  const rows: T[][] = []
  for (const rank of [melee, ranged]) {
    if (!rank.length) continue
    rank.sort((a, b) => (a.x - b.x) * right.x + (a.y - b.y) * right.y || a.id - b.id)
    // Distribute ranks evenly so the last row does not become a one-soldier column.
    const stride = Math.ceil(rank.length / Math.ceil(rank.length / columns))
    for (let i = 0; i < rank.length; i += stride) rows.push(rank.slice(i, i + stride))
  }
  return rows.flatMap((row, i) => row.map((unit, j) => {
    const depth = ((rows.length - 1) / 2 - i) * gap
    const side = (j - (row.length - 1) / 2) * gap
    return { unit, flank: row.length > 1 ? arc * (2 * j / (row.length - 1) - 1) : 0,
      at: { x: target.x + depth * forward.x + side * right.x, y: target.y + depth * forward.y + side * right.y } }
  }))
}
