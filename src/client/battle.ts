import Phaser from 'phaser'
import { TILE, ashford, cellCenter, distance } from '../shared/map.ts'
import type { Effect, Entity, Faction, Order, Point, Snapshot } from '../shared/protocol.ts'
import { unitStats } from '../shared/units.ts'
import { canvas, entityTexture, factionColor, propTexture, randomAt, terrainColor, terrainTexture } from './art.ts'
import { BattlefieldInput } from './input.ts'
import type { SelectionRect } from './input.ts'

const mapWidth = ashford.width * TILE
const mapHeight = ashford.height * TILE
type Visual = { entity: Entity, sprite: Phaser.GameObjects.Image, lastHp: number }
type AnimatedEffect = { effect: Effect, born: number, sprite?: Phaser.GameObjects.Image }
type BattleActions = {
  order: (ids: number[], order: Order) => void
  selection: (entities: Entity[]) => void
  effect: (kind: Effect['kind']) => void
}

export class BattleScene extends Phaser.Scene {
  private visuals = new Map<number, Visual>()
  private selected = new Set<number>()
  private effects: AnimatedEffect[] = []
  private newest: Snapshot | null = null
  private graphics!: Phaser.GameObjects.Graphics
  private water!: Phaser.GameObjects.Graphics
  private ui!: Phaser.GameObjects.Graphics
  private controls!: BattlefieldInput
  private miniTerrain!: HTMLCanvasElement
  private markers: Array<{ point: Point, color: number, born: number }> = []
  private keys!: Record<string, Phaser.Input.Keyboard.Key>
  private minimapDirty = true
  private initialized = false
  private hasSnapshot = false
  private lastMiniDraw = 0
  advanceMode = false

  constructor(
    readonly faction: Faction,
    private host: HTMLElement,
    private minimap: HTMLCanvasElement,
    private actions: BattleActions
  ) {
    super('battlefield')
  }

  create() {
    this.textures.addCanvas('terrain', terrainTexture())
    this.add.image(0, 0, 'terrain').setOrigin(0).setDepth(-5)
    this.water = this.add.graphics().setDepth(-4)
    for (const tile of ['forest', 'rock', 'mine'] as const) {
      for (let v = 0; v < (tile === 'forest' ? 3 : 1); v++) this.textures.addCanvas(tile + v, propTexture(tile, v))
    }
    for (const faction of ['human', 'orc'] as const) {
      for (const kind of ['headquarters', 'blade', 'ranged', 'heavy'] as const) {
        this.textures.addCanvas(faction + kind + '0', entityTexture(faction, kind))
        if (kind !== 'headquarters') this.textures.addCanvas(faction + kind + '1', entityTexture(faction, kind, 1))
      }
    }
    ashford.tiles.forEach((tile, i) => {
      if (tile !== 'forest' && tile !== 'rock' && tile !== 'mine') return
      const point = cellCenter(i % ashford.width, Math.floor(i / ashford.width))
      const rand = randomAt(i * 61 + 905)
      const variant = tile === 'forest' ? Math.floor(rand() * 3) : 0
      const sprite = this.add.image(point.x + (rand() - 0.5) * 8, point.y, tile + variant)
      sprite.setScale(tile === 'rock' ? 1.23 : 1.18).setOrigin(0.5, 0.82).setDepth(point.y - 1)
    })
    this.graphics = this.add.graphics().setDepth(mapHeight + 2)
    this.ui = this.add.graphics().setDepth(mapHeight + 3)
    this.miniTerrain = canvas(this.minimap.width, this.minimap.height)
    const mini = this.miniTerrain.getContext('2d')!
    const tw = this.miniTerrain.width / ashford.width
    const th = this.miniTerrain.height / ashford.height
    ashford.tiles.forEach((tile, i) => {
      mini.fillStyle = terrainColor[tile]
      mini.fillRect(i % ashford.width * tw, Math.floor(i / ashford.width) * th, Math.ceil(tw), Math.ceil(th))
    })
    const camera = this.cameras.main
    camera.roundPixels = true
    camera.setZoom(this.host.clientWidth < 950 ? 0.88 : 1.06)
    this.initialized = true
    this.home()
    this.controls = new BattlefieldInput(this.host, {
      select: (point, append, touch) => this.click(point, append, touch),
      selectBox: (rect, append) => this.selectBox(rect, append),
      order: point => this.orderAt(point),
      pan: (dx, dy) => this.pan(dx, dy),
      zoom: (point, ratio) => this.zoom(point, ratio)
    })
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.controls.destroy())
    this.keys = this.input.keyboard?.addKeys('UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.clampCamera())
    if (this.newest) this.snapshot(this.newest)
  }

