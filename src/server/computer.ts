import { buildingTier, hallUpgrades } from '../shared/economy.ts'
import { buildings, canAfford, researchCost, trainedAt, upgrades, validPlacement } from '../shared/economy.ts'
import { TILE, ashfordMap, cellCenter, distance, isWalkable, isWater, resourceAt, tileAt } from '../shared/map.ts'
import type { BattleMap } from '../shared/map.ts'
import { isHeroKind, isShipKind, isUnitKind, opposite } from '../shared/protocol.ts'
import type { BuildingKind, Difficulty, Entity, Faction, Race, Point, ResourceKind, Snapshot, UnitKind } from '../shared/protocol.ts'
import { raceSkills } from '../shared/race-rules.ts'
import { TICK_HZ } from './match.ts'
import type { Match } from './match.ts'

const resourceAssignments = ['gold', 'wood', 'stone', 'gold'] as const
const plans = {
  easy: { cadence: 2, workers: 4, first: 105, interval: 38, guard: 3, wave: 5 },
  normal: { cadence: 1, workers: 5, first: 75, interval: 28, guard: 3, wave: 7 },
  hard: { cadence: 1, workers: 6, first: 58, interval: 24, guard: 4, wave: 10 }
} as const
type Strategy = 'rush' | 'balanced' | 'defensive' | 'counter'

const sites: Partial<Record<BuildingKind, Point>> = {
  barracks: { x: 6, y: 2 },
  farm: { x: 4, y: 4 },
  range: { x: 6, y: -3 },
  tower: { x: 9, y: 0 },
  smithy: { x: 6, y: 5 },
  elite: { x: 3, y: -2 }
}

const recruit: Partial<Record<Entity['kind'], readonly UnitKind[]>> = {
  barracks: ['blade', 'blade', 'polearm'],
  range: ['ranged', 'ranged', 'marksman'],
  elite: ['heavy']
}

export type ComputerCheckpoint = { attacking: number[], nextAssault: number, recruits: number, difficulty?: Difficulty, strategy?: Strategy }

export class ComputerOpponent {
  readonly faction: Faction
  private readonly home: Point
  private readonly enemyBase: Point
  private readonly gatherSites: Record<ResourceKind, Point[]> = { gold: [], wood: [], stone: [] }
  private readonly constructionSites = new Map<BuildingKind, Point[]>()
  private readonly shoreline: Array<{ land: Point, sea: Point }> = []
  private readonly landing?: { land: Point, sea: Point }
  private readonly attacking = new Set<number>()
  private nextAssault: number
  private readonly difficulty: Difficulty
  private readonly strategy: Strategy
  private recruits = 0

  constructor(faction: Faction, map: BattleMap, difficulty: Difficulty = 'normal', strategy: Strategy = 'balanced') {
    this.difficulty = difficulty
    this.strategy = strategy
    const modifier = strategy === 'rush' ? -15 : strategy === 'defensive' ? 20 : 0
    this.nextAssault = (plans[difficulty].first + modifier) * TICK_HZ
    this.faction = faction
    this.home = map.bases[faction]
    // Probe the other side of the battlefield. Enemy headquarters are targeted only once seen.
    const towardEast = faction === 'human'
    const standard = map.id ? ashfordMap(map.id).bases[opposite(faction)] : map.bases[opposite(faction)]
    const x = Math.floor(standard.x / TILE), y = Math.floor(standard.y / TILE)
    let probe = cellCenter(x, y)
    let nearest = Infinity
    for (let i = 0; i < map.tiles.length; i++) {
      if (!isWalkable(map.tiles[i])) continue
      const point = cellCenter(i % map.width, Math.floor(i / map.width))
      const gap = distance(point, cellCenter(x, y))
      if (gap >= nearest) continue
      probe = point
      nearest = gap
    }
    // Fixed starts are part of the public map. Random starts must be scouted.
    this.enemyBase = map.seed === undefined ? map.bases[opposite(faction)] : probe
    const land: Point[] = []
    for (let i = 0; i < map.tiles.length; i++) {
      const point = cellCenter(i % map.width, Math.floor(i / map.width))
      const gap = distance(point, this.home)
      const resource = resourceAt(map, point)
      if (resource) this.gatherSites[resource].push(point)
      if (gap >= 3 * TILE && gap <= 9 * TILE && isWalkable(map.tiles[i])) land.push(point)
    }
    if (map.id === 'shattered-isles') {
      const farShore: Array<{ land: Point, sea: Point }> = []
      for (let index = 0; index < map.tiles.length; index++) {
        if (!isWalkable(map.tiles[index])) continue
        const x = index % map.width, y = Math.floor(index / map.width)
        const point = cellCenter(x, y)
        if (!validPlacement(map, 'port', point, [])) continue
        const direction = x < map.width / 2 ? 1 : -1
        const sea = [2, 3, 4, 5, 6].map(offset => cellCenter(x + offset * direction, y))
          .find(at => isWater(tileAt(map, Math.floor(at.x / TILE), y)))
        if (!sea) continue
        if ((x < map.width / 2) === towardEast) this.shoreline.push({ land: point, sea })
        else farShore.push({ land: point, sea })
      }
      this.shoreline.sort((a, b) => distance(a.land, this.home) - distance(b.land, this.home))
      this.landing = farShore.sort((a, b) => distance(a.land, probe) - distance(b.land, probe))[0]
      this.constructionSites.set('port', this.shoreline.map(site => site.land))
    }
    for (const sites of Object.values(this.gatherSites)) sites.sort((a, b) => distance(a, this.home) - distance(b, this.home))
    const direction = faction === 'human' ? 1 : -1
    for (const [kind, offset] of Object.entries(sites) as Array<[BuildingKind, Point]>) {
      const preferred = { x: this.home.x + offset.x * TILE * direction, y: this.home.y + offset.y * TILE * direction }
      this.constructionSites.set(kind, [...land].sort((a, b) => distance(a, preferred) - distance(b, preferred)))
    }
  }

