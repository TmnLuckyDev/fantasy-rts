import { TILE, ashford, distance, resourceAt, snapToCell } from '../shared/map.ts'
import type { BattleMap } from '../shared/map.ts'
import { MAX_SELECTION, factions, isUnitKind } from '../shared/protocol.ts'
import type { Effect, Entity, EntityKind, Faction, Order, Point, Population, ResourceKind, Resources, Result, Snapshot, UnitKind } from '../shared/protocol.ts'
import { unitStats } from '../shared/units.ts'
import { BASE_POPULATION, FARM_POPULATION, GATHERING, MAX_BUILDINGS, MAX_POPULATION, STARTING_RESOURCES,
  TRAINING_QUEUE_LIMIT, buildings as buildingRules, canAfford, spend, trainedAt, training, validPlacement } from '../shared/economy.ts'
import { canStand, findPath } from './navigation.ts'
import { Visibility } from './visibility.ts'

export const TICK_HZ = 20
const spacing = 30
const isRanged = (kind: EntityKind) => kind === 'ranged' || kind === 'marksman'

type WorkerJob = { kind: 'gather', at: Point, resource: ResourceKind, workTicks: number } | { kind: 'construct', site: number }
type Obstacle = Point & { radius: number }

type Unit = Entity & {
  order: Order | null
  assigned: Point | null
  nextStrike: number
  nextPath: number
  path: Point[]
  pursued: Point | null
  lastTarget: Point | null
  blockedTicks: number
  job: WorkerJob | null
  cargo: ResourceKind | null
  queue: Array<{ kind: UnitKind, left: number }>
  buildTicks: number
  buildDuration: number
}

type WorldSnapshot = Omit<Snapshot, 'resources' | 'population' | 'fog'> & {
  resources: Record<Faction, Resources>, population: Record<Faction, Population>
}

type Missile = { attacker: Unit, targetId: number, arrives: number }

export class Match {
  readonly units = new Map<number, Unit>()
  readonly map: BattleMap
  tick = 0
  result: Result | null = null
  private readonly resources: Record<Faction, Resources> = {
    human: { ...STARTING_RESOURCES }, orc: { ...STARTING_RESOURCES }
  }
  private sequence = 0
  private effects: Effect[] = []
  private missiles: Missile[] = []
  private readonly visibility: Visibility

  constructor(map: BattleMap = ashford) {
    this.map = map
    this.visibility = new Visibility(map)
    for (const faction of factions) {
      const base = map.bases[faction]
      const direction = faction === 'human' ? 1 : -1
      this.spawn(faction, 'headquarters', base)
      const ranks: Array<[EntityKind, number, number]> = [
        ['blade', 74, -31], ['blade', 74, 1], ['blade', 74, 33],
        ['ranged', 40, -23], ['ranged', 40, 24], ['polearm', 109, 1]
      ]
      for (const [kind, x, y] of ranks) {
        this.spawn(faction, kind, { x: base.x + x * direction, y: base.y + y * direction })
      }
    }
    for (const faction of factions) {
      const base = map.bases[faction]
      const direction = faction === 'human' ? 1 : -1
      for (const [x, y] of [[-46, 38], [-12, 53], [22, 50]]) {
        this.spawn(faction, 'worker', { x: base.x + x * direction, y: base.y + y * direction })
      }
    }
    this.visibility.update(this.units.values())
  }

  private spawn(faction: Faction, kind: EntityKind, position: Point, buildDuration = 0) {
    const health = unitStats[faction][kind].health
    const id = ++this.sequence
    const unit: Unit = {
      ...position, faction, kind, id, hp: buildDuration ? Math.ceil(health * 0.2) : health,
      maxHp: health, moving: false, facing: faction === 'human' ? 1 : -1, order: null, assigned: null,
      path: [], nextPath: 0, nextStrike: 0, pursued: null, lastTarget: null, blockedTicks: 0,
      job: null, cargo: null, queue: [], buildTicks: 0, buildDuration
    }
    this.units.set(id, unit)
    return unit
  }

