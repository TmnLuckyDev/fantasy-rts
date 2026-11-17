import { parseMatchSettings } from '../shared/match-settings.ts'
import { MAX_SELECTION, formations, isArmyOrder, isBuildingKind, isFaction, isRace, isUnitKind, troopGroups, upgradeKinds } from '../shared/protocol.ts'
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
    case 'solo': {
      const choice = isRace(value.race) ? { race: value.race } : isFaction(faction) && value.race === undefined ? { faction } : null
      if (!choice || (value.opponentRace !== undefined && (type !== 'solo' || !isRace(value.opponentRace)))) return null
      const player = { ...choice, ...(isRace(value.opponentRace) ? { opponentRace: value.opponentRace } : {}) }
      if (value.settings === undefined) return { type, ...player }
      const settings = parseMatchSettings(value.settings)
      return settings ? { type, ...player, settings } : null
    }
    case 'settings': {
      const settings = parseMatchSettings(value.settings)
      return settings ? { type, settings } : null
    }
    case 'faction':
      return isFaction(faction) ? { type, faction } : null
    case 'race':
      return isRace(value.race) ? { type, race: value.race } : null
    case 'join':
      if (!validCode(code)) return null
      if (isRace(value.race)) return { type, code, race: value.race }
      return value.race === undefined && isFaction(faction) ? { type, code, faction } : null
    case 'resume':
      return validCode(code) && typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? { type, code, token } : null
    case 'ready':
      return typeof ready === 'boolean' ? { type, ready } : null
    case 'leave':
      return { type }
    case 'global-train':
      return isUnitKind(value.unit) && validId(value.count) ? { type, unit: value.unit, count: value.count } : null
    case 'group-command': {
      const group = troopGroups.find(group => group === value.group)
      const parsed = object(order) && parseOrder(order)
      return group && parsed && isArmyOrder(parsed) ? { type, group, order: parsed } : null
    }
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
  if (order.kind === 'halt' || order.kind === 'build-queue' || order.kind === 'explore' || order.kind === 'unit-ability' || order.kind === 'hero-ability' || order.kind === 'structure-upgrade' || order.kind === 'dismiss') return { kind: order.kind }
  const formation = formations.find(kind => kind === order.formation)
  if (order.formation !== undefined && !formation) return null
  const options = formation ? { formation } : {}
  if (order.kind === 'rally' && object(order.to) && coordinate(order.to.x) && coordinate(order.to.y)) {
    return { kind: 'rally', to: { x: order.to.x, y: order.to.y } }
  }
  if (order.kind === 'bulk-structure-upgrade' && (order.building === 'wall' || order.building === 'tower')) return { kind: 'bulk-structure-upgrade', building: order.building }
  if (order.kind === 'unload') {
    if (order.at === undefined) return { kind: 'unload' }
    if (object(order.at) && coordinate(order.at.x) && coordinate(order.at.y)) return { kind: 'unload', at: { x: order.at.x, y: order.at.y } }
    return null
  }
  if (order.kind === 'board' && (order.transport === undefined || validId(order.transport))) return { kind: 'board', transport: order.transport }
  if (order.kind === 'attack' && validId(order.target)) return { kind: 'attack', target: order.target, ...options }
  if ((order.kind === 'move' || order.kind === 'advance') && object(order.to) &&
      coordinate(order.to.x) && coordinate(order.to.y)) {
    return { kind: order.kind, to: { x: order.to.x, y: order.to.y }, ...options }
  }
  if (order.kind === 'gather' && object(order.at) &&
      coordinate(order.at.x) && coordinate(order.at.y)) {
    return { kind: 'gather', at: { x: order.at.x, y: order.at.y } }
  }
  if (order.kind === 'build' && isBuildingKind(order.building) && object(order.at) &&
      coordinate(order.at.x) && coordinate(order.at.y)) {
    return { kind: 'build', building: order.building, at: { x: order.at.x, y: order.at.y } }
  }
  if (order.kind === 'wall-line' && object(order.from) && object(order.to) &&
      coordinate(order.from.x) && coordinate(order.from.y) && coordinate(order.to.x) && coordinate(order.to.y)) {
    return { kind: 'wall-line', from: { x: order.from.x, y: order.from.y }, to: { x: order.to.x, y: order.to.y } }
  }
  if (order.kind === 'upgrade') {
    const upgrade = upgradeKinds.find(kind => kind === order.upgrade)
    if (upgrade) return { kind: 'upgrade', upgrade }
  }
  if ((order.kind === 'resume-build' || order.kind === 'repair') && validId(order.target)) return { kind: order.kind, target: order.target }
  if (order.kind === 'train' && isUnitKind(order.unit) && (order.count === undefined || validId(order.count))) {
    return { kind: 'train', unit: order.unit, count: order.count }
  }
  if (order.kind === 'cancel-train' && validId(order.count)) return { kind: order.kind, count: order.count }
  if (order.kind === 'cancel-build' || order.kind === 'demolish') return { kind: order.kind }
  return null
}
