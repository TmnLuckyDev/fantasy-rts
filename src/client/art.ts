import { TILE, ashford } from '../shared/map.ts'
import type { Tile } from '../shared/map.ts'
import { isBuildingKind } from '../shared/protocol.ts'
import type { BuildingKind, EntityKind, Faction } from '../shared/protocol.ts'

export const factionColor = { human: 0x7db7f8, orc: 0xf08a6b }
export const terrainColor: Record<Tile, string> = {
  grass: '#536338', road: '#806748', forest: '#314628', water: '#386871',
  bridge: '#927557', rock: '#53564d', mine: '#665a38', quarry: '#9a9ca1'
}

export function randomAt(seed: number) {
  let state = seed | 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0
    return (state >>> 0) / 4294967296
  }
}

export function canvas(width: number, height: number) {
  const result = document.createElement('canvas')
  result.width = width
  result.height = height
  return result
}

export function terrainTexture(startX: number, startY: number, width: number, height: number) {
  const surface = canvas(width * TILE, height * TILE)
  const ctx = surface.getContext('2d')!
  for (let local = 0; local < width * height; local++) {
    const col = local % width
    const row = Math.floor(local / width)
    const i = (startY + row) * ashford.width + startX + col
    const tile = ashford.tiles[i]
    const x = col * TILE
    const y = row * TILE
    const rand = randomAt(i * 17 + 113)
    ctx.fillStyle = terrainColor[tile]
    ctx.fillRect(x, y, TILE, TILE)
    if (tile === 'bridge') {
      for (let dy = 2; dy < 32; dy += 5) {
        ctx.fillStyle = dy % 2 ? '#785639' : '#af8758'
        ctx.fillRect(x, y + dy, TILE, 2)
      }
    }
    for (let j = 0; j < 26; j++) {
      const px = x + Math.floor(rand() * TILE)
      const py = y + Math.floor(rand() * TILE)
      ctx.fillStyle = tile === 'water' ? '#91c1ad2b' : rand() > 0.5 ? '#d8d99119' : '#1117092e'
      ctx.fillRect(px, py, 1 + Math.floor(rand() * (tile === 'water' ? 7 : 4)), 1 + Math.floor(rand() * 2))
    }
    if (tile === 'grass' && rand() < 0.32) {
      ctx.fillStyle = rand() < 0.88 ? '#a0a754' : '#cfb181'
      ctx.fillRect(x + 7, y + 10, 2, 3)
      ctx.fillRect(x + 5, y + 12, 2, 1)
      ctx.fillStyle = '#334824'
      ctx.fillRect(x + 7, y + 13, 1, 3)
    }
  }
  return surface
}

type Brush = {
  rect: (color: string, x: number, y: number, w: number, h: number) => void
  poly: (color: string, ...points: number[]) => void
  shadow: (x: number, y: number, rx: number, ry: number) => void
}

