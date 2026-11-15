import { MAX_POPULATION, buildings, canAfford } from '../shared/economy.ts'
import { TILE, cellCenter, distance, isWalkable, resourceAt } from '../shared/map.ts'
import type { BattleMap } from '../shared/map.ts'
import { isUnitKind, opposite } from '../shared/protocol.ts'
import type { BuildingKind, Entity, Faction, Point, ResourceKind, Snapshot, UnitKind } from '../shared/protocol.ts'
import { TICK_HZ } from './match.ts'
import type { Match } from './match.ts'

const resourceAssignments = ['gold', 'wood', 'stone', 'gold'] as const
const workerTarget = 4
const guardsToKeep = 3
const firstAssault = 75 * TICK_HZ
const assaultInterval = 28 * TICK_HZ

const sites: Partial<Record<BuildingKind, Point>> = {
  barracks: { x: 6, y: 2 },
  farm: { x: 4, y: 4 },
  range: { x: 6, y: -3 },
  tower: { x: 9, y: 0 },
  elite: { x: 3, y: -2 }
}

const recruit: Partial<Record<Entity['kind'], readonly UnitKind[]>> = {
  barracks: ['blade', 'blade', 'polearm'],
  range: ['ranged', 'ranged', 'marksman'],
  elite: ['heavy']
}

export class ComputerOpponent {
  readonly faction: Faction
  private readonly home: Point
  private readonly enemyBase: Point
  private readonly gatherSites: Partial<Record<ResourceKind, Point>> = {}
  private readonly constructionSites = new Map<BuildingKind, Point[]>()
  private readonly attacking = new Set<number>()
  private nextAssault = firstAssault
  private recruits = 0

  constructor(faction: Faction, map: BattleMap) {
    this.faction = faction
    this.home = map.bases[faction]
    this.enemyBase = map.bases[opposite(faction)]
    const land: Point[] = []
    for (let i = 0; i < map.tiles.length; i++) {
      const point = cellCenter(i % map.width, Math.floor(i / map.width))
      const gap = distance(point, this.home)
      const resource = resourceAt(map, point)
      if (resource && (!this.gatherSites[resource] || gap < distance(this.gatherSites[resource], this.home))) {
        this.gatherSites[resource] = point
      }
      if (gap >= 3 * TILE && gap <= 9 * TILE && isWalkable(map.tiles[i])) land.push(point)
    }
    const direction = faction === 'human' ? 1 : -1
    for (const [kind, offset] of Object.entries(sites) as Array<[BuildingKind, Point]>) {
      const preferred = { x: this.home.x + offset.x * TILE * direction, y: this.home.y + offset.y * TILE * direction }
      this.constructionSites.set(kind, [...land].sort((a, b) => distance(a, preferred) - distance(b, preferred)))
    }
  }

  think(match: Match) {
    if (match.result || match.tick % TICK_HZ !== 0) return
    const view = match.view(this.faction)
    const own = view.entities.filter(entity => entity.faction === this.faction)
    const structures = own.filter(entity => !isUnitKind(entity.kind))
    const hall = structures.find(entity => entity.kind === 'headquarters')
    if (!hall) return
    const workers = own.filter(entity => entity.kind === 'worker')
    const builder = workers.length >= workerTarget ? workers.at(-1) : undefined
    if (workers.length < workerTarget && !hall.training) {
      match.command(this.faction, [hall.id], { kind: 'train', unit: 'worker' })
    }
    if (builder) this.build(match, view, builder, structures)
    workers.forEach((worker, index) => {
      const job = match.units.get(worker.id)?.job
      const resource = resourceAssignments[index] ?? 'gold'
      const at = this.gatherSites[resource]
      if (at && (!job || (job.kind === 'gather' && job.resource !== resource))) {
        match.command(this.faction, [worker.id], { kind: 'gather', at })
      }
    })
    const army = own.filter(entity => isUnitKind(entity.kind) && entity.kind !== 'worker')
    this.trainArmy(match, army, structures)
    this.maneuver(match, view, army)
  }

  private trainArmy(match: Match, army: Entity[], structures: Entity[]) {
    const available = structures.filter(building =>
      recruit[building.kind] && !building.training && building.construction === undefined)
    const rangedCount = army.filter(unit => unit.kind === 'ranged' || unit.kind === 'marksman').length
    const ranged = rangedCount * 3 < army.length && available.find(building => building.kind === 'range')
    const elite = army.length >= 8 && !army.some(unit => unit.kind === 'heavy') &&
      available.find(building => building.kind === 'elite')
    const building = ranged || elite || available.find(site => site.kind === 'barracks') || available[0]
    if (!building) return
    const choices = recruit[building.kind]!
    const preferred = choices[this.recruits % choices.length]
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
    const needsFarm = population.limit < MAX_POPULATION && population.limit - population.used - population.reserved <= 1
    const desired: Array<[BuildingKind, boolean]> = [
      ['barracks', !has('barracks')],
      ['farm', needsFarm],
      ['range', !has('range')],
      ['tower', !has('tower')],
      ['elite', match.tick >= 90 * TICK_HZ && !has('elite')]
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
    if (match.tick < this.nextAssault || reserve.length < guardsToKeep + 4) return
    const wave = reserve.slice(0, Math.min(7, reserve.length - guardsToKeep))
    if (match.command(this.faction, wave.map(unit => unit.id), { kind: 'advance', to: this.enemyBase })) {
      for (const unit of wave) this.attacking.add(unit.id)
      this.nextAssault = match.tick + assaultInterval
    }
  }
}
