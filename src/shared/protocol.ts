import type { MatchReport, MatchSettings } from './match-settings.ts'
import type { MapId } from './map.ts'

export const factions = ['human', 'orc'] as const
export const difficulties = ['easy', 'normal', 'hard'] as const
export type Difficulty = typeof difficulties[number]
// Wire/save identifiers for the two seats. Race is an independent lobby choice.
export type PlayerId = typeof factions[number]
export type Faction = PlayerId
export const races = ['human', 'orc', 'dwarf', 'elf', 'undead'] as const
export type Race = typeof races[number]
export type PlayerRaces = Record<PlayerId, Race>
export const defaultRaces: PlayerRaces = { human: 'human', orc: 'orc' }
export const isRace = (value: unknown): value is Race => races.some(race => race === value)
export const soloRaces = (race: Race, opponent?: Race): PlayerRaces => race === 'orc'
  ? { human: opponent ?? 'human', orc: race } : { human: race, orc: opponent ?? 'orc' }
export const raceOf = (entity: { race?: Race, faction: PlayerId }): Race => entity.race ?? entity.faction
export type Point = { x: number, y: number }
export const combatKinds = ['blade', 'polearm', 'ranged', 'marksman', 'heavy'] as const
export const heroKinds = ['vanguard', 'pathfinder'] as const
export type HeroKind = typeof heroKinds[number]
export const isHeroKind = (kind: unknown): kind is HeroKind => kind === 'vanguard' || kind === 'pathfinder'
export const unitKinds = [...combatKinds, ...heroKinds, 'siege', 'support', 'scout', 'worker', 'transport', 'warship'] as const
export const buildingKinds = ['barracks', 'range', 'elite', 'farm', 'wall', 'tower', 'smithy', 'port'] as const
export const entityKinds = [...unitKinds, 'headquarters', ...buildingKinds] as const
export type UnitKind = typeof unitKinds[number]
export type BuildingKind = typeof buildingKinds[number]
export type EntityKind = typeof entityKinds[number]
export const isShipKind = (kind: unknown): kind is 'transport' | 'warship' => kind === 'transport' || kind === 'warship'
export const isUnitKind = (kind: unknown): kind is UnitKind => unitKinds.some(value => value === kind)
export const isBuildingKind = (kind: unknown): kind is BuildingKind => buildingKinds.some(value => value === kind)
export const troopGroups = ['all', ...combatKinds, 'siege', 'support', 'scout', 'transport', 'warship', 'heroes'] as const
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

export const factionNames: Record<Race, string> = { human: 'Human Kingdoms', orc: 'Orcish Horde', dwarf: 'Ironbound Clans', elf: 'Sylvan Covenant', undead: 'Hollow Legion' }
export const entityNames: Record<Race, Record<EntityKind, string>> = {
  human: {
    siege: 'Siege Engine', support: 'Support', blade: 'Footman', polearm: 'Pikeman', ranged: 'Archer', marksman: 'Crossbowman', heavy: 'Knight',
    vanguard: 'Aldren the Warden', pathfinder: 'Nera the Pathfinder', scout: 'Scout', transport: 'Transport Ship', warship: 'Warship',
    headquarters: 'Town Hall', worker: 'Peasant', barracks: 'Barracks', range: 'Archery Range',
    elite: 'Stables', farm: 'Farm', wall: 'Stone Wall', tower: 'Guard Tower', smithy: 'Blacksmith', port: 'Harbor'
  },
  orc: {
    siege: 'Siege Engine', support: 'Support', blade: 'Grunt', polearm: 'Cleaver', ranged: 'Spearman', marksman: 'Axe Thrower', heavy: 'Ogre',
    vanguard: 'Gorak Ironhand', pathfinder: 'Vesha Emberbow', scout: 'Scout', transport: 'Transport Ship', warship: 'Warship',
    headquarters: 'Great Hall', worker: 'Peon', barracks: 'War Barracks', range: 'Hunting Grounds',
    elite: 'Ogre Den', farm: 'Boar Farm', wall: 'Stone Rampart', tower: 'Watch Tower', smithy: 'War Forge', port: 'War Port'
  },
  dwarf: {
    blade: 'Ironbreaker', polearm: 'Hammerguard', ranged: 'Thunderer', marksman: 'Runebolt Gunner', heavy: 'Stoneguard',
    siege: 'Siege Cannon', support: 'Support', scout: 'Tunnel Pathfinder', worker: 'Delver',
    vanguard: 'Thorin Stoneheart', pathfinder: 'Bromm Thunderforge', headquarters: 'Mountain Hall',
    barracks: 'Iron Barracks', range: 'Powder Hall', elite: 'Foundry', farm: 'Deep Mine', wall: 'Runestone Wall',
    tower: 'Stone Bastion', smithy: 'Rune Forge', port: 'Iron Dock', transport: 'Armored Ferry', warship: 'Iron Warship'
  },
  elf: {
    blade: 'Bladedancer', polearm: 'Thorn Guard', ranged: 'Sylvan Archer', marksman: 'Forest Sentinel', heavy: 'Grove Warden',
    siege: 'Siege Engine', support: 'Druid', scout: 'Woodland Scout', worker: 'Grove Tender',
    vanguard: 'Faelar Swiftwind', pathfinder: 'Aelindra Moonwhisper', headquarters: 'Ancient Grove',
    barracks: 'Blade Circle', range: 'Ranger Lodge', elite: 'Moon Sanctuary', farm: 'Sacred Tree', wall: 'Briar Wall',
    tower: 'Living Watchtower', smithy: 'Leafweave Atelier', port: 'Willow Harbor', transport: 'Leaf Ferry', warship: 'Grove Warship'
  },
  undead: {
    blade: 'Skeleton Warrior', polearm: 'Ghoul', ranged: 'Bone Archer', marksman: 'Grave Marksman', heavy: 'Abomination',
    siege: 'Siege Engine', support: 'Necromancer', scout: 'Grave Wisp', worker: 'Thrall',
    vanguard: 'Vorrak the Deathlord', pathfinder: 'Malachar the Lich', headquarters: 'Necropolis',
    barracks: 'Crypt', range: 'Bone Arsenal', elite: 'Fleshworks', farm: 'Graveyard', wall: 'Ossuary Wall',
    tower: 'Bone Spire', smithy: 'Dark Sanctum', port: 'Drowned Pier', transport: 'Soul Barge', warship: 'Dread Warship'
  }
}

