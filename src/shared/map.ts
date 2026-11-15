import type { Faction, Point, ResourceKind } from './protocol.ts'

export const TILE = 32
export type Tile = 'grass' | 'road' | 'forest' | 'water' | 'rock' | 'bridge' | 'mine' | 'quarry'
export type BattleMap = {
  name: string
  width: number
  height: number
  tiles: readonly Tile[]
  bases: Record<Faction, Point>
}

const width = 64
export const riverColumn = width / 2 - 1
const height = 30
const tiles: Tile[] = Array.from({ length: width * height }, () => 'grass')
const put = (x: number, y: number, tile: Tile) => {
  tiles[y * width + x] = tile
  tiles[(height - 1 - y) * width + (width - 1 - x)] = tile
}

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width / 2; x++) {
    if (y === 0 || y === height - 1 || x === 0) put(x, y, 'forest')
    if (x < 3 && (y < 8 || y > 22)) put(x, y, 'rock')
    if ((x - 8) ** 2 / 25 + (y - 5) ** 2 / 9 < 1 ||
        (x - 14) ** 2 / 25 + (y - 23) ** 2 / 14 < 1 ||
        (x - 19) ** 2 / 13 + (y - 3) ** 2 / 9 < 1 ||
        (x - 27) ** 2 / 8 + (y - 25) ** 2 / 8 < 1) put(x, y, 'forest')
    if ((x - 18) ** 2 / 8 + (y - 17) ** 2 / 5 < 1) put(x, y, 'rock')
    if (x === riverColumn) put(x, y, 'water')
  }
}
for (let x = 4; x < width / 2; x++) {
  const y = x < 14 ? 11 : 10 - Math.floor((x - 14) / 7)
  put(x, y, x === riverColumn ? 'bridge' : 'road')
  put(x, y + 1, x === riverColumn ? 'bridge' : 'road')
}
for (const y of [8, 9, 20, 21]) {
  tiles[y * width + riverColumn] = 'bridge'
  tiles[y * width + riverColumn + 1] = 'bridge'
}
for (let x = 4; x < riverColumn; x++) {
  const y = x < 12 ? 12 + Math.floor((x - 4) / 2) : 16 + Math.floor((x - 12) / 2)
  if (tiles[y * width + x] === 'grass') put(x, y, 'road')
}
put(5, 18, 'mine')
put(25, 5, 'mine')
put(4, 15, 'quarry')
put(23, 22, 'quarry')

export const ashford: BattleMap = {
  name: 'Ashford Crossing',
  width, height, tiles,
  bases: { human: { x: 6.5 * TILE, y: 11.5 * TILE }, orc: { x: (width - 6.5) * TILE, y: 18.5 * TILE } }
}

export function tileAt(map: BattleMap, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return
  return map.tiles[y * map.width + x]
}

export const isWalkable = (tile: Tile | undefined) => tile === 'grass' || tile === 'road' || tile === 'bridge'
export const cellCenter = (x: number, y: number): Point => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE })
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)


export const snapToCell = (point: Point) => cellCenter(Math.floor(point.x / TILE), Math.floor(point.y / TILE))

export function resourceAt(map: BattleMap, point: Point): ResourceKind | undefined {
  const tile = tileAt(map, Math.floor(point.x / TILE), Math.floor(point.y / TILE))
  if (tile === 'mine') return 'gold'
  if (tile === 'forest') return 'wood'
  if (tile === 'quarry') return 'stone'
}