  command(faction: Faction, ids: number[], order: Order): boolean {
    if (this.result || ids.length === 0 || ids.length > MAX_SELECTION) return false
    const units: Unit[] = []
    for (const id of new Set(ids)) {
      const unit = this.units.get(id)
      if (!unit || unit.faction !== faction) return false
      units.push(unit)
    }
    if (order.kind === 'train') return units.length === 1 && this.enqueue(units[0], order.unit)
    if (order.kind === 'gather' || order.kind === 'build' || order.kind === 'resume-build') {
      return this.assignWorkers(faction, units.filter(unit => unit.kind === 'worker'), order)
    }
    if (units.some(unit => !isUnitKind(unit.kind))) return false
    if (order.kind === 'attack') {
      const target = this.units.get(order.target)
      if (!target || target.faction === faction || this.visibility.at(faction, target) !== 2) return false
    }
    if ((order.kind === 'move' || order.kind === 'advance') &&
        (!Number.isFinite(order.to.x) || !Number.isFinite(order.to.y) ||
          order.to.x < 0 || order.to.y < 0 || order.to.x >= this.map.width * TILE ||
          order.to.y >= this.map.height * TILE)) return false

    const troops = order.kind === 'attack' ? units.filter(unit => unit.kind !== 'worker') : units
    if (!troops.length) return false
    const rowSize = Math.ceil(Math.sqrt(troops.length))
    troops.sort((a, b) => Number(isRanged(a.kind)) - Number(isRanged(b.kind)) || a.y - b.y)
    troops.forEach((unit, i) => {
      this.resetOrders(unit)
      unit.order = order.kind === 'halt' ? null : order
      if (order.kind === 'attack') {
        const target = this.units.get(order.target)!
        unit.lastTarget = { x: target.x, y: target.y }
      }
      if (order.kind === 'move' || order.kind === 'advance') {
        const front = faction === 'human' ? 1 : -1
        const rows = Math.ceil(troops.length / rowSize)
        const x = order.to.x + front * ((rows - 1) / 2 - Math.floor(i / rowSize)) * spacing
        const y = order.to.y + (i % rowSize - (rowSize - 1) / 2) * spacing
        unit.assigned = {
          x: Math.min(this.map.width * TILE - 1, Math.max(0, x)),
          y: Math.min(this.map.height * TILE - 1, Math.max(0, y))
        }
      }
    })
    return true
  }

  private resetOrders(unit: Unit) {
    unit.order = null
    unit.job = null
    unit.path = []
    unit.pursued = null
    unit.lastTarget = null
    unit.nextPath = this.tick
    unit.blockedTicks = 0
    unit.assigned = null
  }

  private assignWorkers(faction: Faction, workers: Unit[], order: Extract<Order, { kind: 'gather' | 'build' | 'resume-build' }>) {
    if (!workers.length) return false
    if (order.kind === 'gather') {
      const resource = resourceAt(this.map, order.at)
      if (!resource || !this.visibility.at(faction, order.at)) return false
      const at = snapToCell(order.at)
      for (const worker of workers) {
        this.resetOrders(worker)
        worker.job = { kind: 'gather', at, resource, workTicks: 0 }
      }
      return true
    }
    const worker = workers.find(unit => !unit.job) ?? workers.find(unit => unit.job?.kind === 'gather') ?? workers[0]
    let site = order.kind === 'resume-build' ? this.units.get(order.target) : undefined
    if (order.kind === 'build') {
      const rule = buildingRules[order.building]
      if (this.visibility.at(faction, order.at) !== 2 ||
          !canAfford(this.resources[faction], rule.cost) || !validPlacement(this.map, order.building, order.at, this.units.values())) return false
      const count = [...this.units.values()].filter(unit => unit.faction === faction && !isUnitKind(unit.kind)).length
      if (count >= MAX_BUILDINGS) return false
      spend(this.resources[faction], rule.cost)
      site = this.spawn(faction, order.building, snapToCell(order.at), rule.ticks)
    }
    if (!site || site.faction !== faction || !site.buildDuration) return false
    if ([...this.units.values()].some(unit => unit !== worker && unit.job?.kind === 'construct' && unit.job.site === site.id)) return false
    this.resetOrders(worker)
    worker.job = { kind: 'construct', site: site.id }
    return true
  }

