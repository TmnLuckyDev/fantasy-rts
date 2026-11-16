import { TILE, distance, snapToCell, tileAt } from './map.ts'
import type { BattleMap } from './map.ts'
import { heroKinds, isUnitKind, resourceKinds } from './protocol.ts'
import type { BuildingKind, Entity, EntityKind, Point, ResourceKind, Resources, UnitKind, UpgradeKind } from './protocol.ts'
import { unitStats } from './units.ts'

export const STARTING_RESOURCES: Readonly<Resources> = { gold: 300, wood: 180, stone: 120 }
export const GATHERING: Record<ResourceKind, { amount: number, ticks: number }> = {
  gold: { amount: 30, ticks: 24 },
  wood: { amount: 35, ticks: 20 },
  stone: { amount: 25, ticks: 28 }
}

export const BASE_POPULATION = 10
export const FARM_POPULATION = 10

export type Cost = Readonly<Partial<Resources>>

export const buildings: Record<BuildingKind, { cost: Cost, ticks: number }> = {
  barracks: { cost: { wood: 90, stone: 45 }, ticks: 140 },
  range: { cost: { wood: 100, stone: 40 }, ticks: 155 },
  elite: { cost: { wood: 135, stone: 100 }, ticks: 180 },
  farm: { cost: { wood: 70, stone: 20 }, ticks: 100 },
  wall: { cost: { stone: 28 }, ticks: 55 },
  tower: { cost: { wood: 55, stone: 85 }, ticks: 110 },
  smithy: { cost: { wood: 105, stone: 65 }, ticks: 150 }
}

export const REPAIR = { health: 20, ticks: 10 }
export const repairCost = (kind: EntityKind): Cost => kind === 'wall' ? { stone: 1 } : { wood: 1, stone: 1 }

export const upgrades: Record<UpgradeKind, { name: string, cost: Cost, ticks: number, bonus: number }> = {
  weapons: { name: 'Weapons +2 damage', cost: { gold: 170, wood: 45 }, ticks: 240, bonus: 2 },
  armor: { name: 'Armor +1 defense', cost: { gold: 130, stone: 60 }, ticks: 220, bonus: 1 }
}

export const training: Record<UnitKind, { gold: number, ticks: number, population: number }> = {
  worker: { gold: 60, ticks: 95, population: 1 },
  blade: { gold: 75, ticks: 95, population: 1 },
  polearm: { gold: 105, ticks: 120, population: 1 },
  ranged: { gold: 90, ticks: 120, population: 1 },
  marksman: { gold: 135, ticks: 145, population: 1 },
  heavy: { gold: 220, ticks: 180, population: 2 },
  vanguard: { gold: 225, ticks: 190, population: 1 },
  pathfinder: { gold: 225, ticks: 190, population: 1 }
}

const production: Partial<Record<EntityKind, readonly UnitKind[]>> = {
  headquarters: ['worker', ...heroKinds],
  barracks: ['blade', 'polearm'],
  range: ['ranged', 'marksman'],
  elite: ['heavy']
}

export const trainedAt = (building: EntityKind) => production[building] ?? []

export function canAfford(resources: Resources, cost: Cost) {
  return resourceKinds.every(kind => resources[kind] >= (cost[kind] ?? 0))
}

export function spend(resources: Resources, cost: Cost) {
  for (const kind of resourceKinds) resources[kind] -= cost[kind] ?? 0
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
