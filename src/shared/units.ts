import type { EntityKind, Race } from './protocol.ts'

export type UnitStats = {
  health: number
  damage: number
  armor: number
  range: number
  speed: number
  cooldown: number
  radius: number
}

export const siegeBalance = { structureRange: 211, structureBonus: 16, unitPenalty: 4 }

const economyStats = {
  support: { health: 88, damage: 0, armor: 1, range: 0, speed: 75, cooldown: 0, radius: 9 },
  siege: { health: 165, damage: 28, armor: 3, range: 185, speed: 47, cooldown: 32, radius: 13 },
  vanguard: { health: 360, damage: 39, armor: 7, range: 30, speed: 86, cooldown: 18, radius: 15 },
  pathfinder: { health: 265, damage: 30, armor: 4, range: 158, speed: 87, cooldown: 18, radius: 13 },
  transport: { health: 550, damage: 0, armor: 4, range: 0, speed: 100, cooldown: 0, radius: 18 },
  warship: { health: 650, damage: 35, armor: 5, range: 120, speed: 82, cooldown: 28, radius: 19 },
  settlement: { health: 580, damage: 0, armor: 3, range: 0, speed: 0, cooldown: 0, radius: 25 },
  port: { health: 750, damage: 0, armor: 3, range: 0, speed: 0, cooldown: 0, radius: 28 },
  scout: { health: 48, damage: 0, armor: 0, range: 0, speed: 148, cooldown: 0, radius: 7 },
  worker: { health: 55, damage: 0, armor: 0, range: 0, speed: 86, cooldown: 0, radius: 8 },
  barracks: { health: 550, damage: 0, armor: 3, range: 0, speed: 0, cooldown: 0, radius: 25 },
  range: { health: 490, damage: 0, armor: 2, range: 0, speed: 0, cooldown: 0, radius: 24 },
  elite: { health: 690, damage: 0, armor: 4, range: 0, speed: 0, cooldown: 0, radius: 27 },
  farm: { health: 310, damage: 0, armor: 1, range: 0, speed: 0, cooldown: 0, radius: 21 },
  wall: { health: 360, damage: 0, armor: 4, range: 0, speed: 0, cooldown: 0, radius: 16 },
  smithy: { health: 620, damage: 0, armor: 4, range: 0, speed: 0, cooldown: 0, radius: 24 },
  tower: { health: 460, damage: 20, armor: 3, range: 170, speed: 0, cooldown: 20, radius: 17 }
}

const original: Record<'human' | 'orc', Record<EntityKind, UnitStats>> = {
  human: {
    blade: { health: 96, damage: 15, armor: 3, range: 24, speed: 77, cooldown: 12, radius: 9 },
    ranged: { health: 66, damage: 13, armor: 1, range: 127, speed: 73, cooldown: 17, radius: 9 },
    polearm: { health: 120, damage: 19, armor: 4, range: 34, speed: 76, cooldown: 15, radius: 10 },
    marksman: { health: 82, damage: 24, armor: 2, range: 151, speed: 64, cooldown: 24, radius: 10 },
    heavy: { health: 240, damage: 34, armor: 7, range: 28, speed: 104, cooldown: 18, radius: 12 },
    headquarters: { health: 1500, damage: 0, armor: 5, range: 0, speed: 0, cooldown: 0, radius: 30 },
    ...economyStats,
    tower: { ...economyStats.tower, range: 205 }
  },
  orc: {
    blade: { health: 94, damage: 15, armor: 3, range: 23, speed: 80, cooldown: 12, radius: 9 },
    ranged: { health: 66, damage: 13, armor: 1, range: 123, speed: 76, cooldown: 17, radius: 9 },
    polearm: { health: 118, damage: 19, armor: 3, range: 34, speed: 74, cooldown: 15, radius: 10 },
    marksman: { health: 82, damage: 24, armor: 1, range: 136, speed: 67, cooldown: 23, radius: 10 },
    heavy: { health: 240, damage: 34, armor: 7, range: 28, speed: 81, cooldown: 20, radius: 13 },
    headquarters: { health: 1500, damage: 0, armor: 5, range: 0, speed: 0, cooldown: 0, radius: 30 },
    ...economyStats,
    tower: { ...economyStats.tower, range: 205 }
  }
}