  checkpoint(): ComputerCheckpoint {
    return { attacking: [...this.attacking], nextAssault: this.nextAssault, recruits: this.recruits, difficulty: this.difficulty, strategy: this.strategy }
  }

  restore(checkpoint: ComputerCheckpoint) {
    for (const id of checkpoint.attacking) this.attacking.add(id)
    this.nextAssault = checkpoint.nextAssault
    this.recruits = checkpoint.recruits
  }

  think(match: Match) {
    const plan = plans[this.difficulty]
    if (match.result || match.tick % (plan.cadence * TICK_HZ) !== 0) return
    const race = match.races[this.faction]
    const view = match.view(this.faction)
    const own = view.entities.filter(entity => entity.faction === this.faction)
    const structures = own.filter(entity => !isUnitKind(entity.kind))
    const hall = structures.find(entity => entity.kind === 'headquarters')
    if (!hall) return
    const workers = own.filter(entity => entity.kind === 'worker')
    const builder = workers.length >= 4 ? workers.at(-1) : undefined
    const workerTarget = plan.workers
    if (workers.length < workerTarget && !hall.training) {
      match.command(this.faction, [hall.id], { kind: 'train', unit: 'worker' })
    }
    const tier = match.hallLevel(this.faction)
    const savingForTier = tier < 3 && hall.upgradeProgress === undefined &&
      hallUpgrades[tier === 1 ? 2 : 3].required.every(kind =>
        structures.some(site => site.kind === kind && site.construction === undefined))
    if (savingForTier) match.command(this.faction, [hall.id], { kind: 'structure-upgrade' })
    if (builder) this.build(match, view, builder, structures, race)
    const scout = own.find(entity => entity.kind === 'scout')
    if (scout && !match.units.get(scout.id)?.order) match.command(this.faction, [scout.id], { kind: 'explore' })
    if ((race === 'elf' || this.landing) && !scout && !hall.training && workers.length >= 4) {
      match.command(this.faction, [hall.id], { kind: 'train', unit: 'scout' })
    }
    const assigned = new Map<string, number>()
    const jobKey = (at: Point) => at.x + ',' + at.y
    for (const worker of workers) {
      const job = match.units.get(worker.id)?.job
      if (job?.kind === 'gather') {
        const key = jobKey(job.at)
        assigned.set(key, (assigned.get(key) ?? 0) + 1)
      }
    }
    workers.forEach((worker, index) => {
      const state = match.units.get(worker.id)
      const job = state?.job
      if (state?.assigned || (job && job.kind !== 'gather')) return
      const resource = resourceAssignments[index] ?? 'gold'
      const available = (at: Point, kind: ResourceKind) => match.availableDeposit(this.faction, at) &&
        (assigned.get(jobKey(at)) ?? 0) - Number(job?.kind === 'gather' && jobKey(job.at) === jobKey(at)) < (match.settings.sources[kind].workers ?? Infinity)
      const preferred = this.gatherSites[resource].find(at => available(at, resource))
      const at = preferred ?? (job && available(job.at, job.resource) ? job.at :
        Object.entries(this.gatherSites).flatMap(([kind, sites]) =>
          sites.find(at => available(at, kind as ResourceKind)) ?? []).at(0))
      if (!at) return
      if (job && jobKey(job.at) === jobKey(at)) return
      if (!match.command(this.faction, [worker.id], { kind: 'gather', at })) return
      if (job) assigned.set(jobKey(job.at), (assigned.get(jobKey(job.at)) ?? 1) - 1)
      const current = state?.job
      if (current?.kind === 'gather') assigned.set(jobKey(current.at), (assigned.get(jobKey(current.at)) ?? 0) + 1)
    })
    const smith = structures.find(unit => unit.kind === 'smithy' && unit.construction === undefined && !unit.research)
    if (smith && !savingForTier) {
      for (const kind of ['weapons', 'armor'] as const) {
        if (!view.upgrades?.includes(kind) && canAfford(view.resources, researchCost(kind, 1)) &&
            match.command(this.faction, [smith.id], { kind: 'upgrade', upgrade: kind })) break
      }
    }
    const foundry = race === 'dwarf' && structures.find(unit =>
      unit.kind === 'elite' && unit.construction === undefined && !unit.research)
    if (foundry && !view.upgrades?.includes('fortress') && canAfford(view.resources, upgrades.fortress.cost)) {
      match.command(this.faction, [foundry.id], { kind: 'upgrade', upgrade: 'fortress' })
    }
    const army = own.filter(entity => isUnitKind(entity.kind) && entity.kind !== 'worker')
    if (army.length >= 8 && workers.length >= 4 && !hall.training && !army.some(unit => isHeroKind(unit.kind))) {
      match.command(this.faction, [hall.id], { kind: 'train', unit: this.strategy === 'counter' ? 'pathfinder' : 'vanguard' })
    }
    if (!savingForTier) this.trainArmy(match, army, structures, view, race)
    const enemies = view.entities.filter(unit => unit.faction !== this.faction)
    for (const unit of army) {
      const skill = isUnitKind(unit.kind) && raceSkills[race]?.[unit.kind]
      if (skill && (unit.abilityReadyAt ?? 0) <= match.tick &&
          (unit.kind === 'support' || enemies.some(enemy => distance(enemy, unit) <= Math.max(skill.radius, 144)))) {
        match.command(this.faction, [unit.id], { kind: isHeroKind(unit.kind) ? 'hero-ability' : 'unit-ability' })
      }
    }
    if (this.landing) this.navalAssault(match, army, structures, view, this.landing)
    else this.maneuver(match, view, army, race)
  }

