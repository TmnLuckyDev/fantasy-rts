import type { MatchSettings } from './match-settings.ts'
import type { Faction, Point, ResourceKind } from './protocol.ts'

export const TILE = 32
export type Tile = 'grass' | 'road' | 'forest' | 'water' | 'rock' | 'bridge' | 'mine' | 'quarry'
export type BattleMap = {
  id?: MapId
  seed?: number
  name: string
  width: number
  height: number
  tiles: readonly Tile[]
  bases: Record<Faction, Point>
}

export const mapIds = ['ashford-original', 'ashford-expanded', 'pinewatch-vale', 'ironbreak-pass', 'twinmere-basin', 'shattered-isles'] as const
export type MapId = typeof mapIds[number]
type NewMap = Exclude<MapId, 'ashford-original' | 'ashford-expanded' | 'shattered-isles'>

function createAshford(id: 'ashford-original' | 'ashford-expanded'): BattleMap {
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

const terrainLayouts = {
  'pinewatch-vale': { name: 'Pinewatch Vale', width: 112, height: 64, deposits: 6 },
  'ironbreak-pass': { name: 'Ironbreak Pass', width: 144, height: 72, deposits: 7 },
  'twinmere-basin': { name: 'Twinmere Basin', width: 160, height: 88, deposits: 8 }
} as const

function createBattlefield(id: NewMap): BattleMap {
  const { name, width, height } = terrainLayouts[id]
  const half = width / 2
  const tiles: Tile[] = Array(width * height).fill('grass')
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < half; x++) {
      const u = x / half
      const v = y / height
      const patch = (cx: number, cy: number, rx: number, ry: number) =>
        ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 < 1
      let tile: Tile = 'grass'
      if (y === 0 || y === height - 1 || x === 0) tile = 'forest'
      if (patch(.23, .27, .13, .095) || patch(.35, .77, .14, .095) ||
          patch(.53, .12, .16, .07) || patch(.59, .58, .15, .09) ||
          patch(.76, .88, .15, .075)) tile = 'forest'
      if (id === 'pinewatch-vale' && (patch(.22, .51, .15, .08) || patch(.79, .31, .14, .13) ||
          patch(.92, .64, .1, .12))) tile = 'forest'
      if (id === 'ironbreak-pass') {
        if (patch(.62, .35, .12, .115) || patch(.78, .63, .15, .115)) tile = 'rock'
        if (x >= half - 2) {
          const pass = [.2, .5, .8].some(center => Math.abs(y + 0.5 - center * height) < 3)
          tile = pass ? 'road' : 'rock'
        }
      }
      if (id === 'twinmere-basin') {
        if (patch(.56, .34, .22, .15) || patch(.81, .68, .17, .12)) tile = 'water'
        if (x === half - 1) {
          const crossing = [.16, .50, .84].some(center => Math.abs(y + 0.5 - center * height) < 3)
          tile = crossing ? 'bridge' : 'water'
        }
      }
      const index = y * width + x
      tiles[index] = tiles[tiles.length - 1 - index] = tile
    }
  }
  return { id, name, width, height, tiles, bases: mirroredBases(width, height, 8, 9) }
}

function mirroredBases(width: number, height: number, x: number, y: number): BattleMap['bases'] {
  return { human: { x: (x + .5) * TILE, y: (y + .5) * TILE },
    orc: { x: (width - x - .5) * TILE, y: (height - y - .5) * TILE } }
}

function createIslands(): BattleMap {
  const width = 160, height = 96
  const tiles: Tile[] = Array(width * height).fill('water')
  const ellipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
    ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const jitter = Math.sin(x * .31 + y * .13) * 1.5 + Math.cos(y * .37 - x * .19)
    const left = ellipse(x, y, 26, 48, 25 + jitter, 41 + jitter)
    const right = ellipse(x, y, 133, 47, 25 + jitter, 41 + jitter)
    const north = ellipse(x, y, 80, 13, 18 + jitter, 10 + jitter)
    const south = ellipse(x, y, 80, 82, 19 + jitter, 11 + jitter)
    const middle = ellipse(x, y, 80, 48, 12 + jitter, 10 + jitter)
    if (!left && !right && !north && !south && !middle) continue
    let tile: Tile = 'grass'
    const noise = (Math.imul(x + 11, 73856093) ^ Math.imul(y + 17, 19349663)) >>> 0
    if (noise % 37 < 3 && x > 13 && x < 147) tile = 'forest'
    if (noise % 131 === 4) tile = 'rock'
    tiles[y * width + x] = tile
  }
  // Safe starting zones and mirrored resource deposits on both large islands.
  for (const [cx, cy] of [[24, 48], [135, 47]]) {
    for (let y = cy - 6; y <= cy + 6; y++) for (let x = cx - 7; x <= cx + 7; x++) tiles[y * width + x] = 'grass'
    for (const [dx, dy, tile] of [[-6, 2, 'mine'], [-6, -2, 'quarry'], [1, -5, 'forest']] as const) {
      tiles[(cy + dy) * width + cx + dx] = tile
    }
  }
  return { id: 'shattered-isles', name: 'Shattered Isles', width, height, tiles,
    bases: mirroredBases(width, height, 24, 48) }
}

