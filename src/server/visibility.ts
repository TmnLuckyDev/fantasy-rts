import { decodeFog } from '../shared/fog.ts'
import { TILE } from '../shared/map.ts'
import type { BattleMap } from '../shared/map.ts'
import { factions } from '../shared/protocol.ts'
import type { Entity, EntityKind, Faction, Point } from '../shared/protocol.ts'

const sight: Record<EntityKind, number> = {
  headquarters: 10, worker: 6, blade: 7, polearm: 7, ranged: 8, marksman: 8, heavy: 8,
  barracks: 5, range: 5, elite: 5, farm: 4, wall: 2, tower: 9, smithy: 5
}

const circles = new Map<number, Point[]>()
for (const radius of new Set(Object.values(sight))) {
  const cells: Point[] = []
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius) cells.push({ x, y })
    }
  }
  circles.set(radius, cells)
}

export class Visibility {
  private readonly cells: Record<Faction, Uint8Array>

  private readonly map: BattleMap

  constructor(map: BattleMap) {
    this.map = map
    const size = map.width * map.height
    this.cells = { human: new Uint8Array(size), orc: new Uint8Array(size) }
  }

  update(units: Iterable<Entity & { buildDuration: number }>) {
    const { width, height } = this.map
    for (const faction of factions) {
      const cells = this.cells[faction]
      for (let i = 0; i < cells.length; i++) if (cells[i] === 2) cells[i] = 1
    }
    // Units of the same faction with the same sight radius in one tile
    // reveal exactly the same cells. Stamp that circle only once per update.
    const stamped = new Set<number>()
    for (const unit of units) {
      if (unit.buildDuration) continue
      const cells = this.cells[unit.faction]
      const cx = Math.floor(unit.x / TILE)
      const cy = Math.floor(unit.y / TILE)
      const radius = sight[unit.kind]
      const key = (((unit.faction === 'orc' ? 1 : 0) * 16 + radius) * height + cy) * width + cx
      if (stamped.has(key)) continue
      stamped.add(key)
      for (const offset of circles.get(radius)!) {
        const x = cx + offset.x
        const y = cy + offset.y
        if (x >= 0 && x < width && y >= 0 && y < height) cells[y * width + x] = 2
      }
    }
  }

  at(faction: Faction, point: Point) {
    const { width, height } = this.map
    const x = Math.floor(point.x / TILE)
    const y = Math.floor(point.y / TILE)
    if (x < 0 || x >= width || y < 0 || y >= height) return 0
    return this.cells[faction][y * width + x]
  }

  restore(masks: Record<Faction, string>) {
    for (const faction of factions) this.cells[faction].set(decodeFog(masks[faction], this.cells[faction].length))
  }

  mask(faction: Faction): string {
    // Run length and shade share a number: shade 0 unseen, 1 explored, 2 visible.
    const cells = this.cells[faction]
    const runs: string[] = []
    let start = 0
    for (let i = 1; i <= cells.length; i++) {
      if (cells[i] === cells[start]) continue
      runs.push(((i - start) * 3 + cells[start]).toString(36))
      start = i
    }
    return runs.join('.')
  }
}