  private population(faction: Faction): Population {
    let used = 0
    let reserved = 0
    let limit = 0
    for (const unit of this.units.values()) {
      if (unit.faction !== faction) continue
      if (isUnitKind(unit.kind)) used += training[unit.kind].population
      else if (!unit.buildDuration) {
        if (unit.kind === 'headquarters') limit += BASE_POPULATION
        if (unit.kind === 'farm') limit += FARM_POPULATION
        for (const queued of unit.queue) reserved += training[queued.kind].population
      }
    }
    return { used, reserved, limit: Math.min(limit, MAX_POPULATION) }
  }

  private enqueue(building: Unit, kind: UnitKind) {
    const rule = training[kind]
    const stock = this.resources[building.faction]
    if (building.buildDuration || !trainedAt(building.kind).includes(kind) ||
        building.queue.length >= TRAINING_QUEUE_LIMIT || stock.gold < rule.gold) return false
    const { used, reserved, limit } = this.population(building.faction)
    if (used + reserved + rule.population > limit) return false
    stock.gold -= rule.gold
    building.queue.push({ kind, left: rule.ticks })
    return true
  }

  private train(building: Unit, obstacles: Obstacle[]) {
    const next = building.queue[0]
    if (!next) return
    if (next.left > 0) next.left--
    if (next.left > 0) return
    const { used, limit } = this.population(building.faction)
    if (used + training[next.kind].population > limit) return
    const radius = unitStats[building.faction][next.kind].radius
    const bounds = unitStats[building.faction][building.kind].radius + radius + 16
    const slots = [0, 0.65, -0.65, 1.3, -1.3, 2.0, -2.0, Math.PI]
    const direction = building.faction === 'human' ? 1 : -1
    for (const angle of slots) {
      const point = { x: building.x + direction * Math.cos(angle) * bounds, y: building.y + Math.sin(angle) * bounds }
      if (!canStand(this.map, point, obstacles, radius)) continue
      if ([...this.units.values()].some(unit => isUnitKind(unit.kind) &&
          distance(point, unit) < radius + unitStats[unit.faction][unit.kind].radius + 4)) continue
      building.queue.shift()
      this.spawn(building.faction, next.kind, point)
      return
    }
  }

  private work(worker: Unit, obstacles: Obstacle[]) {
    const job = worker.job
    if (!job) return
    if (job.kind === 'construct') {
      const site = this.units.get(job.site)
      if (!site || !site.buildDuration) {
        this.resetOrders(worker)
        return
      }
      const radius = unitStats[site.faction][site.kind].radius
      if (distance(worker, site) > radius + 27) {
        this.approach(worker, site, obstacles, true)
        return
      }
      const baseHealth = Math.ceil(site.maxHp * 0.2)
      const addedHealth = (ticks: number) => Math.floor((site.maxHp - baseHealth) * ticks / site.buildDuration)
      site.hp = Math.min(site.maxHp, site.hp + addedHealth(site.buildTicks + 1) - addedHealth(site.buildTicks))
      if (++site.buildTicks >= site.buildDuration) {
        site.buildDuration = 0
        this.resetOrders(worker)
      }
      return
    }
    if (worker.cargo) {
      const base = [...this.units.values()].find(unit => unit.faction === worker.faction && unit.kind === 'headquarters')
      if (!base) return
      if (distance(worker, base) <= unitStats[base.faction].headquarters.radius + 26) {
        this.resources[worker.faction][worker.cargo] += GATHERING[worker.cargo].amount
        worker.cargo = null
      } else this.approach(worker, base, obstacles, true)
    } else if (distance(worker, job.at) < 49) {
      if (++job.workTicks >= GATHERING[job.resource].ticks) {
        worker.cargo = job.resource
        job.workTicks = 0
      }
    } else this.approach(worker, job.at, obstacles, true)
  }

