import { TILE, ashford, ashfordMap, cellCenter, distance, mapForSettings, resourceAt, snapToCell, wallLine, isWalkable, isWater, tileAt } from '../shared/map.ts'
import type { BattleMap, MapId } from '../shared/map.ts'
import { MAX_SELECTION, factions, inTroopGroup, isBuildingKind, isHeroKind, isShipKind, isUnitKind, opposite, resourceKinds } from '../shared/protocol.ts'
import type { ArmyOrder, TroopGroup, Effect, Entity, EntityKind, Faction, HeroKind, Order, Point, Population, ResourceKind, Resources, Result, Snapshot, UnitKind, UpgradeKind } from '../shared/protocol.ts'
import { heroAbilities, heroDamagePerLevel, heroHealthPerLevel, heroLevel, heroMaxExperience } from '../shared/heroes.ts'
import { allocateTraining, trainingTimeline } from '../shared/production.ts'
import { unitStats } from '../shared/units.ts'
import { BASE_POPULATION, FARM_POPULATION, GATHERING,
  buildings as buildingRules, buildingFootprint, canAfford, REPAIR, repairCost, spend, trainedAt, training, trainingCost, MAX_UPGRADE_LEVEL, structureUpgrade, upgrades, validPlacement } from '../shared/economy.ts'
import { canStand, clearSegment, findPath, NavigationGrid } from './navigation.ts'
import type { Obstacle } from './navigation.ts'
import { ARMY_SCORE_PER_UNIT, TICKS_PER_SECOND, defaultMatchSettings, emptyMatchStats } from '../shared/match-settings.ts'
import type { FinalStats, MatchReport, MatchSettings, MatchStats } from '../shared/match-settings.ts'
import { formationSlots } from './formations.ts'
import { AttackAlerts } from './attack-alerts.ts'
import { SpatialIndex } from './spatial.ts'
import { Visibility } from './visibility.ts'

export const TICK_HZ = TICKS_PER_SECOND
const spacing = 30
const maxRadius = Math.max(...Object.values(unitStats).flatMap(stats => Object.values(stats).map(unit => unit.radius)))
const defenseRadius = 5 * TILE
const defenseLeash = 8 * TILE
const defenseDuration = 4 * TICK_HZ
const routesPerTick = 48
const squaredDistance = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2
const steering = [0, 0.54, -0.54, 1.05, -1.05, 1.4, -1.4]
  .map(angle => ({ sin: Math.sin(angle), cos: Math.cos(angle), direct: angle === 0 }))
const isRanged = (kind: EntityKind) => kind === 'ranged' || kind === 'marksman' || kind === 'pathfinder'

type WorkerJob = { kind: 'gather', at: Point, resource: ResourceKind, workTicks: number } | { kind: 'construct', site: number }
  | { kind: 'repair', site: number, workTicks: number }
type Defense = { targetId: number, at: Point, until: number }

type Unit = Entity & {
  order: Order | null
  assigned: Point | null
  flank?: number
  nextStrike: number
  nextPath: number
  path: Point[]
  pursued: Point | null
  lastTarget: Point | null
  defense: Defense | null
  blockedTicks: number
  job: WorkerJob | null
  cargo: ResourceKind | null
  cargoAmount?: number
  queue: Array<{ kind: UnitKind, left: number, count?: number }>
  buildTicks: number
  buildDuration: number
  embarkedOn?: number
  passengers?: number[]
  buildQueue?: number[]
  upgradeJob?: { kind: UpgradeKind, left: number }
  structureJob?: { left: number, total: number }
  level?: number
}

type WorldSnapshot = Omit<Snapshot, 'resources' | 'population' | 'fog' | 'upgrades'> & {
  resources: Record<Faction, Resources>, population: Record<Faction, Population>, upgrades: Record<Faction, UpgradeKind[]>
}

type Missile = { attacker: Unit, targetId: number, arrives: number }

export type MatchCheckpoint = {
  map?: MapId
  mapSeed?: number
  settings?: MatchSettings
  stats?: Record<Faction, MatchStats>
  extracted?: Array<[number, number]>
  knownDepletion?: Partial<Record<Faction, number[]>>
  tick: number
  result: Result | null
  sequence: number
  resources: Record<Faction, Resources>
  units: Unit[]
  missiles: Missile[]
  fog: Record<Faction, string>
  upgrades?: Record<Faction, UpgradeKind[]>
  heroExperience?: Record<Faction, Partial<Record<HeroKind, number>>>
}

export class Match {
  readonly units = new Map<number, Unit>()
  readonly map: BattleMap
  readonly settings: MatchSettings
  private readonly attackAlerts = { human: new AttackAlerts(), orc: new AttackAlerts() }
  private readonly nearby = { human: new SpatialIndex<Unit>(), orc: new SpatialIndex<Unit>() }
  private readonly activeHeroes: Partial<Record<Faction, Unit>> = {}
  private readonly heroExperience: Record<Faction, Partial<Record<HeroKind, number>>> = { human: {}, orc: {} }
  private readonly routes = new Map<Unit, Point>()
  private readonly navigation: Partial<Record<Faction, { key: string, grid: NavigationGrid }>> = {}
  tick = 0
  result: Result | null = null
  private readonly resources: Record<Faction, Resources>
  private readonly stats = { human: emptyMatchStats(), orc: emptyMatchStats() }
  private readonly extracted = new Map<number, number>()
  private readonly harvesting = new Map<number, number>()
  private readonly depletion = { human: new Set<number>(), orc: new Set<number>() }
  private readonly visibleDepletion: Partial<Record<Faction, number[]>> = {}
  private readonly exhausted = new Set<number>()
  private readonly upgrades: Record<Faction, UpgradeKind[]> = { human: [], orc: [] }
  private sequence = 0
  private effects: Effect[] = []
  private missiles: Missile[] = []
  private readonly visibility: Visibility

