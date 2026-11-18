import { TILE, ashford, ashfordMap, cellCenter, distance, mapForSettings, resourceAt, snapToCell, wallLine, isWalkable, isWater, tileAt } from '../shared/map.ts'
import type { BattleMap, MapId } from '../shared/map.ts'
import { MAX_SELECTION, defaultRaces, factions, inTroopGroup, isBuildingKind, isHeroKind, isShipKind, isUnitKind, opposite, resourceKinds } from '../shared/protocol.ts'
import type { ArmyOrder, BuildingKind, ControlSite, Corpse, TroopGroup, Effect, Entity, EntityKind, Faction, PlayerRaces, HeroKind, Order, Point, Population, ResourceKind, Resources, Result, Snapshot, UnitKind, UpgradeKind } from '../shared/protocol.ts'
import { heroAbilities, heroDamagePerLevel, heroHealthPerLevel, heroLevel, heroMaxExperience } from '../shared/heroes.ts'
import { allocateTraining, trainingTimeline } from '../shared/production.ts'
import { raceRules, raceSkills } from '../shared/race-rules.ts'
import { unitStats } from '../shared/units.ts'
import { BASE_POPULATION, FARM_POPULATION, GATHERING,
  buildings as buildingRules, buildingFootprint, bulkStructureCost, canAfford, REPAIR, repairCost, researchCost, spend, trainedAt, training, trainingCost, trainingRule, MAX_UPGRADE_LEVEL, researchSite, structureUpgrade, upgradeLevelLimit, upgrades, validPlacement } from '../shared/economy.ts'
import { canStand, clearSegment, findPath, NavigationGrid } from './navigation.ts'
import type { Obstacle } from './navigation.ts'
import { CONTROL_RADIUS, TICKS_PER_SECOND, defaultMatchSettings, emptyMatchStats } from '../shared/match-settings.ts'
import type { FinalStats, MatchReport, MatchSettings, MatchStats } from '../shared/match-settings.ts'
import { formationSlots } from './formations.ts'
import { AttackAlerts } from './attack-alerts.ts'
import { SpatialIndex } from './spatial.ts'
import { Coast } from './coast.ts'
import type { Landing } from './coast.ts'
import { Visibility } from './visibility.ts'

export const TICK_HZ = TICKS_PER_SECOND
const transportCapacity = 30
const boardingTimeout = 180 * TICK_HZ
const maxRadius = Math.max(...Object.values(unitStats).flatMap(stats => Object.values(stats).map(unit => unit.radius)))
const defenseRadius = 8 * TILE
const defenseLeash = 11 * TILE
const defenseDuration = 4 * TICK_HZ
const routesPerTick = 48
const corpseLifetime = 34 * TICK_HZ
const summonLifetime = 30 * TICK_HZ
const maxCorpses = 240
const summonLimit = 10
const squaredDistance = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2
const steering = [0, 0.54, -0.54, 1.05, -1.05, 1.4, -1.4]
  .map(angle => ({ sin: Math.sin(angle), cos: Math.cos(angle), direct: angle === 0 }))
const isRanged = (kind: EntityKind) => kind === 'siege' || kind === 'ranged' || kind === 'marksman' || kind === 'pathfinder'
const benefitsFromRange = (kind: EntityKind) => isRanged(kind) || kind === 'warship' || kind === 'tower'

type WorkerJob = { kind: 'gather', at: Point, resource: ResourceKind, workTicks: number } | { kind: 'construct', site: number }
  | { kind: 'repair', site: number, workTicks: number }
type Defense = { targetId: number, at: Point, until: number }

