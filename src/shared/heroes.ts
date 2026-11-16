import { isHeroKind } from './protocol.ts'
import type { Entity, HeroKind } from './protocol.ts'

export const heroThresholds = [0, 60, 140, 240, 360] as const
export const heroMaxExperience = heroThresholds[heroThresholds.length - 1]
export const heroHealthPerLevel = 14
export const heroDamagePerLevel = 2
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