  constructor(map: BattleMap = ashford, settings = defaultMatchSettings(map.id)) {
    this.map = map
    this.settings = settings
    this.resources = { human: { ...settings.starting }, orc: { ...settings.starting } }
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
    this.visibility.update([...this.units.values()].filter(unit => !unit.embarkedOn))
  }

  static start(settings: MatchSettings) {
    const seed = settings.randomStarts === false ? undefined : globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
    return Match.configured(settings, seed)
  }

  static configured(settings: MatchSettings, seed?: number) {
    return new Match(mapForSettings(settings, seed), settings)
  }

  static restore(checkpoint: MatchCheckpoint, map = checkpoint.settings
    ? mapForSettings(checkpoint.settings, checkpoint.mapSeed) : ashfordMap(checkpoint.map ?? 'ashford-original')) {
    const match = new Match(map, checkpoint.settings)
    Object.assign(match.stats, checkpoint.stats)
    for (const [index, amount] of checkpoint.extracted ?? []) {
      match.extracted.set(index, amount)
      const resource = resourceAt(map, cellCenter(index % map.width, Math.floor(index / map.width)))
      if (resource && amount >= (match.settings.sources[resource].stock ?? Infinity)) match.exhausted.add(index)
    }
    for (const faction of factions) {
      for (const index of checkpoint.knownDepletion?.[faction] ?? []) match.depletion[faction].add(index)
    }
    match.tick = checkpoint.tick
    match.result = checkpoint.result
    match.sequence = checkpoint.sequence
    Object.assign(match.resources, checkpoint.resources)
    Object.assign(match.upgrades, checkpoint.upgrades)
    Object.assign(match.heroExperience, checkpoint.heroExperience)
    // Normalize max health when resuming a save made before a balance update.
    for (const unit of checkpoint.units) {
      let maxHp = unitStats[unit.faction][unit.kind].health
      if (isHeroKind(unit.kind)) {
        unit.experience = match.heroExperience[unit.faction][unit.kind] ?? unit.experience ?? 0
        match.heroExperience[unit.faction][unit.kind] = unit.experience
        maxHp += (heroLevel(unit.experience) - 1) * heroHealthPerLevel
        match.activeHeroes[unit.faction] = unit
      }
      if (isUnitKind(unit.kind) && unit.kind !== 'worker' && unit.kind !== 'scout') {
        maxHp += (match.upgrades[unit.faction] ?? []).filter(kind => kind === 'vitality').length * upgrades.vitality.bonus
      }
      if (unit.kind === 'wall' || unit.kind === 'tower') {
        unit.level = Math.max(1, Math.min(MAX_UPGRADE_LEVEL, unit.level ?? 1))
        maxHp += (unit.level - 1) * (unit.kind === 'wall' ? 100 : 85)
      }
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
      map: this.map.id, mapSeed: this.map.seed, settings: this.settings, stats: this.stats, extracted: [...this.extracted],
      knownDepletion: this.visibleDepletion, tick: this.tick, result: this.result, sequence: this.sequence, resources: this.resources,
      units: [...this.units.values()], missiles: this.missiles, upgrades: this.upgrades,
      heroExperience: this.heroExperience,
      fog: { human: this.visibility.mask('human'), orc: this.visibility.mask('orc') }
    }
  }

  private spawn(faction: Faction, kind: EntityKind, position: Point, buildDuration = 0) {
    const experience = isHeroKind(kind) ? this.heroExperience[faction][kind] ?? 0 : undefined
    const health = unitStats[faction][kind].health + (experience ? (heroLevel(experience) - 1) * heroHealthPerLevel : 0) +
      (isUnitKind(kind) && kind !== 'worker' && kind !== 'scout' ? this.upgrades[faction].filter(value => value === 'vitality').length * upgrades.vitality.bonus : 0)
    const id = ++this.sequence
    const unit: Unit = {
      ...position, faction, kind, id, experience, level: kind === 'wall' || kind === 'tower' ? 1 : undefined, hp: buildDuration ? Math.ceil(health * 0.2) : health,
      maxHp: health, moving: false, facing: faction === 'human' ? 1 : -1, order: null, assigned: null,
      path: [], nextPath: 0, nextStrike: 0, pursued: null, lastTarget: null, defense: null, blockedTicks: 0,
      job: null, cargo: null, queue: [], buildTicks: 0, buildDuration
    }
    this.units.set(id, unit)
    if (isHeroKind(kind)) this.activeHeroes[faction] = unit
    this.nearby[unit.faction].update(unit)
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
    return this.issue(faction, units, order)
  }

  commandGroup(faction: Faction, group: TroopGroup, order: ArmyOrder) {
    if (this.result) return false
    const units = [...this.units.values()].filter(unit => unit.faction === faction && inTroopGroup(unit.kind, group))
    return units.length > 0 && this.issue(faction, units, order)
  }