  step() {
    if (this.result) return
    this.tick++
    const incoming: Missile[] = []
    for (const missile of this.missiles) {
      if (missile.arrives <= this.tick) this.hit(missile.attacker, missile.targetId)
      else incoming.push(missile)
    }
    this.missiles = incoming
    const obstacles = [...this.units.values()].filter(unit => !isUnitKind(unit.kind))
      .map(unit => ({ x: unit.x, y: unit.y, radius: unitStats[unit.faction][unit.kind].radius }))
    for (const unit of this.units.values()) {
      unit.moving = false
      if (unit.buildDuration) continue
      const stats = unitStats[unit.faction][unit.kind]
      if (!isUnitKind(unit.kind)) this.train(unit, obstacles)
      if (unit.job) {
        this.work(unit, obstacles)
        continue
      }
      const automaticRange = stats.damage === 0 ? 0 : unit.order?.kind === 'advance' ? 180 : stats.range + 30
      let target: Unit | undefined
      if (unit.order?.kind === 'attack') {
        target = this.units.get(unit.order.target)
        if (target && this.visibility.at(unit.faction, target) === 2) {
          unit.lastTarget = { x: target.x, y: target.y }
        } else {
          target = undefined
          const last = unit.lastTarget
          this.resetOrders(unit)
          if (last) {
            unit.order = { kind: 'advance', to: last }
            unit.assigned = last
          }
        }
      }
      if (automaticRange > 0 && unit.order?.kind !== 'move' && !target) {
        let nearest = automaticRange
        for (const other of this.units.values()) {
          if (other.faction === unit.faction || (unit.kind === 'tower' && !isUnitKind(other.kind))) continue
          const separation = distance(unit, other) - unitStats[other.faction][other.kind].radius
          if (separation < nearest && this.visibility.at(unit.faction, other) === 2) {
            nearest = separation
            target = other
          }
        }
      }
      if (target && this.fight(unit, target)) continue

      let destination = unit.assigned
      if (target && (unit.order?.kind === 'attack' || unit.order?.kind === 'advance')) {
        const range = unitStats[unit.faction][unit.kind].range + unitStats[target.faction][target.kind].radius - 4
        const separation = distance(unit, target) || 1
        destination = {
          x: target.x + (unit.x - target.x) * range / separation,
          y: target.y + (unit.y - target.y) * range / separation
        }
      }
      if (destination && stats.speed) this.approach(unit, destination, obstacles, Boolean(target))
    }
    this.visibility.update(this.units.values())
    const standing = [...this.units.values()].filter(unit => unit.kind === 'headquarters')
    if (standing.length < 2) this.result = { winner: standing[0]?.faction ?? null, reason: 'headquarters' }
  }

  private approach(unit: Unit, destination: Point, obstacles: Obstacle[], pursuing: boolean) {
    if (!unit.pursued || (this.tick >= unit.nextPath &&
        (distance(unit.pursued, destination) > 14 || unit.blockedTicks >= 8))) {
      unit.path = findPath(this.map, unit, destination, obstacles, unitStats[unit.faction][unit.kind].radius)
      unit.pursued = { x: destination.x, y: destination.y }
      unit.nextPath = this.tick + 10
      unit.blockedTicks = 0
    }
    this.walk(unit, obstacles, pursuing)
  }

  private fight(unit: Unit, target: Unit): boolean {
    const stats = unitStats[unit.faction][unit.kind]
    if (distance(unit, target) > stats.range + unitStats[target.faction][target.kind].radius) return false
    if (unit.nextStrike > this.tick) return true
    unit.nextStrike = this.tick + stats.cooldown
    unit.facing = target.x < unit.x ? -1 : 1
    if (isRanged(unit.kind) || unit.kind === 'tower') {
      const flight = Math.max(2, Math.ceil(distance(unit, target) / 24))
      this.missiles.push({ attacker: unit, targetId: target.id, arrives: this.tick + flight })
      this.effects.push({
        id: ++this.sequence, kind: 'shot', at: { x: unit.x, y: unit.y },
        to: { x: target.x, y: target.y }, faction: unit.faction, entityKind: unit.kind
      })
    } else this.hit(unit, target.id)
    return true
  }