  snapshot(snapshot: Snapshot) {
    this.newest = snapshot
    if (!this.initialized) return
    const present = new Set(snapshot.entities.map(entity => entity.id))
    for (const [id, visual] of this.visuals) {
      if (!present.has(id)) {
        visual.sprite.destroy()
        this.visuals.delete(id)
        this.selected.delete(id)
      }
    }
    for (const entity of snapshot.entities) {
      const visual = this.visuals.get(entity.id)
      if (visual) {
        visual.lastHp = visual.entity.hp
        visual.entity = entity
      } else {
        const sprite = this.add.image(entity.x, entity.y, entity.faction + entity.kind + '0')
          .setOrigin(0.5, entity.kind === 'headquarters' ? 0.85 : 0.84)
          .setScale(entity.kind === 'headquarters' ? 1.84 : 1.48)
        this.visuals.set(entity.id, { entity, sprite, lastHp: entity.hp })
      }
    }
    for (const effect of snapshot.effects) {
      let sprite: Phaser.GameObjects.Image | undefined
      if (effect.kind === 'fallen' && effect.entityKind !== 'headquarters') {
        sprite = this.add.image(effect.at.x, effect.at.y, effect.faction + effect.entityKind + '0')
          .setOrigin(0.5, 0.84).setScale(1.48).setDepth(effect.at.y - 1)
      }
      this.effects.push({ effect, born: this.time.now, sprite })
      const camera = this.cameras.main
      if (distance(effect.at, this.cameraCenter()) < Math.max(camera.width, camera.height) / camera.zoom) this.actions.effect(effect.kind)
    }
    this.hasSnapshot = true
    this.minimapDirty = true
    this.selectionChanged()
  }

  setBoxMode(enabled: boolean) { if (this.controls) this.controls.boxMode = enabled }

  selectAll() {
    this.selected = new Set([...this.visuals.values()].filter(({ entity }) => this.ownUnit(entity)).map(({ entity }) => entity.id))
    this.selectionChanged()
  }

  halt() { this.issue({ kind: 'halt' }) }
  home() { if (this.initialized) this.focus(ashford.bases[this.faction]) }
  minimapFocus(x: number, y: number) { if (this.initialized) this.focus({ x: x * mapWidth, y: y * mapHeight }) }

  private ownUnit(entity: Entity) { return entity.faction === this.faction && entity.kind !== 'headquarters' }

  private click(screen: Point, append: boolean, touch: boolean) {
    if (this.advanceMode && this.mobileUnits().length) {
      this.orderAt(screen)
      return
    }
    const point = this.world(screen)
    const picked = this.pick(point, touch)
    if (picked?.faction === this.faction) {
      if (!append) this.selected.clear()
      if (append && this.selected.has(picked.id)) this.selected.delete(picked.id)
      else this.selected.add(picked.id)
      this.selectionChanged()
    } else if (touch && this.mobileUnits().length) this.orderAt(screen)
    else if (!append) {
      this.selected.clear()
      this.selectionChanged()
    }
  }

  private pick(point: Point, touch = false) {
    return [...this.visuals.values()]
      .filter(({ entity, sprite }) => {
        const dx = Math.abs(point.x - sprite.x)
        const dy = sprite.y - point.y
        return entity.kind === 'headquarters' ? dx < 43 && dy > -13 && dy < 76 :
          dx < (touch ? 21 : 14) && dy > -12 && dy < 35
      })
      .sort((a, b) => Number(a.entity.kind === 'headquarters') - Number(b.entity.kind === 'headquarters') ||
        distance(point, { x: a.sprite.x, y: a.sprite.y - 14 }) - distance(point, { x: b.sprite.x, y: b.sprite.y - 14 }))[0]?.entity
  }

  private selectBox(rect: SelectionRect, append: boolean) {
    const a = this.world(rect.from)
    const b = this.world(rect.to)
    if (!append) this.selected.clear()
    for (const { entity, sprite } of this.visuals.values()) {
      if (this.ownUnit(entity) && sprite.x >= Math.min(a.x, b.x) && sprite.x <= Math.max(a.x, b.x) &&
          sprite.y >= Math.min(a.y, b.y) && sprite.y - 15 <= Math.max(a.y, b.y)) this.selected.add(entity.id)
    }
    this.selectionChanged()
  }