  private issue(faction: Faction, units: Unit[], order: Order) {
    if (order.kind === 'hero-ability') {
      if (units.length !== 1 || !isHeroKind(units[0].kind)) return false
      const hero = units[0]
      const ability = heroAbilities[hero.kind as HeroKind]
      if (this.tick < (hero.abilityReadyAt ?? 0)) return false
      hero.abilityReadyAt = this.tick + ability.cooldown
      if (hero.kind === 'vanguard') {
        hero.abilityActiveUntil = this.tick + ability.duration
      } else {
        // A single authoritative AoE hit. Respect current sight and never hit allies.
        const enemies = this.nearby[opposite(faction)]
        for (const enemy of enemies.near(hero, ability.radius)) {
          if (squaredDistance(hero, enemy) > ability.radius ** 2 ||
              this.visibility.at(faction, enemy) !== 2) continue
          this.heroSkillHit(hero, enemy, ability.bonus)
        }
      }
      return true
    }
    if (order.kind === 'board') {
      const ship = this.units.get(order.transport)
      if (!ship || ship.kind !== 'transport' || ship.faction !== faction || ship.buildDuration) return false
      const candidates = units.filter(unit => isUnitKind(unit.kind) && !isShipKind(unit.kind) &&
        unit.kind !== 'worker' && !unit.embarkedOn && distance(unit, ship) <= 5 * TILE)
      if (candidates.length !== units.length) return false
      const used = (ship.passengers ?? []).reduce((total, id) => {
        const passenger = this.units.get(id)
        return total + (passenger ? training[passenger.kind as UnitKind].population : 0)
      }, 0)
      const load = candidates.reduce((total, unit) => total + training[unit.kind as UnitKind].population, 0)
      if (used + load > 30) return false
      ship.passengers ??= []
      for (const unit of candidates) {
        this.resetOrders(unit)
        unit.embarkedOn = ship.id
        ship.passengers.push(unit.id)
      }
      return true
    }
    if (order.kind === 'unload') {
      if (units.length !== 1 || units[0].kind !== 'transport') return false
      const ship = units[0]
      const passengers = (ship.passengers ?? []).map(id => this.units.get(id)).filter((unit): unit is Unit => Boolean(unit))
      if (!passengers.length) return false
      const x = Math.floor(ship.x / TILE), y = Math.floor(ship.y / TILE)
      const sites: Point[] = []
      for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
        if (!isWalkable(tileAt(this.map, x + dx, y + dy))) continue
        const at = cellCenter(x + dx, y + dy)
        if (distance(ship, at) <= 7 * TILE) sites.push(at)
      }
      sites.sort((a, b) => distance(ship, a) - distance(ship, b))
      if (sites.length < passengers.length) return false
      for (let i = 0; i < passengers.length; i++) {
        const passenger = passengers[i]
        passenger.embarkedOn = undefined
        Object.assign(passenger, sites[i])
        this.nearby[faction].update(passenger)
      }
      ship.passengers = []
      return true
    }
    if (order.kind === 'structure-upgrade') return units.length === 1 && this.startStructureUpgrade(units[0])
    if (order.kind === 'upgrade') return units.length === 1 && this.startUpgrade(units[0], order.upgrade)
    if (order.kind === 'train') return units.length === 1 && this.enqueue(units[0], order.unit, order.count ?? 1)
    if (order.kind === 'cancel-train') return units.length === 1 && this.cancelTraining(units[0], order.count)
    if (order.kind === 'cancel-build') return units.length === 1 && this.cancelConstruction(units[0])
    if (order.kind === 'demolish') {
      const [building] = units
      if (units.length !== 1 || building.kind === 'headquarters' || isUnitKind(building.kind) || building.buildDuration) return false
      this.destroy(building)
      return true
    }
    if (order.kind === 'gather' || order.kind === 'build' || order.kind === 'wall-line' ||
        order.kind === 'resume-build' || order.kind === 'repair') {
      return this.assignWorkers(faction, units.filter(unit => unit.kind === 'worker'), order)
    }
    if (units.some(unit => !isUnitKind(unit.kind) || unit.embarkedOn)) return false
    if (order.kind === 'explore' && units.some(unit => unit.kind !== 'scout')) return false
    if (order.kind === 'attack' && units.some(unit => unit.kind === 'scout' || unit.kind === 'transport')) return false
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
    if ((order.kind === 'move' || order.kind === 'advance' || order.kind === 'attack') && order.formation) {
      const anchor = order.kind === 'attack' ? this.units.get(order.target)! : order.to
      for (const { unit, at, flank } of formationSlots(troops, anchor, order.formation)) {
        this.resetOrders(unit)
        unit.order = order
        if (order.kind === 'attack') {
          unit.lastTarget = { x: anchor.x, y: anchor.y }
          if (flank) unit.flank = flank
        } else {
          unit.assigned = this.fitFormationSlot(unit, at, anchor)
          if (order.kind === 'advance' && flank) unit.flank = flank
        }
      }
      return true
    }
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

  private scoutDestination(scout: Unit): Point | null {
    // Sample a sparse grid to avoid scanning every map tile on every simulation tick.
    const step = 3
    const offset = scout.id % step
    let best: Point | null = null
    let score = Infinity
    const reserved = [...this.units.values()].filter(unit => unit !== scout && unit.kind === 'scout' &&
      unit.faction === scout.faction && unit.order?.kind === 'explore' && unit.assigned).map(unit => unit.assigned!)
    for (let y = 2 + offset; y < this.map.height - 2; y += step) {
      for (let x = 2 + offset; x < this.map.width - 2; x += step) {
        const at = cellCenter(x, y)
        if (this.visibility.at(scout.faction, at) !== 0 || !isWalkable(tileAt(this.map, x, y))) continue
        const occupied = reserved.some(point => squaredDistance(point, at) < (6 * TILE) ** 2)
        if (occupied) continue
        const candidate = squaredDistance(scout, at)
        if (candidate < score) { score = candidate; best = at }
      }
    }
    return best
  }

  private fitFormationSlot(unit: Unit, at: Point, anchor: Point) {
    const radius = unitStats[unit.faction][unit.kind].radius
    for (const scale of [1, 0.75, 0.5, 0.25]) {
      const point = { x: anchor.x + (at.x - anchor.x) * scale, y: anchor.y + (at.y - anchor.y) * scale }
      if (canStand(this.map, point, [], radius)) return point
    }
    return anchor
  }

  private resetOrders(unit: Unit) {
    this.routes.delete(unit)
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
    unit.flank = undefined
  }

