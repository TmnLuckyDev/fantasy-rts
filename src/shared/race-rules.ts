import type { BuildingKind, EntityKind, Race, UnitKind } from './protocol.ts'

type RaceRules = {
  description: string
  gathering?: number
  stoneYield?: number
  scoutSight?: number
  training?: Partial<Record<UnitKind, { gold?: number, wood?: number, ticks?: number }>>
  production?: Partial<Record<EntityKind, readonly UnitKind[]>>
  defense?: Partial<Record<BuildingKind, number>>
  ambush?: readonly UnitKind[]
}

export const raceRules: Record<Race, RaceRules> = {
  human: { description: 'Flexible infantry and ranged formations.', production: { elite: ['heavy', 'siege'] } },
  orc: { description: 'Strong frontline and fast ranged attacks.', production: { elite: ['heavy', 'siege'] } },
  dwarf: {
    description: 'Armored infantry, fortress defenses and siege. Slow to take ground.',
    production: { elite: ['heavy', 'siege'] }, stoneYield: 1.15,
    training: { heavy: { gold: 253 } }, defense: { tower: 1.12, wall: 1.12 }
  },
  elf: {
    description: 'Mobile archers, forest ambush and healing. Fragile in a prolonged fight.',
    production: { elite: ['heavy', 'support', 'siege'] }, scoutSight: 1.1, ambush: ['blade', 'ranged', 'marksman'],
    training: { heavy: { gold: 255 }, marksman: { gold: 150 } }
  },
  undead: {
    description: 'Cheap skeletons and corpse magic. Weak defenses and slower gathering.',
    gathering: 0.9, production: { barracks: ['blade', 'polearm', 'ranged'], range: ['marksman'], elite: ['heavy', 'siege'], smithy: ['support'] },
    training: { blade: { gold: 64, ticks: 76 }, ranged: { gold: 76, ticks: 96 }, warship: { gold: 207, wood: 167 } }
  }
}

export type RaceSkill = { name: string, description: string, cooldown: number, radius: number, duration?: number, bonus: number }
export const raceSkills: Partial<Record<Race, Partial<Record<UnitKind, RaceSkill>>>> = {
  dwarf: {
    heavy: { name: 'Shield Wall', description: 'Reduce incoming damage by 30% for 5 seconds.', cooldown: 300, radius: 0, duration: 100, bonus: 0.3 },
    vanguard: { name: 'Stoneheart Aura', description: '+3 armor for allies nearby for 6 seconds.', cooldown: 300, radius: 128, duration: 120, bonus: 3 },
    pathfinder: { name: 'Siege Command', description: 'Nearby siege cannons gain +12 building damage for 7 seconds.', cooldown: 320, radius: 152, duration: 140, bonus: 12 }
  },
  elf: {
    marksman: { name: 'Steady Aim', description: '+3 attack damage for 5 seconds.', cooldown: 300, radius: 0, duration: 100, bonus: 3 },
    support: { name: 'Mend', description: 'Restore up to 25 HP to each of three wounded allies.', cooldown: 280, radius: 112, bonus: 25 },
    pathfinder: { name: 'Moonshot', description: '+5 attack damage and +24 range for 6 seconds.', cooldown: 300, radius: 0, duration: 120, bonus: 5 },
    vanguard: { name: 'Windstride', description: 'Nearby troops move 20% faster for 5 seconds.', cooldown: 280, radius: 128, duration: 100, bonus: 0.2 }
  },
  undead: {
    support: { name: 'Raise the Fallen', description: 'Raise one nearby corpse into a temporary skeleton.', cooldown: 240, radius: 125, bonus: 1 },
    pathfinder: { name: 'Grave Chill', description: 'Strike up to three visible enemies with frost.', cooldown: 260, radius: 115, bonus: 28 },
    vanguard: { name: 'Grave Might', description: '+5 damage for 5 seconds. Kills restore 18 HP.', cooldown: 280, radius: 0, duration: 100, bonus: 5 }
  }
}
