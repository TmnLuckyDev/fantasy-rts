import { TILE, cellCenter, distance, isWalkable, tileAt } from '../shared/map.ts'
import type { BattleMap } from '../shared/map.ts'
import type { Point } from '../shared/protocol.ts'

type Obstacle = Point & { radius: number }

export function canStand(map: BattleMap, point: Point, obstacles: readonly Obstacle[], radius = 0): boolean {
  const { x, y } = point
  for (const dx of [-radius, radius]) {
    for (const dy of [-radius, radius]) {
      if (!isWalkable(tileAt(map, Math.floor((x + dx) / TILE), Math.floor((y + dy) / TILE)))) return false
    }
  }
  return !obstacles.some(obstacle => distance(point, obstacle) < obstacle.radius + radius)
}

export function findPath(map: BattleMap, start: Point, target: Point, obstacles: readonly Obstacle[], radius: number): Point[] {
  const cellId = (point: Point) => Math.floor(point.y / TILE) * map.width + Math.floor(point.x / TILE)
  const center = (id: number) => cellCenter(id % map.width, Math.floor(id / map.width))
  const source = cellId(start)
  const desiredX = Math.floor(target.x / TILE)
  const desiredY = Math.floor(target.y / TILE)
  const candidates: Point[] = []
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const point = cellCenter(desiredX + dx, desiredY + dy)
      if (canStand(map, point, obstacles, radius)) candidates.push(point)
    }
  }
  candidates.sort((a, b) => distance(a, target) - distance(b, target) || distance(a, start) - distance(b, start))
  const exact = canStand(map, target, obstacles, radius)
  const desired = exact ? target : candidates[0]
  if (!desired) return []
  const goal = cellId(desired)
  if (source === goal) return [desired]

  const count = map.width * map.height
  const cost = new Float32Array(count).fill(Infinity)
  const previous = new Int32Array(count).fill(-1)
  const visited = new Uint8Array(count)
  const open = new Set([source])
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
  cost[source] = 0
  while (open.size) {
    let current = -1
    let best = Infinity
    for (const id of open) {
      const score = cost[id] + distance(center(id), desired) / TILE
      if (score < best) {
        best = score
        current = id
      }
    }
    if (current === goal) {
      const path: Point[] = [desired]
      for (let id = current; id !== source; id = previous[id]) path.unshift(center(id))
      return path
    }
    open.delete(current)
    visited[current] = 1
    const x = current % map.width
    const y = Math.floor(current / map.width)
    for (const [dx, dy] of steps) {
      const point = cellCenter(x + dx, y + dy)
      if (!canStand(map, point, obstacles, radius)) continue
      if (dx && dy && (!canStand(map, cellCenter(x + dx, y), obstacles, radius) ||
          !canStand(map, cellCenter(x, y + dy), obstacles, radius))) continue
      const next = cellId(point)
      const nextCost = cost[current] + Math.hypot(dx, dy)
      if (visited[next] || nextCost >= cost[next]) continue
      cost[next] = nextCost
      previous[next] = current
      open.add(next)
    }
  }
  return []
}