  private assignWorkers(faction: Faction, workers: Unit[], order: Extract<Order, { kind: 'gather' | 'build' | 'wall-line' | 'resume-build' | 'repair' }>) {
    if (!workers.length) return false
    if (order.kind === 'gather') {
      const resource = resourceAt(this.map, order.at)
      if (!resource || !this.availableDeposit(faction, order.at)) return false
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
      if (this.visibility.at(faction, at) === 0 || !validPlacement(this.map, kind, at, this.units.values())) continue
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

  private startStructureUpgrade(building: Unit) {
    if ((building.kind !== 'wall' && building.kind !== 'tower') || building.buildDuration || building.structureJob ||
        (building.level ?? 1) >= MAX_UPGRADE_LEVEL) return false
    const rule = structureUpgrade(building.kind, (building.level ?? 1) + 1)
    if (!canAfford(this.resources[building.faction], rule.cost)) return false
    spend(this.resources[building.faction], rule.cost)
    building.structureJob = { left: rule.ticks, total: rule.ticks }
    return true
  }

  private completeStructureUpgrade(building: Unit) {
    if (!building.structureJob || --building.structureJob.left > 0) return
    building.structureJob = undefined
    building.level = Math.min(MAX_UPGRADE_LEVEL, (building.level ?? 1) + 1)
    const bonus = building.kind === 'wall' ? 100 : 85
    building.maxHp += bonus
    building.hp += bonus
  }

  private startUpgrade(building: Unit, kind: UpgradeKind) {
    const rule = upgrades[kind]
    const stock = this.resources[building.faction]
    if (building.kind !== 'smithy' || building.buildDuration || building.upgradeJob ||
        this.upgrades[building.faction].filter(upgrade => upgrade === kind).length >= MAX_UPGRADE_LEVEL || !canAfford(stock, rule.cost) ||
        [...this.units.values()].some(unit => unit.faction === building.faction && unit.upgradeJob?.kind === kind)) return false
    spend(stock, rule.cost)
    building.upgradeJob = { kind, left: rule.ticks }
    return true
  }

  private research(building: Unit) {
    if (!building.upgradeJob || --building.upgradeJob.left > 0) return
    this.upgrades[building.faction].push(building.upgradeJob.kind)
    if (building.upgradeJob.kind === 'vitality') {
      for (const unit of this.units.values()) {
        if (unit.faction !== building.faction || !isUnitKind(unit.kind) || unit.kind === 'worker' || unit.kind === 'scout') continue
        unit.maxHp += upgrades.vitality.bonus
        unit.hp += upgrades.vitality.bonus
      }
    }
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

  trainGlobally(faction: Faction, kind: UnitKind, count: number): string | null {
    if (this.result) return 'The match has ended.'
    const buildings = [...this.units.values()].filter(building => building.faction === faction &&
      !building.buildDuration && trainedAt(building.kind).includes(kind))
    if (!buildings.length) return 'Build the required production building first.'
    const error = this.trainingError(faction, kind, count)
    if (error) return error
    const rule = training[kind]
    const loads = buildings.map(building => trainingTimeline(building.queue, building.queue[0]?.left ?? 0).ticks)
    const allocation = allocateTraining(loads, rule.ticks, count)
    for (const resource of resourceKinds) this.resources[faction][resource] -= count * (trainingCost(kind)[resource] ?? 0)
    buildings.forEach((building, i) => {
      if (allocation[i]) this.appendTraining(building, kind, allocation[i])
    })
    return null
  }

  private trainingError(faction: Faction, kind: UnitKind, count: number) {
    if (!Number.isSafeInteger(count) || count < 1) return 'Choose a valid unit count.'
    if (isHeroKind(kind) && (count !== 1 || this.activeHeroes[faction] ||
        [...this.units.values()].some(unit => unit.faction === faction && unit.queue.some(entry => isHeroKind(entry.kind))))) {
      return 'You can only have one active or queued hero.'
    }
    const rule = training[kind]
    for (const resource of resourceKinds) if (count * (trainingCost(kind)[resource] ?? 0) > this.resources[faction][resource]) return `Not enough ${resource}.`
    const { used, reserved, limit } = this.population(faction)
    if (count > Math.floor((limit - used - reserved) / rule.population)) return 'Not enough population space. Build more farms.'
    return null
  }

  private enqueue(building: Unit, kind: UnitKind, count: number) {
    if (building.buildDuration || !trainedAt(building.kind).includes(kind) || this.trainingError(building.faction, kind, count)) return false
    for (const resource of resourceKinds) this.resources[building.faction][resource] -= count * (trainingCost(kind)[resource] ?? 0)
    this.appendTraining(building, kind, count)
    return true
  }

  private appendTraining(building: Unit, kind: UnitKind, count: number) {
    const tail = building.queue.at(-1)
    if (tail?.kind === kind) tail.count = (tail.count ?? 1) + count
    else building.queue.push({ kind, left: training[kind].ticks, count })
  }

  private cancelTraining(building: Unit, count: number) {
    if (!Number.isSafeInteger(count) || count < 1 || !building.queue.length) return false
    const stock = this.resources[building.faction]
    while (count > 0 && building.queue.length) {
      const tail = building.queue.at(-1)!
      const size = tail.count ?? 1
      const removed = Math.min(count, size)
      count -= removed
      for (const resource of resourceKinds) stock[resource] += removed * (trainingCost(tail.kind)[resource] ?? 0)
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
    const bounds = unitStats[building.faction][building.kind].radius + radius + (building.kind === 'port' ? 55 : 16)
    const slots = [0, 0.65, -0.65, 1.3, -1.3, 2.0, -2.0, Math.PI]
    const direction = building.faction === 'human' ? 1 : -1
    let spawnPoint: Point | undefined
    if (isShipKind(next.kind)) {
      const cx = Math.floor(building.x / TILE), cy = Math.floor(building.y / TILE)
      const water: Point[] = []
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        if (isWater(tileAt(this.map, cx + dx, cy + dy))) water.push(cellCenter(cx + dx, cy + dy))
      }
      water.sort((a, b) => distance(a, building) - distance(b, building))
      spawnPoint = water.find(point => [...this.nearby.human.near(point, 60), ...this.nearby.orc.near(point, 60)]
        .every(unit => !isShipKind(unit.kind) || distance(unit, point) >= radius + unitStats[unit.faction][unit.kind].radius + 3))
    }
    spawnSlots: for (const angle of isShipKind(next.kind) ? [] : slots) {
      const point = { x: building.x + direction * Math.cos(angle) * bounds, y: building.y + Math.sin(angle) * bounds }
      if (isShipKind(next.kind) ? !isWater(tileAt(this.map, Math.floor(point.x / TILE), Math.floor(point.y / TILE))) : !canStand(this.map, point, obstacles, radius)) continue
      spawnPoint ??= point
      for (const unit of [...this.nearby.human.near(point, radius + maxRadius + 4), ...this.nearby.orc.near(point, radius + maxRadius + 4)]) {
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
    this.stats[building.faction].unitsTrained++
    if (next.kind !== 'worker') this.stats[building.faction].troopsTrained++
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
        this.stats[site.faction].buildingsBuilt++
        this.nextConstruction(worker)
      }
      return
    }
    if (worker.cargo) {
      const base = [...this.units.values()].find(unit => unit.faction === worker.faction && unit.kind === 'headquarters')
      if (!base) return
      if (distance(worker, base) <= unitStats[base.faction].headquarters.radius + 26) {
        const amount = worker.cargoAmount ?? GATHERING[worker.cargo].amount
        this.resources[worker.faction][worker.cargo] += amount
        this.stats[worker.faction].gathered[worker.cargo] += amount
        worker.cargo = null
        worker.cargoAmount = undefined
      } else this.approach(worker, base, obstacles, true)
    } else {
      this.harvest(worker, job, obstacles)
    }
  }

  private depositIndex(point: Point) {
    return Math.floor(point.y / TILE) * this.map.width + Math.floor(point.x / TILE)
  }

  availableDeposit(faction: Faction, point: Point) {
    return this.visibility.at(faction, point) > 0 && !this.exhausted.has(this.depositIndex(point))
  }

  private harvest(worker: Unit, job: Extract<WorkerJob, { kind: 'gather' }>, obstacles: Obstacle[]) {
    const index = this.depositIndex(job.at)
    if (this.exhausted.has(index)) {
      this.resetOrders(worker)
      return
    }
    if (distance(worker, job.at) >= 49) {
      this.approach(worker, job.at, obstacles, true)
      return
    }
    const { stock, workers } = this.settings.sources[job.resource]
    if (workers !== null) {
      const active = this.harvesting.get(index) ?? 0
      if (active >= workers) return
      this.harvesting.set(index, active + 1)
    }
    if (++job.workTicks < GATHERING[job.resource].ticks) return
    const extracted = this.extracted.get(index) ?? 0
    const amount = Math.min(GATHERING[job.resource].amount, (stock ?? Infinity) - extracted)
    worker.cargo = job.resource
    worker.cargoAmount = amount
    job.workTicks = 0
    if (stock !== null) {
      this.extracted.set(index, extracted + amount)
      if (extracted + amount >= stock) this.exhausted.add(index)
    }
  }

  report(): MatchReport {
    const sides = {} as Record<Faction, FinalStats>
    for (const faction of factions) {
      const bank = { ...this.resources[faction] }
      let army = 0
      for (const unit of this.units.values()) {
        if (unit.faction === faction && isUnitKind(unit.kind) && unit.kind !== 'worker') army++
      }
      const score = bank.gold + bank.wood + bank.stone + army * ARMY_SCORE_PER_UNIT
      sides[faction] = { ...this.stats[faction], gathered: { ...this.stats[faction].gathered }, bank, army, score }
    }
    return { elapsedSeconds: Math.floor(this.tick / TICK_HZ), sides }
  }

  step() {
    if (this.result) return
    this.tick++
    for (const faction of factions) this.attackAlerts[faction].advance(this.tick)
    this.harvesting.clear()
    for (const faction of factions) this.nearby[faction].reset([])
    for (const unit of this.units.values()) if (!unit.embarkedOn) this.nearby[unit.faction].update(unit)
    const incoming: Missile[] = []
    for (const missile of this.missiles) {
      if (missile.arrives <= this.tick) this.hit(missile.attacker, missile.targetId)
      else incoming.push(missile)
    }
    this.missiles = incoming
    const hostileBuildings: Record<Faction, Obstacle[]> = { human: [], orc: [] }
    for (const building of this.units.values()) {
      if (isUnitKind(building.kind)) continue
      const opponent = opposite(building.faction)
      hostileBuildings[opponent].push({ x: building.x, y: building.y, radius: building.kind === 'headquarters' ? unitStats[building.faction][building.kind].radius : buildingFootprint(building.kind) })
    }
    for (const unit of this.units.values()) {
      unit.moving = false
      if (unit.structureJob) this.completeStructureUpgrade(unit)
      if (unit.buildDuration || unit.embarkedOn) continue
      const stats = unitStats[unit.faction][unit.kind]
      const obstacles = hostileBuildings[unit.faction]
      if (unit.kind === 'scout' && unit.order?.kind === 'explore' &&
          (!unit.assigned || squaredDistance(unit, unit.assigned) < (TILE * 1.5) ** 2 || this.tick % 80 === unit.id % 80)) {
        const destination = this.scoutDestination(unit)
        if (destination) unit.assigned = destination
        else { this.resetOrders(unit) }
      }
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
        const enemies = this.nearby[opposite(unit.faction)]
        for (const other of enemies.near(unit, automaticRange + maxRadius)) {
          if ((unit.kind === 'tower' && !isUnitKind(other.kind)) || other.embarkedOn) continue
          const radius = unitStats[other.faction][other.kind].radius
          const gap = squaredDistance(unit, other)
          if (gap > (nearest + radius) ** 2) continue
          const separation = Math.sqrt(gap) - radius
          if ((separation < nearest || (separation === nearest && target && enemies.before(other, target))) && this.visibility.at(unit.faction, other) === 2) {
            nearest = separation
            target = other
          }
        }
      }
      if (target && !target.embarkedOn && stats.damage > 0 && this.fight(unit, target)) {
        this.routes.delete(unit)
        continue
      }

      let destination = unit.assigned
      if (target && (defenderTarget || unit.order?.kind === 'attack' || unit.order?.kind === 'advance')) {
        const range = unitStats[unit.faction][unit.kind].range + unitStats[target.faction][target.kind].radius - 4
        const separation = distance(unit, target) || 1
        if (unit.flank && (unit.order?.kind === 'attack' || unit.order?.kind === 'advance')) {
          const bearing = Math.atan2(unit.y - target.y, unit.x - target.x) + unit.flank
          const flanked = { x: target.x + Math.cos(bearing) * range, y: target.y + Math.sin(bearing) * range }
          if (canStand(this.map, flanked, obstacles, stats.radius)) destination = flanked
          else unit.flank = undefined
        }
        if (!unit.flank || defenderTarget || !destination) {
          destination = {
            x: target.x + (unit.x - target.x) * range / separation,
            y: target.y + (unit.y - target.y) * range / separation
          }
        }
      }
      if (destination && stats.speed && isShipKind(unit.kind)) this.sail(unit, destination)
      else if (destination && stats.speed) this.approach(unit, destination, obstacles, Boolean(target))
      else this.routes.delete(unit)
    }
    this.resolveRoutes(hostileBuildings)
    this.visibility.update(this.units.values())
    const standing = [...this.units.values()].filter(unit => unit.kind === 'headquarters')
    if (standing.length < 2) this.result = { winner: standing[0]?.faction ?? null, reason: 'headquarters' }
    else if (this.settings.minutes !== null && this.tick >= this.settings.minutes * 60 * TICK_HZ) {
      const { sides: { human, orc } } = this.report()
      this.result = { winner: human.score === orc.score ? null : human.score > orc.score ? 'human' : 'orc', reason: 'time' }
    }
  }

  private defendedAgainst(unit: Unit) {
    if (!unit.defense) return
    const { targetId, at, until } = unit.defense
    const attacker = this.units.get(targetId)
    if (attacker && this.tick < until && squaredDistance(unit, at) <= defenseLeash ** 2 &&
        squaredDistance(attacker, at) <= defenseLeash ** 2 && this.visibility.at(unit.faction, attacker) === 2) return attacker
    unit.defense = null
  }

  private callDefenders(victim: Unit, attacker: Unit) {
    if (!this.units.has(attacker.id) || this.visibility.at(victim.faction, attacker) !== 2) return
    const at = { x: victim.x, y: victim.y }
    const radius = defenseRadius + unitStats[victim.faction][victim.kind].radius
    if (squaredDistance(at, attacker) > defenseLeash ** 2) return
    for (const unit of this.nearby[victim.faction].near(at, radius)) {
      if (!isUnitKind(unit.kind) || !unitStats[unit.faction][unit.kind].damage ||
          unit.order?.kind === 'move' || unit.order?.kind === 'attack' || squaredDistance(unit, at) > radius ** 2) continue
      const current = this.defendedAgainst(unit)
      if (current && current !== attacker && squaredDistance(unit, current) <= squaredDistance(unit, attacker)) continue
      unit.defense = { targetId: attacker.id, at, until: this.tick + defenseDuration }
    }
  }

  private sail(unit: Unit, destination: Point) {
    const x = Math.floor(destination.x / TILE), y = Math.floor(destination.y / TILE)
    if (!isWater(tileAt(this.map, x, y))) {
      // Warships may attack targets ashore, but must remain at sea.
      const candidates: Point[] = []
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        if (isWater(tileAt(this.map, x + dx, y + dy))) candidates.push(cellCenter(x + dx, y + dy))
      }
      candidates.sort((a, b) => distance(a, destination) - distance(b, destination))
      if (!candidates.length) return
      destination = candidates[0]
    }
    if (distance(unit, destination) < TILE * .5) { unit.path = []; return }
    const goal = Math.floor(destination.y / TILE) * this.map.width + Math.floor(destination.x / TILE)
    if (unit.pursued?.x !== goal || !unit.path.length) {
      unit.pursued = { x: goal, y: 0 }
      const start = Math.floor(unit.y / TILE) * this.map.width + Math.floor(unit.x / TILE)
      const previous = new Int32Array(this.map.width * this.map.height).fill(-1)
      const queue = new Int32Array(previous.length)
      let head = 0, tail = 1
      queue[0] = start
      previous[start] = start
      while (head < tail && previous[goal] === -1) {
        const index = queue[head++], px = index % this.map.width, py = Math.floor(index / this.map.width)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx, ny = py + dy, next = ny * this.map.width + nx
          if (!isWater(tileAt(this.map, nx, ny)) || previous[next] !== -1) continue
          previous[next] = index
          queue[tail++] = next
        }
      }
      if (previous[goal] === -1) return
      const route: Point[] = []
      for (let at = goal; at !== start; at = previous[at]) route.push(cellCenter(at % this.map.width, Math.floor(at / this.map.width)))
      unit.path = route.reverse()
    }
    const next = unit.path[0]
    if (!next) return
    const gap = distance(unit, next), step = unitStats[unit.faction][unit.kind].speed / TICK_HZ
    if (gap <= step) {
      Object.assign(unit, next)
      unit.path.shift()
    } else {
      unit.x += (next.x - unit.x) * step / gap
      unit.y += (next.y - unit.y) * step / gap
    }
    unit.moving = true
    this.nearby[unit.faction].update(unit)
  }

