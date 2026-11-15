export const factions = ['human', 'orc'] as const
export type Faction = typeof factions[number]
export type Point = { x: number, y: number }
export const combatKinds = ['blade', 'ranged', 'heavy'] as const
export const unitKinds = [...combatKinds, 'worker'] as const
export const buildingKinds = ['barracks', 'wall', 'tower'] as const
export const entityKinds = [...unitKinds, 'headquarters', ...buildingKinds] as const
export type UnitKind = typeof unitKinds[number]
export type BuildingKind = typeof buildingKinds[number]
export type EntityKind = typeof entityKinds[number]
export const isUnitKind = (kind: unknown): kind is UnitKind => unitKinds.some(value => value === kind)
export const isBuildingKind = (kind: unknown): kind is BuildingKind => buildingKinds.some(value => value === kind)
export const MAX_SELECTION = 24

export const factionNames: Record<Faction, string> = { human: 'Human Kingdoms', orc: 'Orcish Horde' }
export const entityNames: Record<Faction, Record<EntityKind, string>> = {
  human: { blade: 'Footman', ranged: 'Archer', heavy: 'Knight', headquarters: 'Town Hall', worker: 'Peasant', barracks: 'Barracks', wall: 'Stone Wall', tower: 'Guard Tower' },
  orc: { blade: 'Grunt', ranged: 'Spearman', heavy: 'Raider', headquarters: 'Great Hall', worker: 'Peon', barracks: 'War Barracks', wall: 'Palisade', tower: 'Watch Tower' }
}

export const opposite = (faction: Faction): Faction => faction === 'human' ? 'orc' : 'human'
export const isFaction = (value: unknown): value is Faction => value === 'human' || value === 'orc'

export type Entity = Point & {
  id: number
  faction: Faction
  kind: EntityKind
  hp: number
  maxHp: number
  facing: -1 | 1
  moving: boolean
  construction?: number
  training?: { kind: UnitKind, progress: number, remaining: number }
  carryingGold?: boolean
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
  phase: 'lobby' | 'playing' | 'finished'
  players: Player[]
  result: Result | null
}

export type Order =
  | { kind: 'move' | 'advance', to: Point }
  | { kind: 'attack', target: number }
  | { kind: 'halt' }
  | { kind: 'gather', mine: Point }
  | { kind: 'build', building: BuildingKind, at: Point }
  | { kind: 'resume-build', target: number }
  | { kind: 'train', unit: UnitKind }

export type ClientMessage =
  | { type: 'create', faction: Faction }
  | { type: 'join', code: string, faction: Faction }
  | { type: 'resume', code: string, token: string }
  | { type: 'leave' }
  | { type: 'faction', faction: Faction }
  | { type: 'ready', ready: boolean }
  | { type: 'command', ids: number[], order: Order }

export type Snapshot = { type: 'snapshot', tick: number, entities: Entity[], effects: Effect[], gold: Record<Faction, number> }
export type ServerMessage =
  | { type: 'session', code: string, token: string, faction: Faction }
  | { type: 'room', room: RoomState, faction: Faction }
  | { type: 'error', message: string, resetSession?: boolean }
  | Snapshot