  private trainArmy(match: Match, army: Entity[], structures: Entity[], view: Snapshot, race: Race) {
    const available = structures.filter(building =>
      building.kind !== 'headquarters' && building.kind !== 'port' && trainedAt(building.kind, race).length > 0 && (building.training?.remaining ?? 0) < (this.difficulty === 'hard' ? 2 : 1) && building.construction === undefined)
    const rangedCount = army.filter(unit => unit.kind === 'ranged' || unit.kind === 'marksman').length
    const visibleHeavy = view.entities.some(unit => unit.faction !== this.faction && unit.kind === 'heavy')
    const counter = this.difficulty === 'hard' || this.strategy === 'counter'
    const ranged = rangedCount * (race === 'elf' ? 2 : counter && visibleHeavy ? 4 : 3) < army.length && available.find(building => building.kind === 'range')
    const elite = army.length >= 8 && !army.some(unit => unit.kind === 'heavy') &&
      available.find(building => building.kind === 'elite')
    const supportCount = army.filter(unit => unit.kind === 'support').length
    const support = (race === 'elf' || race === 'undead') && supportCount < (race === 'undead' && army.length >= 14 ? 2 : 1) &&
      available.find(site => trainedAt(site.kind, race).includes('support'))
    const towers = view.entities.filter(unit => unit.faction !== this.faction && unit.kind === 'tower' && unit.construction === undefined).length
    const mortar = (race === 'dwarf' || towers >= 2) &&
      army.filter(unit => unit.kind === 'siege').length < (towers >= 2 ? 2 : 1) &&
      available.find(site => trainedAt(site.kind, race).includes('siege'))
    const crypt = race === 'undead' && available.find(site => site.kind === 'barracks')
    const building = support || mortar || ranged || elite || crypt || available.find(site => site.kind === 'barracks') || available[0]
    if (!building) return
    const choices = crypt === building ? ['blade', 'ranged', 'blade', 'ranged', 'polearm'] as const :
      race === 'human' || race === 'orc' ? recruit[building.kind] ?? trainedAt(building.kind, race) : trainedAt(building.kind, race)
    const preferred = support === building ? 'support' : mortar === building ? 'siege' : counter && visibleHeavy && building.kind === 'barracks' ?
      'polearm' : choices[this.recruits % choices.length]
    if (match.command(this.faction, [building.id], { kind: 'train', unit: preferred }) ||
        (preferred !== choices[0] && match.command(this.faction, [building.id], { kind: 'train', unit: choices[0] }))) this.recruits++
    if (race === 'undead') {
      const otherCrypt = available.find(site => site !== building && site.kind === 'barracks')
      if (otherCrypt) {
        const skeleton = this.recruits % 2 ? 'blade' : 'ranged'
        if (match.command(this.faction, [otherCrypt.id], { kind: 'train', unit: skeleton })) this.recruits++
      }
    }
  }

