import { mapIds, mapOptions } from './map.ts'
import type { MapId } from './map.ts'
import { STARTING_RESOURCES } from './economy.ts'
import { resourceKinds } from './protocol.ts'
import type { ResourceKind, Resources } from './protocol.ts'

export const TICKS_PER_SECOND = 20
export const ARMY_SCORE_PER_UNIT = 100
export const MAX_DEPOSITS = 24
export const STARTING_RESOURCE_MAX = 100_000
export const DEPOSIT_STOCK_MAX = 1_000_000
export const WORKER_LIMIT_MAX = 100
export const TIME_LIMIT_MAX_MINUTES = 720
export const MAX_POPULATION_CAP = 2000
export const DEFAULT_POPULATION_CAP = 500

type ResourceSettings = { count: number, stock: number | null, workers: number | null }
export type MatchSettings = {
  map: MapId
  randomStarts?: boolean
  sources: Record<ResourceKind, ResourceSettings>
  starting: Resources
  minutes: number | null
  populationCap: number
}

export type MatchStats = {
  gathered: Resources
  unitsTrained: number
  troopsTrained: number
  buildingsBuilt: number
  buildingsRazed: number
  enemiesKilled: number
  unitsLost: number
  buildingsLost: number
}
export type FinalStats = MatchStats & { bank: Resources, army: number, score: number }
export type MatchReport = { elapsedSeconds: number, sides: Record<'human' | 'orc', FinalStats> }

export const treeLimit = (map: MapId) => mapOptions.find(option => option.id === map)!.trees

export function defaultMatchSettings(map: MapId = 'ashford-expanded'): MatchSettings {
  const deposits = mapOptions.find(option => option.id === map)!.deposits
  return {
    map,
    randomStarts: true,
    sources: {
      gold: { count: deposits, stock: null, workers: null },
      stone: { count: deposits, stock: null, workers: null },
      wood: { count: treeLimit(map), stock: null, workers: null }
    },
    starting: { ...STARTING_RESOURCES },
    minutes: null,
    populationCap: DEFAULT_POPULATION_CAP
  }
}

export function emptyMatchStats(): MatchStats {
  return { gathered: { gold: 0, wood: 0, stone: 0 }, unitsTrained: 0, troopsTrained: 0, buildingsBuilt: 0,
    buildingsRazed: 0, enemiesKilled: 0, unitsLost: 0, buildingsLost: 0 }
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const bounded = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max

export function parseMatchSettings(value: unknown): MatchSettings | null {
  const { map, randomStarts, sources, starting, minutes, populationCap } = record(value)
  const selected = mapIds.find(id => id === map)
  if (!selected || (randomStarts !== undefined && typeof randomStarts !== 'boolean')) return null
  if (minutes !== null && !bounded(minutes, 1, TIME_LIMIT_MAX_MINUTES)) return null
  const validated = defaultMatchSettings(selected)
  validated.randomStarts = randomStarts ?? true
  validated.minutes = minutes
  if (populationCap !== undefined && !bounded(populationCap, 10, MAX_POPULATION_CAP)) return null
  validated.populationCap = populationCap ?? DEFAULT_POPULATION_CAP
  for (const resource of resourceKinds) {
    const { count, stock, workers } = record(record(sources)[resource])
    const initial = record(starting)[resource]
    if (!bounded(count, 0, resource === 'wood' ? treeLimit(selected) : MAX_DEPOSITS) ||
        (stock !== null && !bounded(stock, 1, DEPOSIT_STOCK_MAX)) ||
        (workers !== null && !bounded(workers, 1, WORKER_LIMIT_MAX)) ||
        !bounded(initial, 0, STARTING_RESOURCE_MAX)) return null
    validated.sources[resource] = { count, stock, workers }
    validated.starting[resource] = initial
  }
  return validated
}
