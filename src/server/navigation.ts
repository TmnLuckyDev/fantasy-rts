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
  return !obstacles.some(obstacle => {
    const dx = point.x - obstacle.x
    const dy = point.y - obstacle.y
    const limit = obstacle.radius + radius
    return dx * dx + dy * dy < limit * limit
  })
}

function clearSegment(map: BattleMap, from: Point, to: Point, obstacles: readonly Obstacle[], radius: number) {
  const steps = Math.max(1, Math.ceil(distance(from, to) / 4))
  for (let i = 1; i <= steps; i++) {
    const point = { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }
    if (!canStand(map, point, obstacles, radius)) return false
  }
  return true
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
  if (!candidates.length) return []
  const approach = canStand(map, target, obstacles, radius)
    ? candidates.find(point => clearSegment(map, point, target, obstacles, radius))
    : undefined
  const waypoint = approach ?? candidates[0]
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
    open.push({ id, priority })
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (open[parent].priority <= priority) break
      open[i] = open[parent]
      i = parent
    }
    open[i] = { id, priority }
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
  const heuristic = (id: number) => distance(center(id), waypoint) / TILE
  push(source, heuristic(source))
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
  cost[source] = 0
  while (open.length) {
    const entry = pop()
    const current = entry.id
    if (visited[current] || entry.priority > cost[current] + heuristic(current) + 0.00001) continue
    if (current === goal) {
      const path: Point[] = distance(waypoint, destination) > 0.1 ? [destination] : []
      for (let id = current; id !== source; id = previous[id]) path.unshift(center(id))
      return path
    }
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
      push(next, nextCost + heuristic(next))
    }
  }
  return []
}
