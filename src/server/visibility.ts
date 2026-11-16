import { decodeFog } from '../shared/fog.ts'
import { TILE } from '../shared/map.ts'
import type { BattleMap } from '../shared/map.ts'
import { factions } from '../shared/protocol.ts'
import type { Entity, EntityKind, Faction, Point } from '../shared/protocol.ts'

const sight: Record<EntityKind, number> = {
  headquarters: 10, scout: 13, transport: 9, warship: 10, worker: 6, blade: 7, polearm: 7, ranged: 8, marksman: 8, heavy: 8, vanguard: 8, pathfinder: 9,
  barracks: 5, range: 5, elite: 5, farm: 4, wall: 2, tower: 9, smithy: 5, port: 7
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
  private readonly coverage: Record<Faction, Uint32Array>
  private previous = { human: new Set<number>(), orc: new Set<number>() }
  private current = { human: new Set<number>(), orc: new Set<number>() }
  private readonly encoded: Partial<Record<Faction, string>> = {}
  private restored = false

  constructor(map: BattleMap) {
    this.map = map
    const size = map.width * map.height
    this.cells = { human: new Uint8Array(size), orc: new Uint8Array(size) }
    this.coverage = { human: new Uint32Array(size), orc: new Uint32Array(size) }
  }

  update(units: Iterable<Entity & { buildDuration: number }>) {
    const { width, height } = this.map
    const size = width * height
    for (const unit of units) {
      if (unit.buildDuration) continue
      const x = Math.floor(unit.x / TILE)
      const y = Math.floor(unit.y / TILE)
      if (x < 0 || x >= width || y < 0 || y >= height) continue
      this.current[unit.faction].add(sight[unit.kind] * size + y * width + x)
    }
    for (const faction of factions) {
      const next = this.current[faction]
      const old = this.previous[faction]
      // Identical sight circles share one contribution, even when troops stack.
      for (const stamp of next) if (!old.has(stamp)) this.apply(faction, stamp, 1)
      for (const stamp of old) if (!next.has(stamp)) this.apply(faction, stamp, -1)
      if (this.restored) {
        const cells = this.cells[faction]
        for (let i = 0; i < cells.length; i++) {
          if (cells[i] === 2 && !this.coverage[faction][i]) {
            cells[i] = 1
            delete this.encoded[faction]
          }
        }
      }
      old.clear()
    }
    const previous = this.previous
    this.previous = this.current
    this.current = previous
    this.restored = false
  }

  private apply(faction: Faction, stamp: number, change: 1 | -1) {
    const { width, height } = this.map
    const size = width * height
    const origin = stamp % size
    const cx = origin % width
    const cy = Math.floor(origin / width)
    const coverage = this.coverage[faction]
    const cells = this.cells[faction]
    for (const offset of circles.get(Math.floor(stamp / size))!) {
      const x = cx + offset.x
      const y = cy + offset.y
      if (x < 0 || x >= width || y < 0 || y >= height) continue
      const index = y * width + x
      coverage[index] += change
      const shade = coverage[index] ? 2 : 1
      if (cells[index] === shade) continue
      cells[index] = shade
      delete this.encoded[faction]
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
    for (const faction of factions) {
      this.cells[faction].set(decodeFog(masks[faction], this.cells[faction].length))
      this.previous[faction].clear()
      this.current[faction].clear()
      this.coverage[faction].fill(0)
      this.encoded[faction] = masks[faction]
    }
    this.restored = true
  }

  mask(faction: Faction): string {
    const cached = this.encoded[faction]
    if (cached !== undefined) return cached
    // Run length and shade share a number: shade 0 unseen, 1 explored, 2 visible.
    const cells = this.cells[faction]
    const runs: string[] = []
    let start = 0
    for (let i = 1; i <= cells.length; i++) {
      if (cells[i] === cells[start]) continue
      runs.push(((i - start) * 3 + cells[start]).toString(36))
      start = i
    }
    return this.encoded[faction] = runs.join('.')
  }
}