  private approach(unit: Unit, destination: Point, obstacles: Obstacle[], pursuing: boolean) {
    const pending = this.routes.has(unit)
    if (pending || !unit.pursued || (this.tick >= unit.nextPath &&
        (squaredDistance(unit.pursued, destination) > 14 ** 2 || unit.blockedTicks >= 8))) {
      const radius = unitStats[unit.faction][unit.kind].radius
      if (!pending && clearSegment(this.map, unit, destination, obstacles, radius)) {
        this.setRoute(unit, destination, [destination])
      } else {
        this.routes.set(unit, destination)
        if (!unit.path.length) return
      }
    }
    this.walk(unit, obstacles, pursuing)
  }

  private resolveRoutes(obstacles: Record<Faction, Obstacle[]>) {
    if (!this.routes.size) return
    let processed = 0
    const checked = new Set<Faction>()
    for (const [unit, destination] of this.routes) {
      this.routes.delete(unit)
      if (this.units.get(unit.id) !== unit) continue
      const blockers = obstacles[unit.faction]
      let cached = this.navigation[unit.faction]
      // Rebuild at most once per side per batch, and only if hostile buildings changed.
      if (!checked.has(unit.faction)) {
        const key = blockers.map(({ x, y, radius }) => x + ',' + y + ',' + radius).join('|')
        if (cached?.key !== key) this.navigation[unit.faction] = cached = { key, grid: new NavigationGrid(this.map, blockers) }
        checked.add(unit.faction)
      }
      const path = findPath(this.map, unit, destination, blockers, unitStats[unit.faction][unit.kind].radius, cached?.grid)
      const order = unit.order
      if (path.length === 0 && (order?.kind === 'move' || order?.kind === 'advance') && order.formation &&
          unit.assigned && squaredDistance(unit.assigned, order.to) > 4) {
        unit.assigned = order.to
        unit.pursued = null
        unit.path = []
      } else if (path.length === 0 && unit.flank) {
        unit.flank = undefined
        unit.pursued = null
        unit.path = []
      } else this.setRoute(unit, destination, path)
      if (++processed === routesPerTick) break
    }
  }

