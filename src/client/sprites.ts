import type { EntityKind, Faction, UnitKind, BuildingKind } from '../shared/protocol.ts'
import { isUnitKind } from '../shared/protocol.ts'
import { brush, canvas } from './voxel.ts'
import type { Faces } from './voxel.ts'

const cobalt: Faces = ['#79cbfa', '#387fc8', '#254d91']
const vermilion: Faces = ['#ff9a6a', '#cc5340', '#883832']
const sandstone: Faces = ['#fff3c8', '#d8c6a3', '#a09481']
const marble: Faces = ['#ebf2d8', '#b3c6be', '#788e99']
const steel: Faces = ['#f3f9dc', '#9fbac3', '#5c758f']
const iron: Faces = ['#9a9b7e', '#596160', '#3d464f']
const oak: Faces = ['#dcab6e', '#a36f4a', '#6b4a3a']
const timber: Faces = ['#a88058', '#765340', '#50352e']
const brass: Faces = ['#ffe797', '#e3aa57', '#a77642']
const thatch: Faces = ['#ffe09b', '#d1a760', '#a27b4f']
const green: Faces = ['#bbd566', '#82a94f', '#587548']
const leather: Faces = ['#bd8c61', '#8c5e45', '#5b3d35']
const boot: Faces = ['#735c54', '#493d3e', '#2a2b34']
const bone: Faces = ['#fff5ce', '#d8c098', '#aa9075']

type Ink = ReturnType<typeof brush>

function masonry(ink: Ink, faces: Faces, x: number, y: number, w: number, h: number, d: number) {
  ink.block(faces, x, y, w, h, d)
  for (let row = 4; row < h; row += 5) {
    ink.rect(faces[2] + '8a', x + 1, y + row, w - 2, 1)
    for (let col = row % 2 ? 5 : 8; col < w - 3; col += 8) {
      ink.rect(faces[2] + '8a', x + col, y + row - 3, 1, 3)
    }
  }
}

function pitchedRoof(ink: Ink, color: Faces, x: number, y: number, w: number, depth: number, height: number) {
  const ridge = x + Math.floor(w * 0.47)
  const rise = Math.round(depth * 0.6)
  ink.poly(color[0], x, y, ridge, y - height, ridge + depth, y - height - rise, x + depth, y - rise)
  ink.poly(color[2], ridge, y - height, ridge + depth, y - height - rise, x + w + depth, y - rise, x + w, y)
  ink.poly(color[1], x, y, ridge, y - height, x + w, y)
  ink.rect(color[2], x, y, w, 2)
  for (let dy = 4; dy < height; dy += 4) {
    const left = Math.ceil((ridge - x) * dy / height)
    const right = Math.ceil((x + w - ridge) * dy / height)
    ink.rect(color[0] + '93', x + left, y - dy, w - left - right, 1)
  }
}

function gate(ink: Ink, x: number, y: number, w: number, trim: Faces) {
  ink.rect('#303540', x, y - 12, w, 12)
  ink.rect('#303540', x + 2, y - 15, w - 4, 5)
  ink.rect('#644b3c', x + 2, y - 10, w - 4, 10)
  for (let col = 3; col < w - 1; col += 3) ink.rect('#98705b', x + col, y - 10, 1, 9)
  ink.rect(trim[0], x + 2, y - 15, w - 4, 2)
  ink.rect(trim[1], x + Math.floor(w / 2), y - 5, 1, 2)
}

function flag(ink: Ink, color: Faces, x: number, y: number) {
  ink.rect('#e8c98b', x, y, 1, 18)
  ink.poly(color[2], x + 1, y + 2, x + 17, y + 4, x + 13, y + 7, x + 16, y + 12, x + 1, y + 10)
  ink.poly(color[1], x + 1, y + 1, x + 15, y + 3, x + 12, y + 8, x + 1, y + 8)
  ink.rect(color[0], x + 2, y + 2, 9, 1)
  ink.rect('#ffe5a8', x + 5, y + 4, 3, 3)
}

function battlements(ink: Ink, face: Faces, x: number, y: number, w: number, orc: boolean) {
  ink.block(face, x, y, w, 6, 6)
  for (let col = 0; col < w - 3; col += 7) {
    const left = x + col
    if (orc) ink.poly(bone[0], left, y + 1, left + 2, y - 7, left + 5, y + 1)
    else ink.block(face, left, y - 4, 4, 6, 3)
  }
}