function brush(surface: HTMLCanvasElement): Brush {
  const ctx = surface.getContext('2d')!
  return {
    rect(color, x, y, w, h) {
      ctx.fillStyle = color
      ctx.fillRect(x, y, w, h)
    },
    poly(color, ...points) {
      ctx.fillStyle = color
      // Flat colors and a one-pixel grid keep texture silhouettes sharp when enlarged.
      ctx.beginPath()
      ctx.moveTo(points[0], points[1])
      for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1])
      ctx.closePath()
      ctx.fill()
    },
    shadow(x, y, rx, ry) {
      ctx.fillStyle = '#11170a80'
      ctx.beginPath()
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

export function propTexture(tile: 'forest' | 'rock' | 'mine' | 'quarry', variant: number) {
  const surface = canvas(34, 36)
  const { rect, poly, shadow } = brush(surface)
  shadow(18, 30, 15, 4)
  if (tile === 'forest') {
    const lean = variant - 1
    rect('#513923', 15, 15, 5, 15)
    rect('#8f683b', 15, 20, 2, 10)
    for (let i = 0; i < 3; i++) {
      const w = 13 - i * 3
      const y = 25 - i * 6
      poly('#1c3220', 17 + lean, y - 16, 17 + w, y, 20, y + 3, 17 - w, y + 1)
      poly(i % 2 ? '#45623a' : '#365530', 17 + lean, y - 16, 16, y - 1, 17 - w, y + 1)
      poly('#567345', 17 + lean, y - 13, 13, y - 2, 8 + i, y - 1)
    }
  } else {
    poly('#30332e', 2, 27, 5, 16, 11, 9, 21, 6, 29, 14, 32, 27, 23, 31, 8, 30)
    poly('#91918a', 6, 23, 10, 13, 21, 7, 25, 16, 18, 21)
    poly('#777a71', 3, 27, 7, 21, 18, 18, 23, 28, 12, 30)
    poly('#565a55', 21, 7, 30, 16, 32, 27, 23, 30, 18, 20)
    if (tile === 'quarry') {
      poly('#c6c9c4', 1, 28, 6, 19, 13, 17, 18, 25, 13, 31)
      poly('#a5adb1', 18, 27, 22, 16, 29, 18, 33, 27, 28, 32)
      rect('#e1e2ca', 6, 21, 5, 2)
      rect('#e1e2ca', 23, 19, 4, 2)
      rect('#95765b', 2, 8, 2, 17)
      rect('#d8cead', 2, 8, 10, 6)
      rect('#655d5e', 4, 10, 6, 2)
    }
    if (tile === 'mine') {
      rect('#724627', 11, 19, 14, 11)
      rect('#523520', 12, 15, 13, 5)
      rect('#191713', 15, 19, 7, 11)
      rect('#a57846', 12, 18, 2, 11)
      rect('#a57846', 23, 18, 2, 11)
      for (const [x, y] of [[9, 12], [24, 13], [8, 22], [26, 24]]) {
        rect('#b08243', x, y, 4, 3)
        rect('#f0ce77', x, y, 2, 1)
      }
    }
  }
  return surface
}

function fortress(faction: Faction) {
  const surface = canvas(56, 50)
  const { rect, poly, shadow } = brush(surface)
  const human = faction === 'human'
  shadow(29, 43, 25, 6)
  if (human) {
    poly('#242e38', 7, 19, 25, 11, 49, 16, 51, 40, 40, 47, 6, 45)
    poly('#929b9b', 9, 24, 37, 22, 37, 44, 8, 43)
    poly('#5d6870', 37, 22, 49, 17, 49, 39, 37, 44)
    poly('#b7b5a4', 8, 23, 24, 15, 49, 17, 36, 25)
    rect('#78818b', 19, 15, 17, 22)
    poly('#316096', 15, 16, 26, 3, 41, 16, 28, 21)
    poly('#527eb1', 15, 16, 26, 3, 27, 19)
    rect('#bec5c0', 5, 23, 10, 18)
    rect('#a4acab', 36, 23, 10, 19)
    for (const x of [5, 9, 13, 35, 39, 43]) rect('#d3cbbb', x, 20, 3, 5)
    for (const x of [8, 39]) {
      rect('#48525b', x, 27, 2, 5)
      rect('#d5ae64', x + 1, 31, 1, 2)
    }
    for (const [x, y] of [[8, 35], [13, 38], [16, 28], [25, 30], [31, 34], [41, 35], [44, 39]]) rect('#6d787d', x, y, 5, 1)
    poly('#45423b', 19, 44, 19, 37, 23, 33, 29, 34, 31, 44)
    rect('#745439', 22, 37, 6, 7)
    rect('#cfa66a', 29, 1, 1, 10)
    poly('#3970aa', 30, 1, 42, 2, 40, 5, 30, 6)
    rect('#c1ac62', 33, 2, 3, 2)
  } else {
    poly('#2e221e', 5, 27, 14, 14, 39, 13, 52, 25, 51, 44, 44, 47, 7, 44)
    poly('#724e38', 6, 28, 37, 25, 39, 44, 7, 44)
    poly('#483a2c', 38, 25, 51, 25, 49, 43, 39, 44)
    poly('#472827', 4, 27, 25, 7, 54, 25, 45, 33, 11, 32)
    poly('#963e32', 6, 26, 25, 8, 36, 30, 13, 31)
    poly('#b16043', 7, 25, 25, 8, 26, 15, 12, 29)
    poly('#6b302a', 25, 9, 53, 25, 44, 32, 37, 31)
    for (const x of [7, 13, 32, 39, 46]) {
      rect('#372c25', x, 31, 3, 14)
      rect('#917353', x, 34, 1, 10)
    }
    for (const x of [4, 47]) {
      poly('#ab9b77', x, 33, x - 1, 16, x + 7, 24, x + 4, 34)
      rect('#514c3f', x + 1, 29, 5, 3)
    }
    poly('#231c18', 17, 45, 18, 34, 24, 31, 31, 35, 32, 45)
    rect('#ca9b67', 23, 33, 4, 3)
    rect('#5a4030', 22, 38, 6, 7)
    rect('#98907e', 27, 2, 2, 12)
    poly('#bc513b', 29, 2, 44, 3, 39, 7, 29, 8)
    rect('#e0b87b', 33, 4, 3, 2)
  }
  return surface
}

function structureTexture(faction: Faction, kind: BuildingKind) {
  const surface = canvas(kind === 'wall' ? 23 : 41, kind === 'tower' ? 49 : 34)
  const { rect, poly, shadow } = brush(surface)
  const human = faction === 'human'
  const mid = human ? '#888f91' : '#835c38'
  const dark = human ? '#4c525d' : '#4a3028'
  const light = human ? '#c2c4b4' : '#bd9160'
  const accent = human ? '#467fbb' : '#a84633'
  if (kind === 'wall') {
    shadow(11, 27, 11, 3)
    rect(dark, 0, 14, 23, 13)
    rect(mid, 0, 12, 23, 13)
    for (const x of [0, 6, 12, 18]) {
      poly(light, x, 14, x, 9, x + 2, human ? 9 : 5, x + 5, 9, x + 5, 14)
      rect(dark, x + 4, 15, 1, human ? 3 : 9)
    }
    rect(dark, 0, 21, 23, 1)
    rect(light, 1, 19, 9, 1)
    return surface
  }
  if (kind === 'tower') {
    shadow(20, 43, 16, 4)
    rect(dark, 8, 19, 26, 24)
    rect(mid, 10, 17, 18, 23)
    rect(light, 11, 18, 3, 21)
    rect(dark, 5, 13, 30, 10)
    rect(mid, 6, 12, 28, 8)
    for (const x of [6, 17, 28]) {
      poly(light, x, 14, x, 9, x + 3, human ? 9 : 5, x + 7, 9, x + 7, 14)
    }
    rect('#28251e', 18, 24, 7, 7)
    rect('#f0b76e', 19, 24, 3, 2)
    rect(dark, 25, 1, 1, 13)
    poly(accent, 26, 1, 40, 2, 36, 6, 26, 7)
    return surface
  }
  if (kind === 'farm') {
    shadow(20, 30, 19, 4)
    rect('#695033', 1, 24, 38, 7)
    rect('#9d824c', 2, 25, 37, 2)
    rect('#b39154', 3, 16, 20, 12)
    poly(human ? '#d5ab57' : '#ae7950', 1, 17, 11, 6, 23, 12, 26, 18, 12, 21)
    rect('#67462c', 11, 21, 5, 7)
    rect(accent, 17, 19, 4, 3)
    for (const x of [25, 29, 33, 37]) {
      rect('#b28343', x, 20, 2, 8)
      rect('#d4ad62', x, 19, 3, 3)
    }
    if (!human) rect('#ca8f7f', 27, 23, 8, 4)
    return surface
  }
  if (kind === 'range') {
    shadow(20, 30, 19, 4)
    rect(dark, 1, 12, 24, 18)
    rect(mid, 2, 16, 21, 12)
    poly(accent, 0, 15, 6, 9, 25, 10, 23, 17)
    rect('#37281d', 11, 19, 7, 8)
    for (const [x, y] of [[26, 17], [31, 10]]) {
      rect('#69482e', x + 3, y + 6, 2, 9)
      rect('#c8ac7a', x, y, 8, 8)
      rect('#824c45', x + 1, y + 1, 6, 6)
      rect('#ede0a0', x + 3, y + 3, 2, 2)
    }
    return surface
  }
  if (kind === 'elite') {
    shadow(20, 30, 19, 4)
    if (!human) {
      poly('#43342d', 1, 28, 5, 11, 16, 5, 27, 7, 38, 19, 39, 30)
      poly('#76644a', 4, 25, 9, 10, 20, 7, 29, 14, 34, 28)
      poly('#2d2420', 13, 29, 15, 19, 23, 16, 28, 29)
      poly('#d6b98d', 8, 28, 6, 14, 13, 23, 14, 28)
      poly('#ccb389', 28, 30, 35, 15, 34, 28)
      rect(accent, 18, 10, 9, 3)
    } else {
      rect(dark, 1, 18, 38, 12)
      rect(mid, 4, 17, 33, 11)
      poly(accent, 1, 18, 11, 7, 31, 8, 39, 17, 25, 20)
      rect(light, 5, 18, 4, 10)
      rect(light, 30, 18, 4, 10)
      rect('#3b2b22', 11, 20, 7, 9)
      rect('#3b2b22', 21, 20, 7, 9)
      rect('#d4bd83', 17, 13, 5, 3)
    }
    return surface
  }
  shadow(20, 30, 19, 4)
  rect(dark, 3, 15, 35, 16)
  rect(mid, 4, 15, 26, 14)
  poly(accent, 1, 15, 14, 4, 35, 7, 39, 17, 27, 20)
  poly(human ? '#6c97bd' : '#cc7853', 2, 14, 14, 5, 29, 16, 14, 17)
  rect(light, 5, 18, 4, 10)
  rect(light, 27, 19, 3, 11)
  rect('#281d1b', 14, 21, 9, 9)
  rect(light, 14, 20, 9, 2)
  rect('#deae60', 31, 21, 3, 4)
  return surface
}

export function entityTexture(faction: Faction, kind: EntityKind, frame = 0) {
  if (kind === 'headquarters') return fortress(faction)
  if (isBuildingKind(kind)) return structureTexture(faction, kind)
  if (kind === 'heavy' && faction === 'orc') {
    const surface = canvas(33, 31)
    const { rect, poly, shadow } = brush(surface)
    const step = frame ? 2 : 0
    shadow(16, 27, 13, 4)
    rect('#422b23', 8, 22, 6, 7 - step)
    rect('#422b23', 18, 22, 6, 5 + step)
    poly('#44362b', 3, 22, 5, 12, 10, 7, 22, 7, 27, 14, 27, 24, 9, 25)
    poly('#af8d64', 4, 21, 6, 13, 11, 10, 23, 11, 25, 19, 22, 23, 7, 23)
    rect('#c5412c', 8, 19, 16, 4)
    rect('#bfa476', 14, 3, 9, 9)
    rect('#3d3226', 20, 6, 3, 1)
    rect('#ede0be', 21, 10, 3, 2)
    rect('#6a4831', 26, 8, 3, 14)
    poly('#664830', 24, 9, 24, 3, 29, 1, 32, 4, 31, 9)
    rect('#c1ab86', 27, 4, 4, 2)
    return surface
  }
  const surface = canvas(28, 29)
  const { rect, poly, shadow } = brush(surface)
  const human = faction === 'human'
  const light = human ? '#b2babe' : '#828664'
  const dark = human ? '#515969' : '#4c5036'
  const cloth = human ? '#4e8bca' : '#b64d3d'
  const skin = human ? '#d8a47a' : '#9aa75f'
  if (kind === 'worker') {
    const step = frame ? 2 : 0
    shadow(14, 25, 9, 3)
    rect('#31261e', 9, 19, 4, 6 - step)
    rect('#31261e', 16, 18, 4, 5 + step)
    rect(human ? '#927951' : '#6e5434', 8, 10, 13, 10)
    rect(cloth, 9, 14, 12, 4)
    rect(skin, 10, 4, 9, 8)
    rect(human ? '#806044' : '#39402d', 10, 3, 8, 3)
    rect('#f2d79e', 17, 9, 2, 1)
    rect('#8c6240', 22, 8, 2, 15)
    poly('#c2bb9f', 17, 7, 22, 4, 27, 7, 27, 9, 23, 7, 19, 9)
    return surface
  }
  const step = frame === 1 ? 2 : 0
  shadow(14, 25, kind === 'heavy' ? 12 : 8, 3)
  if (kind === 'heavy') {
    const flank = human ? '#8b7763' : '#716b65'
    poly('#2d2524', 2, 15, 6, 11, 18, 12, 22, 8, 27, 14, 24, 19, 20, 20, 21, 26, 18, 27, 16, 21, 9, 21, 8, 26, 4, 26)
    poly(flank, 3, 15, 8, 12, 18, 14, 23, 9, 26, 14, 23, 18, 18, 20, 8, 19)
    rect(dark, 5 + step, 20, 3, 5)
    rect(dark, 18 - step, 20, 3, 5)
    rect(cloth, 9, 14, 8, 6)
    rect('#211c18', 24, 12, 2, 1)
  } else {
    rect('#262320', 9, 20, 5, 6 - step)
    rect('#252420', 15, 19, 5, 5 + step)
    rect(dark, 10, 19, 3, 5 - step)
    rect(dark, 16, 19, 3, 4 + step)
  }
  const top = kind === 'heavy' ? 1 : 3
  poly('#282824', 8, top + 7, 11, top + 5, 18, top + 5, 22, top + 10, 20, top + 17, 9, top + 17, 6, top + 11)
  poly(dark, 9, top + 8, 13, top + 5, 19, top + 7, 20, top + 15, 10, top + 17)
  rect(cloth, 10, top + 9, 8, 6)
  rect(light, 8, top + 8, 5, 4)
  rect(light, 17, top + 8, 4, 4)
  rect(skin, 12, top + 3, 7, 5)
  if (human) {
    poly('#586477', 10, top + 5, 10, top + 2, 13, top, 17, top, 20, top + 3, 18, top + 6)
    rect('#bdc8ca', 12, top + 1, 5, 2)
    rect('#212930', 17, top + 4, 3, 1)
  } else {
    rect('#414b2e', 12, top, 7, 3)
    rect('#242c21', 16, top + 4, 2, 1)
    rect('#e4d1a2', 17, top + 6, 3, 1)
  }
  if (kind === 'polearm') {
    for (let i = 0; i < 17; i++) rect('#947049', 17 + Math.floor(i / 2), 25 - i, 2, 1)
    poly('#c2c9bd', 23, 10, 25, 3, 27, 7, 26, 12)
    if (!human) poly('#abb0a9', 25, 5, 29, 6, 29, 12, 26, 13)
  } else if (kind === 'marksman') {
    if (human) {
      rect('#a58151', 18, 13, 10, 3)
      poly('#bdc3bc', 19, 14, 22, 10, 25, 9, 23, 14, 25, 19, 22, 18)
    } else {
      rect('#986d45', 21, 8, 2, 13)
      poly('#b7bbb4', 18, 8, 23, 5, 28, 6, 27, 12, 23, 13)
    }
  } else if (kind === 'ranged') {
    if (human) {
      poly('#b38550', 21, 7, 24, 9, 26, 15, 25, 19, 23, 22, 22, 21, 24, 16, 23, 11)
      rect('#d6c29e', 22, 10, 1, 11)
    } else {
      for (let i = 0; i < 15; i++) rect('#906b43', 14 + Math.floor(i / 2), 23 - i, 2, 1)
      poly('#a8afa4', 20, 10, 23, 4, 25, 8, 22, 12)
    }
  } else {
    if (human) {
      poly('#b5c4c7', 21, 13, 25, 6, 26, 8, 23, 16)
      rect('#987546', 20, 14, 5, 2)
      if (kind === 'blade') {
        poly('#1d3754', 5, 13, 12, 13, 12, 19, 8, 23, 4, 19)
        poly('#6395c4', 5, 14, 11, 14, 10, 19, 8, 21, 6, 19)
        rect('#d2c79c', 7, 16, 2, 3)
      }
    } else {
      rect('#79523a', 22, 10, 2, 12)
      poly('#3a3b37', 20, 10, 22, 7, 27, 7, 27, 14, 23, 14)
      rect('#adb2a5', 25, 8, 2, 5)
    }
  }
  return surface
}
