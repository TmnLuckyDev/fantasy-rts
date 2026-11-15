import { TILE, ashford, tileAt } from '../shared/map.ts'
import type { Tile } from '../shared/map.ts'
import { brush, canvas } from './voxel.ts'
import type { Faces } from './voxel.ts'

export const factionColor = { human: 0x71ceff, orc: 0xff8671 }
export const terrainColor: Record<Tile, string> = {
  grass: '#648e44', road: '#ae8757', forest: '#3c6640', water: '#2a7492',
  bridge: '#ab7953', rock: '#707b70', mine: '#8b7546', quarry: '#8a9c9b'
}

const grass = ['#628b43', '#6c964a', '#759d50', '#6f984a', '#7ba252']
const trail = ['#ad8251', '#b38854', '#b38a58', '#b88f5c']
const rock = ['#b3bab3', '#7f918b', '#4c6564'] as const
const darkRock = ['#8d9e95', '#637b71', '#435f59'] as const
const ore: Faces = ['#ffe58a', '#dcab45', '#986938']
const pine: Faces[] = [
  ['#7baa50', '#54883c', '#316341'],
  ['#98bb55', '#669644', '#3d7542'],
  ['#6c9f64', '#478556', '#315f4b']
]

export function randomAt(seed: number) {
  let state = seed | 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0
    return (state >>> 0) / 4294967296
  }
}

export function terrainTexture(startX: number, startY: number, width: number, height: number) {
  const surface = canvas(width * TILE, height * TILE)
  const { rect, block } = brush(surface)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const tx = startX + col
      const ty = startY + row
      const tile = tileAt(ashford, tx, ty)!
      const x = col * TILE
      const y = row * TILE
      const rand = randomAt((ty * ashford.width + tx) * 311 + 1049)
      if (tile === 'water' || tile === 'bridge') {
        rect('#236480', x, y, TILE, TILE)
        for (let j = 0; j < 10; j++) {
          rect(j % 3 ? '#317992' : '#3b8e9c', x + Math.floor(rand() * 26), y + Math.floor(rand() * 30), 3 + j % 4, 2)
        }
        const bank = tileAt(ashford, tx - 1, ty) === 'water' ? x + TILE - 4 : x
        if (tile === 'water') {
          rect('#426e63', bank, y, 4, TILE)
          rect('#6aa393', bank + 1, y, 2, TILE)
        } else {
          rect('#463b31', x, y + 2, TILE, 30)
          for (let d = 2; d < TILE; d += 5) {
            rect(d % 2 ? '#b98953' : '#cb9b64', x, y + d, TILE, 4)
            rect('#e0b481', x, y + d, TILE, 1)
          }
          for (const [dy, offset] of [[-1, 3], [1, 28]]) {
            if (tileAt(ashford, tx, ty + dy) === 'bridge') continue
            const railY = y + offset
            rect('#674a38', x, railY, TILE, 4)
            rect('#d9a76d', x, railY, TILE, 1)
            for (const dx of [3, 23]) block(['#e6af74', '#a37147', '#573e34'], x + dx, railY - 2, 4, 6, 2)
          }
        }
        continue
      }

      const meadow = Math.floor((Math.sin(tx * 0.46 + ty * 0.11) + Math.cos(ty * 0.41) + 2) * 1.18)
      rect(tile === 'grass' ? grass[meadow] : terrainColor[tile], x, y, TILE, TILE)
      if (tile === 'road') {
        const north = tileAt(ashford, tx, ty - 1) === 'road'
        const south = tileAt(ashford, tx, ty + 1) === 'road'
        const top = north ? 0 : 3
        const bottom = south ? 0 : 3
        rect(grass[meadow], x, y, TILE, TILE)
        rect('#9e7d50', x, y + top, TILE, TILE - top - Math.max(0, bottom - 1))
        rect(trail[(tx + ty) % trail.length], x, y + top, TILE, TILE - top - bottom)
        for (const dx of [1, 12, 25]) {
          if (!north) rect('#c29a62', x + dx, y + 2 + dx % 2, 4, 2)
          if (!south) rect('#687f43', x + dx, y + 29 + dx % 2, 5, 1)
        }
        for (let j = 0; j < 5; j++) {
          rect(j % 2 ? '#ca9e6b' : '#967451', x + 2 + Math.floor(rand() * 25), y + 6 + Math.floor(rand() * 18), 2 + j % 3, 1)
        }
        continue
      }
      for (let j = 0; j < 10; j++) {
        const px = x + Math.floor(rand() * 26)
        const py = y + Math.floor(rand() * 28)
        rect(j % 2 ? '#e0df8421' : '#254e3334', px, py, 2 + j % 5, 1 + j % 3)
      }
      if (tile === 'grass') {
        for (let i = 0; i < 2; i++) {
          const px = x + 4 + Math.floor(rand() * 22)
          const py = y + 6 + Math.floor(rand() * 22)
          rect('#416e39', px, py, 2, 4)
          rect('#9dbe60', px - 1, py + 1, 2, 2)
          if (rand() < 0.21) rect(i ? '#f1d77e' : '#d7e5ae', px, py - 1, 2, 2)
        }
      }
    }
  }
  return surface
}