function headquarters(faction: Faction) {
  const surface = canvas(76, 64)
  const ink = brush(surface)
  const { rect, block, poly, shadow } = ink
  const human = faction === 'human'
  const team = human ? cobalt : vermilion
  const wall = human ? sandstone : timber
  const plinth = human ? marble : iron
  shadow(37, 53, 34, 8)
  block(plinth, 5, 49, 57, 7, 11)
  masonry(ink, wall, 19, 26, 31, 25, 13)
  if (human) pitchedRoof(ink, team, 16, 27, 37, 13, 15)
  else {
    pitchedRoof(ink, team, 15, 28, 39, 14, 14)
    block(iron, 29, 15, 11, 5, 9)
    poly(bone[0], 26, 18, 25, 7, 31, 15, 31, 19)
    poly(bone[1], 39, 16, 45, 6, 45, 16, 40, 21)
  }
  flag(ink, team, 40, 2)
  for (const x of [7, 51]) {
    masonry(ink, wall, x, 29, 12, 23, 6)
    battlements(ink, plinth, x - 2, 27, 16, !human)
    rect('#34404b', x + 4, 35, 3, 7)
    rect('#f4bb68', x + 4, 40, 2, 2)
  }
  gate(ink, 27, 51, 16, human ? brass : iron)
  for (const x of [19, 45]) {
    poly(team[1], x, 32, x + 7, 32, x + 7, 45, x + 4, 48, x, 45)
    rect(team[0], x + 1, 32, 1, 12)
    rect(bone[0], x + 2, 36, 3, 3)
  }
  if (!human) {
    poly(bone[0], 20, 51, 17, 38, 21, 43, 24, 52)
    poly(bone[1], 48, 51, 53, 38, 51, 51, 49, 53)
  }
  return surface
}

function structure(faction: Faction, kind: BuildingKind) {
  const human = faction === 'human'
  const team = human ? cobalt : vermilion
  const wall = human ? sandstone : timber
  const plinth = human ? marble : iron
  const tall = kind === 'tower'
  const base = tall ? 42 : 33
  const surface = canvas(46, tall ? 50 : 40)
  const ink = brush(surface)
  const { rect, block, poly, shadow } = ink
  shadow(23, base, tall ? 14 : 21, 5)
  if (kind === 'wall') {
    masonry(ink, plinth, 8, 23, 27, 10, 5)
    battlements(ink, human ? sandstone : iron, 8, 21, 27, !human)
    return surface
  }
  if (tall) {
    block(plinth, 10, 37, 22, 5, 5)
    masonry(ink, wall, 12, 18, 17, 20, 6)
    battlements(ink, plinth, 9, 16, 23, !human)
    rect('#303943', 18, 28, 4, 8)
    rect('#fcc36a', 19, 32, 2, 2)
    flag(ink, team, 24, 2)
    return surface
  }
  const width = kind === 'farm' || kind === 'range' ? 22 : 31
  block(plinth, 3, 31, width + 4, 4, 6)
  masonry(ink, wall, 5, 18, width, 13, 7)
  pitchedRoof(ink, kind === 'farm' ? thatch : team, 3, 20, width + 3, 8, kind === 'elite' ? 12 : 9)
  gate(ink, kind === 'elite' ? 10 : 11, 32, 11, brass)
  if (kind === 'farm') {
    block(timber, 27, 31, 10, 4, 4)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) rect(human ? '#f8d782' : '#e9a48e',
        28 + col * 4 + row, 25 + row * 3, 2, 3)
    }
  } else if (kind === 'range') {
    block(oak, 32, 26, 3, 7, 2)
    block(bone, 28, 20, 10, 8, 3)
    rect(vermilion[1], 30, 22, 6, 4)
    rect(bone[0], 32, 23, 2, 2)
  } else if (kind === 'elite') {
    if (human) gate(ink, 24, 32, 9, brass)
    else {
      poly(bone[0], 27, 32, 28, 19, 32, 25, 32, 32)
      poly(bone[1], 6, 33, 7, 22, 10, 28, 10, 33)
      rect(iron[2], 23, 24, 3, 5)
    }
  } else {
    rect(team[2], 25, 22, 6, 8)
    rect(team[0], 27, 24, 2, 3)
    block(brass, 29, 14, 4, 4, 3)
  }
  return surface
}

