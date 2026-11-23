import { TILE, cellCenter, distance, isWalkable, tileAt } from '../shared/map.ts'
import type { BattleMap } from '../shared/map.ts'
import type { Point } from '../shared/protocol.ts'

export type Obstacle = Point & { radius: number }

export function canStand(map: BattleMap, point: Point, obstacles: readonly Obstacle[], radius = 0): boolean {
  const left = Math.floor((point.x - radius) / TILE)
  const right = Math.floor((point.x + radius) / TILE)
  const top = Math.floor((point.y - radius) / TILE)
  const bottom = Math.floor((point.y + radius) / TILE)
  if (!isWalkable(tileAt(map, left, top)) || !isWalkable(tileAt(map, right, top)) ||
      !isWalkable(tileAt(map, left, bottom)) || !isWalkable(tileAt(map, right, bottom))) return false
  for (const obstacle of obstacles) {
    const dx = point.x - obstacle.x
    const dy = point.y - obstacle.y
    const limit = obstacle.radius + radius
    if (dx * dx + dy * dy < limit * limit) return false
  }
  return true
}

export class NavigationGrid {
  private readonly openByRadius = new Map<number, Uint8Array>()

  private readonly map: BattleMap
  private readonly obstacles: readonly Obstacle[]

  constructor(map: BattleMap, obstacles: readonly Obstacle[]) {
    this.map = map
    this.obstacles = obstacles
  }

  cells(radius: number) {
    let cells = this.openByRadius.get(radius)
    if (!cells) {
      const { width, height } = this.map
      cells = new Uint8Array(width * height)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          cells[y * width + x] = Number(canStand(this.map, cellCenter(x, y), [], radius))
        }
      }
      for (const obstacle of this.obstacles) {
        const limit = obstacle.radius + radius
        const left = Math.max(0, Math.floor((obstacle.x - limit) / TILE))
        const right = Math.min(width - 1, Math.floor((obstacle.x + limit) / TILE))
        const top = Math.max(0, Math.floor((obstacle.y - limit) / TILE))
        const bottom = Math.min(height - 1, Math.floor((obstacle.y + limit) / TILE))
        for (let y = top; y <= bottom; y++) {
          for (let x = left; x <= right; x++) {
            const point = cellCenter(x, y)
            if ((point.x - obstacle.x) ** 2 + (point.y - obstacle.y) ** 2 < limit ** 2) cells[y * width + x] = 0
          }
        }
      }
      this.openByRadius.set(radius, cells)
    }
    return cells
  }
}

export function clearSegment(map: BattleMap, from: Point, to: Point, obstacles: readonly Obstacle[], radius: number) {
  const steps = Math.max(1, Math.ceil(distance(from, to) / 4))
  for (let i = 1; i <= steps; i++) {
    const point = { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }
    if (!canStand(map, point, obstacles, radius)) return false
  }
  return true
}

export function findPath(map: BattleMap, start: Point, target: Point, obstacles: readonly Obstacle[], radius: number, grid?: NavigationGrid): Point[] {
  const cellId = (point: Point) => Math.floor(point.y / TILE) * map.width + Math.floor(point.x / TILE)
  const center = (id: number) => cellCenter(id % map.width, Math.floor(id / map.width))
  const cells = grid?.cells(radius)
  const openCell = (x: number, y: number) => x >= 0 && x < map.width && y >= 0 && y < map.height &&
    (cells ? cells[y * map.width + x] === 1 : canStand(map, cellCenter(x, y), obstacles, radius))
  const source = cellId(start)
  const desiredX = Math.floor(target.x / TILE)
  const desiredY = Math.floor(target.y / TILE)
  const candidates: Array<{ point: Point, targetGap: number, startGap: number }> = []
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (!openCell(desiredX + dx, desiredY + dy)) continue
      const point = cellCenter(desiredX + dx, desiredY + dy)
      candidates.push({
        point,
        targetGap: (point.x - target.x) ** 2 + (point.y - target.y) ** 2,
        startGap: (point.x - start.x) ** 2 + (point.y - start.y) ** 2
      })
    }
  }
  candidates.sort((a, b) => a.targetGap - b.targetGap || a.startGap - b.startGap)
  if (!candidates.length) return []
  const approach = canStand(map, target, obstacles, radius)
    ? candidates.find(({ point }) => clearSegment(map, point, target, obstacles, radius))?.point
    : undefined
  const waypoint = approach ?? candidates[0].point
  const destination = approach ? target : waypoint
  const goal = cellId(waypoint)
  if (source === goal) {
    return clearSegment(map, start, destination, obstacles, radius) ? [destination] : [waypoint, destination]
  }

  const count = map.width * map.height
  const cost = new Float32Array(count).fill(Infinity)
  const previous = new Int32Array(count).fill(-1)
  const visited = new Uint8Array(count)
  // Binary min-heap avoids scanning every open tile on each A* iteration.
  // Entries may become stale after a better route is found, so discard them on pop.
  const open: Array<{ id: number, priority: number }> = []
  const push = (id: number, priority: number) => {
    let i = open.length
    const entry = { id, priority }
    open.push(entry)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (open[parent].priority <= priority) break
      open[i] = open[parent]
      i = parent
    }
    open[i] = entry
  }
  const pop = () => {
    const first = open[0]
    const last = open.pop()!
    if (open.length) {
      let i = 0
      while (true) {
        const left = i * 2 + 1
        if (left >= open.length) break
        const right = left + 1
        const child = right < open.length && open[right].priority < open[left].priority ? right : left
        if (open[child].priority >= last.priority) break
        open[i] = open[child]
        i = child
      }
      open[i] = last
    }
    return first
  }
  const goalX = goal % map.width
  const goalY = Math.floor(goal / map.width)
  const heuristic = (id: number) => Math.sqrt((id % map.width - goalX) ** 2 + (Math.floor(id / map.width) - goalY) ** 2)
  push(source, heuristic(source))
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
  cost[source] = 0
  while (open.length) {
    const entry = pop()
    const current = entry.id
    if (visited[current] || entry.priority > cost[current] + heuristic(current) + 0.00001) continue
    if (current === goal) {
      const path: Point[] = distance(waypoint, destination) > 0.1 ? [destination] : []
      for (let id = current; id !== source; id = previous[id]) path.push(center(id))
      return path.reverse()
    }
    visited[current] = 1
    const x = current % map.width
    const y = Math.floor(current / map.width)
    for (const [dx, dy] of steps) {
      if (!openCell(x + dx, y + dy)) continue
      const diagonal = dx !== 0 && dy !== 0
      if (diagonal && (!openCell(x + dx, y) || !openCell(x, y + dy))) continue
      const next = current + dy * map.width + dx
      const nextCost = cost[current] + (diagonal ? Math.SQRT2 : 1)
      if (visited[next] || nextCost >= cost[next]) continue
      cost[next] = nextCost
      previous[next] = current
      push(next, nextCost + heuristic(next))
    }
  }
  return []
}
