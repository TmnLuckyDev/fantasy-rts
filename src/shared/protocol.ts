export const factions = ['human', 'orc'] as const
export type Faction = typeof factions[number]
export type Point = { x: number, y: number }
export type UnitKind = 'blade' | 'ranged' | 'heavy'
export type EntityKind = UnitKind | 'headquarters'

export const factionNames: Record<Faction, string> = { human: 'Human Kingdoms', orc: 'Orcish Horde' }
export const entityNames: Record<Faction, Record<EntityKind, string>> = {
  human: { blade: 'Footman', ranged: 'Archer', heavy: 'Knight', headquarters: 'Town Hall' },
  orc: { blade: 'Grunt', ranged: 'Spearman', heavy: 'Raider', headquarters: 'Great Hall' }
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

export type ClientMessage =
  | { type: 'create', faction: Faction }
  | { type: 'join', code: string, faction: Faction }
  | { type: 'resume', code: string, token: string }
  | { type: 'leave' }
  | { type: 'faction', faction: Faction }
  | { type: 'ready', ready: boolean }
  | { type: 'command', ids: number[], order: Order }

export type Snapshot = { type: 'snapshot', tick: number, entities: Entity[], effects: Effect[] }
export type ServerMessage =
  | { type: 'session', code: string, token: string, faction: Faction }
  | { type: 'room', room: RoomState, faction: Faction }
  | { type: 'error', message: string, resetSession?: boolean }
  | Snapshot