const battlefields = {
  'ashford-original': ashfordClassic,
  'ashford-expanded': ashford,
  'pinewatch-vale': createBattlefield('pinewatch-vale'),
  'ironbreak-pass': createBattlefield('ironbreak-pass'),
  'twinmere-basin': createBattlefield('twinmere-basin'),
  'shattered-isles': createIslands()
} satisfies Record<MapId, BattleMap>

export const ashfordMap = (id: MapId | undefined) => id ? battlefields[id] : ashford
export const mapOptions = mapIds.map(id => {
  const { name, width, height, tiles } = battlefields[id]
  const deposits = id === 'ashford-original' ? 3 : id === 'ashford-expanded' ? 7 : id === 'shattered-isles' ? 8 : terrainLayouts[id as NewMap].deposits
  return { id, name, width, height, deposits, trees: tiles.filter(tile => tile === 'forest').length / 2 }
})

const starterSites = [
  { resource: 'gold', tile: 'mine', x: -4, y: 2 },
  { resource: 'stone', tile: 'quarry', x: -4, y: -2 },
  { resource: 'wood', tile: 'forest', x: 1, y: -4 }
] as const

function startingSites(map: BattleMap) {
  const { width, height } = map
  const options: Point[] = []
  const open = (x: number, y: number) => isWalkable(tileAt(map, x, y))
  const spacing = map.id === 'ashford-original' ? 2 : 3
  for (let y = 6; y < height - 6; y += spacing) {
    for (let x = 6; x < width * .38; x += spacing) {
      let clear = true
      for (let dy = -2; dy <= 2 && clear; dy++) {
        for (let dx = -2; dx <= 4; dx++) {
          if (!open(x + dx, y + dy)) { clear = false; break }
        }
      }
      if (clear && starterSites.every(site => {
        const sx = x + site.x
        const sy = y + site.y
        return (tileAt(map, sx, sy) === 'grass' || tileAt(map, sx, sy) === site.tile) &&
          (site.x < 0 ? open(sx + 1, sy) : open(sx, sy + 1))
      })) options.push({ x, y })
    }
  }
  return options
}

const spawnSites = new Map<MapId, Point[]>()

export function mapForSettings(settings: MatchSettings, seed?: number): BattleMap {
  const base = ashfordMap(settings.map)
  const { width, height } = base
  const half = base.tiles.length / 2
  const tiles = [...base.tiles]
  const mirror = (index: number, tile: Tile) => {
    tiles[index] = tile
    tiles[tiles.length - 1 - index] = tile
  }
  let bases = base.bases
  const reserved = new Set<number>()
  if (seed !== undefined || !settings.map.startsWith('ashford-')) {
    let sites = spawnSites.get(settings.map)
    if (!sites) {
      sites = startingSites(base)
      spawnSites.set(settings.map, sites)
    }
    const site = sites[(seed ?? 0) % sites.length]
    if (site) {
      bases = mirroredBases(width, height, site.x, site.y)
      for (const resource of starterSites) {
        if (!settings.sources[resource.resource].count) continue
        const index = (site.y + resource.y) * width + site.x + resource.x
        mirror(index, resource.tile)
        reserved.add(Math.min(index, tiles.length - 1 - index))
      }
    }
  }
  const coordinates = (i: number) => cellCenter(i % width, Math.floor(i / width))
  const toBase = (i: number) => {
    const p = coordinates(i)
    return Math.min(distance(p, bases.human), distance(p, bases.orc))
  }
  const locations: Array<{ tile: Tile, count: number }> = [
    { tile: 'forest', count: settings.sources.wood.count },
    { tile: 'mine', count: settings.sources.gold.count },
    { tile: 'quarry', count: settings.sources.stone.count }
  ]
  for (const { tile, count } of locations) {
    const present = tiles.slice(0, half).flatMap((kind, i) => kind === tile ? [i] : [])
    if (present.length > count) {
      present.sort((a, b) => Number(reserved.has(b)) - Number(reserved.has(a)) || toBase(a) - toBase(b))
      for (const i of present.slice(count)) mirror(i, 'grass')
    }
    if (present.length >= count) continue
    const candidates = tiles.slice(0, half).flatMap((kind, i) => {
      const x = i % width
      const y = Math.floor(i / width)
      return kind === 'grass' && x > 2 && x < width - 3 && y > 1 && y < height - 2 &&
        Math.abs(x - width / 2) > 7 && toBase(i) > 7 * TILE ? [i] : []
    })
    // Keep roads clear and leave an approach on each side of new deposits.
    candidates.sort((a, b) => (Math.imul(a, 0x9e3779b9) >>> 0) - (Math.imul(b, 0x9e3779b9) >>> 0))
    let missing = count - present.length
    for (const i of candidates) {
      if (![i - 1, i + 1, i - width, i + width].every(index => isWalkable(tiles[index]))) continue
      mirror(i, tile)
      if (--missing === 0) break
    }
  }
  return { ...base, ...(seed === undefined ? {} : { seed }), bases, tiles }
}

export function tileAt(map: BattleMap, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return
  return map.tiles[y * map.width + x]
}

export const isWater = (tile: Tile | undefined) => tile === 'water'
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
