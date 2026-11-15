export const factions = ['human', 'orc'] as const
export const difficulties = ['easy', 'normal', 'hard'] as const
export type Difficulty = typeof difficulties[number]
export type Faction = typeof factions[number]
export type Point = { x: number, y: number }
export const combatKinds = ['blade', 'polearm', 'ranged', 'marksman', 'heavy'] as const
export const unitKinds = [...combatKinds, 'worker'] as const
export const buildingKinds = ['barracks', 'range', 'elite', 'farm', 'wall', 'tower', 'smithy'] as const
export const entityKinds = [...unitKinds, 'headquarters', ...buildingKinds] as const
export type UnitKind = typeof unitKinds[number]
export type BuildingKind = typeof buildingKinds[number]
export type EntityKind = typeof entityKinds[number]
export const isUnitKind = (kind: unknown): kind is UnitKind => unitKinds.some(value => value === kind)
export const isBuildingKind = (kind: unknown): kind is BuildingKind => buildingKinds.some(value => value === kind)
export const MAX_SELECTION = 512
export const resourceKinds = ['gold', 'wood', 'stone'] as const
export type ResourceKind = typeof resourceKinds[number]
export type Resources = Record<ResourceKind, number>
export type Population = { used: number, reserved: number, limit: number }

export const factionNames: Record<Faction, string> = { human: 'Human Kingdoms', orc: 'Orcish Horde' }
export const entityNames: Record<Faction, Record<EntityKind, string>> = {
  human: {
    blade: 'Footman', polearm: 'Pikeman', ranged: 'Archer', marksman: 'Crossbowman', heavy: 'Knight',
    headquarters: 'Town Hall', worker: 'Peasant', barracks: 'Barracks', range: 'Archery Range',
    elite: 'Stables', farm: 'Farm', wall: 'Stone Wall', tower: 'Guard Tower', smithy: 'Blacksmith'
  },
  orc: {
    blade: 'Grunt', polearm: 'Cleaver', ranged: 'Spearman', marksman: 'Axe Thrower', heavy: 'Ogre',
    headquarters: 'Great Hall', worker: 'Peon', barracks: 'War Barracks', range: 'Hunting Grounds',
    elite: 'Ogre Den', farm: 'Boar Farm', wall: 'Stone Rampart', tower: 'Watch Tower', smithy: 'War Forge'
  }
}

export const opposite = (faction: Faction): Faction => faction === 'human' ? 'orc' : 'human'
export const isFaction = (value: unknown): value is Faction => value === 'human' || value === 'orc'

export const upgradeKinds = ['weapons', 'armor'] as const
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
  repairing?: boolean
  carrying?: ResourceKind
  idle?: boolean
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
export type Result = { winner: Faction | null, reason: 'headquarters' | 'disconnect' }
export type RoomState = {
  code: string
  mode: 'multiplayer' | 'solo'
  phase: 'lobby' | 'playing' | 'finished'
  players: Player[]
  result: Result | null
  paused?: boolean
}

export type Order =
  | { kind: 'move' | 'advance', to: Point }
  | { kind: 'attack', target: number }
  | { kind: 'halt' }
  | { kind: 'gather', at: Point }
  | { kind: 'build', building: BuildingKind, at: Point }
  | { kind: 'wall-line', from: Point, to: Point }
  | { kind: 'upgrade', upgrade: UpgradeKind }
  | { kind: 'resume-build', target: number }
  | { kind: 'repair', target: number }
  | { kind: 'train', unit: UnitKind, count?: number }
  | { kind: 'cancel-train', count: number }
  | { kind: 'cancel-build' }
  | { kind: 'demolish' }

export type ClientMessage =
  | { type: 'create' | 'solo', faction: Faction }
  | { type: 'join', code: string, faction: Faction }
  | { type: 'resume', code: string, token: string }
  | { type: 'leave' }
  | { type: 'faction', faction: Faction }
  | { type: 'ready', ready: boolean }
  | { type: 'command', ids: number[], order: Order }

export type Snapshot = { type: 'snapshot', tick: number, entities: Entity[], effects: Effect[], resources: Resources, population: Population, fog: string, upgrades?: UpgradeKind[] }
export type ServerMessage =
  | { type: 'session', code: string, token: string, faction: Faction }
  | { type: 'room', room: RoomState, faction: Faction }
  | { type: 'error', message: string, resetSession?: boolean }
  | Snapshot
