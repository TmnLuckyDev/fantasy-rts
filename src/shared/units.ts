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
  vanguard: { health: 220, damage: 27, armor: 6, range: 30, speed: 86, cooldown: 18, radius: 12 },
  pathfinder: { health: 150, damage: 19, armor: 3, range: 149, speed: 83, cooldown: 18, radius: 10 },
  worker: { health: 55, damage: 0, armor: 0, range: 0, speed: 86, cooldown: 0, radius: 8 },
  barracks: { health: 550, damage: 0, armor: 3, range: 0, speed: 0, cooldown: 0, radius: 25 },
  range: { health: 490, damage: 0, armor: 2, range: 0, speed: 0, cooldown: 0, radius: 24 },
  elite: { health: 690, damage: 0, armor: 4, range: 0, speed: 0, cooldown: 0, radius: 27 },
  farm: { health: 310, damage: 0, armor: 1, range: 0, speed: 0, cooldown: 0, radius: 21 },
  wall: { health: 360, damage: 0, armor: 4, range: 0, speed: 0, cooldown: 0, radius: 16 },
  smithy: { health: 620, damage: 0, armor: 4, range: 0, speed: 0, cooldown: 0, radius: 24 },
  tower: { health: 460, damage: 20, armor: 3, range: 160, speed: 0, cooldown: 20, radius: 17 }
}

export const unitStats: Record<Faction, Record<EntityKind, UnitStats>> = {
  human: {
    blade: { health: 96, damage: 15, armor: 3, range: 24, speed: 77, cooldown: 12, radius: 9 },
    ranged: { health: 66, damage: 13, armor: 1, range: 127, speed: 73, cooldown: 17, radius: 9 },
    polearm: { health: 120, damage: 19, armor: 4, range: 34, speed: 76, cooldown: 15, radius: 10 },
    marksman: { health: 82, damage: 24, armor: 2, range: 151, speed: 64, cooldown: 24, radius: 10 },
    heavy: { health: 240, damage: 34, armor: 7, range: 28, speed: 104, cooldown: 18, radius: 12 },
    headquarters: { health: 1500, damage: 0, armor: 5, range: 0, speed: 0, cooldown: 0, radius: 30 },
    ...economyStats
  },
  orc: {
    blade: { health: 94, damage: 15, armor: 3, range: 23, speed: 74, cooldown: 12, radius: 9 },
    ranged: { health: 66, damage: 13, armor: 1, range: 118, speed: 76, cooldown: 17, radius: 9 },
    polearm: { health: 118, damage: 19, armor: 3, range: 34, speed: 74, cooldown: 15, radius: 10 },
    marksman: { health: 82, damage: 24, armor: 1, range: 136, speed: 67, cooldown: 23, radius: 10 },
    heavy: { health: 240, damage: 34, armor: 7, range: 28, speed: 81, cooldown: 20, radius: 13 },
    headquarters: { health: 1500, damage: 0, armor: 5, range: 0, speed: 0, cooldown: 0, radius: 30 },
    ...economyStats
  }
}
