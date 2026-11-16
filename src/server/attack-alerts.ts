import { TILE } from '../shared/map.ts'
import { TICKS_PER_SECOND } from '../shared/match-settings.ts'
import { isUnitKind } from '../shared/protocol.ts'
import type { AttackAlert, Entity, Point } from '../shared/protocol.ts'

const area = 6 * TILE
const lifetime = 5 * TICKS_PER_SECOND
const cooldown = 8 * TICKS_PER_SECOND
const skirmishWindow = 2 * TICKS_PER_SECOND
const maxVisible = 3
const priority = { army: 0, workers: 1, building: 2, base: 3 }

type Region = Point & { tick: number, lastAlert: number, alert?: AttackAlert, troops: Map<number, number> }

export class AttackAlerts {
  private readonly regions = new Map<number, Region>()
  private visible: AttackAlert[] = []
  private nextId = 0

  get current() { return this.visible }

  advance(tick: number) {
    if (this.visible.some(alert => alert.until <= tick)) {
      this.visible = this.visible.filter(alert => alert.until > tick)
    }
    if (tick % TICKS_PER_SECOND) return
    for (const [key, region] of this.regions) {
      if (tick - region.tick >= cooldown) this.regions.delete(key)
    }
  }

  hit(target: Entity, tick: number) {
    const kind: AttackAlert['kind'] = target.kind === 'headquarters' ? 'base' :
      target.kind === 'worker' ? 'workers' : isUnitKind(target.kind) ? 'army' : 'building'
    const region = this.region(target, tick)
    region.tick = tick
    if (kind === 'army') {
      for (const [id, when] of region.troops) {
        if (tick - when >= skirmishWindow) region.troops.delete(id)
      }
      if (region.troops.size < 3 || region.troops.has(target.id)) region.troops.set(target.id, tick)
      if (region.troops.size < 3) return
    }
    const previous = region.alert
    if (previous && tick - region.lastAlert < cooldown && priority[kind] <= priority[previous.kind]) return
    const alert: AttackAlert = { id: ++this.nextId, kind, at: { x: target.x, y: target.y }, until: tick + lifetime }
    const next = [...this.visible.filter(other => other !== previous), alert]
    next.sort((a, b) => priority[b.kind] - priority[a.kind] || b.id - a.id)
    this.visible = next.slice(0, maxVisible)
    region.alert = alert
    region.lastAlert = tick
  }

  private region(point: Point, tick: number): Region {
    const x = Math.floor(point.x / area)
    const y = Math.floor(point.y / area)
    const key = (x: number, y: number) => x + y * 1024
    const direct = this.regions.get(key(x, y))
    if (direct && tick - direct.tick < cooldown) return direct
    let nearest: Region | undefined
    let range = area ** 2
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const region = this.regions.get(key(x + dx, y + dy))
        if (!region || tick - region.tick >= cooldown) continue
        const gap = (point.x - region.x) ** 2 + (point.y - region.y) ** 2
        if (gap >= range) continue
        nearest = region
        range = gap
      }
    }
    if (nearest) return nearest
    const region = { x: point.x, y: point.y, tick, lastAlert: -Infinity, troops: new Map<number, number>() }
    this.regions.set(key(x, y), region)
    return region
  }
}