type Unit = Entity & {
  order: Order | null
  assigned: Point | null
  flank?: number
  revealedUntil?: number
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
  pickup?: Landing & { until: number }
  unloadTotal?: number
  unloadRetryAt?: number
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
  races?: PlayerRaces
  corpses?: Corpse[]
  mapSeed?: number
  settings?: MatchSettings
  stats?: Record<Faction, MatchStats>
  territory?: Record<Faction, number>
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
  readonly races: PlayerRaces
  readonly settings: MatchSettings
  private readonly attackAlerts = { human: new AttackAlerts(), orc: new AttackAlerts() }
  private readonly nearby = { human: new SpatialIndex<Unit>(), orc: new SpatialIndex<Unit>() }
  private readonly activeHeroes: Partial<Record<Faction, Unit>> = {}
  private readonly heroExperience: Record<Faction, Partial<Record<HeroKind, number>>> = { human: {}, orc: {} }
  private coast?: Coast
  private readonly controlSites: ControlSite[]
  private readonly deposits: Array<{ index: number, resource: ResourceKind, at: Point }>
  private readonly territory = { human: 0, orc: 0 }
  private readonly routes = new Map<Unit, Point>()
  private readonly navigation: Partial<Record<Faction, { key: string, grid: NavigationGrid }>> = {}
  tick = 0
  result: Result | null = null
  private readonly corpses = new Map<number, Corpse>()
  private readonly summoned = new Set<number>()
  private readonly usesCorpses: boolean
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

  constructor(map: BattleMap = ashford, settings = defaultMatchSettings(map.id), races = defaultRaces) {
    this.map = map
    this.races = { ...races }
    this.usesCorpses = Object.values(races).includes('undead')
    this.settings = settings
    this.controlSites = settings.minutes ? this.scoreSites() : []
    this.deposits = map.tiles.flatMap((tile, index) => {
      const resource = tile === 'forest' ? 'wood' : tile === 'mine' ? 'gold' : tile === 'quarry' ? 'stone' : null
      return resource ? [{ index, resource, at: cellCenter(index % map.width, Math.floor(index / map.width)) }] : []
    })
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
    this.visibility.update(this.units.values())
  }

  static start(settings: MatchSettings, races = defaultRaces) {
    const seed = settings.randomStarts === false ? undefined : globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
    return Match.configured(settings, seed, races)
  }

  static practice(faction: Faction, races: PlayerRaces) {
    const settings = { ...defaultMatchSettings('ashford-original'), randomStarts: false, populationCap: 30 }
    const match = Match.configured(settings, undefined, races)
    const base = match.map.bases[faction]
    const clear = (kind: BuildingKind) => {
      for (let y = -4; y <= 4; y++) {
        for (let x = -4; x <= 4; x++) {
          const site = snapToCell({ x: base.x + x * TILE, y: base.y + y * TILE })
          if (validPlacement(match.map, kind, site, match.units.values())) return site
        }
      }
      throw Error('No room for practice buildings')
    }
    match.spawn(faction, 'barracks', clear('barracks'))
    match.spawn(faction, 'farm', clear('farm'))
    match.visibility.update(match.units.values())
    return match
  }

  static configured(settings: MatchSettings, seed?: number, races = defaultRaces) {
    return new Match(mapForSettings(settings, seed), settings, races)
  }

  static restore(checkpoint: MatchCheckpoint, map = checkpoint.settings
    ? mapForSettings(checkpoint.settings, checkpoint.mapSeed) : ashfordMap(checkpoint.map ?? 'ashford-original')) {
    const match = new Match(map, checkpoint.settings, checkpoint.races)
    Object.assign(match.stats, checkpoint.stats)
    Object.assign(match.territory, checkpoint.territory)
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
      let maxHp = unitStats[match.races[unit.faction]][unit.kind].health
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
        maxHp = match.fortificationMaxHp(unit.faction, unit.kind, unit.level)
      }
      unit.race = match.races[unit.faction] === unit.faction ? undefined : match.races[unit.faction]
      unit.hp = Math.min(maxHp, Math.max(1, Math.ceil(unit.hp * maxHp / unit.maxHp)))
      unit.maxHp = maxHp
    }
    match.units.clear()
    for (const faction of factions) match.nearby[faction].reset([])
    for (const unit of checkpoint.units) {
      match.units.set(unit.id, unit)
      if (!unit.embarkedOn) match.nearby[unit.faction].update(unit)
      if (unit.summonedUntil) match.summoned.add(unit.id)
    }
    for (const corpse of checkpoint.corpses ?? []) match.corpses.set(corpse.id, corpse)
    match.missiles = checkpoint.missiles.map(missile =>
      ({ ...missile, attacker: match.units.get(missile.attacker.id) ?? missile.attacker }))
    match.visibility.restore(checkpoint.fog)
    match.scoreControl(false)
    return match
  }

  checkpoint(): MatchCheckpoint {
    return {
      map: this.map.id, races: this.races, ...(this.corpses.size ? { corpses: [...this.corpses.values()] } : {}), mapSeed: this.map.seed, settings: this.settings, stats: this.stats, extracted: [...this.extracted],
      territory: { ...this.territory }, knownDepletion: this.visibleDepletion, tick: this.tick, result: this.result, sequence: this.sequence, resources: this.resources,
      units: [...this.units.values()], missiles: this.missiles, upgrades: this.upgrades,
      heroExperience: this.heroExperience,
      fog: { human: this.visibility.mask('human'), orc: this.visibility.mask('orc') }
    }
  }

  private spawn(faction: Faction, kind: EntityKind, position: Point, buildDuration = 0) {
    const experience = isHeroKind(kind) ? this.heroExperience[faction][kind] ?? 0 : undefined
    const health = this.fortifiedHealth(faction, kind, unitStats[this.races[faction]][kind].health) + (experience ? (heroLevel(experience) - 1) * heroHealthPerLevel : 0) +
      (isUnitKind(kind) && kind !== 'worker' && kind !== 'scout' ? this.upgrades[faction].filter(value => value === 'vitality').length * upgrades.vitality.bonus : 0)
    const id = ++this.sequence
    const unit: Unit = {
      ...position, faction, race: this.races[faction] === faction ? undefined : this.races[faction], kind, id, experience, level: kind === 'wall' || kind === 'tower' ? 1 : undefined, hp: buildDuration ? Math.ceil(health * 0.2) : health,
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
    if (order.kind === 'rally') {
      const building = units[0]
      if (units.length !== 1 || building.buildDuration || !trainedAt(building.kind, this.races[faction]).length) return false
      const tile = tileAt(this.map, Math.floor(order.to.x / TILE), Math.floor(order.to.y / TILE))
      if (building.kind === 'port' ? !isWater(tile) : !isWalkable(tile)) return false
      building.rally = { ...order.to }
      return true
    }
    if (order.kind === 'unit-ability' || order.kind === 'hero-ability') {
      if (units.length !== 1 || units[0].embarkedOn || !isUnitKind(units[0].kind)) return false
      const caster = units[0]
      if ((order.kind === 'hero-ability') !== isHeroKind(caster.kind)) return false
      const custom = raceSkills[this.races[faction]]?.[caster.kind as UnitKind]
      if (custom) return this.castRaceSkill(caster, custom)
      if (order.kind === 'unit-ability') return false
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
              !this.canSee(faction, enemy)) continue
          this.heroSkillHit(hero, enemy, ability.bonus)
        }
      }
      return true
    }
    if (order.kind === 'build-queue') {
      const workers = units.filter(unit => unit.kind === 'worker' && !unit.embarkedOn)
      for (const worker of workers) {
        if (worker.job?.kind !== 'construct') this.resetOrders(worker)
        worker.order = order
      }
      return workers.length > 0
    }
    if (order.kind === 'board') return this.board(faction, units, order.transport)
    if (order.kind === 'unload') {
      if (!order.at) return this.unload(units)
      const coast = this.coast ??= new Coast(this.map)
      const selected = new Set(units)
      const reserved = [...this.units.values()].flatMap(ship =>
        !selected.has(ship) && ship.faction === faction && ship.order?.kind === 'unload' && ship.assigned ? [ship.assigned] : [])
      let accepted = false
      for (const ship of units) {
        if (ship.kind !== 'transport' || !ship.passengers?.length) continue
        const landing = coast.landingNear(order.at, ship, reserved)
        if (!landing) continue
        this.resetOrders(ship)
        ship.order = { kind: 'unload', at: landing.land }
        ship.assigned = landing.sea
        ship.unloadTotal = ship.passengers.length
        reserved.push(landing.sea)
        accepted = true
      }
      return accepted
    }
    if (order.kind === 'bulk-structure-upgrade') return this.startBulkStructureUpgrade(faction, order.building)
    if (order.kind === 'structure-upgrade') return units.length === 1 && this.startStructureUpgrade(units[0])
    if (order.kind === 'upgrade') return units.length === 1 && this.startUpgrade(units[0], order.upgrade)
    if (order.kind === 'train') return units.length === 1 && this.enqueue(units[0], order.unit, order.count ?? 1)
    if (order.kind === 'cancel-train') return units.length === 1 && this.cancelTraining(units[0], order.count)
    if (order.kind === 'cancel-build') return units.length === 1 && this.cancelConstruction(units[0])
    if (order.kind === 'dismiss') {
      // Only your own peasants and scouts can be deliberately dismissed.
      if (units.some(unit => (unit.kind !== 'worker' && unit.kind !== 'scout') || unit.embarkedOn)) return false
      for (const unit of units) this.destroy(unit)
      return true
    }
    if (order.kind === 'demolish') {
      const [building] = units
      if (units.length !== 1 || building.kind === 'headquarters' || isUnitKind(building.kind) || building.buildDuration) return false
      this.destroy(building)
      return true
    }
    if (order.kind === 'gather' || order.kind === 'build' || order.kind === 'wall-line' ||
        order.kind === 'resume-build' || order.kind === 'repair') {
      return this.assignWorkers(faction, units.filter(unit => unit.kind === 'worker' && !unit.embarkedOn), order)
    }
    if (units.some(unit => !isUnitKind(unit.kind) || unit.embarkedOn)) return false
    if (order.kind === 'explore' && units.some(unit => unit.kind !== 'scout')) return false
    if (order.kind === 'attack' && units.some(unit => unit.kind === 'scout' || unit.kind === 'transport')) return false
    if (order.kind === 'attack') {
      const target = this.units.get(order.target)
      if (!target || target.faction === faction || !this.canSee(faction, target)) return false
    }
    if ((order.kind === 'move' || order.kind === 'advance') &&
        (!Number.isFinite(order.to.x) || !Number.isFinite(order.to.y) ||
          order.to.x < 0 || order.to.y < 0 || order.to.x >= this.map.width * TILE ||
          order.to.y >= this.map.height * TILE)) return false

    const troops = order.kind === 'attack' ? units.filter(unit => unit.kind !== 'worker') : units
    if (!troops.length) return false
    if ((order.kind === 'move' || order.kind === 'advance' || order.kind === 'attack') && order.formation) {
      const anchor = order.kind === 'attack' ? this.units.get(order.target)! : order.to
      const groups = order.kind === 'attack' ? [troops] : [
        troops.filter(unit => !isShipKind(unit.kind)), troops.filter(unit => isShipKind(unit.kind))
      ]
      for (const { unit, at, flank } of groups.flatMap(group => formationSlots(group, anchor, order.formation!))) {
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
      unit.order = order
      if (order.kind === 'attack') {
        const target = this.units.get(order.target)!
        unit.lastTarget = { x: target.x, y: target.y }
      }
      if (order.kind === 'move' || order.kind === 'advance') {
        const spacing = isShipKind(unit.kind) ? 52 : 30
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
    const radius = unitStats[this.races[unit.faction]][unit.kind].radius
    for (const scale of [1, 0.75, 0.5, 0.25]) {
      const point = { x: anchor.x + (at.x - anchor.x) * scale, y: anchor.y + (at.y - anchor.y) * scale }
      if (isShipKind(unit.kind) ? isWater(tileAt(this.map, Math.floor(point.x / TILE), Math.floor(point.y / TILE))) :
        canStand(this.map, point, [], radius)) return point
    }
    return anchor
  }

  private resetOrders(unit: Unit) {
    this.reveal(unit)
    this.routes.delete(unit)
    unit.order = null
    unit.pickup = undefined
    unit.unloadTotal = undefined
    unit.unloadRetryAt = undefined
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

  private board(faction: Faction, units: Unit[], transport?: number) {
    const ships = [...this.units.values()].filter(unit => unit.kind === 'transport' && unit.faction === faction && unit.order?.kind !== 'unload' &&
      (transport === undefined || unit.id === transport))
    if (!ships.length || units.some(unit => !isUnitKind(unit.kind) || isShipKind(unit.kind) || unit.embarkedOn)) return false
    const coast = this.coast ??= new Coast(this.map)
    const selected = new Set(units)
    const remaining = new Map(ships.map(ship => [ship, transportCapacity - (ship.passengers ?? []).reduce(
      (total, id) => total + this.passengerPopulation(this.units.get(id)), 0)]))
    for (const unit of this.units.values()) {
      if (unit.order?.kind !== 'board' || selected.has(unit)) continue
      const ship = this.units.get(unit.order.transport ?? 0)
      if (ship?.pickup && remaining.has(ship)) remaining.set(ship, remaining.get(ship)! - this.passengerPopulation(unit))
    }
    let accepted = false
    for (const unit of units) {
      const size = this.passengerPopulation(unit)
      let best: { ship: Unit, site: Landing, score: number } | undefined
      for (const ship of ships) {
        if (remaining.get(ship)! < size) continue
        const pickup = ship.pickup
        if (pickup && coast.region(unit) !== coast.region(pickup.land)) continue
        const meeting = pickup ? { site: pickup, score: distance(unit, pickup.land) + distance(ship, pickup.sea) } :
          coast.meeting(unit, ship)
        if (meeting && (!best || meeting.score < best.score)) best = { ship, ...meeting }
      }
      if (!best) continue
      const { ship, site } = best
      remaining.set(ship, remaining.get(ship)! - size)
      this.resetOrders(unit)
      if (distance(ship, site.sea) <= TILE * 2 && distance(unit, site.land) <= TILE * 3 &&
          distance(unit, ship) <= TILE * 5 && clearSegment(this.map, unit, site.land, [], 0)) {
        this.embark(unit, ship)
      } else {
        if (!ship.pickup) {
          this.resetOrders(ship)
          ship.pickup = { ...site, until: this.tick + boardingTimeout }
        }
        unit.order = { kind: 'board', transport: ship.id }
      }
      accepted = true
    }
    return accepted
  }

  private unload(candidates: readonly Unit[]) {
    const occupied = new Set<number>()
    if (candidates.some(ship => ship.order?.kind === 'unload' && ship.order.at)) {
      for (const unit of this.units.values()) {
        if (!isUnitKind(unit.kind) || isShipKind(unit.kind) || unit.embarkedOn) continue
        occupied.add(Math.floor(unit.y / TILE) * this.map.width + Math.floor(unit.x / TILE))
      }
    }
    const buildings = [...this.units.values()].filter(unit => !isUnitKind(unit.kind)).map(unit => ({
      x: unit.x, y: unit.y, radius: unit.kind === 'headquarters' ?
        unitStats[this.races[unit.faction]].headquarters.radius : buildingFootprint(unit.kind as BuildingKind)
    }))
    let unloaded = false
    for (const ship of candidates) {
      if (ship.kind !== 'transport' || !ship.passengers?.length) continue
      const target = ship.order?.kind === 'unload' ? ship.order.at : undefined
      const coast = target ? this.coast ??= new Coast(this.map) : undefined
      const landRegion = target && coast?.region(target)
      const x = Math.floor(ship.x / TILE), y = Math.floor(ship.y / TILE)
      const sites: Array<{ at: Point, cell: number, gap: number }> = []
      for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
        if (!isWalkable(tileAt(this.map, x + dx, y + dy))) continue
        const at = cellCenter(x + dx, y + dy)
        if (target && (coast?.region(at) !== landRegion || squaredDistance(target, at) > (6 * TILE) ** 2)) continue
        const gap = squaredDistance(ship, at)
        if (gap <= (7 * TILE) ** 2) sites.push({ at, cell: (y + dy) * this.map.width + x + dx, gap: target ? squaredDistance(target, at) : gap })
      }
      sites.sort((a, b) => a.gap - b.gap)
      const remaining: number[] = []
      for (const id of ship.passengers) {
        const passenger = this.units.get(id)
        if (!passenger) continue
        const radius = unitStats[this.races[ship.faction]][passenger.kind].radius
        const site = sites.find(({ cell, at }) => !occupied.has(cell) && canStand(this.map, at, buildings, radius))
        if (!site) {
          remaining.push(id)
          continue
        }
        occupied.add(site.cell)
        passenger.embarkedOn = undefined
        Object.assign(passenger, site.at)
        this.nearby[ship.faction].update(passenger)
        unloaded = true
      }
      ship.passengers = remaining
    }
    return unloaded
  }

  private passengerPopulation(unit?: Unit) {
    return unit && isUnitKind(unit.kind) ? training[unit.kind].population : 0
  }

  private embark(unit: Unit, ship: Unit) {
    this.resetOrders(unit)
    unit.embarkedOn = ship.id
    unit.moving = false
    this.nearby[unit.faction].remove(unit)
    ship.unloadTotal = undefined
    const passengers = ship.passengers ??= []
    passengers.push(unit.id)
  }

  private updatePickups() {
    const pending = new Set<Unit>()
    for (const unit of this.units.values()) {
      if (unit.order?.kind !== 'board') continue
      const ship = this.units.get(unit.order.transport ?? 0)
      if (!ship?.pickup || this.tick >= ship.pickup.until) this.resetOrders(unit)
      else pending.add(ship)
    }
    for (const ship of this.units.values()) {
      if (ship.pickup && !pending.has(ship)) this.resetOrders(ship)
    }
  }

  private takeQueuedConstruction() {
    const idle = { human: [] as Unit[], orc: [] as Unit[] }
    const active = new Set<number>()
    const owners = new Map<number, Unit>()
    for (const worker of this.units.values()) {
      if (worker.kind !== 'worker' || worker.embarkedOn) continue
      if (worker.job?.kind === 'construct') active.add(worker.job.site)
      for (const id of worker.buildQueue ?? []) owners.set(id, worker)
      if (!worker.job && worker.order?.kind === 'build-queue') idle[worker.faction].push(worker)
    }
    for (const site of this.units.values()) {
      if (!site.buildDuration || active.has(site.id)) continue
      const workers = idle[site.faction]
      if (!workers.length) continue
      const coast = this.coast ??= new Coast(this.map)
      const region = coast.region(site)
      let closest = -1
      for (let i = 0; i < workers.length; i++) {
        if (!region || coast.region(workers[i]) !== region) continue
        if (closest < 0 || squaredDistance(workers[i], site) < squaredDistance(workers[closest], site)) closest = i
      }
      if (closest < 0) continue
      const [worker] = workers.splice(closest, 1)
      const owner = owners.get(site.id)
      if (owner) owner.buildQueue = owner.buildQueue?.filter(id => id !== site.id)
      this.queueConstruction(worker, site.id)
      worker.order = { kind: 'build-queue' }
    }
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
    const task = worker.order?.kind === 'build-queue' ? worker.order : null
    this.resetOrders(worker)
    worker.order = task
    const site = remaining.shift()
    if (site !== undefined) {
      worker.job = { kind: 'construct', site }
      worker.buildQueue = remaining
    }
  }

  private startBulkStructureUpgrade(faction: Faction, kind: 'wall' | 'tower') {
    const eligible = [...this.units.values()].filter(unit =>
      unit.faction === faction && unit.kind === kind && !unit.buildDuration && !unit.structureJob &&
      (unit.level ?? 1) < MAX_UPGRADE_LEVEL)
    if (!eligible.length) return false
    const total: Resources = { gold: 0, wood: 0, stone: 0 }
    for (const unit of eligible) {
      const cost = bulkStructureCost(kind, (unit.level ?? 1) + 1)
      for (const resource of resourceKinds) total[resource] += cost[resource] ?? 0
    }
    if (!canAfford(this.resources[faction], total)) return false
    spend(this.resources[faction], total)
    for (const unit of eligible) {
      const rule = structureUpgrade(kind, (unit.level ?? 1) + 1)
      unit.structureJob = { left: rule.ticks, total: rule.ticks }
    }
    return true
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

  private fortifiedHealth(faction: Faction, kind: EntityKind, base: number) {
    return this.upgrades[faction].includes('fortress') ? Math.round(base * this.fortressMultiplier(faction, kind)) : base
  }

  private fortressMultiplier(faction: Faction, kind: EntityKind) {
    return kind === 'wall' || kind === 'tower' ? raceRules[this.races[faction]].defense?.[kind] ?? 1 : 1
  }

  private fortificationMaxHp(faction: Faction, kind: 'wall' | 'tower', level: number) {
    const tierHealth = kind === 'wall' ? 100 : 85
    return this.fortifiedHealth(faction, kind, unitStats[this.races[faction]][kind].health + (level - 1) * tierHealth)
  }

  private completeStructureUpgrade(building: Unit) {
    if (!building.structureJob || --building.structureJob.left > 0) return
    building.structureJob = undefined
    building.level = Math.min(MAX_UPGRADE_LEVEL, (building.level ?? 1) + 1)
    if (building.kind !== 'wall' && building.kind !== 'tower') return
    const maxHp = this.fortificationMaxHp(building.faction, building.kind, building.level)
    building.hp += maxHp - building.maxHp
    building.maxHp = maxHp
  }

  private startUpgrade(building: Unit, kind: UpgradeKind) {
    const rule = upgrades[kind]
    const stock = this.resources[building.faction]
    const level = this.upgrades[building.faction].filter(upgrade => upgrade === kind).length + 1
    if (!rule || building.kind !== researchSite(kind) || building.buildDuration || building.upgradeJob ||
        (kind === 'fortress' && this.races[building.faction] !== 'dwarf') ||
        level > upgradeLevelLimit(kind) ||
        [...this.units.values()].some(unit => unit.faction === building.faction && unit.upgradeJob?.kind === kind)) return false
    const cost = researchCost(kind, level)
    if (!canAfford(stock, cost)) return false
    spend(stock, cost)
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
    if (building.upgradeJob.kind === 'fortress') {
      for (const unit of this.units.values()) {
        if (unit.faction !== building.faction || (unit.kind !== 'wall' && unit.kind !== 'tower')) continue
        const maxHp = this.fortifiedHealth(unit.faction, unit.kind, unit.maxHp)
        unit.hp = Math.min(maxHp, Math.round(unit.hp / unit.maxHp * maxHp))
        unit.maxHp = maxHp
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
    return { used, reserved, limit: Math.min(limit, this.settings.populationCap ?? 500) }
  }

  trainGlobally(faction: Faction, kind: UnitKind, count: number): string | null {
    if (this.result) return 'The match has ended.'
    const buildings = [...this.units.values()].filter(building => building.faction === faction &&
      !building.buildDuration && trainedAt(building.kind, this.races[building.faction]).includes(kind))
    if (!buildings.length) return 'Build the required production building first.'
    const error = this.trainingError(faction, kind, count)
    if (error) return error
    const rule = trainingRule(kind, this.races[faction])
    const loads = buildings.map(building => trainingTimeline(building.queue, building.queue[0]?.left ?? 0, this.races[faction]).ticks)
    const allocation = allocateTraining(loads, rule.ticks, count)
    for (const resource of resourceKinds) this.resources[faction][resource] -= count * (trainingCost(kind, this.races[faction])[resource] ?? 0)
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
    const rule = trainingRule(kind, this.races[faction])
    for (const resource of resourceKinds) if (count * (trainingCost(kind, this.races[faction])[resource] ?? 0) > this.resources[faction][resource]) return `Not enough ${resource}.`
    const { used, reserved, limit } = this.population(faction)
    if (count > Math.floor((limit - used - reserved) / rule.population)) return 'Not enough population space. Build more farms.'
    return null
  }

  private enqueue(building: Unit, kind: UnitKind, count: number) {
    if (building.buildDuration || !trainedAt(building.kind, this.races[building.faction]).includes(kind) || this.trainingError(building.faction, kind, count)) return false
    for (const resource of resourceKinds) this.resources[building.faction][resource] -= count * (trainingCost(kind, this.races[building.faction])[resource] ?? 0)
    this.appendTraining(building, kind, count)
    return true
  }

  private appendTraining(building: Unit, kind: UnitKind, count: number) {
    const tail = building.queue.at(-1)
    if (tail?.kind === kind) tail.count = (tail.count ?? 1) + count
    else building.queue.push({ kind, left: trainingRule(kind, this.races[building.faction]).ticks, count })
  }

  private cancelTraining(building: Unit, count: number) {
    if (!Number.isSafeInteger(count) || count < 1 || !building.queue.length) return false
    const stock = this.resources[building.faction]
    while (count > 0 && building.queue.length) {
      const tail = building.queue.at(-1)!
      const size = tail.count ?? 1
      const removed = Math.min(count, size)
      count -= removed
      for (const resource of resourceKinds) stock[resource] += removed * (trainingCost(tail.kind, this.races[building.faction])[resource] ?? 0)
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
    const radius = unitStats[this.races[building.faction]][next.kind].radius
    const bounds = unitStats[this.races[building.faction]][building.kind].radius + radius + (building.kind === 'port' ? 55 : 16)
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
        .every(unit => !isShipKind(unit.kind) || distance(unit, point) >= radius + unitStats[this.races[unit.faction]][unit.kind].radius + 3))
    }
    spawnSlots: for (const angle of isShipKind(next.kind) ? [] : slots) {
      const point = { x: building.x + direction * Math.cos(angle) * bounds, y: building.y + Math.sin(angle) * bounds }
      if (isShipKind(next.kind) ? !isWater(tileAt(this.map, Math.floor(point.x / TILE), Math.floor(point.y / TILE))) : !canStand(this.map, point, obstacles, radius)) continue
      spawnPoint ??= point
      for (const unit of [...this.nearby.human.near(point, radius + maxRadius + 4), ...this.nearby.orc.near(point, radius + maxRadius + 4)]) {
        if (isUnitKind(unit.kind) && distance(point, unit) < radius + unitStats[this.races[unit.faction]][unit.kind].radius + 4) {
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
      next.left = trainingRule(next.kind, this.races[building.faction]).ticks
    }
    const trained = this.spawn(building.faction, next.kind, spawnPoint)
    if (building.rally) {
      trained.assigned = building.rally
      trained.order = { kind: 'move', to: building.rally }
    }
    this.stats[building.faction].unitsTrained++
    if (next.kind !== 'worker') this.stats[building.faction].troopsTrained++
  }

  private work(worker: Unit, obstacles: Obstacle[], dropOffs: readonly Unit[]) {
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
      if (distance(worker, site) > unitStats[this.races[site.faction]][site.kind].radius + 27) {
        this.approach(worker, site, obstacles, true)
        return
      }
      if (++job.workTicks >= REPAIR.ticks) {
        job.workTicks = 0
        spend(stock, cost)
        site.hp = Math.min(site.maxHp, site.hp + this.fortifiedHealth(site.faction, site.kind, REPAIR.health))
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
      const radius = unitStats[this.races[site.faction]][site.kind].radius
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
      const dwarfStone = worker.cargo === 'stone' && this.races[worker.faction] === 'dwarf'
      const coast = this.coast ??= new Coast(this.map)
      const region = coast.region(worker)
      let dropOff: Unit | undefined
      let nearest = Infinity
      for (const site of dropOffs) {
        if (this.units.get(site.id) !== site || coast.region(site) !== region) continue
        const gap = squaredDistance(worker, site)
        if (site.kind === 'farm' && (!dwarfStone || gap > (8 * TILE) ** 2)) continue
        if (gap >= nearest) continue
        nearest = gap
        dropOff = site
      }
      if (!dropOff) return
      if (distance(worker, dropOff) <= unitStats[this.races[worker.faction]][dropOff.kind].radius + 26) {
        let amount = worker.cargoAmount ?? GATHERING[worker.cargo].amount
        if (worker.cargo === 'wood' && this.races[worker.faction] === 'elf') {
          for (const tree of this.nearby[worker.faction].near(dropOff, 160)) {
            if (tree.kind !== 'farm' || tree.buildDuration || squaredDistance(tree, dropOff) > 160 ** 2) continue
            amount += Math.ceil(amount * 0.1)
            break
          }
        }
        this.resources[worker.faction][worker.cargo] += amount
        this.stats[worker.faction].gathered[worker.cargo] += amount
        worker.cargo = null
        worker.cargoAmount = undefined
      } else this.approach(worker, dropOff, obstacles, true)
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

  private nextTree(worker: Unit, previous: number): Point | null {
    let closest: Point | null = null
    let bestDistance = Infinity
    for (let index = 0; index < this.map.tiles.length; index++) {
      if (index === previous || this.map.tiles[index] !== 'forest' || this.exhausted.has(index)) continue
      const at = cellCenter(index % this.map.width, Math.floor(index / this.map.width))
      if (this.visibility.at(worker.faction, at) === 0) continue
      const range = distance(worker, at)
      if (range < bestDistance) {
        closest = at
        bestDistance = range
      }
    }
    return closest
  }

  private harvest(worker: Unit, job: Extract<WorkerJob, { kind: 'gather' }>, obstacles: Obstacle[]) {
    const index = this.depositIndex(job.at)
    if (this.exhausted.has(index)) {
      if (job.resource === 'wood') {
        const next = this.nextTree(worker, index)
        if (next) {
          job.at = next
          job.workTicks = 0
          worker.path = []
          worker.pursued = null
          worker.assigned = null
          return
        }
      }
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
    const rules = raceRules[this.races[worker.faction]]
    const yieldMultiplier = (rules.gathering ?? 1) * (job.resource === 'stone' ? rules.stoneYield ?? 1 : 1)
    const amount = Math.min(Math.round(GATHERING[job.resource].amount * yieldMultiplier), (stock ?? Infinity) - extracted)
    worker.cargo = job.resource
    worker.cargoAmount = amount
    job.workTicks = 0
    if (stock !== null) {
      this.extracted.set(index, extracted + amount)
      if (extracted + amount >= stock) this.exhausted.add(index)
    }
  }

  private scoreSites(): ControlSite[] {
    const sites: ControlSite[] = []
    const mid = Math.floor(this.map.width / 2)
    for (const fraction of [0.25, 0.5, 0.75]) {
      const row = Math.floor(this.map.height * fraction)
      let best = Infinity
      let site: Point | undefined
      for (let y = Math.max(1, row - 7); y < Math.min(this.map.height - 1, row + 8); y++) {
        for (let x = mid - 8; x <= mid + 8; x++) {
          const tile = tileAt(this.map, x, y)
          const gap = (x - mid) ** 2 + (y - row) ** 2
          if (!(this.map.id === 'shattered-isles' ? isWater(tile) : isWalkable(tile)) || gap >= best) continue
          best = gap
          site = cellCenter(x, y)
        }
      }
      if (site) sites.push(site)
    }
    return sites
  }

  private scoreControl(increase: boolean) {
    for (const site of this.controlSites) {
      const present = factions.filter(faction => [...this.nearby[faction].near(site, CONTROL_RADIUS)].some(unit =>
        isUnitKind(unit.kind) && unitStats[this.races[faction]][unit.kind].damage > 0 &&
        !unit.summonedUntil && !unit.embarkedOn && squaredDistance(unit, site) <= CONTROL_RADIUS ** 2))
      site.owner = present.length === 1 ? present[0] : undefined
      if (increase && site.owner) this.territory[site.owner]++
    }
  }

  report(): MatchReport {
    const sides = {} as Record<Faction, FinalStats>
    const value = (cost: Partial<Resources>) => (cost.gold ?? 0) + (cost.wood ?? 0) + (cost.stone ?? 0)
    for (const faction of factions) {
      const bank = { ...this.resources[faction] }
      let army = 0
      let military = 0
      for (const unit of this.units.values()) {
        if (unit.faction !== faction || !isUnitKind(unit.kind) || unit.kind === 'worker' || unit.summonedUntil) continue
        army++
        military += value(trainingCost(unit.kind, this.races[faction]))
      }
      const levels = new Map<UpgradeKind, number>()
      let research = 0
      for (const kind of this.upgrades[faction]) {
        const level = (levels.get(kind) ?? 0) + 1
        levels.set(kind, level)
        research += value(researchCost(kind, level))
      }
      const territory = this.territory[faction]
      const score = value(bank) + military + research + territory
      sides[faction] = { ...this.stats[faction], gathered: { ...this.stats[faction].gathered }, bank, army, military, research, territory, score }
    }
    return { elapsedSeconds: Math.floor(this.tick / TICK_HZ), sides }
  }

  step() {
    if (this.result) return
    this.tick++
    for (const id of this.summoned) {
      const unit = this.units.get(id)
      if (!unit) this.summoned.delete(id)
      else if (unit.summonedUntil! <= this.tick) this.destroy(unit)
    }
    for (const [id, corpse] of this.corpses) {
      if (corpse.expiresAt > this.tick) break
      this.corpses.delete(id)
    }
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
    this.updatePickups()
    if (this.tick % TICK_HZ === 0) this.takeQueuedConstruction()
    const hostileBuildings: Record<Faction, Obstacle[]> = { human: [], orc: [] }
    const dropOffs: Record<Faction, Unit[]> = { human: [], orc: [] }
    for (const building of this.units.values()) {
      if (isUnitKind(building.kind)) continue
      if (!building.buildDuration && (building.kind === 'headquarters' || building.kind === 'settlement' ||
          (building.kind === 'farm' && this.races[building.faction] === 'dwarf'))) {
        dropOffs[building.faction].push(building)
      }
      const opponent = opposite(building.faction)
      hostileBuildings[opponent].push({ x: building.x, y: building.y, radius: building.kind === 'headquarters' ? unitStats[this.races[building.faction]][building.kind].radius : buildingFootprint(building.kind) })
    }
    const readyToUnload: Unit[] = []
    for (const unit of this.units.values()) {
      if (this.races[unit.faction] === 'elf' && this.tick % 10 === unit.id % 10) this.updateAmbush(unit)
      unit.moving = false
      if (unit.structureJob) this.completeStructureUpgrade(unit)
      if (unit.buildDuration || unit.embarkedOn) continue
      const stats = unitStats[this.races[unit.faction]][unit.kind]
      const obstacles = hostileBuildings[unit.faction]
      if (unit.order?.kind === 'unload' && unit.assigned) {
        if (distance(unit, unit.assigned) < TILE * .5) {
          if (this.tick >= (unit.unloadRetryAt ?? 0)) readyToUnload.push(unit)
        } else this.sail(unit, unit.assigned)
        continue
      }
      if (unit.pickup) {
        this.sail(unit, unit.pickup.sea)
        continue
      }
      if (unit.order?.kind === 'board') {
        const ship = this.units.get(unit.order.transport ?? 0)
        const pickup = ship?.pickup
        if (ship && pickup) {
          if (distance(unit, pickup.land) <= TILE * 1.3 && distance(ship, pickup.sea) <= TILE * .75) this.embark(unit, ship)
          else if (distance(unit, pickup.land) > TILE) this.approach(unit, pickup.land, obstacles, true)
        }
        continue
      }
      if (unit.order?.kind === 'halt') continue
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
        this.work(unit, obstacles, dropOffs[unit.faction])
        continue
      }
      const automaticRange = stats.damage === 0 ? 0 : unit.order?.kind === 'advance' ? Math.max(180, this.attackRange(unit) + 30) : this.attackRange(unit)
      let target: Unit | undefined
      if (unit.order?.kind === 'attack') {
        target = this.units.get(unit.order.target)
        if (target && this.canSee(unit.faction, target)) {
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
      if (automaticRange > 0 && !target) {
        let nearest = automaticRange
        const enemies = this.nearby[opposite(unit.faction)]
        for (const other of enemies.near(unit, automaticRange + maxRadius)) {
          if ((unit.kind === 'tower' && !isUnitKind(other.kind)) || other.embarkedOn) continue
          const radius = unitStats[this.races[other.faction]][other.kind].radius
          const gap = squaredDistance(unit, other)
          if (gap > (nearest + radius) ** 2) continue
          const separation = Math.sqrt(gap) - radius
          if ((separation < nearest || (separation === nearest && target && enemies.before(other, target))) && this.canSee(unit.faction, other)) {
            nearest = separation
            target = other
          }
        }
      }
      // A move order can fire at an enemy in range without pausing or pursuing it.
      const movingOrder = unit.order?.kind === 'move'
      if (target && !target.embarkedOn && stats.damage > 0 && this.fight(unit, target) && !movingOrder) {
        this.routes.delete(unit)
        continue
      }

      let destination = unit.assigned
      if (target && (defenderTarget || unit.order?.kind === 'attack' || unit.order?.kind === 'advance')) {
        const range = this.attackRange(unit) + unitStats[this.races[target.faction]][target.kind].radius - 4
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
      if (destination && stats.speed && isShipKind(unit.kind)) this.sail(unit, destination, !target)
      else if (destination && stats.speed) this.approach(unit, destination, obstacles, Boolean(target) && !movingOrder)
      else this.routes.delete(unit)
    }
    if (readyToUnload.length) {
      this.unload(readyToUnload)
      for (const ship of readyToUnload) {
        if (ship.passengers?.length) ship.unloadRetryAt = this.tick + TICK_HZ / 2
        else {
          const total = ship.unloadTotal
          this.resetOrders(ship)
          ship.unloadTotal = total
        }
      }
    }
    this.resolveRoutes(hostileBuildings)
    this.spaceMovingUnits(hostileBuildings)
    this.visibility.update(this.units.values())
    if (this.tick % TICK_HZ === 0) this.scoreControl(true)
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
        squaredDistance(attacker, at) <= defenseLeash ** 2 && this.canSee(unit.faction, attacker)) return attacker
    unit.defense = null
  }

  private callDefenders(victim: Unit, attacker: Unit) {
    if (!this.units.has(attacker.id) || !this.canSee(victim.faction, attacker)) return
    const at = { x: victim.x, y: victim.y }
    const radius = defenseRadius + unitStats[this.races[victim.faction]][victim.kind].radius
    if (squaredDistance(at, attacker) > defenseLeash ** 2) return
    for (const unit of this.nearby[victim.faction].near(at, radius)) {
      if (!isUnitKind(unit.kind) || unit.order?.kind === 'move' || unit.order?.kind === 'halt' || unit.order?.kind === 'board' ||
          !unitStats[this.races[unit.faction]][unit.kind].damage ||
          (unit !== victim && unit.order?.kind === 'attack') || squaredDistance(unit, at) > radius ** 2) continue
      const current = this.defendedAgainst(unit)
      if (current && current !== attacker && squaredDistance(unit, current) <= squaredDistance(unit, attacker)) continue
      unit.defense = { targetId: attacker.id, at, until: this.tick + defenseDuration }
    }
  }

  private sail(unit: Unit, destination: Point, clearOnArrival = false) {
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
    if (distance(unit, destination) < TILE * .5) {
      unit.path = []
      if (clearOnArrival) unit.assigned = null
      return
    }
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
      unit.path = route.length ? route.reverse() : [destination]
    }
    const next = unit.path[0]
    if (!next) return
    const gap = distance(unit, next), step = this.moveSpeed(unit) / TICK_HZ
    if (Math.abs(next.x - unit.x) > 1) unit.facing = next.x < unit.x ? -1 : 1
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

  private spaceMovingUnits(obstacles: Record<Faction, Obstacle[]>) {
    const offsets: Array<{ unit: Unit, at: Point }> = []
    for (const unit of this.units.values()) {
      if (!unit.moving || unit.embarkedOn || unit.job) continue
      const ship = isShipKind(unit.kind)
      const gap = ship ? 42 : 18
      let closest: Unit | undefined
      let separation = gap ** 2
      for (const other of this.nearby[unit.faction].near(unit, gap)) {
        if (other === unit || !isUnitKind(other.kind) || isShipKind(other.kind) !== ship) continue
        const squared = squaredDistance(unit, other)
        if (squared >= separation) continue
        separation = squared
        closest = other
        if (squared === 0) break
      }
      if (!closest) continue
      const spread = Math.sqrt(separation)
      const axis = (Math.min(unit.id, closest.id) % 16) * Math.PI / 8
      const sign = unit.id < closest.id ? -1 : 1
      const dx = spread ? (unit.x - closest.x) / spread : Math.cos(axis) * sign
      const dy = spread ? (unit.y - closest.y) / spread : Math.sin(axis) * sign
      const push = Math.min(ship ? 2.5 : 1.6, (gap - spread) / 2)
      const at = { x: unit.x + dx * push, y: unit.y + dy * push }
      if (ship ? isWater(tileAt(this.map, Math.floor(at.x / TILE), Math.floor(at.y / TILE))) :
          canStand(this.map, at, obstacles[unit.faction], unitStats[this.races[unit.faction]][unit.kind].radius)) {
        offsets.push({ unit, at })
      }
    }
    for (const { unit, at } of offsets) {
      Object.assign(unit, at)
      this.nearby[unit.faction].update(unit)
    }
  }

  private approach(unit: Unit, destination: Point, obstacles: Obstacle[], pursuing: boolean) {
    const pending = this.routes.has(unit)
    if (pending || !unit.pursued || (this.tick >= unit.nextPath &&
        (squaredDistance(unit.pursued, destination) > 14 ** 2 || unit.blockedTicks >= 8))) {
      const radius = unitStats[this.races[unit.faction]][unit.kind].radius
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
      const path = findPath(this.map, unit, destination, blockers, unitStats[this.races[unit.faction]][unit.kind].radius, cached?.grid)
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

  private activeSkill(unit: Unit) {
    return this.tick < (unit.abilityActiveUntil ?? 0)
  }

  private hasAura(unit: Unit, kind: HeroKind, radius: number) {
    const hero = this.activeHeroes[unit.faction]
    return Boolean(hero?.kind === kind && !hero.embarkedOn && this.activeSkill(hero) && squaredDistance(hero, unit) <= radius ** 2)
  }

  private reveal(unit: Unit) {
    if (!raceRules[this.races[unit.faction]].ambush?.includes(unit.kind as UnitKind)) return
    unit.concealed = undefined
    unit.revealedUntil = this.tick + 60
  }

  private updateAmbush(unit: Unit) {
    if (!raceRules.elf.ambush?.includes(unit.kind as UnitKind)) return
    if (unit.moving || unit.embarkedOn || unit.assigned || unit.order?.kind === 'attack' ||
        this.tick < (unit.revealedUntil ?? 0)) {
      unit.concealed = undefined
      return
    }
    const x = Math.floor(unit.x / TILE), y = Math.floor(unit.y / TILE)
    unit.concealed = (tileAt(this.map, x, y - 1) === 'forest' || tileAt(this.map, x + 1, y) === 'forest' ||
      tileAt(this.map, x, y + 1) === 'forest' || tileAt(this.map, x - 1, y) === 'forest') || undefined
  }

  private canSee(side: Faction, target: Entity) {
    if (target.embarkedOn || this.visibility.at(side, target) !== 2) return false
    if (!target.concealed) return true
    for (const observer of this.nearby[side].near(target, 112)) {
      if (observer.buildDuration || observer.embarkedOn) continue
      if (squaredDistance(observer, target) <= (observer.kind === 'scout' ? 112 : 36) ** 2) return true
    }
    return false
  }

  private castRaceSkill(caster: Unit, skill: import('../shared/race-rules.ts').RaceSkill) {
    if (this.tick < (caster.abilityReadyAt ?? 0)) return false
    const race = this.races[caster.faction]
    if (race === 'undead' && caster.kind === 'support') {
      if (!this.raiseCorpse(caster, skill.radius)) return false
    } else if (race === 'elf' && caster.kind === 'support') {
      const wounded = [...this.nearby[caster.faction].near(caster, skill.radius)].filter(unit =>
        isUnitKind(unit.kind) && !isShipKind(unit.kind) && unit.hp < unit.maxHp && squaredDistance(caster, unit) <= skill.radius ** 2)
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id - b.id).slice(0, 3)
      if (!wounded.length) return false
      for (const unit of wounded) unit.hp = Math.min(unit.maxHp, unit.hp + skill.bonus)
    } else if (race === 'undead' && caster.kind === 'pathfinder') {
      const victims = [...this.nearby[opposite(caster.faction)].near(caster, skill.radius)].filter(unit =>
        squaredDistance(caster, unit) <= skill.radius ** 2 && this.canSee(caster.faction, unit))
        .sort((a, b) => squaredDistance(caster, a) - squaredDistance(caster, b) || a.id - b.id).slice(0, 3)
      if (!victims.length) return false
      for (const unit of victims) this.heroSkillHit(caster, unit, skill.bonus)
    } else if (skill.duration) {
      caster.abilityActiveUntil = this.tick + skill.duration
    }
    this.reveal(caster)
    caster.abilityReadyAt = this.tick + skill.cooldown
    return true
  }

  private raiseCorpse(caster: Unit, radius: number) {
    const faction = caster.faction
    let active = 0
    for (const id of this.summoned) if (this.units.get(id)?.faction === faction) active++
    if (active >= summonLimit) return false
    // A completed Graveyard extends local ritual range and grants farms' normal population.
    const graveyard = [...this.nearby[faction].near(caster, 150)].some(unit =>
      unit.kind === 'farm' && !unit.buildDuration && squaredDistance(unit, caster) <= 150 ** 2)
    if (graveyard) radius += 35
    let corpse: Corpse | undefined
    let closest = radius ** 2
    for (const candidate of this.corpses.values()) {
      const gap = squaredDistance(candidate, caster)
      if (gap > closest || candidate.expiresAt <= this.tick || this.visibility.at(faction, candidate) !== 2 ||
          !canStand(this.map, candidate, [], unitStats.undead.blade.radius)) continue
      closest = gap
      corpse = candidate
    }
    if (!corpse) return false
    const { used, reserved, limit } = this.population(faction)
    if (used + reserved + training.blade.population > limit) return false
    this.corpses.delete(corpse.id)
    const unit = this.spawn(faction, 'blade', { x: corpse.x, y: corpse.y })
    unit.summonedUntil = this.tick + summonLifetime
    this.summoned.add(unit.id)
    return true
  }

  private moveSpeed(unit: Unit): number {
    const base = unitStats[this.races[unit.faction]][unit.kind].speed
    const wind = this.races[unit.faction] === 'elf' && isUnitKind(unit.kind) && unit.kind !== 'worker' && !isShipKind(unit.kind) &&
      this.hasAura(unit, 'vanguard', 128) ? 0.2 : 0
    return base * (1 + this.upgrades[unit.faction].filter(kind => kind === 'speed').length * upgrades.speed.bonus / 100) * (1 + wind)
  }

  private attackRange(unit: Unit): number {
    const base = unitStats[this.races[unit.faction]][unit.kind].range
    const moonshot = this.races[unit.faction] === 'elf' && unit.kind === 'pathfinder' && this.activeSkill(unit) ? 24 : 0
    return base + moonshot + (benefitsFromRange(unit.kind) ? this.upgrades[unit.faction].filter(kind => kind === 'range').length * upgrades.range.bonus : 0)
  }

  private fight(unit: Unit, target: Unit): boolean {
    const stats = unitStats[this.races[unit.faction]][unit.kind]
    if (squaredDistance(unit, target) > (this.attackRange(unit) + unitStats[this.races[target.faction]][target.kind].radius) ** 2) return false
    if (unit.nextStrike > this.tick) return true
    this.reveal(unit)
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

  private incomingDamage(target: Unit, damage: number) {
    const shield = target.kind === 'heavy' && this.races[target.faction] === 'dwarf' && this.activeSkill(target)
    const multiplier = shield ? 1 - raceSkills.dwarf!.heavy!.bonus : 1
    return Math.max(1, Math.round(damage * multiplier))
  }

  private heroSkillHit(attacker: Unit, target: Unit, power: number) {
    if (!this.units.has(target.id)) return
    const damage = this.incomingDamage(target, power - unitStats[this.races[target.faction]][target.kind].armor -
      (target.kind === 'wall' || target.kind === 'tower' ? ((target.level ?? 1) - 1) * 2 : 0))
    this.reveal(target)
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
    const race = this.races[attacker.faction]
    const allyArmor = this.races[target.faction] === 'dwarf' && isUnitKind(target.kind) && target.kind !== 'worker' && !isShipKind(target.kind) &&
      this.hasAura(target, 'vanguard', 128) ? 3 : 0
    const siegeBonus = attacker.kind === 'siege' && !isUnitKind(target.kind) ? 10 +
      (this.hasAura(attacker, 'pathfinder', 152) ? 12 : 0) : 0
    const ghoulBonus = race === 'undead' && attacker.kind === 'polearm' && target.kind === 'worker' ? 5 : 0
    const activeBonus = this.activeSkill(attacker) ?
      race === 'elf' && attacker.kind === 'marksman' ? 3 :
      (race === 'elf' && attacker.kind === 'pathfinder') || (race === 'undead' && attacker.kind === 'vanguard') ? 5 : 0 : 0
    const classic = race === 'human' || race === 'orc'
    const heroBonus = attacker.experience === undefined ? 0 :
      (heroLevel(attacker.experience) - 1) * heroDamagePerLevel +
      (classic && attacker.kind === 'pathfinder' ? 5 : 0) +
      (classic && attacker.kind === 'vanguard' && this.tick < (attacker.abilityActiveUntil ?? 0) ? 8 : 0)
    const damage = this.incomingDamage(target, unitStats[this.races[attacker.faction]][attacker.kind].damage + attackBonus + heroBonus + siegeBonus + ghoulBonus + activeBonus - allyArmor + (attacker.kind === 'tower' ? ((attacker.level ?? 1) - 1) * 5 : 0) -
      unitStats[this.races[target.faction]][target.kind].armor - armorBonus - (target.kind === 'wall' || target.kind === 'tower' ? ((target.level ?? 1) - 1) * 2 : 0) -
      (target.kind === 'vanguard' && (this.races[target.faction] === 'human' || this.races[target.faction] === 'orc') ? 2 : 0))
    this.reveal(target)
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
      if (race === 'undead' && attacker.kind === 'vanguard' && this.activeSkill(attacker) && isUnitKind(target.kind) && this.units.has(attacker.id)) {
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + 18)
      }
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
    this.summoned.delete(target.id)
    if (this.usesCorpses && target.hp <= 0 && isUnitKind(target.kind) && !isShipKind(target.kind) &&
        !target.embarkedOn && !target.summonedUntil) {
      if (this.corpses.size >= maxCorpses) this.corpses.delete(this.corpses.keys().next().value!)
      this.corpses.set(target.id, { id: target.id, x: Math.round(target.x), y: Math.round(target.y), expiresAt: this.tick + corpseLifetime })
    }
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
        if (unit.kind === 'worker' && unit.order?.kind === 'move') unit.order = null
      } else unit.blockedTicks++
      return
    }
    const stats = unitStats[this.races[unit.faction]][unit.kind]
    const remaining = distance(unit, next)
    if (remaining < 2) {
      unit.path.shift()
      return
    }
    const step = Math.min(remaining, this.moveSpeed(unit) / TICK_HZ)
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
    const finished = this.result !== null
    if (finished) fog = (this.map.tiles.length * 3 + 2).toString(36)
    const visible = (point: Point) => finished || this.visibility.at(faction, point) === 2
    const depleted = this.depletion[faction]
    for (const index of this.exhausted) {
      if (!depleted.has(index) && visible(cellCenter(index % this.map.width, Math.floor(index / this.map.width)))) depleted.add(index)
    }
    if (depleted.size && depleted.size !== this.visibleDepletion[faction]?.length) this.visibleDepletion[faction] = [...depleted]
    const knownDepletion = this.visibleDepletion[faction]
    const alerts = this.attackAlerts[faction].current
    const deposits = this.deposits.flatMap(({ index, resource, at }) => {
      if (!visible(at)) return []
      const stock = this.settings.sources[resource].stock
      return [{ index, remaining: stock === null ? null : Math.max(0, stock - (this.extracted.get(index) ?? 0)) }]
    })
    const effectLimit = world.entities.length >= 440 ? { shot: 18, hit: 10, fallen: 12 } : undefined
    const effects = world.effects.filter(effect => {
      if (effectLimit && effectLimit[effect.kind] === 0) return false
      if (!visible(effect.at) || effect.to && !visible(effect.to)) return false
      if (effectLimit) effectLimit[effect.kind]--
      return true
    })
    return {
      type: 'snapshot', tick: world.tick, fog,
      ...(this.controlSites.length ? { controlSites: this.controlSites.map(({ x, y, owner }) =>
        ({ x, y, ...(owner && (owner === faction || visible({ x, y })) ? { owner } : {}) })) } : {}), ...(alerts.length ? { alerts } : {}), ...(knownDepletion ? { depleted: knownDepletion } : {}),
      resources: world.resources[faction], population: world.population[faction], upgrades: world.upgrades[faction], deposits,
      ...(this.usesCorpses && this.corpses.size ? { corpses: [...this.corpses.values()].filter(visible) } : {}),
      entities: world.entities.flatMap(entity => {
        if (entity.embarkedOn) return []
        if (entity.faction === faction) return [entity]
        if (!finished && !this.canSee(faction, entity)) return []
        const { idle: _idle, repairing: _repair, constructionStatus: _status, research: _research, training: _training, passengers: _passengers, passengerPop: _passengerPop, landing: _landing, concealed: _concealed, rally: _rally, ...seen } = entity
        return [seen]
      }),
      effects
    }
  }

  snapshot(consumeEffects = false): WorldSnapshot {
    const effects = this.effects
    const levels = { human: new Map<UpgradeKind, number>(), orc: new Map<UpgradeKind, number>() }
    for (const faction of factions) {
      for (const kind of this.upgrades[faction]) levels[faction].set(kind, (levels[faction].get(kind) ?? 0) + 1)
    }
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
          id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, kind, faction, ...(unit.race ? { race: unit.race } : {}), ...(unit.rally ? { rally: unit.rally } : {}), hp, maxHp, facing, moving, weaponLevel: isUnitKind(kind) ? (levels[faction].get('weapons') ?? 0) : undefined, armorLevel: isUnitKind(kind) ? (levels[faction].get('armor') ?? 0) : undefined, precisionLevel: isUnitKind(kind) ? (levels[faction].get('precision') ?? 0) : undefined, vitalityLevel: isUnitKind(kind) ? (levels[faction].get('vitality') ?? 0) : undefined, rangeLevel: benefitsFromRange(kind) ? (levels[faction].get('range') ?? 0) : undefined, speedLevel: isUnitKind(kind) ? (levels[faction].get('speed') ?? 0) : undefined, level: unit.level, upgradeProgress: unit.structureJob ? 1 - unit.structureJob.left / unit.structureJob.total : undefined, passengers: unit.passengers?.slice(), passengerPop: unit.kind === 'transport' ? (unit.passengers ?? []).reduce((total, id) => {
             const passenger = this.units.get(id)
             return total + (passenger ? training[passenger.kind as UnitKind].population : 0)
           }, 0) : undefined, embarkedOn: unit.embarkedOn, experience: unit.experience, ...(unit.concealed ? { concealed: true } : {}), ...(unit.summonedUntil ? { summonedUntil: unit.summonedUntil } : {}), abilityReadyAt: unit.abilityReadyAt, abilityActiveUntil: unit.abilityActiveUntil,
          ...(unit.unloadTotal ? { landing: { total: unit.unloadTotal, waiting: Boolean(unit.unloadRetryAt) } } : {}),
          construction: buildDuration ? buildTicks / buildDuration : undefined,
          constructionStatus: buildDuration ? construction.get(id) ?? 'paused' : undefined,
          research: unit.upgradeJob ? { kind: unit.upgradeJob.kind, progress: 1 - unit.upgradeJob.left / upgrades[unit.upgradeJob.kind].ticks } : undefined,
          repairing: repairs.has(id) || undefined,
          carrying: cargo ?? undefined,
          idle: kind === 'worker' ? !unit.job && !unit.order && !unit.assigned : undefined,
          training: next ? { kind: next.kind, progress: 1 - next.left / trainingRule(next.kind, this.races[faction]).ticks, remaining: queue.reduce((total, entry) => total + (entry.count ?? 1), 0),
            seconds: Math.ceil(next.left / TICK_HZ), queue: queue.map(entry => ({ kind: entry.kind, count: entry.count ?? 1 })) } : undefined
        }
      })
    }
  }
}