  private setRoute(unit: Unit, destination: Point, path: Point[]) {
    unit.path = path
    unit.pursued = destination
    unit.nextPath = this.tick + 10
    unit.blockedTicks = 0
  }

  private fight(unit: Unit, target: Unit): boolean {
    const stats = unitStats[unit.faction][unit.kind]
    if (squaredDistance(unit, target) > (stats.range + unitStats[target.faction][target.kind].radius) ** 2) return false
    if (unit.nextStrike > this.tick) return true
    unit.nextStrike = this.tick + stats.cooldown
    unit.facing = target.x < unit.x ? -1 : 1
    if (isRanged(unit.kind) || unit.kind === 'tower' || unit.kind === 'warship') {
      const flight = Math.max(2, Math.ceil(distance(unit, target) / 24))
      this.missiles.push({ attacker: unit, targetId: target.id, arrives: this.tick + flight })
      this.effects.push({
        id: ++this.sequence, kind: 'shot', at: { x: unit.x, y: unit.y },
        to: { x: target.x, y: target.y }, faction: unit.faction, entityKind: unit.kind
      })
    } else this.hit(unit, target.id)
    return true
  }

  private heroSkillHit(attacker: Unit, target: Unit, power: number) {
    if (!this.units.has(target.id)) return
    const damage = Math.max(1, power - unitStats[target.faction][target.kind].armor -
      (target.kind === 'wall' || target.kind === 'tower' ? ((target.level ?? 1) - 1) * 2 : 0))
    target.hp = Math.max(0, target.hp - damage)
    if (isHeroKind(attacker.kind)) this.gainHeroExperience(attacker, 3)
    this.attackAlerts[target.faction].hit(target, this.tick)
    this.effects.push({ id: ++this.sequence, kind: 'hit', at: { x: target.x, y: target.y },
      to: { x: attacker.x, y: attacker.y }, faction: attacker.faction, entityKind: attacker.kind })
    if (!target.hp) {
      if (isUnitKind(target.kind)) this.stats[attacker.faction].enemiesKilled++
      else this.stats[attacker.faction].buildingsRazed++
      this.awardHeroExperience(attacker.faction, target)
      this.destroy(target)
    }
  }

