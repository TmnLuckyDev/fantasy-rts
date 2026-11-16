import type { Faction, Point, ResourceKind } from './protocol.ts'

export const TILE = 32
export type Tile = 'grass' | 'road' | 'forest' | 'water' | 'rock' | 'bridge' | 'mine' | 'quarry'
export type BattleMap = {
  id?: MapId
  name: string
  width: number
  height: number
  tiles: readonly Tile[]
  bases: Record<Faction, Point>
}

export type MapId = 'ashford-original' | 'ashford-expanded'

function createAshford(id: MapId): BattleMap {
  const expanded = id === 'ashford-expanded'
  const width = expanded ? 176 : 88
  const height = expanded ? 80 : 40
  const river = width / 2 - 1
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
          (x - 27) ** 2 / 18 + (y - 25) ** 2 / 14 < 1 ||
          (x - 34) ** 2 / 20 + (y - 16) ** 2 / 25 < 1 ||
          (x - 29) ** 2 / 40 + (y - 36) ** 2 / 16 < 1) put(x, y, 'forest')
      if ((x - 18) ** 2 / 8 + (y - 17) ** 2 / 5 < 1 ||
          (x - 19) ** 2 / 26 + (y - 33) ** 2 / 9 < 1 ||
          (x - 38) ** 2 / 8 + (y - 25) ** 2 / 18 < 1) put(x, y, 'rock')
      if (expanded) {
        if ((x - 28) ** 2 / 80 + (y - 61) ** 2 / 35 < 1 ||
            (x - 52) ** 2 / 58 + (y - 17) ** 2 / 30 < 1 ||
            (x - 69) ** 2 / 110 + (y - 42) ** 2 / 29 < 1 ||
            (x - 47) ** 2 / 95 + (y - 71) ** 2 / 20 < 1 ||
            (x - 12) ** 2 / 42 + (y - 48) ** 2 / 34 < 1) put(x, y, 'forest')
        if ((x - 64) ** 2 / 13 + (y - 64) ** 2 / 10 < 1 ||
            (x - 49) ** 2 / 25 + (y - 39) ** 2 / 14 < 1 ||
            (x - 76) ** 2 / 13 + (y - 19) ** 2 / 21 < 1) put(x, y, 'rock')
      }
      if (x === river) put(x, y, 'water')
    }
  }
  for (let x = 4; x < river; x++) {
    const north = x < 14 ? 11 : Math.max(expanded ? 8 : 0, 11 - Math.floor((x - 14) / 7))
    const south = x < 12 ? 12 + Math.floor((x - 4) / 2) : Math.min(height - 10, 16 + Math.floor((x - 12) / 2))
    for (const y of [north - 1, north, north + 1, north + 2, south - 1, south, south + 1, south + 2]) {
      if (tiles[y * width + x] === 'grass') put(x, y, 'road')
    }
  }
  // Four continuous lanes across each bridge, including the approaches on both banks.
  for (const north of expanded ? [7, 27, 49, 69] : [7, 29]) {
    for (let y = north; y < north + 4; y++) {
      for (let x = river - 5; x < river; x++) put(x, y, 'road')
      put(river, y, 'bridge')
    }
  }
  put(5, 18, 'mine')
  put(25, 5, 'mine')
  put(34, 33, 'mine')
  put(4, 15, 'quarry')
  put(23, 22, 'quarry')
  put(33, 5, 'quarry')

  if (expanded) {
    for (const [x, y] of [[19, 52], [47, 24], [69, 34], [78, 66]]) put(x, y, 'mine')
    for (const [x, y] of [[15, 55], [48, 28], [66, 34], [75, 63]]) put(x, y, 'quarry')
  }

  return {
    id, name: 'Ashford Crossing', width, height, tiles,
    bases: { human: { x: 6.5 * TILE, y: 11.5 * TILE }, orc: { x: (width - 6.5) * TILE, y: (height - 11.5) * TILE } }
  }
}

export const ashfordClassic = createAshford('ashford-original')
export const ashford = createAshford('ashford-expanded')
export const riverColumn = ashford.width / 2 - 1

export const ashfordMap = (id: MapId | undefined) => id === 'ashford-original' ? ashfordClassic : ashford

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

export function wallLine(map: BattleMap, from: Point, to: Point): Point[] {
  if (![from, to].every(point => point.x >= 0 && point.x < map.width * TILE &&
    point.y >= 0 && point.y < map.height * TILE)) return []
  let x = Math.floor(from.x / TILE)
  let y = Math.floor(from.y / TILE)
  const endX = Math.floor(to.x / TILE)
  const endY = Math.floor(to.y / TILE)
  const dx = Math.abs(endX - x)
  const dy = Math.abs(endY - y)
  const sx = Math.sign(endX - x)
  const sy = Math.sign(endY - y)
  const cells = [cellCenter(x, y)]
  let ix = 0
  let iy = 0
  while (ix < dx || iy < dy) {
    // Step in one axis at a time so a diagonal swipe still makes a continuous wall.
    if (ix < dx && (iy >= dy || (ix + 0.5) * dy <= (iy + 0.5) * dx)) {
      x += sx
      ix++
    } else {
      y += sy
      iy++
    }
    cells.push(cellCenter(x, y))
  }
  return cells
}
