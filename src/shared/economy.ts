import { TILE, distance, snapToCell, tileAt } from './map.ts'
import type { BattleMap } from './map.ts'
import { isUnitKind } from './protocol.ts'
import type { BuildingKind, Entity, EntityKind, Point, UnitKind } from './protocol.ts'
import { unitStats } from './units.ts'

export const STARTING_GOLD = 300
export const GOLD_LOAD = 30
export const MINE_TICKS = 24
export const MAX_BUILDINGS = 48
export const MAX_MOBILE_UNITS = 24
export const TRAINING_QUEUE_LIMIT = 5

export const buildings: Record<BuildingKind, { gold: number, ticks: number }> = {
  barracks: { gold: 180, ticks: 140 },
  wall: { gold: 35, ticks: 55 },
  tower: { gold: 150, ticks: 110 }
}

export const training: Record<UnitKind, { gold: number, ticks: number }> = {
  worker: { gold: 60, ticks: 95 },
  blade: { gold: 75, ticks: 95 },
  ranged: { gold: 90, ticks: 120 },
  heavy: { gold: 145, ticks: 155 }
}

export function canTrain(building: EntityKind, unit: UnitKind) {
  return unit === 'worker' ? building === 'headquarters' : building === 'barracks'
}

export function validPlacement(map: BattleMap, kind: BuildingKind, position: Point, entities: Iterable<Entity>) {
  const point = snapToCell(position)
  const radius = unitStats.human[kind].radius
  const edge = radius - 0.01
  for (const dx of [-edge, 0, edge]) {
    for (const dy of [-edge, 0, edge]) {
      const tile = tileAt(map, Math.floor((point.x + dx) / TILE), Math.floor((point.y + dy) / TILE))
      if (tile !== 'grass' && tile !== 'road') return false
    }
  }
  for (const entity of entities) {
    const otherRadius = unitStats[entity.faction][entity.kind].radius
    if (distance(point, entity) < radius + otherRadius + (isUnitKind(entity.kind) ? 2 : -0.01)) return false
  }
  return true
}
