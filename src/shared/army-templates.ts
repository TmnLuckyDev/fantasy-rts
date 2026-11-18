import { trainingCost, trainingRule } from './economy.ts'
import { isHeroKind, resourceKinds } from './protocol.ts'
import type { ArmyTemplate, Population, Race, Resources, TemplateKind } from './protocol.ts'

export function replenishPlan(
  groups: readonly ArmyTemplate[], group: ArmyTemplate, queued: ReadonlyMap<TemplateKind, number>,
  race: Race, resources: Resources, population: Population, canTrain: (kind: TemplateKind) => boolean
) {
  const bank = { ...resources }
  const cost: Resources = { gold: 0, wood: 0, stone: 0 }
  let room = Math.max(0, population.limit - population.used - population.reserved)
  let missingPopulation = 0
  let addedHero = false
  const rows = group.targets.map(({ kind, count }) => {
    const missing = Math.max(0, count - group.members.filter(member => member.kind === kind).length)
    let higherPriority = 0
    for (const other of groups) {
      if (other.id === group.id) break
      higherPriority += Math.max(0, (other.targets.find(target => target.kind === kind)?.count ?? 0) -
        other.members.filter(member => member.kind === kind).length)
    }
    const inQueue = queued.get(kind) ?? 0
    const covered = Math.min(missing, Math.max(0, inQueue - higherPriority))
    const price = trainingCost(kind, race)
    const slots = trainingRule(kind, race).population
    const useful = missing ? Math.max(0, missing + higherPriority - inQueue) : 0
    const possible = canTrain(kind) && !(addedHero && isHeroKind(kind)) ? Math.min(useful, isHeroKind(kind) ? 1 : Infinity) : 0
    const affordable = Math.min(...resourceKinds.map(resource => price[resource] ?
      Math.floor(bank[resource] / price[resource]!) : Infinity))
    const add = Math.min(possible, Math.floor(room / slots), affordable)
    missingPopulation += Math.max(0, Math.min(possible, affordable) * slots - room)
    room -= add * slots
    addedHero ||= add > 0 && isHeroKind(kind)
    for (const resource of resourceKinds) {
      const payment = (price[resource] ?? 0) * add
      bank[resource] -= payment
      cost[resource] += payment
    }
    return { kind, missing, queued: covered, add }
  })
  return { rows, cost, missingPopulation }
}

