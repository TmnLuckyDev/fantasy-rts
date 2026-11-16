import { isHeroKind, isUnitKind } from '../shared/protocol.ts'
import type { Entity, Faction, TroopGroup } from '../shared/protocol.ts'

export type ArmyIndex = Map<TroopGroup, Entity[]>

export function indexArmy(entities: readonly Entity[], faction: Faction): ArmyIndex {
  const army: ArmyIndex = new Map()
  const all: Entity[] = []
  for (const entity of entities) {
    if (entity.faction !== faction || !isUnitKind(entity.kind) || entity.kind === 'worker') continue
    all.push(entity)
    const group = isHeroKind(entity.kind) ? 'heroes' : entity.kind
    const members = army.get(group)
    if (members) members.push(entity)
    else army.set(group, [entity])
  }
  if (all.length) army.set('all', all)
  return army
}
