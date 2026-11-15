import type { EntityKind, Faction } from './protocol.ts'

export type UnitStats = {
  health: number
  damage: number
  armor: number
  range: number
  speed: number
  cooldown: number
  radius: number
}

const economyStats = {
  worker: { health: 55, damage: 0, armor: 0, range: 0, speed: 86, cooldown: 0, radius: 8 },
  barracks: { health: 550, damage: 0, armor: 3, range: 0, speed: 0, cooldown: 0, radius: 25 },
  wall: { health: 360, damage: 0, armor: 4, range: 0, speed: 0, cooldown: 0, radius: 16 },
  tower: { health: 460, damage: 20, armor: 3, range: 160, speed: 0, cooldown: 20, radius: 17 }
}

export const unitStats: Record<Faction, Record<EntityKind, UnitStats>> = {
  human: {
    blade: { health: 94, damage: 15, armor: 3, range: 23, speed: 77, cooldown: 12, radius: 9 },
    ranged: { health: 63, damage: 13, armor: 1, range: 127, speed: 73, cooldown: 17, radius: 9 },
    heavy: { health: 150, damage: 22, armor: 5, range: 26, speed: 100, cooldown: 18, radius: 12 },
    headquarters: { health: 1500, damage: 0, armor: 5, range: 0, speed: 0, cooldown: 0, radius: 30 },
    ...economyStats
  },
  orc: {
    blade: { health: 101, damage: 16, armor: 2, range: 23, speed: 74, cooldown: 13, radius: 9 },
    ranged: { health: 70, damage: 14, armor: 1, range: 118, speed: 76, cooldown: 18, radius: 9 },
    heavy: { health: 146, damage: 23, armor: 4, range: 25, speed: 99, cooldown: 18, radius: 12 },
    headquarters: { health: 1500, damage: 0, armor: 5, range: 0, speed: 0, cooldown: 0, radius: 30 },
    ...economyStats
  }
}
