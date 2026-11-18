import type { Entity, Snapshot } from './protocol.ts'

export const deltaProtocol = 'ash-iron-delta-v1'

type Pose = [id: number, x: number, y: number, hp: number, facing: Entity['facing'], moving: 0 | 1]
export type SnapshotDelta = {
  type: 'delta'
  base: number
  tick: number
  pose?: Pose[]
  upsert?: Entity[]
  removed?: number[]
} & Partial<Pick<Snapshot, 'fog' | 'controlSites' | 'corpses' | 'effects' | 'resources' | 'population' | 'upgrades' | 'depleted' | 'deposits' | 'alerts'>>

function sameTraining(a: Entity['training'], b: Entity['training']) {
  return a === b || Boolean(a && b && a.kind === b.kind && a.progress === b.progress &&
    a.remaining === b.remaining && a.seconds === b.seconds && a.queue?.length === b.queue?.length &&
    (a.queue ?? []).every((run, i) => run.kind === b.queue![i].kind && run.count === b.queue![i].count))
}

function sameDetails(a: Entity, b: Entity) {
  return a.kind === b.kind && a.faction === b.faction && a.race === b.race &&
    a.rally?.x === b.rally?.x && a.rally?.y === b.rally?.y && a.concealed === b.concealed && a.summonedUntil === b.summonedUntil &&
    a.abilityReadyAt === b.abilityReadyAt && a.abilityActiveUntil === b.abilityActiveUntil &&
    a.level === b.level && a.upgradeProgress === b.upgradeProgress && a.passengerPop === b.passengerPop &&
    a.passengers?.length === b.passengers?.length && (a.passengers ?? []).every((id, i) => id === b.passengers![i]) &&
    a.landing?.total === b.landing?.total && a.landing?.waiting === b.landing?.waiting &&
    a.weaponLevel === b.weaponLevel && a.armorLevel === b.armorLevel && a.precisionLevel === b.precisionLevel &&
    a.vitalityLevel === b.vitalityLevel && a.rangeLevel === b.rangeLevel && a.speedLevel === b.speedLevel && a.maxHp === b.maxHp &&
    a.construction === b.construction && a.constructionStatus === b.constructionStatus &&
    a.experience === b.experience && a.repairing === b.repairing && a.carrying === b.carrying && a.idle === b.idle &&
    a.research?.kind === b.research?.kind && a.research?.progress === b.research?.progress &&
    sameTraining(a.training, b.training)
}

export function makeDelta(previous: Snapshot, next: Snapshot): SnapshotDelta {
  const delta: SnapshotDelta = { type: 'delta', base: previous.tick, tick: next.tick }
  const old = new Map(previous.entities.map(entity => [entity.id, entity]))
  for (const entity of next.entities) {
    const before = old.get(entity.id)
    old.delete(entity.id)
    if (!before || !sameDetails(before, entity)) (delta.upsert ??= []).push(entity)
    else if (entity.x !== before.x || entity.y !== before.y || entity.hp !== before.hp ||
        entity.facing !== before.facing || entity.moving !== before.moving) {
      (delta.pose ??= []).push([entity.id, entity.x, entity.y, entity.hp, entity.facing, entity.moving ? 1 : 0])
    }
  }
  if (old.size) delta.removed = [...old.keys()]
  if (next.fog !== previous.fog) delta.fog = next.fog
  if (next.controlSites?.length !== previous.controlSites?.length || next.controlSites?.some((site, i) => {
    const oldSite = previous.controlSites?.[i]
    return !oldSite || oldSite.owner !== site.owner || oldSite.x !== site.x || oldSite.y !== site.y
  })) delta.controlSites = next.controlSites ?? []
  if (next.effects.length) delta.effects = next.effects
  const a = previous.resources, b = next.resources
  if (a.gold !== b.gold || a.wood !== b.wood || a.stone !== b.stone) delta.resources = b
  const p = previous.population, q = next.population
  if (p.used !== q.used || p.limit !== q.limit || p.reserved !== q.reserved) delta.population = q
  if (next.upgrades?.join() !== previous.upgrades?.join()) delta.upgrades = next.upgrades ?? []
  if (next.depleted !== previous.depleted &&
      (next.depleted?.length !== previous.depleted?.length ||
      next.depleted?.some((index, i) => index !== previous.depleted?.[i]))) delta.depleted = next.depleted ?? []
  if (next.deposits?.length !== previous.deposits?.length || next.deposits?.some((site, i) =>
    site.index !== previous.deposits?.[i]?.index || site.remaining !== previous.deposits?.[i]?.remaining)) {
    delta.deposits = next.deposits ?? []
  }
  if (next.alerts !== previous.alerts && (next.alerts?.length || previous.alerts?.length)) delta.alerts = next.alerts ?? []
  if ((next.corpses?.length || previous.corpses?.length) && (next.corpses?.length !== previous.corpses?.length ||
      next.corpses?.some((corpse, i) => corpse.id !== previous.corpses?.[i]?.id))) delta.corpses = next.corpses ?? []
  return delta
}

export function applyDelta(previous: Snapshot | undefined, delta: SnapshotDelta): Snapshot | undefined {
  if (!previous || delta.base !== previous.tick || delta.tick <= delta.base) return
  let entities = previous.entities
  if (delta.pose || delta.upsert || delta.removed) {
    const byId = new Map(entities.map(entity => [entity.id, entity]))
    for (const id of delta.removed ?? []) byId.delete(id)
    for (const entity of delta.upsert ?? []) byId.set(entity.id, entity)
    for (const [id, x, y, hp, facing, moving] of delta.pose ?? []) {
      const entity = byId.get(id)
      if (!entity) return
      byId.set(id, { ...entity, x, y, hp, facing, moving: moving === 1 })
    }
    entities = [...byId.values()]
  }
  return {
    type: 'snapshot', tick: delta.tick, entities, effects: delta.effects ?? [],
    fog: delta.fog ?? previous.fog, resources: delta.resources ?? previous.resources,
    population: delta.population ?? previous.population, upgrades: delta.upgrades ?? previous.upgrades,
    ...(delta.controlSites || previous.controlSites ? { controlSites: delta.controlSites ?? previous.controlSites } : {}),
    ...(delta.corpses || previous.corpses ? { corpses: delta.corpses ?? previous.corpses } : {}),
    ...(delta.alerts || previous.alerts ? { alerts: delta.alerts ?? previous.alerts } : {}),
    ...(delta.depleted || previous.depleted ? { depleted: delta.depleted ?? previous.depleted } : {}),
    ...(delta.deposits || previous.deposits ? { deposits: delta.deposits ?? previous.deposits } : {})
  }
}
