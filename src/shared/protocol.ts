import type { MatchReport, MatchSettings } from './match-settings.ts'
import type { MapId } from './map.ts'

export const factions = ['human', 'orc'] as const
export const difficulties = ['easy', 'normal', 'hard'] as const
export type Difficulty = typeof difficulties[number]
export type Faction = typeof factions[number]
export type Point = { x: number, y: number }
export const combatKinds = ['blade', 'polearm', 'ranged', 'marksman', 'heavy'] as const
export const heroKinds = ['vanguard', 'pathfinder'] as const
export type HeroKind = typeof heroKinds[number]
export const isHeroKind = (kind: unknown): kind is HeroKind => kind === 'vanguard' || kind === 'pathfinder'
export const unitKinds = [...combatKinds, ...heroKinds, 'scout', 'worker', 'transport', 'warship'] as const
export const buildingKinds = ['barracks', 'range', 'elite', 'farm', 'wall', 'tower', 'smithy', 'port'] as const
export const entityKinds = [...unitKinds, 'headquarters', ...buildingKinds] as const
export type UnitKind = typeof unitKinds[number]
export type BuildingKind = typeof buildingKinds[number]
export type EntityKind = typeof entityKinds[number]
export const isShipKind = (kind: unknown): kind is 'transport' | 'warship' => kind === 'transport' || kind === 'warship'
export const isUnitKind = (kind: unknown): kind is UnitKind => unitKinds.some(value => value === kind)
export const isBuildingKind = (kind: unknown): kind is BuildingKind => buildingKinds.some(value => value === kind)
export const troopGroups = ['all', ...combatKinds, 'scout', 'transport', 'warship', 'heroes'] as const
export type TroopGroup = typeof troopGroups[number]
export function inTroopGroup(kind: EntityKind, group: TroopGroup) {
  if (group === 'all') return isUnitKind(kind) && kind !== 'worker'
  return group === 'heroes' ? isHeroKind(kind) : group === kind
}
export const MAX_SELECTION = 1000
export const resourceKinds = ['gold', 'wood', 'stone'] as const
export type ResourceKind = typeof resourceKinds[number]
export type Resources = Record<ResourceKind, number>
export type Population = { used: number, reserved: number, limit: number }

export const factionNames: Record<Faction, string> = { human: 'Human Kingdoms', orc: 'Orcish Horde' }
export const entityNames: Record<Faction, Record<EntityKind, string>> = {
  human: {
    blade: 'Footman', polearm: 'Pikeman', ranged: 'Archer', marksman: 'Crossbowman', heavy: 'Knight',
    vanguard: 'Aldren the Warden', pathfinder: 'Nera the Pathfinder', scout: 'Scout', transport: 'Transport Ship', warship: 'Warship',
    headquarters: 'Town Hall', worker: 'Peasant', barracks: 'Barracks', range: 'Archery Range',
    elite: 'Stables', farm: 'Farm', wall: 'Stone Wall', tower: 'Guard Tower', smithy: 'Blacksmith', port: 'Harbor'
  },
  orc: {
    blade: 'Grunt', polearm: 'Cleaver', ranged: 'Spearman', marksman: 'Axe Thrower', heavy: 'Ogre',
    vanguard: 'Gorak Ironhand', pathfinder: 'Vesha Emberbow', scout: 'Scout', transport: 'Transport Ship', warship: 'Warship',
    headquarters: 'Great Hall', worker: 'Peon', barracks: 'War Barracks', range: 'Hunting Grounds',
    elite: 'Ogre Den', farm: 'Boar Farm', wall: 'Stone Rampart', tower: 'Watch Tower', smithy: 'War Forge', port: 'War Port'
  }
}

export const opposite = (faction: Faction): Faction => faction === 'human' ? 'orc' : 'human'
export const isFaction = (value: unknown): value is Faction => value === 'human' || value === 'orc'

