import { researchCost, trainingCost } from '../shared/economy.ts'
import { cellCenter, isWalkable, isWater, tileAt } from '../shared/map.ts'
import type { BattleMap } from '../shared/map.ts'
import { TICKS_PER_SECOND } from '../shared/match-settings.ts'
import type { FinalStats, MatchReport, MatchSettings, MatchStats } from '../shared/match-settings.ts'
import { factions, isUnitKind } from '../shared/protocol.ts'
import type { ControlSite, Entity, Faction, PlayerRaces, Point, Resources, UpgradeKind } from '../shared/protocol.ts'

export function scoreSites(map: BattleMap): ControlSite[] {
  const sites: ControlSite[] = []
  const mid = Math.floor(map.width / 2)
  for (const fraction of [0.25, 0.5, 0.75]) {
    const row = Math.floor(map.height * fraction)
    let best = Infinity
    let site: Point | undefined
    for (let y = Math.max(1, row - 7); y < Math.min(map.height - 1, row + 8); y++) {
      for (let x = mid - 8; x <= mid + 8; x++) {
        const tile = tileAt(map, x, y)
        const gap = (x - mid) ** 2 + (y - row) ** 2
        if (!(map.id === 'shattered-isles' ? isWater(tile) : isWalkable(tile)) || gap >= best) continue
        best = gap
        site = cellCenter(x, y)
      }
    }
    if (site) sites.push(site)
  }
  return sites
}

type ReportState = {
  tick: number
  objective: MatchSettings['objective']
  races: PlayerRaces
  resources: Record<Faction, Resources>
  units: ReadonlyMap<number, Entity>
  upgrades: Record<Faction, UpgradeKind[]>
  territory: Record<Faction, number>
  stats: Record<Faction, MatchStats>
}

function value(cost: Partial<Resources>) {
  return (cost.gold ?? 0) + (cost.wood ?? 0) + (cost.stone ?? 0)
}

export function matchReport(state: ReportState): MatchReport {
  const sides = {} as Record<Faction, FinalStats>
  for (const faction of factions) {
    const bank = { ...state.resources[faction] }
    let army = 0
    let military = 0
    for (const unit of state.units.values()) {
      if (unit.faction !== faction || !isUnitKind(unit.kind) || unit.kind === 'worker' || unit.summonedUntil) continue
      army++
      military += value(trainingCost(unit.kind, state.races[faction]))
    }
    const levels = new Map<UpgradeKind, number>()
    let research = 0
    for (const kind of state.upgrades[faction]) {
      const level = (levels.get(kind) ?? 0) + 1
      levels.set(kind, level)
      research += value(researchCost(kind, level))
    }
    const territory = state.territory[faction]
    const reserves = value(bank)
    const score = state.objective === 'control' ? territory :
      Math.min(reserves, 2000) + Math.floor(Math.max(0, reserves - 2000) / 2) + military + research + territory
    sides[faction] = { ...state.stats[faction], gathered: { ...state.stats[faction].gathered }, bank, army, military, research, territory, score }
  }
  return { elapsedSeconds: Math.floor(state.tick / TICKS_PER_SECOND), sides }
}