  private build(match: Match, view: Snapshot, builder: Entity, structures: Entity[], race: Race) {
    if (match.units.get(builder.id)?.job?.kind === 'construct') return
    const unfinished = structures.find(entity => entity.construction !== undefined)
    if (unfinished) {
      match.command(this.faction, [builder.id], { kind: 'resume-build', target: unfinished.id })
      return
    }
    const has = (kind: BuildingKind) => structures.some(entity => entity.kind === kind)
    const population = view.population
    const needsFarm = population.limit - population.used - population.reserved <= (this.difficulty === 'hard' ? 3 : 1)
    const desired: Array<[BuildingKind, boolean]> = [
      ['barracks', !has('barracks')],
      ['smithy', Boolean(match.settings.progression) && !has('smithy')],
      ['farm', needsFarm && population.limit < (match.settings.populationCap ?? 500)],
      ['port', Boolean(this.landing) && !has('port')],
      ['tower', (race === 'dwarf' || this.strategy === 'defensive') && !has('tower')],
      ['barracks', race === 'undead' && match.tick >= 30 * TICK_HZ &&
        structures.filter(site => site.kind === 'barracks').length < 2],
      ['range', !has('range')],
      ['tower', !has('tower')],
      ['elite', match.tick >= (race === 'dwarf' ? 50 : race === 'elf' ? 65 : 90) * TICK_HZ && !has('elite')],
      ['smithy', (race === 'undead' || this.difficulty !== 'easy') && match.tick >= (race === 'undead' ? 55 : 100) * TICK_HZ && !has('smithy')]
    ]
    for (const [kind, needed] of desired) {
      if (!needed || buildingTier(kind) > match.hallLevel(this.faction) || !canAfford(view.resources, buildings[kind].cost)) continue
      for (const at of this.constructionSites.get(kind) ?? []) {
        if (match.command(this.faction, [builder.id], { kind: 'build', building: kind, at })) return
      }
      if (kind === 'port' && this.shoreline[0] && !match.units.get(builder.id)?.assigned &&
          distance(builder, this.shoreline[0].land) > TILE) {
        if (match.command(this.faction, [builder.id], { kind: 'move', to: this.shoreline[0].land })) return
      }
    }
  }

  private navalAssault(match: Match, army: Entity[], structures: Entity[], view: Snapshot, landing: { land: Point, sea: Point }) {
    const port = structures.find(site => site.kind === 'port' && site.construction === undefined)
    if (!port) return
    const home = this.shoreline.find(site => distance(site.land, port) < 2 * TILE) ?? this.shoreline[0]
    const ferry = army.find(unit => unit.kind === 'transport')
    const fleet = army.filter(unit => unit.kind === 'warship')
    const objectives = view.controlSites ?? []
    const patrol = match.tick >= 120 * TICK_HZ && objectives.length > 0
    if (!port.training && (!ferry || fleet.length < (patrol ? 3 : 2))) {
      match.command(this.faction, [port.id], { kind: 'train', unit: ferry ? 'warship' : 'transport' })
    }
    for (const [index, ship] of fleet.entries()) {
      const objective = patrol && index >= 2 ? objectives.reduce((nearest, site) =>
        distance(ship, site) < distance(ship, nearest) ? site : nearest) : undefined
      if (match.units.get(ship.id)?.assigned) continue
      const target = objective ?? landing.sea
      if (distance(ship, target) > TILE) match.command(this.faction, [ship.id], { kind: 'advance', to: target })
    }
    if (!ferry || !home || match.units.get(ferry.id)?.pickup) return
    const own = army.filter(unit => !isShipKind(unit.kind) && unit.kind !== 'scout' && !this.attacking.has(unit.id))
    if (ferry.passengers?.length) {
      if (distance(ferry, landing.sea) > 50) {
        if (!match.units.get(ferry.id)?.assigned) match.command(this.faction, [ferry.id], { kind: 'move', to: landing.sea })
      } else {
        const ids = [...ferry.passengers]
        if (match.command(this.faction, [ferry.id], { kind: 'unload' })) {
          const seen = view.entities.find(unit => unit.faction !== this.faction && unit.kind === 'headquarters')
          match.command(this.faction, ids, { kind: 'advance', to: seen ?? this.enemyBase })
          for (const id of ids) this.attacking.add(id)
          match.command(this.faction, [ferry.id], { kind: 'move', to: home.sea })
        }
      }
      return
    }
    if (distance(ferry, home.sea) > 70) {
      if (!match.units.get(ferry.id)?.assigned) match.command(this.faction, [ferry.id], { kind: 'move', to: home.sea })
      return
    }
    const nearby = own.filter(unit => distance(unit, ferry) <= 5 * TILE).slice(0, 12)
    if (nearby.length >= 4 && match.command(this.faction, nearby.map(unit => unit.id), { kind: 'board', transport: ferry.id })) {
      if (!match.units.get(ferry.id)?.pickup) match.command(this.faction, [ferry.id], { kind: 'move', to: landing.sea })
    } else {
      const walking = own.filter(unit => !match.units.get(unit.id)?.assigned && distance(unit, home.land) > TILE)
      if (walking.length) match.command(this.faction, walking.slice(0, 12).map(unit => unit.id), { kind: 'move', to: home.land })
    }
  }

