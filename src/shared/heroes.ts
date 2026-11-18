import { isHeroKind } from './protocol.ts'
import type { Entity, HeroKind } from './protocol.ts'

export const heroThresholds = [0, 60, 140, 240, 360] as const
export const heroMaxExperience = heroThresholds[heroThresholds.length - 1]
export const heroHealthPerLevel = 26
export const heroDamagePerLevel = 4
export const heroAbilities = {
  vanguard: { name: 'War Cry', passive: 'Iron Will: 2 less damage taken', cooldown: 260, radius: 112, duration: 120, bonus: 8 },
  pathfinder: { name: 'Arrow Storm', passive: 'Deadeye: +5 attack damage', cooldown: 220, radius: 108, duration: 0, bonus: 24, maxTargets: 6 }
} as const
export const heroRoles: Record<HeroKind, string> = { vanguard: 'Melee defender', pathfinder: 'Ranged scout' }

export function heroLevel(experience: number) {
  for (let level = heroThresholds.length; level > 1; level--) {
    if (experience >= heroThresholds[level - 1]) return level
  }
  return 1
}

export function hasHero(entities: Iterable<Entity>) {
  for (const unit of entities) {
    if (isHeroKind(unit.kind) || unit.training?.queue?.some(entry => isHeroKind(entry.kind))) return true
  }
  return false
}
