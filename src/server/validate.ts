import { MAX_SELECTION, isBuildingKind, isFaction, isUnitKind } from '../shared/protocol.ts'
import type { ClientMessage, Order } from '../shared/protocol.ts'

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const validCode = (value: unknown): value is string => typeof value === 'string' && /^[A-Z2-9]{5}$/.test(value)
const validId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const coordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export function parseMessage(raw: string): ClientMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!object(value)) return null
  const { type, faction, code, token, ready, ids, order } = value
  switch (type) {
    case 'create':
    case 'faction':
      return isFaction(faction) ? { type, faction } : null
    case 'join':
      return validCode(code) && isFaction(faction) ? { type, code, faction } : null
    case 'resume':
      return validCode(code) && typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? { type, code, token } : null
    case 'ready':
      return typeof ready === 'boolean' ? { type, ready } : null
    case 'leave':
      return { type }
    case 'command': {
      if (!Array.isArray(ids) || !ids.length || ids.length > MAX_SELECTION || !ids.every(validId) || !object(order)) return null
      const parsed = parseOrder(order)
      return parsed ? { type, ids, order: parsed } : null
    }
    default:
      return null
  }
}

function parseOrder(order: Record<string, unknown>): Order | null {
  if (order.kind === 'halt') return { kind: 'halt' }
  if (order.kind === 'attack' && validId(order.target)) return { kind: 'attack', target: order.target }
  if ((order.kind === 'move' || order.kind === 'advance') && object(order.to) &&
      coordinate(order.to.x) && coordinate(order.to.y)) {
    return { kind: order.kind, to: { x: order.to.x, y: order.to.y } }
  }
  if (order.kind === 'gather' && object(order.at) &&
      coordinate(order.at.x) && coordinate(order.at.y)) {
    return { kind: 'gather', at: { x: order.at.x, y: order.at.y } }
  }
  if (order.kind === 'build' && isBuildingKind(order.building) && object(order.at) &&
      coordinate(order.at.x) && coordinate(order.at.y)) {
    return { kind: 'build', building: order.building, at: { x: order.at.x, y: order.at.y } }
  }
  if (order.kind === 'resume-build' && validId(order.target)) return { kind: 'resume-build', target: order.target }
  if (order.kind === 'train' && isUnitKind(order.unit)) return { kind: 'train', unit: order.unit }
  return null
}
