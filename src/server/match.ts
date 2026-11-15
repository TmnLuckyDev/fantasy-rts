import { TILE, ashford, distance } from '../shared/map.ts'
import type { BattleMap } from '../shared/map.ts'
import { factions } from '../shared/protocol.ts'
import type { Effect, Entity, EntityKind, Faction, Order, Point, Result, Snapshot } from '../shared/protocol.ts'
import { unitStats } from '../shared/units.ts'
import { canStand, findPath } from './navigation.ts'

export const TICK_HZ = 20
export const MAX_SELECTION = 24
const spacing = 30

type Unit = Entity & {
  order: Order | null
  assigned: Point | null
  nextStrike: number
  nextPath: number
  path: Point[]
  pursued: Point | null
  blockedTicks: number
}

type Missile = { attacker: Unit, targetId: number, arrives: number }

export class Match {
  readonly units = new Map<number, Unit>()
  readonly map: BattleMap
  tick = 0
  result: Result | null = null
  private sequence = 0
  private effects: Effect[] = []
  private missiles: Missile[] = []

  constructor(map: BattleMap = ashford) {
    this.map = map
    for (const faction of factions) {
      const base = map.bases[faction]
      const direction = faction === 'human' ? 1 : -1
      this.spawn(faction, 'headquarters', base)
      const ranks: Array<[EntityKind, number, number]> = [
        ['blade', 74, -31], ['blade', 74, 1], ['blade', 74, 33],
        ['ranged', 40, -23], ['ranged', 40, 24], ['heavy', 109, 1]
      ]
      for (const [kind, x, y] of ranks) {
        this.spawn(faction, kind, { x: base.x + x * direction, y: base.y + y * direction })
      }
    }
  }

  private spawn(faction: Faction, kind: EntityKind, position: Point) {
    const health = unitStats[faction][kind].health
    const id = ++this.sequence
    this.units.set(id, {
      ...position, faction, kind, id, hp: health, maxHp: health, moving: false,
      facing: faction === 'human' ? 1 : -1, order: null, assigned: null,
      path: [], nextPath: 0, nextStrike: 0, pursued: null, blockedTicks: 0
    })
  }

  command(faction: Faction, ids: number[], order: Order): boolean {
    if (this.result || ids.length === 0 || ids.length > MAX_SELECTION) return false
    const units = [...new Set(ids)].map(id => this.units.get(id))
    if (units.some(unit => !unit || unit.faction !== faction || unit.kind === 'headquarters')) return false
    if (order.kind === 'attack') {
      const target = this.units.get(order.target)
      if (!target || target.faction === faction) return false
    }
    if ((order.kind === 'move' || order.kind === 'advance') &&
        (!Number.isFinite(order.to.x) || !Number.isFinite(order.to.y) ||
          order.to.x < 0 || order.to.y < 0 || order.to.x >= this.map.width * TILE ||
          order.to.y >= this.map.height * TILE)) return false

    const troops = units as Unit[]
    const rowSize = Math.ceil(Math.sqrt(troops.length))
    troops.sort((a, b) => (a.kind === 'ranged' ? 1 : 0) - (b.kind === 'ranged' ? 1 : 0) || a.y - b.y)
    troops.forEach((unit, i) => {
      unit.order = order.kind === 'halt' ? null : order
      unit.path = []
      unit.pursued = null
      unit.nextPath = this.tick
      unit.blockedTicks = 0
      unit.assigned = null
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

  step() {
    if (this.result) return
    this.tick++
    const incoming: Missile[] = []
    for (const missile of this.missiles) {
      if (missile.arrives <= this.tick) this.hit(missile.attacker, missile.targetId)
      else incoming.push(missile)
    }
    this.missiles = incoming
    const buildings = [...this.units.values()].filter(unit => unit.kind === 'headquarters')
      .map(unit => ({ x: unit.x, y: unit.y, radius: unitStats[unit.faction][unit.kind].radius }))
    for (const unit of this.units.values()) {
      if (unit.kind === 'headquarters') continue
      unit.moving = false
      const automaticRange = unit.order?.kind === 'advance' ? 180 : unitStats[unit.faction][unit.kind].range + 30
      let target: Unit | undefined
      if (unit.order?.kind === 'attack') {
        target = this.units.get(unit.order.target)
        if (!target) {
          unit.order = null
          unit.path = []
          unit.pursued = null
        }
      }
      if (unit.order?.kind !== 'move' && !target) {
        let nearest = automaticRange
        for (const other of this.units.values()) {
          if (other.faction === unit.faction) continue
          const separation = distance(unit, other) - unitStats[other.faction][other.kind].radius
          if (separation < nearest) {
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
      if (!destination) continue
      if (!unit.pursued || (this.tick >= unit.nextPath &&
          (distance(unit.pursued, destination) > 14 || unit.blockedTicks >= 8))) {
        unit.path = findPath(this.map, unit, destination, buildings, unitStats[unit.faction][unit.kind].radius)
        unit.pursued = destination
        unit.nextPath = this.tick + 10
        unit.blockedTicks = 0
      }
      this.walk(unit, buildings, Boolean(target))
    }
    const standing = [...this.units.values()].filter(unit => unit.kind === 'headquarters')
    if (standing.length < 2) this.result = { winner: standing[0]?.faction ?? null, reason: 'headquarters' }
  }

  private fight(unit: Unit, target: Unit): boolean {
    const stats = unitStats[unit.faction][unit.kind]
    if (distance(unit, target) > stats.range + unitStats[target.faction][target.kind].radius) return false
    if (unit.nextStrike > this.tick) return true
    unit.nextStrike = this.tick + stats.cooldown
    unit.facing = target.x < unit.x ? -1 : 1
    if (unit.kind === 'ranged') {
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
      for (const unit of this.units.values()) {
        if (unit.order?.kind === 'attack' && unit.order.target === targetId) {
          unit.order = null
          unit.path = []
          unit.pursued = null
        }
      }
    }
  }

  private walk(unit: Unit, obstacles: Array<Point & { radius: number }>, pursuing: boolean) {
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
        if (other === unit || other.kind === 'headquarters') continue
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

  snapshot(consumeEffects = false): Snapshot {
    const effects = this.effects
    if (consumeEffects) this.effects = []
    return {
      type: 'snapshot', tick: this.tick, effects: consumeEffects ? effects : [],
      entities: [...this.units.values()].map(({ id, x, y, kind, faction, hp, maxHp, facing, moving }) => ({
        id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, kind, faction, hp, maxHp, facing, moving
      }))
    }
  }
}