function troop(faction: Faction, kind: UnitKind, frame: number) {
  const surface = canvas(36, 35)
  const { rect, block, poly, shadow } = brush(surface)
  const human = faction === 'human'
  const team = human ? cobalt : vermilion
  const armor = human ? steel : iron
  const skin = human ? ['#ffd8a4', '#dfa476', '#a66b58'] as const : green
  const worker = kind === 'worker'
  const heavy = kind === 'heavy'
  const ranged = kind === 'ranged' || kind === 'marksman'
  const step = frame ? 2 : 0
  const head = heavy ? 7 : ranged || worker ? 10 : 8
  shadow(17, 29, heavy ? 14 : 11, 4)

  if (heavy && human) {
    block(boot, 6 + step, 24, 4, 6, 2)
    block(boot, 21 - step, 24, 4, 6, 2)
    block(leather, 5, 20, 19, 7, 5)
    block(team, 8, 20, 12, 6, 3)
    block(leather, 24, 16, 5, 8, 4)
    rect('#28313b', 27, 18, 2, 2)
  } else {
    block(boot, 10 - step, 23, heavy ? 6 : 4, 6, 2)
    block(boot, 19 + step, 22, heavy ? 6 : 4, 7 - step, 2)
  }
  const outfit = worker ? oak : ranged ? leather : armor
  block(team, 10, 16, heavy ? 13 : 10, 9, 3)
  block(outfit, heavy ? 7 : 9, 14, heavy ? 16 : 11, 6, 4)
  block(team, 12, 17, 8, 6, 2)
  rect(brass[1], 15, 20, 3, 2)
  block(heavy && !human ? green : outfit, 8, 15, 4, 5, 3)
  block(heavy && !human ? green : outfit, 21, 14, 4, 6, 3)
  block(skin, 12, head, heavy && !human ? 10 : 8, 7, 3)
  if (human) {
    block(worker ? thatch : ranged ? team : armor, 11, head, 9, 3, 4)
    rect('#263c4f', 17, head + 4, 4, 1)
    if (kind === 'polearm') rect(team[0], 13, head - 4, 4, 2)
    if (heavy) rect(team[1], 13, head - 5, 6, 3)
  } else {
    block(armor, 12, head, 9, 3, 3)
    rect('#304737', 17, head + 4, 3, 1)
    rect(bone[0], 19, head + 5, 2, 2)
    if (heavy) rect(bone[0], 12, head + 5, 2, 2)
  }

  if (worker) {
    rect(oak[1], 26, 12, 2, 15)
    poly(steel[0], 21, 11, 26, 7, 32, 10, 32, 13, 26, 10, 21, 14)
  } else if (kind === 'ranged' && human) {
    poly(brass[1], 25, 9, 30, 12, 32, 17, 31, 22, 27, 27, 25, 27, 29, 22, 30, 17, 28, 13)
    rect('#f3dfb5', 25, 11, 1, 15)
  } else if (kind === 'marksman' && human) {
    block(oak, 22, 16, 11, 3, 2)
    poly(steel[0], 25, 17, 28, 12, 31, 11, 29, 17, 31, 22, 28, 21)
  } else if (kind === 'polearm' || kind === 'ranged') {
    poly(oak[1], 21, 28, 20, 27, 30, 7, 32, 7)
    poly(steel[0], 28, 8, 32, 2, 34, 5, 32, 10)
    if (!human && kind === 'polearm') poly(iron[0], 30, 6, 33, 8, 33, 14, 29, 13)
  } else if (human) {
    poly(steel[0], 24, 18, 29, 7, 32, 6, 32, 10, 27, 20)
    rect(brass[1], 23, 17, 7, 2)
    poly(team[2], 5, 14, 13, 14, 14, 22, 10, 26, 5, 22)
    poly(team[0], 6, 15, 12, 15, 12, 21, 9, 24, 6, 21)
    rect(brass[0], 8, 17, 2, 4)
  } else {
    rect(oak[1], 26, 10, 2, 15)
    block(heavy ? timber : iron, 25, heavy ? 6 : 9, heavy ? 7 : 5, heavy ? 8 : 6, 3)
    rect(heavy ? brass[1] : steel[0], 29, heavy ? 7 : 10, 2, 4)
  }
  return surface
}

export function entityTexture(faction: Faction, kind: EntityKind, frame = 0) {
  if (isUnitKind(kind)) return troop(faction, kind, frame)
  return kind === 'headquarters' ? headquarters(faction) : structure(faction, kind)
}
