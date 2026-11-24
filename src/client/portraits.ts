import type { EntityKind, Race } from '../shared/protocol.ts'
import { entityTexture } from './sprites.ts'

export function paintPortrait(target: HTMLCanvasElement, side: Race, kind: EntityKind) {
  const key = side + kind
  if (target.dataset.sprite === key) return
  target.dataset.sprite = key
  const sprite = entityTexture(side, kind)
  const ctx = target.getContext('2d')!
  const scale = Math.min(target.width / sprite.width, target.height / sprite.height)
  const width = Math.floor(sprite.width * scale)
  const height = Math.floor(sprite.height * scale)
  ctx.clearRect(0, 0, target.width, target.height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sprite, Math.floor((target.width - width) / 2), Math.floor((target.height - height) / 2), width, height)
}