export const upgradeKinds = ['weapons', 'armor', 'precision', 'vitality'] as const
export type UpgradeKind = typeof upgradeKinds[number]
export type Entity = Point & {
  id: number
  faction: Faction
  kind: EntityKind
  hp: number
  maxHp: number
  facing: -1 | 1
  moving: boolean
  construction?: number
  constructionStatus?: 'queued' | 'building' | 'paused'
  research?: { kind: UpgradeKind, progress: number }
  training?: { kind: UnitKind, progress: number, remaining: number, queue?: Array<{ kind: UnitKind, count: number }>, seconds?: number }
  experience?: number
  abilityReadyAt?: number
  abilityActiveUntil?: number
  repairing?: boolean
  carrying?: ResourceKind
  idle?: boolean
  embarkedOn?: number
  passengers?: number[]
  passengerPop?: number
  weaponLevel?: number
  armorLevel?: number
  precisionLevel?: number
  vitalityLevel?: number
  level?: number
  upgradeProgress?: number
}

export type Effect = {
  id: number
  kind: 'shot' | 'hit' | 'fallen'
  at: Point
  to?: Point
  faction: Faction
  entityKind: EntityKind
}

export type Player = { faction: Faction, connected: boolean, ready: boolean }
export type Result = { winner: Faction | null, reason: 'headquarters' | 'disconnect' | 'time' }
export type RoomState = {
  code: string
  map?: MapId
  mapSeed?: number
  settings?: MatchSettings
  host?: Faction
  report?: MatchReport
  mode: 'multiplayer' | 'solo'
  phase: 'lobby' | 'playing' | 'finished'
  players: Player[]
  result: Result | null
  paused?: boolean
}

export const formations = ['line', 'compact', 'spread'] as const
export type Formation = typeof formations[number]

export type Order =
  | { kind: 'move' | 'advance', to: Point, formation?: Formation }
  | { kind: 'attack', target: number, formation?: Formation }
  | { kind: 'halt' }
  | { kind: 'explore' }
  | { kind: 'hero-ability' }
  | { kind: 'board', transport: number }
  | { kind: 'unload' }
  | { kind: 'gather', at: Point }
  | { kind: 'build', building: BuildingKind, at: Point }
  | { kind: 'wall-line', from: Point, to: Point }
  | { kind: 'upgrade', upgrade: UpgradeKind }
  | { kind: 'structure-upgrade' }
  | { kind: 'resume-build', target: number }
  | { kind: 'repair', target: number }
  | { kind: 'train', unit: UnitKind, count?: number }
  | { kind: 'cancel-train', count: number }
  | { kind: 'cancel-build' }
  | { kind: 'demolish' }
  | { kind: 'dismiss' }

export type ArmyOrder = Extract<Order, { kind: 'move' | 'advance' | 'attack' | 'halt' }>
export const isArmyOrder = (order: Order): order is ArmyOrder =>
  order.kind === 'move' || order.kind === 'advance' || order.kind === 'attack' || order.kind === 'halt'

export type GlobalTrainCommand = { type: 'global-train', unit: UnitKind, count: number }

export type GroupCommand = { type: 'group-command', group: TroopGroup, order: ArmyOrder }

export type ClientMessage =
  | { type: 'create' | 'solo', faction: Faction, settings?: MatchSettings }
  | { type: 'join', code: string, faction: Faction }
  | { type: 'resume', code: string, token: string }
  | { type: 'leave' }
  | { type: 'faction', faction: Faction }
  | { type: 'settings', settings: MatchSettings }
  | { type: 'ready', ready: boolean }
  | GroupCommand
  | GlobalTrainCommand
  | { type: 'command', ids: number[], order: Order }

export type AttackAlert = { id: number, kind: 'base' | 'building' | 'workers' | 'army', at: Point, until: number }

export type DepositInfo = { index: number, remaining: number | null }
export type Snapshot = { type: 'snapshot', deposits?: DepositInfo[], tick: number, entities: Entity[], effects: Effect[], resources: Resources, population: Population, fog: string, upgrades?: UpgradeKind[], depleted?: number[], alerts?: AttackAlert[] }
export type ServerMessage =
  | { type: 'session', code: string, token: string, faction: Faction }
  | { type: 'room', room: RoomState, faction: Faction }
  | { type: 'error', message: string, resetSession?: boolean }
  | Snapshot