  private hit(attacker: Unit, targetId: number) {
    const target = this.units.get(targetId)
    if (!target) return
    const damage = Math.max(1, unitStats[attacker.faction][attacker.kind].damage - unitStats[target.faction][target.kind].armor)
    target.hp = Math.max(0, target.hp - damage)
    const at = { x: target.x, y: target.y }
    this.effects.push({
      id: ++this.sequence, kind: 'hit', at, to: { x: attacker.x, y: attacker.y },
      faction: attacker.faction, entityKind: attacker.kind
    })
    if (!target.hp) {
      this.units.delete(target.id)
      this.effects.push({ id: ++this.sequence, kind: 'fallen', at, faction: target.faction, entityKind: target.kind })
    }
  }

  private walk(unit: Unit, obstacles: Obstacle[], pursuing: boolean) {
    const next = unit.path[0]
    if (!next) {
      if (!pursuing) {
        unit.assigned = null
        if (unit.order?.kind === 'move') unit.order = null
      } else unit.blockedTicks++
      return
    }
    const stats = unitStats[unit.faction][unit.kind]
    const remaining = distance(unit, next)
    if (remaining < 2) {
      unit.path.shift()
      return
    }
    const step = Math.min(remaining, stats.speed / TICK_HZ)
    const vx = (next.x - unit.x) / remaining
    const vy = (next.y - unit.y) / remaining
    const angles = [0, 0.54, -0.54, 1.05, -1.05, 1.4, -1.4]
    for (const angle of angles) {
      const x = unit.x + (vx * Math.cos(angle) - vy * Math.sin(angle)) * step
      const y = unit.y + (vx * Math.sin(angle) + vy * Math.cos(angle)) * step
      const test = { x, y }
      if (!canStand(this.map, test, obstacles, stats.radius)) continue
      let collides = false
      for (const other of this.units.values()) {
        if (other === unit || !isUnitKind(other.kind)) continue
        const minimum = (stats.radius + unitStats[other.faction][other.kind].radius) * 0.78
        const gap = distance(test, other)
        if (gap < minimum && gap <= distance(unit, other)) {
          collides = true
          break
        }
      }
      if (collides) continue
      if (Math.abs(x - unit.x) > 0.8) unit.facing = x < unit.x ? -1 : 1
      unit.x = x
      unit.y = y
      unit.moving = true
      unit.blockedTicks = angle ? unit.blockedTicks + 1 : 0
      return
    }
    unit.blockedTicks++
  }

  view(faction: Faction, world = this.snapshot()): Snapshot {
    const visible = (point: Point) => this.visibility.at(faction, point) === 2
    return {
      type: 'snapshot', tick: world.tick, fog: this.visibility.mask(faction),
      resources: world.resources[faction], population: world.population[faction],
      entities: world.entities.filter(entity => entity.faction === faction || visible(entity)),
      effects: world.effects.filter(effect => visible(effect.at) && (!effect.to || visible(effect.to)))
    }
  }

  snapshot(consumeEffects = false): WorldSnapshot {
    const effects = this.effects
    if (consumeEffects) this.effects = []
    return {
      type: 'snapshot', tick: this.tick, effects: consumeEffects ? effects : [],
      resources: { human: { ...this.resources.human }, orc: { ...this.resources.orc } },
      population: { human: this.population('human'), orc: this.population('orc') },
      entities: [...this.units.values()].map(unit => {
        const { id, x, y, kind, faction, hp, maxHp, facing, moving, cargo, queue, buildDuration, buildTicks } = unit
        const next = queue[0]
        return {
          id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, kind, faction, hp, maxHp, facing, moving,
          construction: buildDuration ? buildTicks / buildDuration : undefined,
          carrying: cargo ?? undefined,
          training: next ? { kind: next.kind, progress: 1 - next.left / training[next.kind].ticks, remaining: queue.length } : undefined
        }
      })
    }
  }
}