export const opposite = (faction: Faction): Faction => faction === 'human' ? 'orc' : 'human'
export const isFaction = (value: unknown): value is Faction => value === 'human' || value === 'orc'

export const upgradeKinds = ['weapons', 'armor', 'precision', 'vitality', 'range', 'speed', 'fortress'] as const
export type UpgradeKind = typeof upgradeKinds[number]
export type Entity = Point & {
  id: number
  faction: Faction
  race?: Race
  rally?: Point
  concealed?: boolean
  summonedUntil?: number
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
  rangeLevel?: number
  speedLevel?: number
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

export type Player = { faction: Faction, race?: Race, connected: boolean, ready: boolean }
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
  | { kind: 'rally', to: Point }
  | { kind: 'move' | 'advance', to: Point, formation?: Formation }
  | { kind: 'attack', target: number, formation?: Formation }
  | { kind: 'halt' }
  | { kind: 'explore' }
  | { kind: 'hero-ability' | 'unit-ability' }
  | { kind: 'board', transport: number }
  | { kind: 'unload' }
  | { kind: 'gather', at: Point }
  | { kind: 'build', building: BuildingKind, at: Point }
  | { kind: 'wall-line', from: Point, to: Point }
  | { kind: 'upgrade', upgrade: UpgradeKind }
  | { kind: 'structure-upgrade' }
  | { kind: 'bulk-structure-upgrade', building: 'wall' | 'tower' }
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
  | { type: 'create' | 'solo', faction?: Faction, race?: Race, opponentRace?: Race, settings?: MatchSettings }
  | { type: 'join', code: string, faction?: Faction, race?: Race }
  | { type: 'resume', code: string, token: string }
  | { type: 'leave' }
  | { type: 'faction', faction: Faction }
  | { type: 'race', race: Race }
  | { type: 'settings', settings: MatchSettings }
  | { type: 'ready', ready: boolean }
  | GroupCommand
  | GlobalTrainCommand
  | { type: 'command', ids: number[], order: Order }

export type AttackAlert = { id: number, kind: 'base' | 'building' | 'workers' | 'army', at: Point, until: number }

export type DepositInfo = { index: number, remaining: number | null }
export type Corpse = Point & { id: number, expiresAt: number }

export type Snapshot = { corpses?: Corpse[], type: 'snapshot', deposits?: DepositInfo[], tick: number, entities: Entity[], effects: Effect[], resources: Resources, population: Population, fog: string, upgrades?: UpgradeKind[], depleted?: number[], alerts?: AttackAlert[] }
export type ServerMessage =
  | { type: 'session', code: string, token: string, faction: Faction }
  | { type: 'room', room: RoomState, faction: Faction }
  | { type: 'error', message: string, resetSession?: boolean }
  | Snapshot