export function propTexture(tile: 'forest' | 'rock' | 'mine' | 'quarry', variant: number) {
  const surface = canvas(44, 48)
  const { rect, block, poly, shadow } = brush(surface)
  shadow(23, 40, 18, 5)
  if (tile === 'forest') {
    const leaves = pine[variant]
    block(['#a78250', '#735039', '#493e30'], 18, 31, 5, 10, 4)
    if (variant === 2) {
      block(leaves, 7, 25, 24, 9, 8)
      block(leaves, 11, 18, 18, 10, 7)
      block(leaves, 14, 11, 12, 10, 6)
      block(leaves, 17, 5, 7, 8, 5)
      rect('#d8dd8a55', 17, 10, 7, 2)
    } else {
      const rise = variant * 4
      block(leaves, 8, 23, 23, 10, 8)
      block(leaves, 5, 20 + rise, 10, 9, 6)
      block(leaves, 21, 19 + rise, 11, 9, 6)
      block(leaves, 10, 15 - rise, 18, 11, 7)
      block(leaves, 14, 11 - rise, 10, 6, 6)
      rect('#e5e79460', 14, 11 - rise, 8, 2)
      rect('#c4d97950', 8, 25, 5, 2)
    }
    return surface
  }

  if (tile === 'quarry') {
    block(darkRock, 5, 29, 21, 11, 7)
    block(rock, 17, 28, 16, 11, 8)
    block(['#d7dfcf', '#a4b4aa', '#687f79'], 7, 22, 14, 14, 6)
    rect('#493d31', 3, 16, 2, 21)
    block(['#ffdc88', '#bc965b', '#7d5032'], 2, 16, 11, 7, 3)
    rect('#554c40', 5, 18, 5, 2)
  } else {
    block(darkRock, 6, 27, 26, 13, 8)
    block(rock, 8, 19, 17, 17, 10)
    block(rock, 17, 14 + variant * 2, 13, 17 - variant * 2, 8)
    block(darkRock, 25, 27, 10, 9, 5)
    rect('#e0ead070', 19, 14 + variant * 2, 7, 2)
  }
  if (tile === 'mine') {
    for (const [x, y] of [[6, 29], [22, 16], [32, 27]]) block(ore, x, y, 4, 3, 3)
    rect('#211c1b', 13, 28, 14, 12)
    block(['#e6ad64', '#966644', '#60422f'], 10, 26, 4, 15, 3)
    block(['#e6ad64', '#966644', '#60422f'], 25, 26, 4, 15, 3)
    block(['#f4c277', '#a27245', '#654934'], 10, 24, 19, 4, 4)
    poly('#dfad5d', 32, 18, 34, 21, 37, 22, 34, 23, 32, 26, 31, 23, 28, 22, 31, 21)
  }
  return surface
}
