import { TILE, cellCenter, isWalkable, isWater, tileAt } from '../shared/map.ts'
import type { BattleMap } from '../shared/map.ts'
import type { Point } from '../shared/protocol.ts'

export type Landing = { land: Point, sea: Point }
const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

// Match terrain is immutable. Label connected regions once, then reuse their shared shores.
export class Coast {
  private readonly map: BattleMap
  private readonly regions: Int32Array
  private readonly shoresBySea = new Map<number, Landing[]>()
  private readonly shores = new Map<string, Landing[]>()

  constructor(map: BattleMap) {
    this.map = map
    const { width, height, tiles } = map
    this.regions = new Int32Array(tiles.length)
    const queue = new Int32Array(tiles.length)
    let region = 0
    for (let i = 0; i < tiles.length; i++) {
      const passable = isWater(tiles[i]) ? isWater : isWalkable
      if (this.regions[i] || !passable(tiles[i])) continue
      this.regions[i] = ++region
      queue[0] = i
      let tail = 1
      for (let head = 0; head < tail; head++) {
        const index = queue[head]
        const x = index % width, y = Math.floor(index / width)
        for (const [dx, dy] of neighbors) {
          const nx = x + dx, ny = y + dy, next = ny * width + nx
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || this.regions[next] || !passable(tiles[next])) continue
          this.regions[next] = region
          queue[tail++] = next
        }
      }
    }
    for (let index = 0; index < tiles.length; index++) {
      if (!isWalkable(tiles[index])) continue
      const x = index % width, y = Math.floor(index / width)
      for (const [dx, dy] of neighbors) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || !isWater(tiles[next])) continue
        const key = this.regions[index] + ':' + this.regions[next]
        const landing = { land: cellCenter(x, y), sea: cellCenter(nx, ny) }
        const sea = this.regions[next]
        const seaShore = this.shoresBySea.get(sea)
        if (seaShore) seaShore.push(landing)
        else this.shoresBySea.set(sea, [landing])
        const shores = this.shores.get(key)
        if (shores) shores.push(landing)
        else this.shores.set(key, [landing])
      }
    }
  }

  region(at: Point) {
    const x = Math.floor(at.x / TILE), y = Math.floor(at.y / TILE)
    return x >= 0 && x < this.map.width && y >= 0 && y < this.map.height ? this.regions[y * this.map.width + x] : 0
  }

  canReachDeposit(region: number, at: Point) {
    if (!region) return false
    if (this.region(at) === region) return true
    for (const [dx, dy] of neighbors) {
      const next = { x: at.x + dx * TILE, y: at.y + dy * TILE }
      if (this.region(next) === region) return true
    }
    return false
  }

  landingNear(target: Point, ship: Point, reserved: readonly Point[]) {
    const shores = this.shoresBySea.get(this.region(ship)) ?? []
    const region = isWalkable(tileAt(this.map, Math.floor(target.x / TILE), Math.floor(target.y / TILE))) ? this.region(target) : 0
    let nearest: Landing | undefined
    let nearestGap = 4 * TILE
    for (const site of shores) {
      if (region && region !== this.region(site.land)) continue
      const gap = Math.hypot(site.land.x - target.x, site.land.y - target.y)
      if (gap > nearestGap) continue
      nearest = site
      nearestGap = gap
    }
    if (!nearest) return
    const destination = this.region(nearest.land)
    let best = nearest
    let bestScore = Infinity
    for (const site of shores) {
      if (this.region(site.land) !== destination) continue
      const gap = Math.hypot(site.land.x - target.x, site.land.y - target.y)
      if (gap > (reserved.length ? 14 : 4) * TILE) continue
      const congestion = reserved.reduce((total, other) => total +
        Math.max(0, 8 * TILE - Math.hypot(site.sea.x - other.x, site.sea.y - other.y)) * 4, 0)
      if (gap + congestion >= bestScore) continue
      best = site
      bestScore = gap + congestion
    }
    return best
  }

  meeting(unit: Point, ship: Point) {
    let best: Landing | undefined
    let score = Infinity
    for (const site of this.shores.get(this.region(unit) + ':' + this.region(ship)) ?? []) {
      const gap = Math.hypot(unit.x - site.land.x, unit.y - site.land.y) + Math.hypot(ship.x - site.sea.x, ship.y - site.sea.y)
      if (gap < score) {
        score = gap
        best = site
      }
    }
    return best && { site: best, score }
  }
}