  private selectionChanged() {
    const entities = [...this.selected].flatMap(id => {
      const entry = this.visuals.get(id)
      return entry ? [entry.entity] : []
    })
    this.actions.selection(entities)
  }

  private mobileUnits() { return [...this.selected].filter(id => this.visuals.get(id)?.entity.kind !== 'headquarters') }

  private orderAt(screen: Point) {
    const point = this.world(screen)
    if (point.x < 0 || point.y < 0 || point.x >= mapWidth || point.y >= mapHeight) return
    const picked = this.pick(point, true)
    if (picked && picked.faction !== this.faction) this.issue({ kind: 'attack', target: picked.id }, { x: picked.x, y: picked.y })
    else this.issue({ kind: this.advanceMode ? 'advance' : 'move', to: point }, point)
  }

  private issue(order: Order, point?: Point) {
    const ids = this.mobileUnits()
    if (!ids.length) return
    if (point) this.markers.push({ point, color: order.kind === 'move' ? 0xadd995 : 0xffa36b, born: this.time.now })
    this.actions.order(ids, order)
  }

  private world(point: Point): Point {
    const camera = this.cameras.main
    const center = this.cameraCenter()
    return {
      x: center.x + (point.x - camera.width / 2) / camera.zoom,
      y: center.y + (point.y - camera.height / 2) / camera.zoom
    }
  }

  private cameraCenter(): Point {
    const camera = this.cameras.main
    return { x: camera.scrollX + camera.width / 2, y: camera.scrollY + camera.height / 2 }
  }

  private focus(point: Point) {
    const camera = this.cameras.main
    camera.centerOn(point.x, point.y)
    this.clampCamera()
  }

  private pan(dx: number, dy: number) {
    const camera = this.cameras.main
    camera.scrollX -= dx / camera.zoom
    camera.scrollY -= dy / camera.zoom
    this.clampCamera()
  }

  private zoom(point: Point, ratio: number) {
    const camera = this.cameras.main
    const old = this.world(point)
    camera.setZoom(Math.max(0.38, Math.min(1.7, camera.zoom * ratio)))
    const next = this.world(point)
    camera.scrollX += old.x - next.x
    camera.scrollY += old.y - next.y
    this.clampCamera()
  }

  private clampCamera() {
    const camera = this.cameras.main
    const limit = (center: number, view: number, size: number) =>
      view >= size ? size / 2 : Math.min(size - view / 2, Math.max(view / 2, center))
    const center = this.cameraCenter()
    camera.centerOn(limit(center.x, camera.width / camera.zoom, mapWidth), limit(center.y, camera.height / camera.zoom, mapHeight))
    this.minimapDirty = true
  }

