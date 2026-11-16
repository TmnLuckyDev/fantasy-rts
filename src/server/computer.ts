import { buildings, canAfford, upgrades } from '../shared/economy.ts'
import { TILE, cellCenter, distance, isWalkable, resourceAt } from '../shared/map.ts'
import type { BattleMap } from '../shared/map.ts'
import { isHeroKind, isUnitKind, opposite } from '../shared/protocol.ts'
import type { BuildingKind, Difficulty, Entity, Faction, Point, ResourceKind, Snapshot, UnitKind } from '../shared/protocol.ts'
import { TICK_HZ } from './match.ts'
import type { Match } from './match.ts'

const resourceAssignments = ['gold', 'wood', 'stone', 'gold'] as const
const plans = {
  easy: { cadence: 2, workers: 4, first: 105, interval: 38, guard: 3, wave: 5 },
  normal: { cadence: 1, workers: 4, first: 75, interval: 28, guard: 3, wave: 7 },
  hard: { cadence: 1, workers: 5, first: 58, interval: 24, guard: 4, wave: 10 }
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
    this.enemyBase = map.bases[opposite(faction)]
    const land: Point[] = []
    for (let i = 0; i < map.tiles.length; i++) {
      const point = cellCenter(i % map.width, Math.floor(i / map.width))
      const gap = distance(point, this.home)
      const resource = resourceAt(map, point)
      if (resource) this.gatherSites[resource].push(point)
      if (gap >= 3 * TILE && gap <= 9 * TILE && isWalkable(map.tiles[i])) land.push(point)
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
    const view = match.view(this.faction)
    const own = view.entities.filter(entity => entity.faction === this.faction)
    const structures = own.filter(entity => !isUnitKind(entity.kind))
    const hall = structures.find(entity => entity.kind === 'headquarters')
    if (!hall) return
    const workers = own.filter(entity => entity.kind === 'worker')
    const builder = workers.length >= 4 ? workers.at(-1) : undefined
    if (workers.length < plan.workers && !hall.training) {
      match.command(this.faction, [hall.id], { kind: 'train', unit: 'worker' })
    }
    if (builder) this.build(match, view, builder, structures)
    const assigned = new Map<string, number>()
    workers.forEach((worker, index) => {
      const job = match.units.get(worker.id)?.job
      if (job && job.kind !== 'gather') return
      const resource = resourceAssignments[index] ?? 'gold'
      const key = (at: Point) => at.x + ',' + at.y
      const available = (at: Point, kind: ResourceKind) => match.availableDeposit(this.faction, at) &&
        (assigned.get(key(at)) ?? 0) < (match.settings.sources[kind].workers ?? Infinity)
      const preferred = this.gatherSites[resource].find(at => available(at, resource))
      const at = preferred ?? (job && available(job.at, job.resource) ? job.at :
        Object.entries(this.gatherSites).flatMap(([kind, sites]) =>
          sites.find(at => available(at, kind as ResourceKind)) ?? []).at(0))
      if (!at) return
      if (!job || key(job.at) !== key(at)) {
        if (!match.command(this.faction, [worker.id], { kind: 'gather', at })) return
      }
      assigned.set(key(at), (assigned.get(key(at)) ?? 0) + 1)
    })
    const smith = structures.find(unit => unit.kind === 'smithy' && unit.construction === undefined && !unit.research)
    if (smith) {
      for (const kind of ['weapons', 'armor'] as const) {
        if (!view.upgrades?.includes(kind) && canAfford(view.resources, upgrades[kind].cost) &&
            match.command(this.faction, [smith.id], { kind: 'upgrade', upgrade: kind })) break
      }
    }
    const army = own.filter(entity => isUnitKind(entity.kind) && entity.kind !== 'worker')
    if (army.length >= 8 && workers.length >= 4 && !hall.training && !army.some(unit => isHeroKind(unit.kind))) {
      match.command(this.faction, [hall.id], { kind: 'train', unit: this.strategy === 'counter' ? 'pathfinder' : 'vanguard' })
    }
    this.trainArmy(match, army, structures, view)
    this.maneuver(match, view, army)
  }

  private trainArmy(match: Match, army: Entity[], structures: Entity[], view: Snapshot) {
    const available = structures.filter(building =>
      recruit[building.kind] && (building.training?.remaining ?? 0) < (this.difficulty === 'hard' ? 2 : 1) && building.construction === undefined)
    const rangedCount = army.filter(unit => unit.kind === 'ranged' || unit.kind === 'marksman').length
    const visibleHeavy = view.entities.some(unit => unit.faction !== this.faction && unit.kind === 'heavy')
    const counter = this.difficulty === 'hard' || this.strategy === 'counter'
    const ranged = rangedCount * (counter && visibleHeavy ? 4 : 3) < army.length && available.find(building => building.kind === 'range')
    const elite = army.length >= 8 && !army.some(unit => unit.kind === 'heavy') &&
      available.find(building => building.kind === 'elite')
    const building = ranged || elite || available.find(site => site.kind === 'barracks') || available[0]
    if (!building) return
    const choices = recruit[building.kind]!
    const preferred = counter && visibleHeavy && building.kind === 'barracks' ?
      'polearm' : choices[this.recruits % choices.length]
    if (match.command(this.faction, [building.id], { kind: 'train', unit: preferred }) ||
        (preferred !== choices[0] && match.command(this.faction, [building.id], { kind: 'train', unit: choices[0] }))) this.recruits++
  }

  private build(match: Match, view: Snapshot, builder: Entity, structures: Entity[]) {
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
      ['farm', needsFarm],
      ['tower', this.strategy === 'defensive' && !has('tower')],
      ['range', !has('range')],
      ['tower', !has('tower')],
      ['elite', match.tick >= 90 * TICK_HZ && !has('elite')],
      ['smithy', this.difficulty !== 'easy' && match.tick >= 100 * TICK_HZ && !has('smithy')]
    ]
    const kind = desired.find(([, needed]) => needed)?.[0]
    if (!kind || !canAfford(view.resources, buildings[kind].cost)) return
    for (const at of this.constructionSites.get(kind) ?? []) {
      if (match.command(this.faction, [builder.id], { kind: 'build', building: kind, at })) return
    }
  }

  private maneuver(match: Match, view: Snapshot, army: Entity[]) {
    for (const id of this.attacking) if (!match.units.has(id)) this.attacking.delete(id)
    const reserve = army.filter(unit => !this.attacking.has(unit.id))
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
    if (match.tick < this.nextAssault || reserve.length < plan.guard + 4) return
    const wave = reserve.slice(0, Math.min(plan.wave, reserve.length - plan.guard))
    const worker = (this.strategy === 'rush' || this.difficulty === 'hard') ?
      view.entities.find(unit => unit.faction !== this.faction && unit.kind === 'worker') : undefined
    if (match.command(this.faction, wave.map(unit => unit.id), { kind: 'advance', to: worker ?? this.enemyBase })) {
      for (const unit of wave) this.attacking.add(unit.id)
      this.nextAssault = match.tick + plan.interval * TICK_HZ
    }
  }
}