function roster(changes: Partial<Record<EntityKind, Partial<UnitStats>>>) {
  return Object.fromEntries(Object.entries(original.human).map(([kind, stats]) =>
    [kind, { ...stats, ...changes[kind as EntityKind] }])) as Record<EntityKind, UnitStats>
}

const elf = roster({
  blade: { armor: 1, damage: 20 }, polearm: { armor: 2, damage: 19 },
  heavy: { armor: 4, damage: 29 }, marksman: { damage: 24, cooldown: 21 },
  ranged: { damage: 19, cooldown: 16 }, siege: { health: 125, damage: 25, armor: 1, range: 205, speed: 57, cooldown: 35 }, tower: { range: 205 }, support: { health: 78, speed: 86 }, vanguard: { health: 295, speed: 104, armor: 4 },
  pathfinder: { range: 165, health: 240, speed: 94 }, warship: { health: 645, speed: 90.2 }
})
for (const kind of ['blade', 'polearm', 'heavy', 'ranged', 'marksman', 'scout', 'support'] as const) {
  elf[kind].speed *= 1.1
  elf[kind].health = Math.round(elf[kind].health * 0.85)
}
for (const kind of ['ranged', 'marksman'] as const) elf[kind].range = Math.round(elf[kind].range * 1.1)
for (const kind of ['tower', 'wall'] as const) elf[kind].health = Math.round(elf[kind].health * 0.9)

export const unitStats: Record<Race, Record<EntityKind, UnitStats>> = {
  ...original, elf,
  dwarf: roster({
    blade: { health: 101, armor: 3, speed: 65.45, damage: 14 },
    polearm: { health: 124, armor: 5, speed: 64.6, cooldown: 17 },
    ranged: { health: 74, damage: 17, speed: 62.05, range: 112, cooldown: 25 },
    marksman: { health: 92, speed: 54.4, range: 145, cooldown: 25 },
    heavy: { health: 248, armor: 8, speed: 76.5, cooldown: 21 },
    siege: { health: 205, damage: 38, armor: 5, range: 180, speed: 36, cooldown: 39 },
    headquarters: { health: 1725, armor: 6 }, tower: { health: 552, armor: 4, range: 205 },
    wall: { health: 432, armor: 5 }, scout: { speed: 128 }, warship: { health: 665, speed: 73.8, cooldown: 29 },
    vanguard: { health: 385, speed: 69, damage: 32 }, pathfinder: { speed: 72, damage: 26, range: 149 }
  }),
  undead: roster({
    blade: { health: 82, armor: 2, damage: 14 }, ranged: { health: 56, armor: 0, range: 115 },
    polearm: { health: 97, speed: 105, armor: 2, damage: 15 },
    marksman: { health: 68, armor: 1, range: 143 },
    heavy: { health: 295, speed: 57, armor: 6, damage: 36, cooldown: 23 },
    siege: { health: 135, damage: 31, armor: 1, range: 190, speed: 52, cooldown: 34 },
    tower: { health: 390, range: 205 }, wall: { health: 305 }, warship: { health: 615, damage: 31 }, support: { health: 94, speed: 73 },
    vanguard: { armor: 5, damage: 35 }, pathfinder: { health: 230, range: 146, damage: 26 }
  })
}

// Heroes have more staying power without changing collision or population.
for (const stats of Object.values(unitStats)) {
  for (const kind of ['vanguard', 'pathfinder'] as const) {
    stats[kind].health = Math.round(stats[kind].health * 1.12)
    stats[kind].damage += 2
  }
}