  private hit(attacker: Unit, targetId: number) {
    const target = this.units.get(targetId)
    if (!target || target.embarkedOn) return
    const attackBonus = isUnitKind(attacker.kind) ? this.upgrades[attacker.faction].filter(kind => kind === 'weapons').length * upgrades.weapons.bonus +
      (isRanged(attacker.kind) || attacker.kind === 'warship' ? this.upgrades[attacker.faction].filter(kind => kind === 'precision').length * upgrades.precision.bonus : 0) : 0
    const armorBonus = isUnitKind(target.kind) && target.kind !== 'worker' ? this.upgrades[target.faction].filter(kind => kind === 'armor').length * upgrades.armor.bonus : 0
    const heroBonus = attacker.experience === undefined ? 0 :
      (heroLevel(attacker.experience) - 1) * heroDamagePerLevel +
      (attacker.kind === 'pathfinder' ? 5 : 0) +
      (attacker.kind === 'vanguard' && this.tick < (attacker.abilityActiveUntil ?? 0) ? 8 : 0)
    const damage = Math.max(1, unitStats[attacker.faction][attacker.kind].damage + attackBonus + heroBonus + (attacker.kind === 'tower' ? ((attacker.level ?? 1) - 1) * 5 : 0) -
      unitStats[target.faction][target.kind].armor - armorBonus - (target.kind === 'wall' || target.kind === 'tower' ? ((target.level ?? 1) - 1) * 2 : 0) -
      (target.kind === 'vanguard' ? 2 : 0))
    target.hp = Math.max(0, target.hp - damage)
    if (isHeroKind(attacker.kind)) this.gainHeroExperience(attacker, 3)
    this.attackAlerts[target.faction].hit(target, this.tick)
    this.callDefenders(target, attacker)
    const at = { x: target.x, y: target.y }
    this.effects.push({
      id: ++this.sequence, kind: 'hit', at, to: { x: attacker.x, y: attacker.y },
      faction: attacker.faction, entityKind: attacker.kind
    })
    if (!target.hp) {
      const stats = this.stats[attacker.faction]
      if (isUnitKind(target.kind)) stats.enemiesKilled++
      else stats.buildingsRazed++
      this.awardHeroExperience(attacker.faction, target)
      this.destroy(target)
    }
  }

