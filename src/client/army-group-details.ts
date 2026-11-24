import { groupComposition } from '../shared/army-templates.ts'
import { trainedAt } from '../shared/economy.ts'
import { isTemplateKind, isUnitKind, MAX_ARMY_GROUPS, MAX_ARMY_GROUP_SIZE } from '../shared/protocol.ts'
import type { ArmyTemplate, Entity, Race, TemplateKind } from '../shared/protocol.ts'

type SavedBlueprint = Pick<ArmyTemplate, 'name' | 'targets'>

export function targetTotal(group: ArmyTemplate) {
  return group.targets.reduce((total, row) => total + row.count, 0)
}

export const eligibleGroupUnit = (unit: Entity): unit is Entity & { kind: TemplateKind } =>
  isTemplateKind(unit.kind) && !unit.summonedUntil

export function groupBreakdown(group: ArmyTemplate) {
  const current = groupComposition(group.members)
  const kinds = new Set([...group.targets.map(row => row.kind), ...current.map(row => row.kind)])
  return [...kinds].map(kind => ({
    kind, live: current.find(row => row.kind === kind)?.count ?? 0,
    target: group.targets.find(row => row.kind === kind)?.count ?? 0
  }))
}

export function groupProduction(entities: readonly Entity[], race: Race) {
  const queued = new Map<TemplateKind, number>()
  const production = entities.filter(entity => !isUnitKind(entity.kind) && entity.construction === undefined)
  for (const entity of production) for (const run of entity.training?.queue ?? []) {
    if (isTemplateKind(run.kind)) queued.set(run.kind, (queued.get(run.kind) ?? 0) + run.count)
  }
  const ready = new Set(production.flatMap(entity => trainedAt(entity.kind, race)))
  return { queued, ready }
}

function blueprintKey(race: Race) {
  return 'ash-iron-blueprint-' + race
}

export function loadBlueprints(race: Race): SavedBlueprint[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(blueprintKey(race)) ?? 'null')
    const entries = Array.isArray(data) ? data : [data]
    return entries.filter((entry): entry is SavedBlueprint =>
      entry && typeof entry.name === 'string' && Array.isArray(entry.targets) &&
      entry.targets.every((row: ArmyTemplate['targets'][number]) =>
        row && isTemplateKind(row.kind) && Number.isInteger(row.count) && row.count > 0 && row.count <= MAX_ARMY_GROUP_SIZE))
      .slice(0, MAX_ARMY_GROUPS)
  } catch { return [] }
}

export function saveBlueprint(race: Race, group: SavedBlueprint) {
  const saved = loadBlueprints(race).filter(entry => entry.name !== group.name)
  saved.unshift({ name: group.name, targets: group.targets })
  localStorage.setItem(blueprintKey(race), JSON.stringify(saved.slice(0, MAX_ARMY_GROUPS)))
}