  private maneuver(match: Match, view: Snapshot, army: Entity[], race: Race) {
    for (const id of this.attacking) if (!match.units.has(id)) this.attacking.delete(id)
    if (race === 'elf') {
      const endangered = army.filter(unit => unit.hp < unit.maxHp * 0.35 && unit.kind !== 'scout' &&
        view.entities.some(enemy => enemy.faction !== this.faction && distance(enemy, unit) < 70)).slice(0, 6)
      if (endangered.length) {
        match.command(this.faction, endangered.map(unit => unit.id), { kind: 'move', to: this.home })
        for (const unit of endangered) this.attacking.delete(unit.id)
      }
    }
    const reserve = army.filter(unit => !this.attacking.has(unit.id) && unit.kind !== 'scout' && !isShipKind(unit.kind))
    const intruder = view.entities.find(unit => unit.faction !== this.faction && unit.kind !== 'worker' &&
      distance(unit, this.home) < 7 * TILE)
    if (intruder) {
      const idle = reserve.filter(unit => {
        const state = match.units.get(unit.id)
        return !state?.assigned && !state?.defense && distance(unit, intruder) > 3 * TILE
      })
      if (idle.length) match.command(this.faction, idle.map(unit => unit.id), { kind: 'advance', to: intruder })
      return
    }
    const plan = plans[this.difficulty]
    const guard = plan.guard + (race === 'dwarf' ? 2 : race === 'undead' ? -1 : 0)
    const early = race === 'undead' ? 12 * TICK_HZ : 0
    if (match.tick + early < this.nextAssault || reserve.length < guard + 4) return
    const waveSize = plan.wave + (race === 'undead' ? 3 : 0)
    const towers = view.entities.filter(unit => unit.faction !== this.faction && unit.kind === 'tower' &&
      unit.construction === undefined && distance(unit, this.enemyBase) < 12 * TILE).length
    const siegeReady = reserve.some(unit => unit.kind === 'siege')
    if (towers >= 2 && !siegeReady && reserve.length < guard + waveSize + towers * 2) return
    if (race === 'dwarf' || towers >= 2) reserve.sort((a, b) => Number(b.kind === 'siege') - Number(a.kind === 'siege'))
    const wave = reserve.slice(0, Math.min(waveSize + (towers >= 2 ? towers : 0), reserve.length - guard))
    const worker = (this.strategy === 'rush' || this.difficulty === 'hard') ?
      view.entities.find(unit => unit.faction !== this.faction && unit.kind === 'worker') : undefined
    const hall = view.entities.find(unit => unit.faction !== this.faction && unit.kind === 'headquarters')
    const objectives = (view.controlSites ?? []).filter(site => site.owner !== this.faction)
    const objective = match.tick >= 120 * TICK_HZ && this.strategy !== 'rush' && objectives.length ?
      objectives.reduce((nearest, site) => distance(this.home, site) < distance(this.home, nearest) ? site : nearest) : undefined
    if (match.command(this.faction, wave.map(unit => unit.id), { kind: 'advance', to: worker ?? hall ?? objective ?? this.enemyBase })) {
      for (const unit of wave) this.attacking.add(unit.id)
      this.nextAssault = match.tick + plan.interval * TICK_HZ
    }
  }
}
