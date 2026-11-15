import { TILE, ashford, distance, resourceAt, snapToCell, wallLine } from '../shared/map.ts'
import type { BattleMap } from '../shared/map.ts'
import { MAX_SELECTION, factions, isBuildingKind, isUnitKind, resourceKinds } from '../shared/protocol.ts'
import type { Effect, Entity, EntityKind, Faction, Order, Point, Population, ResourceKind, Resources, Result, Snapshot, UnitKind, UpgradeKind } from '../shared/protocol.ts'
import { unitStats } from '../shared/units.ts'
import { BASE_POPULATION, FARM_POPULATION, GATHERING, STARTING_RESOURCES,
  buildings as buildingRules, canAfford, REPAIR, repairCost, spend, trainedAt, training, upgrades, validPlacement } from '../shared/economy.ts'
import { canStand, findPath } from './navigation.ts'
import { SpatialIndex } from './spatial.ts'
import { Visibility } from './visibility.ts'

export const TICK_HZ = 20
const spacing = 30
const maxRadius = Math.max(...Object.values(unitStats).flatMap(stats => Object.values(stats).map(unit => unit.radius)))
const defenseRadius = 5 * TILE
const defenseLeash = 8 * TILE
const defenseDuration = 4 * TICK_HZ
const isRanged = (kind: EntityKind) => kind === 'ranged' || kind === 'marksman'

type WorkerJob = { kind: 'gather', at: Point, resource: ResourceKind, workTicks: number } | { kind: 'construct', site: number }
  | { kind: 'repair', site: number, workTicks: number }
type Defense = { targetId: number, at: Point, until: number }
type Obstacle = Point & { radius: number }

type Unit = Entity & {
  order: Order | null
  assigned: Point | null
  nextStrike: number
  nextPath: number
  path: Point[]
  pursued: Point | null
  lastTarget: Point | null
  defense: Defense | null
  blockedTicks: number
  job: WorkerJob | null
  cargo: ResourceKind | null
  queue: Array<{ kind: UnitKind, left: number, count?: number }>
  buildTicks: number
  buildDuration: number
  buildQueue?: number[]
  upgradeJob?: { kind: UpgradeKind, left: number }
}

type WorldSnapshot = Omit<Snapshot, 'resources' | 'population' | 'fog' | 'upgrades'> & {
  resources: Record<Faction, Resources>, population: Record<Faction, Population>, upgrades: Record<Faction, UpgradeKind[]>
}

type Missile = { attacker: Unit, targetId: number, arrives: number }

export type MatchCheckpoint = {
  tick: number
  result: Result | null
  sequence: number
  resources: Record<Faction, Resources>
  units: Unit[]
  missiles: Missile[]
  fog: Record<Faction, string>
  upgrades?: Record<Faction, UpgradeKind[]>
}

export class Match {
  readonly units = new Map<number, Unit>()
  readonly map: BattleMap
  private readonly nearby = new SpatialIndex<Unit>()
  tick = 0
  result: Result | null = null
  private readonly resources: Record<Faction, Resources> = {
    human: { ...STARTING_RESOURCES }, orc: { ...STARTING_RESOURCES }
  }
  private readonly upgrades: Record<Faction, UpgradeKind[]> = { human: [], orc: [] }
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

  static restore(checkpoint: MatchCheckpoint, map: BattleMap = ashford) {
    const match = new Match(map)
    match.tick = checkpoint.tick
    match.result = checkpoint.result
    match.sequence = checkpoint.sequence
    Object.assign(match.resources, checkpoint.resources)
    Object.assign(match.upgrades, checkpoint.upgrades)
    // Normalize max health when resuming a save made before a balance update.
    for (const unit of checkpoint.units) {
      const maxHp = unitStats[unit.faction][unit.kind].health
      unit.hp = Math.min(maxHp, Math.max(1, Math.ceil(unit.hp * maxHp / unit.maxHp)))
      unit.maxHp = maxHp
    }
    match.units.clear()
    for (const unit of checkpoint.units) match.units.set(unit.id, unit)
    match.missiles = checkpoint.missiles.map(missile =>
      ({ ...missile, attacker: match.units.get(missile.attacker.id) ?? missile.attacker }))
    match.visibility.restore(checkpoint.fog)
    return match
  }