  private awardHeroExperience(faction: Faction, defeated: Unit) {
    const hero = this.activeHeroes[faction]
    if (!hero || !isHeroKind(hero.kind) || squaredDistance(hero, defeated) > 224 ** 2) return
    const previous = hero.experience ?? 0
    const reward = defeated.kind === 'worker' ? 10 : isUnitKind(defeated.kind) ? 24 : 36
    this.gainHeroExperience(hero, reward)
  }

  private gainHeroExperience(hero: Unit, amount: number) {
    const previous = hero.experience ?? 0
    const gained = Math.min(heroMaxExperience, previous + amount)
    if (gained === previous) return
    hero.experience = gained
    this.heroExperience[hero.faction][hero.kind as HeroKind] = gained
    const health = (heroLevel(gained) - heroLevel(previous)) * heroHealthPerLevel
    hero.maxHp += health
    hero.hp += health
  }

  private destroy(target: Unit) {
    if (isUnitKind(target.kind)) this.stats[target.faction].unitsLost++
    else this.stats[target.faction].buildingsLost++
    for (const id of target.passengers ?? []) {
      const passenger = this.units.get(id)
      if (passenger) this.destroy(passenger)
    }
    if (target.embarkedOn) {
      const ship = this.units.get(target.embarkedOn)
      if (ship) ship.passengers = (ship.passengers ?? []).filter(id => id !== target.id)
    }
    this.units.delete(target.id)
    if (this.activeHeroes[target.faction] === target) delete this.activeHeroes[target.faction]
    this.nearby[target.faction].remove(target)
    this.routes.delete(target)
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
    for (const { sin, cos, direct } of steering) {
      const x = unit.x + (vx * cos - vy * sin) * step
      const y = unit.y + (vx * sin + vy * cos) * step
      const test = { x, y }
      if (!canStand(this.map, test, obstacles, stats.radius)) continue
      if (Math.abs(x - unit.x) > 0.8) unit.facing = x < unit.x ? -1 : 1
      unit.x = x
      unit.y = y
      this.nearby[unit.faction].update(unit)
      unit.moving = true
      unit.blockedTicks = direct ? 0 : unit.blockedTicks + 1
      return
    }
    unit.blockedTicks++
  }

  view(faction: Faction, world = this.snapshot(), fog = this.visibility.mask(faction)): Snapshot {
    const visible = (point: Point) => this.visibility.at(faction, point) === 2
    const depleted = this.depletion[faction]
    for (const index of this.exhausted) {
      if (!depleted.has(index) && visible(cellCenter(index % this.map.width, Math.floor(index / this.map.width)))) depleted.add(index)
    }
    if (depleted.size && depleted.size !== this.visibleDepletion[faction]?.length) this.visibleDepletion[faction] = [...depleted]
    const knownDepletion = this.visibleDepletion[faction]
    const alerts = this.attackAlerts[faction].current
    return {
      type: 'snapshot', tick: world.tick, fog, ...(alerts.length ? { alerts } : {}), ...(knownDepletion ? { depleted: knownDepletion } : {}),
      resources: world.resources[faction], population: world.population[faction], upgrades: world.upgrades[faction],
      entities: world.entities.flatMap(entity => {
        if (entity.embarkedOn) return []
        if (entity.faction === faction) return [entity]
        if (!visible(entity)) return []
        const { idle: _idle, repairing: _repair, constructionStatus: _status, research: _research, training: _training, passengers: _passengers, passengerPop: _passengerPop, ...seen } = entity
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
          id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, kind, faction, hp, maxHp, facing, moving, weaponLevel: isUnitKind(kind) ? this.upgrades[faction].filter(value => value === 'weapons').length : undefined, armorLevel: isUnitKind(kind) ? this.upgrades[faction].filter(value => value === 'armor').length : undefined, precisionLevel: isUnitKind(kind) ? this.upgrades[faction].filter(value => value === 'precision').length : undefined, vitalityLevel: isUnitKind(kind) ? this.upgrades[faction].filter(value => value === 'vitality').length : undefined, level: unit.level, upgradeProgress: unit.structureJob ? 1 - unit.structureJob.left / unit.structureJob.total : undefined, passengers: unit.passengers, passengerPop: unit.kind === 'transport' ? (unit.passengers ?? []).reduce((total, id) => {
             const passenger = this.units.get(id)
             return total + (passenger ? training[passenger.kind as UnitKind].population : 0)
           }, 0) : undefined, embarkedOn: unit.embarkedOn, experience: unit.experience, abilityReadyAt: unit.abilityReadyAt, abilityActiveUntil: unit.abilityActiveUntil,
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