  update(time: number, delta: number) {
    if (!this.initialized) return
    const horizontal = Number(this.keys?.RIGHT.isDown ?? false) - Number(this.keys?.LEFT.isDown ?? false)
    const vertical = Number(this.keys?.DOWN.isDown ?? false) - Number(this.keys?.UP.isDown ?? false)
    if (horizontal || vertical) this.pan(-horizontal * delta * 0.37, -vertical * delta * 0.37)
    this.water.clear()
    this.water.fillStyle(0x8eb4ac, 0.32)
    for (let i = 0; i < 48; i++) {
      const y = (i * 53 + Math.floor(time * 0.024)) % mapHeight
      if (ashford.tiles[Math.floor(y / TILE) * ashford.width + 23] !== 'water') continue
      this.water.fillRect(23 * TILE + (i * 13) % 54, y, 6 + i % 7, 1)
    }
    this.graphics.clear()
    const blend = Math.min(1, delta / 70)
    for (const { entity, sprite, lastHp } of this.visuals.values()) {
      const building = entity.kind === 'headquarters'
      sprite.x += (entity.x - sprite.x) * blend
      sprite.y += (entity.y - sprite.y) * blend
      sprite.setDepth(sprite.y)
      if (!building) {
        const frame = entity.moving ? Math.floor(time / 125) % 2 : 0
        sprite.setTexture(entity.faction + entity.kind + frame).setFlipX(entity.facing < 0)
      }
      const selected = this.selected.has(entity.id)
      const color = factionColor[entity.faction]
      if (selected) {
        this.graphics.lineStyle(1.5, 0xecdf9c, 0.95)
        this.graphics.strokeEllipse(sprite.x, sprite.y + 2, building ? 85 : 29, building ? 25 : 12)
      }
      const w = building ? 64 : 22
      const x = sprite.x - w / 2
      const y = sprite.y - (building ? 82 : 40)
      this.graphics.fillStyle(0x1b1914, 0.9).fillRect(x - 1, y - 1, w + 2, 5)
      this.graphics.fillStyle(0x30271e, 1).fillRect(x, y, w, 3)
      this.graphics.fillStyle(color, 0.97).fillRect(x, y, w * entity.hp / entity.maxHp, 3)
      if (building && entity.hp < entity.maxHp * 0.5) this.paintFire(sprite.x + 19, sprite.y - 18, time)
      if (entity.hp < lastHp) this.graphics.fillStyle(0xffdc99, 0.85).fillRect(sprite.x - 1, sprite.y - 19, 3, 3)
    }
    this.paintEffects(time)
    this.markers = this.markers.filter(mark => {
      const t = (time - mark.born) / 410
      if (t > 1) return false
      this.graphics.lineStyle(2, mark.color, 1 - t)
      this.graphics.strokeEllipse(mark.point.x, mark.point.y, 12 + t * 22, 6 + t * 12)
      return true
    })
    this.ui.clear()
    const drag = this.controls?.selection
    if (drag) {
      const a = this.world(drag.from)
      const b = this.world(drag.to)
      const x = Math.min(a.x, b.x)
      const y = Math.min(a.y, b.y)
      this.ui.fillStyle(0xe2ce87, 0.15).fillRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y))
      this.ui.lineStyle(1, 0xe2ce87, 0.9).strokeRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    }
    if (this.hasSnapshot && this.minimapDirty && time - this.lastMiniDraw > 60) {
      this.drawMinimap()
      this.minimapDirty = false
      this.lastMiniDraw = time
    }
  }

  private paintFire(x: number, y: number, time: number) {
    for (let i = 0; i < 5; i++) {
      const offset = (Math.floor(time / 70) + i * 3) % 16
      this.graphics.fillStyle(i % 2 ? 0xf1b44a : 0xab5e33, 1 - offset / 17)
        .fillRect(x + i * 3 - 6, y - offset, 3 + i % 3, 5)
    }
  }

  private paintEffects(time: number) {
    this.effects = this.effects.filter(({ effect, born, sprite }) => {
      const age = time - born
      const { x, y } = effect.at
      if (effect.kind === 'shot' && effect.to) {
        const duration = Math.max(100, Math.ceil(distance(effect.at, effect.to) / 24) * 50)
        const t = age / duration
        if (t > 1) return false
        const dx = effect.to.x - x
        const dy = effect.to.y - y
        const start = Math.max(0, t - 0.09)
        const arc = Math.sin(t * Math.PI) * 17
        this.graphics.lineStyle(2, 0xe5cf9e, 0.95).lineBetween(x + dx * start, y + dy * start - 15 - arc, x + dx * t, y + dy * t - 15 - arc)
      } else if (effect.kind === 'hit') {
        if (age > 230) return false
        const t = age / 230
        for (let i = 0; i < 5; i++) {
          this.graphics.fillStyle(i % 2 ? 0xeb8c43 : 0xffdf96, 1 - t)
            .fillRect(x + Math.cos(i * 1.25) * 15 * t, y - 14 + Math.sin(i * 1.25) * 15 * t, 3, 3)
        }
      } else if (effect.kind === 'fallen') {
        if (age > 950) {
          sprite?.destroy()
          return false
        }
        if (sprite) sprite.setRotation(Math.min(1.4, age / 130)).setAlpha(1 - age / 950)
        else {
          for (let i = 0; i < 3; i++) this.paintFire(x + (i - 1) * 22, y - i * 10, time)
          this.graphics.fillStyle(0x352721, 0.62 * (1 - age / 950)).fillEllipse(x, y, 82, 38)
        }
      }
      return true
    })
  }

  private drawMinimap() {
    const ctx = this.minimap.getContext('2d')!
    const w = this.minimap.width
    const h = this.minimap.height
    ctx.drawImage(this.miniTerrain, 0, 0)
    for (const { entity } of this.visuals.values()) {
      ctx.fillStyle = entity.faction === 'human' ? '#a3d6ff' : '#ff9575'
      const r = entity.kind === 'headquarters' ? 3 : 1.3
      ctx.fillRect(entity.x / mapWidth * w - r, entity.y / mapHeight * h - r, r * 2, r * 2)
    }
    const camera = this.cameras.main
    const start = this.world({ x: 0, y: 0 })
    ctx.strokeStyle = '#ffdf98'
    ctx.strokeRect(start.x / mapWidth * w, start.y / mapHeight * h,
      camera.width / camera.zoom / mapWidth * w, camera.height / camera.zoom / mapHeight * h)
  }
}