  checkpoint(): MatchCheckpoint {
    return {
      tick: this.tick, result: this.result, sequence: this.sequence, resources: this.resources,
      units: [...this.units.values()], missiles: this.missiles, upgrades: this.upgrades,
      fog: { human: this.visibility.mask('human'), orc: this.visibility.mask('orc') }
    }
  }

  private spawn(faction: Faction, kind: EntityKind, position: Point, buildDuration = 0) {
    const health = unitStats[faction][kind].health
    const id = ++this.sequence
    const unit: Unit = {
      ...position, faction, kind, id, hp: buildDuration ? Math.ceil(health * 0.2) : health,
      maxHp: health, moving: false, facing: faction === 'human' ? 1 : -1, order: null, assigned: null,
      path: [], nextPath: 0, nextStrike: 0, pursued: null, lastTarget: null, defense: null, blockedTicks: 0,
      job: null, cargo: null, queue: [], buildTicks: 0, buildDuration
    }
    this.units.set(id, unit)
    this.nearby.update(unit)
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
    if (order.kind === 'upgrade') return units.length === 1 && this.startUpgrade(units[0], order.upgrade)
    if (order.kind === 'train') return units.length === 1 && this.enqueue(units[0], order.unit, order.count ?? 1)
    if (order.kind === 'cancel-train') return units.length === 1 && this.cancelTraining(units[0], order.count)
    if (order.kind === 'cancel-build') return units.length === 1 && this.cancelConstruction(units[0])
    if (order.kind === 'demolish') {
      const [building] = units
      if (units.length !== 1 || isUnitKind(building.kind) || building.buildDuration) return false
      this.destroy(building)
      return true
    }
    if (order.kind === 'gather' || order.kind === 'build' || order.kind === 'wall-line' ||
        order.kind === 'resume-build' || order.kind === 'repair') {
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
    unit.buildQueue = undefined
    unit.path = []
    unit.pursued = null
    unit.lastTarget = null
    unit.defense = null
    unit.nextPath = this.tick
    unit.blockedTicks = 0
    unit.assigned = null
  }

  private assignWorkers(faction: Faction, workers: Unit[], order: Extract<Order, { kind: 'gather' | 'build' | 'wall-line' | 'resume-build' | 'repair' }>) {
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
    if (order.kind === 'repair') {
      const site = this.units.get(order.target)
      if (!site || site.faction !== faction || isUnitKind(site.kind) || site.buildDuration || site.hp >= site.maxHp ||
          !canAfford(this.resources[faction], repairCost(site.kind))) return false
      for (const unit of this.units.values()) {
        if (unit.job?.kind === 'repair' && unit.job.site === site.id) return false
      }
      const worker = workers.reduce((nearest, candidate) =>
        distance(candidate, site) < distance(nearest, site) ? candidate : nearest)
      this.resetOrders(worker)
      worker.job = { kind: 'repair', site: site.id, workTicks: 0 }
      return true
    }
    if (order.kind === 'resume-build') {
      const site = this.units.get(order.target)
      if (!site || site.faction !== faction || !site.buildDuration) return false
      if ([...this.units.values()].some(unit => (unit.job?.kind === 'construct' && unit.job.site === site.id) ||
          unit.buildQueue?.includes(site.id))) return false
      this.queueConstruction(this.builder(workers), site.id)
      return true
    }
    const kind = order.kind === 'build' ? order.building : 'wall'
    const locations = order.kind === 'build' ? [order.at] : wallLine(this.map, order.from, order.to)
    const rule = buildingRules[kind]
    const stock = this.resources[faction]
    let queued = false
    for (const at of locations) {
      if (!canAfford(stock, rule.cost)) break
      if (this.visibility.at(faction, at) !== 2 || !validPlacement(this.map, kind, at, this.units.values())) continue
      spend(stock, rule.cost)
      this.queueConstruction(this.builder(workers), this.spawn(faction, kind, snapToCell(at), rule.ticks).id)
      queued = true
    }
    return queued
  }

  private builder(workers: Unit[]) {
    return workers.reduce((best, worker) => this.constructionLoad(worker) < this.constructionLoad(best) ? worker : best)
  }

  private constructionLoad(worker: Unit) {
    if (worker.job?.kind === 'construct') return 2 + (worker.buildQueue?.length ?? 0)
    return worker.job ? 1 : 0
  }

  private queueConstruction(worker: Unit, site: number) {
    if (worker.job?.kind === 'construct') {
      const queue = worker.buildQueue ??= []
      queue.push(site)
    } else {
      this.resetOrders(worker)
      worker.job = { kind: 'construct', site }
    }
  }

  private nextConstruction(worker: Unit) {
    const next = worker.buildQueue?.findIndex(id => this.units.get(id)?.buildDuration) ?? -1
    const remaining = next < 0 ? [] : worker.buildQueue!.slice(next)
    this.resetOrders(worker)
    const site = remaining.shift()
    if (site !== undefined) {
      worker.job = { kind: 'construct', site }
      worker.buildQueue = remaining
    }
  }

  private startUpgrade(building: Unit, kind: UpgradeKind) {
    const rule = upgrades[kind]
    const stock = this.resources[building.faction]
    if (building.kind !== 'smithy' || building.buildDuration || building.upgradeJob ||
        this.upgrades[building.faction].includes(kind) || !canAfford(stock, rule.cost) ||
        [...this.units.values()].some(unit => unit.faction === building.faction && unit.upgradeJob?.kind === kind)) return false
    spend(stock, rule.cost)
    building.upgradeJob = { kind, left: rule.ticks }
    return true
  }

  private research(building: Unit) {
    if (!building.upgradeJob || --building.upgradeJob.left > 0) return
    this.upgrades[building.faction].push(building.upgradeJob.kind)
    building.upgradeJob = undefined
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
        for (const queued of unit.queue) reserved += training[queued.kind].population * (queued.count ?? 1)
      }
    }
    return { used, reserved, limit }
  }

  private enqueue(building: Unit, kind: UnitKind, count: number) {
    if (building.buildDuration || !trainedAt(building.kind).includes(kind) || !Number.isSafeInteger(count) || count < 1) return false
    const rule = training[kind]
    const stock = this.resources[building.faction]
    const { used, reserved, limit } = this.population(building.faction)
    if (count > Math.floor(stock.gold / rule.gold) || count > Math.floor((limit - used - reserved) / rule.population)) return false
    stock.gold -= count * rule.gold
    const tail = building.queue.at(-1)
    if (tail?.kind === kind) tail.count = (tail.count ?? 1) + count
    else building.queue.push({ kind, left: rule.ticks, count })
    return true
  }

  private cancelTraining(building: Unit, count: number) {
    if (!Number.isSafeInteger(count) || count < 1 || !building.queue.length) return false
    const stock = this.resources[building.faction]
    while (count > 0 && building.queue.length) {
      const tail = building.queue.at(-1)!
      const size = tail.count ?? 1
      const removed = Math.min(count, size)
      count -= removed
      stock.gold += removed * training[tail.kind].gold
      if (removed === size) building.queue.pop()
      else tail.count = size - removed
    }
    return true
  }

  private cancelConstruction(site: Unit) {
    if (!site.buildDuration || !isBuildingKind(site.kind)) return false
    const cost = buildingRules[site.kind].cost
    const remaining = (site.buildDuration - site.buildTicks) / site.buildDuration
    const stock = this.resources[site.faction]
    for (const resource of resourceKinds) stock[resource] += Math.floor((cost[resource] ?? 0) * remaining)
    this.units.delete(site.id)
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
    let spawnPoint: Point | undefined
    spawnSlots: for (const angle of slots) {
      const point = { x: building.x + direction * Math.cos(angle) * bounds, y: building.y + Math.sin(angle) * bounds }
      if (!canStand(this.map, point, obstacles, radius)) continue
      spawnPoint ??= point
      for (const unit of this.nearby.near(point, radius + maxRadius + 4)) {
        if (isUnitKind(unit.kind) && distance(point, unit) < radius + unitStats[unit.faction][unit.kind].radius + 4) {
          continue spawnSlots
        }
      }
      spawnPoint = point
      break
    }
    if (!spawnPoint) return
    if ((next.count ?? 1) <= 1) building.queue.shift()
    else {
      next.count = next.count! - 1
      next.left = training[next.kind].ticks
    }
    this.spawn(building.faction, next.kind, spawnPoint)
  }

  private work(worker: Unit, obstacles: Obstacle[]) {
    const job = worker.job
    if (!job) return
    if (job.kind === 'repair') {
      const site = this.units.get(job.site)
      if (!site || site.hp === site.maxHp) {
        this.resetOrders(worker)
        return
      }
      const stock = this.resources[worker.faction]
      const cost = repairCost(site.kind)
      if (!canAfford(stock, cost)) {
        this.resetOrders(worker)
        return
      }
      if (distance(worker, site) > unitStats[site.faction][site.kind].radius + 27) {
        this.approach(worker, site, obstacles, true)
        return
      }
      if (++job.workTicks >= REPAIR.ticks) {
        job.workTicks = 0
        spend(stock, cost)
        site.hp = Math.min(site.maxHp, site.hp + REPAIR.health)
        if (site.hp === site.maxHp) this.resetOrders(worker)
      }
      return
    }
    if (job.kind === 'construct') {
      const site = this.units.get(job.site)
      if (!site || !site.buildDuration) {
        this.nextConstruction(worker)
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
        this.nextConstruction(worker)
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
    this.nearby.reset(this.units.values())
    const incoming: Missile[] = []
    for (const missile of this.missiles) {
      if (missile.arrives <= this.tick) this.hit(missile.attacker, missile.targetId)
      else incoming.push(missile)
    }
    this.missiles = incoming
    const hostileBuildings: Record<Faction, Obstacle[]> = { human: [], orc: [] }
    for (const building of this.units.values()) {
      if (isUnitKind(building.kind)) continue
      const opponent = building.faction === 'human' ? 'orc' : 'human'
      hostileBuildings[opponent].push({ x: building.x, y: building.y, radius: unitStats[building.faction][building.kind].radius })
    }
    for (const unit of this.units.values()) {
      unit.moving = false
      if (unit.buildDuration) continue
      const stats = unitStats[unit.faction][unit.kind]
      const obstacles = hostileBuildings[unit.faction]
      if (!isUnitKind(unit.kind)) {
        this.train(unit, obstacles)
        this.research(unit)
      }
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
      const defenderTarget = this.defendedAgainst(unit)
      target ??= defenderTarget
      if (automaticRange > 0 && unit.order?.kind !== 'move' && !target) {
        let nearest = automaticRange
        for (const other of this.nearby.near(unit, automaticRange + maxRadius)) {
          if (other.faction === unit.faction || (unit.kind === 'tower' && !isUnitKind(other.kind))) continue
          const separation = distance(unit, other) - unitStats[other.faction][other.kind].radius
          if ((separation < nearest || (separation === nearest && target && this.nearby.before(other, target))) && this.visibility.at(unit.faction, other) === 2) {
            nearest = separation
            target = other
          }
        }
      }
      if (target && this.fight(unit, target)) continue

      let destination = unit.assigned
      if (target && (defenderTarget || unit.order?.kind === 'attack' || unit.order?.kind === 'advance')) {
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

  private defendedAgainst(unit: Unit) {
    if (!unit.defense) return
    const { targetId, at, until } = unit.defense
    const attacker = this.units.get(targetId)
    if (attacker && this.tick < until && distance(unit, at) <= defenseLeash &&
        distance(attacker, at) <= defenseLeash && this.visibility.at(unit.faction, attacker) === 2) return attacker
    unit.defense = null
  }

  private callDefenders(victim: Unit, attacker: Unit) {
    if (!this.units.has(attacker.id) || this.visibility.at(victim.faction, attacker) !== 2) return
    const at = { x: victim.x, y: victim.y }
    const radius = defenseRadius + unitStats[victim.faction][victim.kind].radius
    if (distance(at, attacker) > defenseLeash) return
    for (const unit of this.nearby.near(at, radius)) {
      if (unit.faction !== victim.faction || !isUnitKind(unit.kind) || !unitStats[unit.faction][unit.kind].damage ||
          unit.order?.kind === 'move' || unit.order?.kind === 'attack' || distance(unit, at) > radius) continue
      const current = this.defendedAgainst(unit)
      if (current && current !== attacker && distance(unit, current) <= distance(unit, attacker)) continue
      unit.defense = { targetId: attacker.id, at, until: this.tick + defenseDuration }
    }
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
    const attackBonus = isUnitKind(attacker.kind) && this.upgrades[attacker.faction].includes('weapons') ? upgrades.weapons.bonus : 0
    const armorBonus = isUnitKind(target.kind) && target.kind !== 'worker' && this.upgrades[target.faction].includes('armor') ? upgrades.armor.bonus : 0
    const damage = Math.max(1, unitStats[attacker.faction][attacker.kind].damage + attackBonus -
      unitStats[target.faction][target.kind].armor - armorBonus)
    target.hp = Math.max(0, target.hp - damage)
    this.callDefenders(target, attacker)
    const at = { x: target.x, y: target.y }
    this.effects.push({
      id: ++this.sequence, kind: 'hit', at, to: { x: attacker.x, y: attacker.y },
      faction: attacker.faction, entityKind: attacker.kind
    })
    if (!target.hp) this.destroy(target)
  }

  private destroy(target: Unit) {
    this.units.delete(target.id)
    this.nearby.remove(target)
    this.effects.push({ id: ++this.sequence, kind: 'fallen', at: { x: target.x, y: target.y },
      faction: target.faction, entityKind: target.kind })
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
      if (Math.abs(x - unit.x) > 0.8) unit.facing = x < unit.x ? -1 : 1
      unit.x = x
      unit.y = y
      this.nearby.update(unit)
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
      resources: world.resources[faction], population: world.population[faction], upgrades: world.upgrades[faction],
      entities: world.entities.flatMap(entity => {
        if (entity.faction === faction) return [entity]
        if (!visible(entity)) return []
        const { idle: _idle, repairing: _repair, constructionStatus: _status, research: _research, training: _training, ...seen } = entity
        return [seen]
      }),
      effects: world.effects.filter(effect => visible(effect.at) && (!effect.to || visible(effect.to)))
    }
  }

  snapshot(consumeEffects = false): WorldSnapshot {
    const effects = this.effects
    const construction = new Map<number, Entity['constructionStatus']>()
    const repairs = new Set<number>()
    for (const unit of this.units.values()) {
      if (unit.job?.kind === 'construct') construction.set(unit.job.site, 'building')
      if (unit.job?.kind === 'repair') {
        repairs.add(unit.job.site)
        repairs.add(unit.id)
      }
      for (const id of unit.buildQueue ?? []) construction.set(id, 'queued')
    }
    if (consumeEffects) this.effects = []
    return {
      type: 'snapshot', tick: this.tick, effects: consumeEffects ? effects : [],
      resources: { human: { ...this.resources.human }, orc: { ...this.resources.orc } },
      population: { human: this.population('human'), orc: this.population('orc') },
      upgrades: { human: [...this.upgrades.human], orc: [...this.upgrades.orc] },
      entities: [...this.units.values()].map(unit => {
        const { id, x, y, kind, faction, hp, maxHp, facing, moving, cargo, queue, buildDuration, buildTicks } = unit
        const next = queue[0]
        return {
          id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, kind, faction, hp, maxHp, facing, moving,
          construction: buildDuration ? buildTicks / buildDuration : undefined,
          constructionStatus: buildDuration ? construction.get(id) ?? 'paused' : undefined,
          research: unit.upgradeJob ? { kind: unit.upgradeJob.kind, progress: 1 - unit.upgradeJob.left / upgrades[unit.upgradeJob.kind].ticks } : undefined,
          repairing: repairs.has(id) || undefined,
          carrying: cargo ?? undefined,
          idle: kind === 'worker' ? !unit.job && !unit.assigned : undefined,
          training: next ? { kind: next.kind, progress: 1 - next.left / training[next.kind].ticks, remaining: queue.reduce((total, entry) => total + (entry.count ?? 1), 0),
            seconds: Math.ceil(next.left / TICK_HZ), queue: queue.map(entry => ({ kind: entry.kind, count: entry.count ?? 1 })) } : undefined
        }
      })
    }
  }
}
