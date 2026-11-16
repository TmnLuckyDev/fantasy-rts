import Phaser from 'phaser'
import { TILE, cellCenter, distance, isWalkable, resourceAt, snapToCell, tileAt, wallLine } from '../shared/map.ts'
import type { BattleMap } from '../shared/map.ts'
import { MAX_SELECTION, entityKinds, isHeroKind, isUnitKind } from '../shared/protocol.ts'
import { decodeFog } from '../shared/fog.ts'
import { validPlacement } from '../shared/economy.ts'
import type { BuildingKind, Effect, Entity, Faction, Order, Point, ResourceKind, Snapshot } from '../shared/protocol.ts'
import { heroLevel } from '../shared/heroes.ts'
import { unitStats } from '../shared/units.ts'
import { factionColor, propTexture, randomAt, terrainColor, terrainTexture } from './art.ts'
import { entityTexture } from './sprites.ts'
import { canvas } from './voxel.ts'
import { BattlefieldInput } from './input.ts'
import type { SelectionRect } from './input.ts'

const terrainChunkTiles = 24
type Visual = { entity: Entity, sprite: Phaser.GameObjects.Image, lastHp: number, offsetX: number, offsetY: number, ring?: Phaser.GameObjects.Image }
type AnimatedEffect = { effect: Effect, born: number, sprite?: Phaser.GameObjects.Image }
type BattleActions = {
  order: (ids: number[], order: Order) => void
  selection: (entities: Entity[], interactive: boolean) => void
  placement: (kind: BuildingKind | null, blocked?: boolean, segmentCount?: number) => void
  effect: (kind: Effect['kind']) => void
}

export class BattleScene extends Phaser.Scene {
  private visuals = new Map<number, Visual>()
  private ringPool: Phaser.GameObjects.Image[] = []
  private selected = new Set<number>()
  private lastIdleWorker = 0
  private effects: AnimatedEffect[] = []
  private newest: Snapshot | null = null
  private graphics!: Phaser.GameObjects.Graphics
  private water!: Phaser.GameObjects.Graphics
  private ui!: Phaser.GameObjects.Graphics
  private controls!: BattlefieldInput
  private miniTerrain!: HTMLCanvasElement
  private fogTexture!: Phaser.Textures.CanvasTexture
  private fogPixels!: ImageData
  private fogMask = ''
  private fog: Uint8Array
  private terrainChunks = new Map<string, Phaser.GameObjects.Image>()
  private terrainWindow = ''

  private get mapWidth() { return this.map.width * TILE }
  private get mapHeight() { return this.map.height * TILE }
  private markers: Array<{ point: Point, color: number, born: number }> = []
  private keys!: Record<string, Phaser.Input.Keyboard.Key>
  private minimapDirty = true
  private initialized = false
  private hasSnapshot = false
  private lastMiniDraw = 0
  advanceMode = false
  private placing: BuildingKind | null = null
  private pointer: Point | null = null

  constructor(
    readonly faction: Faction,
    private readonly map: BattleMap,
    private host: HTMLElement,
    private minimap: HTMLCanvasElement,
    private actions: BattleActions
  ) {
    super('battlefield')
    this.fog = new Uint8Array(map.tiles.length)
  }

  create() {
    this.water = this.add.graphics().setDepth(-4)
    for (const tile of ['forest', 'rock', 'mine', 'quarry'] as const) {
      for (let v = 0; v < (tile === 'forest' || tile === 'rock' ? 3 : 1); v++) this.textures.addCanvas(tile + v, propTexture(tile, v))
    }
    for (const faction of ['human', 'orc'] as const) {
      for (const kind of entityKinds) {
        this.textures.addCanvas(faction + kind + '0', entityTexture(faction, kind))
        if (isUnitKind(kind)) this.textures.addCanvas(faction + kind + '1', entityTexture(faction, kind, 1))
      }
    }
    this.map.tiles.forEach((tile, i) => {
      if (tile !== 'forest' && tile !== 'rock' && tile !== 'mine' && tile !== 'quarry') return
      const point = cellCenter(i % this.map.width, Math.floor(i / this.map.width))
      const rand = randomAt(Math.imul(i + 1, 0x9e3779b9))
      const variant = tile === 'forest' || tile === 'rock' ? Math.floor(rand() * 3) : 0
      const sprite = this.add.image(point.x + (rand() - 0.5) * 8, point.y + (rand() - 0.5) * 4, tile + variant)
      sprite.setScale(tile === 'forest' ? 1.06 : 0.96).setOrigin(0.5, 40 / 48).setDepth(point.y - 1)
    })
    this.textures.addCanvas('selection-unit', this.ringTexture(27, 12))
    for (const kind of entityKinds) {
      if (!isUnitKind(kind)) {
        this.textures.addCanvas('selection-' + kind, this.ringTexture(unitStats[this.faction][kind].radius * 2.1, 22))
      }
    }
    this.graphics = this.add.graphics().setDepth(this.mapHeight + 2)
    this.fogTexture = this.textures.createCanvas('fog', this.map.width, this.map.height)!
    this.fogTexture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    this.fogPixels = this.fogTexture.context.createImageData(this.map.width, this.map.height)
    this.paintFog()
    this.add.image(0, 0, 'fog').setOrigin(0).setScale(TILE).setDepth(this.mapHeight + 3)
    this.ui = this.add.graphics().setDepth(this.mapHeight + 4)
    this.miniTerrain = canvas(this.minimap.width, this.minimap.height)
    const mini = this.miniTerrain.getContext('2d')!
    const tw = this.miniTerrain.width / this.map.width
    const th = this.miniTerrain.height / this.map.height
    this.map.tiles.forEach((tile, i) => {
      mini.fillStyle = terrainColor[tile]
      mini.fillRect(i % this.map.width * tw, Math.floor(i / this.map.width) * th, Math.ceil(tw), Math.ceil(th))
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
      camera: (from, to, ratio) => this.transformCamera(from, to, ratio)
    })
    const track = (event: PointerEvent) => {
      const rect = this.host.getBoundingClientRect()
      this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    this.host.addEventListener('pointermove', track)
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0 && (width !== this.scale.width || height !== this.scale.height)) {
        this.scale.setParentSize(width, height)
      }
    })
    const onResize = (_gameSize: Phaser.Structs.Size, baseSize: Phaser.Structs.Size,
      _displaySize: Phaser.Structs.Size, oldWidth: number, oldHeight: number) => {
      camera.setSize(baseSize.width, baseSize.height)
      camera.scrollX += (oldWidth - camera.width) / 2
      camera.scrollY += (oldHeight - camera.height) / 2
      this.clampCamera()
    }
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize)
    resize.observe(this.host)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.controls.destroy()
      this.host.removeEventListener('pointermove', track)
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize)
      resize.disconnect()
    })
    this.keys = this.input.keyboard?.addKeys('UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>
    if (this.newest) this.snapshot(this.newest)
  }

  snapshot(snapshot: Snapshot) {
    this.newest = snapshot
    if (!this.initialized) return
    if (snapshot.fog !== this.fogMask) {
      this.fogMask = snapshot.fog
      this.fog = decodeFog(snapshot.fog, this.map.tiles.length)
      this.paintFog()
    }
    const present = new Set(snapshot.entities.map(entity => entity.id))
    for (const [id, visual] of this.visuals) {
      if (!present.has(id)) {
        visual.sprite.destroy()
        this.releaseRing(visual)
        this.visuals.delete(id)
        this.selected.delete(id)
      }
    }
    for (const entity of snapshot.entities) {
      const visual = this.visuals.get(entity.id)
      if (visual) {
        if (visual.entity === entity) continue
        visual.lastHp = visual.entity.hp
        visual.entity = entity
      } else {
        const sprite = this.add.image(entity.x, entity.y, entity.faction + entity.kind + '0')
          .setOrigin(0.5, 0.83)
          .setScale(isHeroKind(entity.kind) ? 1.52 : isUnitKind(entity.kind) ? 1.21 : entity.kind === 'headquarters' ? 1.55 : 1.4)
        this.visuals.set(entity.id, { entity, sprite, lastHp: entity.hp, offsetX: 0, offsetY: 0 })
      }
    }
    this.spreadCrowds()
    for (const effect of snapshot.effects) {
      let sprite: Phaser.GameObjects.Image | undefined
      if (effect.kind === 'fallen' && isUnitKind(effect.entityKind)) {
        sprite = this.add.image(effect.at.x, effect.at.y, effect.faction + effect.entityKind + '0')
          .setOrigin(0.5, 0.83).setScale(1.21).setDepth(effect.at.y - 1)
      }
      this.effects.push({ effect, born: this.time.now, sprite })
      const camera = this.cameras.main
      if (distance(effect.at, this.cameraCenter()) < Math.max(camera.width, camera.height) / camera.zoom) this.actions.effect(effect.kind)
    }
    this.hasSnapshot = true
    this.minimapDirty = true
    this.selectionChanged()
  }

  private spreadCrowds() {
    const groups = new Map<number, Visual[]>()
    for (const visual of this.visuals.values()) {
      const { entity } = visual
      if (!isUnitKind(entity.kind)) continue
      visual.offsetX = visual.offsetY = 0
      const key = Math.floor(entity.x / 14) + Math.floor(entity.y / 14) * 65536
      const group = groups.get(key)
      if (group) group.push(visual)
      else groups.set(key, [visual])
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue
      // Move only the rendered sprites. Spacing remains small and stable within a crowd.
      for (let i = 0; i < group.length; i++) {
        const visual = group[i]
        const angle = i * 2.399963
        const radius = Math.min(15, 5 * Math.sqrt(i + 1))
        const dx = radius * Math.cos(angle)
        const dy = radius * Math.sin(angle) * 0.68
        const tx = Math.floor((visual.entity.x + dx) / TILE)
        const ty = Math.floor((visual.entity.y + dy) / TILE)
        if (!isWalkable(tileAt(this.map, tx, ty))) continue
        visual.offsetX = dx
        visual.offsetY = dy
      }
    }
  }

  selectHero() {
    for (const { entity } of this.visuals.values()) {
      if (entity.faction !== this.faction || !isHeroKind(entity.kind)) continue
      this.selected = new Set([entity.id])
      this.place(null)
      this.focus(entity)
      this.selectionChanged(true)
      return
    }
  }

  private ringTexture(width: number, height: number) {
    const surface = canvas(Math.ceil(width) + 6, height + 6)
    const context = surface.getContext('2d')!
    context.beginPath()
    context.ellipse(surface.width / 2, surface.height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
    context.strokeStyle = 'rgba(24,44,38,0.8)'
    context.lineWidth = 3.5
    context.stroke()
    context.strokeStyle = '#ffe89e'
    context.lineWidth = 1.5
    context.stroke()
    return surface
  }

  private releaseRing(visual: Visual) {
    if (!visual.ring) return
    this.ringPool.push(visual.ring.setVisible(false))
    visual.ring = undefined
  }

  private paintFog() {
    const pixels = this.fogPixels.data
    for (let i = 0; i < this.fog.length; i++) {
      const offset = i * 4
      pixels[offset] = 13
      pixels[offset + 1] = 19
      pixels[offset + 2] = 16
      pixels[offset + 3] = this.fog[i] === 2 ? 0 : this.fog[i] === 1 ? 174 : 255
    }
    this.fogTexture.context.putImageData(this.fogPixels, 0, 0)
    this.fogTexture.refresh()
  }

  private sightAt(point: Point) {
    const x = Math.floor(point.x / TILE)
    const y = Math.floor(point.y / TILE)
    if (x < 0 || x >= this.map.width || y < 0 || y >= this.map.height) return 0
    return this.fog[y * this.map.width + x]
  }

  selectAll() {
    this.selectKind(false)
  }

  selectWorkers() { this.selectKind(true) }

  selectIdleWorker() {
    const idle = [...this.visuals.values()].map(({ entity }) => entity)
      .filter(entity => entity.faction === this.faction && entity.kind === 'worker' && entity.idle)
      .sort((a, b) => a.id - b.id)
    const next = idle.find(entity => entity.id > this.lastIdleWorker) ?? idle[0]
    if (!next) return
    this.lastIdleWorker = next.id
    this.place(null)
    this.selected = new Set([next.id])
    this.focus(next)
    this.selectionChanged(true)
  }

  gatherNearest(resource: ResourceKind) {
    const ids = this.workerIds()
    const worker = this.visuals.get(ids[0])?.entity
    if (!worker) return false
    let nearest: Point | undefined
    let range = Infinity
    for (let index = 0; index < this.map.tiles.length; index++) {
      if (!this.fog[index]) continue
      const point = cellCenter(index % this.map.width, Math.floor(index / this.map.width))
      if (resourceAt(this.map, point) !== resource) continue
      const gap = distance(worker, point)
      if (gap < range) {
        nearest = point
        range = gap
      }
    }
    if (!nearest) return false
    this.actions.order(ids, { kind: 'gather', at: nearest })
    return true
  }

  private selectKind(workers: boolean) {
    this.placing = null
    this.actions.placement(null)
    this.selected = new Set([...this.visuals.values()].filter(({ entity }) =>
      this.ownUnit(entity) && (entity.kind === 'worker') === workers).slice(0, MAX_SELECTION).map(({ entity }) => entity.id))
    this.selectionChanged(true)
  }

  place(kind: BuildingKind | null) {
    this.placing = kind
    this.actions.placement(kind)
  }

  private workerIds() { return [...this.selected].filter(id => this.visuals.get(id)?.entity.kind === 'worker') }

  halt() { this.issue({ kind: 'halt' }) }
  home() { if (this.initialized) this.focus(this.map.bases[this.faction]) }
  minimapFocus(x: number, y: number) { if (this.initialized) this.focus({ x: x * this.mapWidth, y: y * this.mapHeight }) }

  private ownUnit(entity: Entity) { return entity.faction === this.faction && isUnitKind(entity.kind) }

  private click(screen: Point, append: boolean, touch: boolean) {
    const point = this.world(screen)
    if (this.placing) {
      const ids = this.workerIds()
      const at = snapToCell(point)
      if (ids.length && this.sightAt(at) === 2 && validPlacement(this.map, this.placing, at, this.entities())) {
        this.actions.order(ids, { kind: 'build', building: this.placing, at })
        this.actions.placement(this.placing)
      } else this.actions.placement(this.placing, true)
      return
    }
    if (touch && this.workerIds().length && this.gatherPoint(point)) {
      this.orderAt(screen)
      return
    }
    if (this.advanceMode && this.mobileUnits().length) {
      this.orderAt(screen)
      return
    }
    const picked = this.pick(point, touch)
    if (touch && this.workOnBuilding(this.workerIds(), picked)) return
    if (picked?.faction === this.faction) {
      if (!append) this.selected.clear()
      if (append && this.selected.has(picked.id)) this.selected.delete(picked.id)
      else if (this.selected.size < MAX_SELECTION) this.selected.add(picked.id)
      this.selectionChanged(true)
    } else if (touch && this.mobileUnits().length) this.orderAt(screen)
    else if (!append) {
      this.selected.clear()
      this.selectionChanged(true)
    }
  }

  private pick(point: Point, touch = false) {
    return [...this.visuals.values()]
      .filter(({ entity, sprite }) => {
        const dx = Math.abs(point.x - sprite.x)
        const dy = sprite.y - point.y
        if (isUnitKind(entity.kind)) return dx < (touch ? 21 : 14) && dy > -12 && dy < 35
        const radius = unitStats[entity.faction][entity.kind].radius
        const height = entity.kind === 'headquarters' ? 76 : entity.kind === 'tower' ? 61 : 35
        return dx < radius + 10 && dy > -14 && dy < height
      })
      .sort((a, b) => Number(!isUnitKind(a.entity.kind)) - Number(!isUnitKind(b.entity.kind)) ||
        distance(point, { x: a.sprite.x, y: a.sprite.y - 14 }) - distance(point, { x: b.sprite.x, y: b.sprite.y - 14 }))[0]?.entity
  }

  private selectBox(rect: SelectionRect, append: boolean) {
    const a = this.world(rect.from)
    const b = this.world(rect.to)
    if (this.placing) {
      if (this.placing === 'wall' && wallLine(this.map, a, b).length) {
        this.actions.order(this.workerIds(), { kind: 'wall-line', from: a, to: b })
        this.actions.placement('wall')
      }
      return
    }
    if (!append) this.selected.clear()
    for (const { entity, sprite } of this.visuals.values()) {
      if (this.selected.size < MAX_SELECTION && this.ownUnit(entity) && sprite.x >= Math.min(a.x, b.x) && sprite.x <= Math.max(a.x, b.x) &&
          sprite.y >= Math.min(a.y, b.y) && sprite.y - 15 <= Math.max(a.y, b.y)) this.selected.add(entity.id)
    }
    this.selectionChanged(true)
  }

  private selectionChanged(interactive = false) {
    const entities = [...this.selected].flatMap(id => {
      const entry = this.visuals.get(id)
      return entry ? [entry.entity] : []
    })
    if (this.placing && !entities.some(entity => entity.kind === 'worker')) this.place(null)
    this.actions.selection(entities, interactive)
  }

  private mobileUnits() {
    return [...this.selected].filter(id => isUnitKind(this.visuals.get(id)?.entity.kind))
  }

  private *entities() {
    for (const current of this.visuals.values()) yield current.entity
  }

  private gatherPoint(point: Point) {
    if (this.sightAt(point) && resourceAt(this.map, point)) return snapToCell(point)
    const ground = { x: point.x, y: point.y + 12 }
    return this.sightAt(ground) && resourceAt(this.map, ground) ? snapToCell(ground) : null
  }

  private orderAt(screen: Point) {
    if (this.placing) {
      this.place(null)
      return
    }
    const point = this.world(screen)
    if (point.x < 0 || point.y < 0 || point.x >= this.mapWidth || point.y >= this.mapHeight) return
    const picked = this.pick(point, true)
    const workers = this.workerIds()
    const resource = workers.length ? this.gatherPoint(point) : null
    if (resource) {
      this.actions.order(workers, { kind: 'gather', at: resource })
      return
    }
    if (this.workOnBuilding(workers, picked)) return
    if (picked && picked.faction !== this.faction) this.issue({ kind: 'attack', target: picked.id }, { x: picked.x, y: picked.y })
    else this.issue({ kind: this.advanceMode ? 'advance' : 'move', to: point }, point)
  }

  private workOnBuilding(workers: number[], target?: Entity) {
    if (!workers.length || target?.faction !== this.faction || isUnitKind(target.kind)) return false
    if (target.construction !== undefined) {
      this.actions.order(workers, { kind: 'resume-build', target: target.id })
    } else if (target.hp < target.maxHp && !target.repairing) {
      this.actions.order(workers, { kind: 'repair', target: target.id })
    } else return false
    return true
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

  private transformCamera(from: Point, to: Point, ratio: number) {
    const camera = this.cameras.main
    const old = this.world(from)
    camera.setZoom(Math.max(0.38, Math.min(1.7, camera.zoom * ratio)))
    const next = this.world(to)
    camera.scrollX += old.x - next.x
    camera.scrollY += old.y - next.y
    this.clampCamera()
  }

  private clampCamera() {
    const camera = this.cameras.main
    const limit = (center: number, view: number, size: number) =>
      view >= size ? size / 2 : Math.min(size - view / 2, Math.max(view / 2, center))
    const center = this.cameraCenter()
    camera.centerOn(limit(center.x, camera.width / camera.zoom, this.mapWidth), limit(center.y, camera.height / camera.zoom, this.mapHeight))
    this.minimapDirty = true
  }

  private updateTerrain(center: Point, halfWidth: number, halfHeight: number) {
    const span = terrainChunkTiles * TILE
    const left = Math.max(0, Math.floor((center.x - halfWidth) / span))
    const top = Math.max(0, Math.floor((center.y - halfHeight) / span))
    const right = Math.min(Math.ceil(this.map.width / terrainChunkTiles) - 1, Math.floor((center.x + halfWidth) / span))
    const bottom = Math.min(Math.ceil(this.map.height / terrainChunkTiles) - 1, Math.floor((center.y + halfHeight) / span))
    const window = [left, top, right, bottom].join(',')
    if (this.terrainWindow === window) return
    this.terrainWindow = window
    const visible = new Set<string>()
    for (let row = top; row <= bottom; row++) {
      for (let column = left; column <= right; column++) {
        const key = `terrain-${column}-${row}`
        visible.add(key)
        if (this.terrainChunks.has(key)) continue
        const x = column * terrainChunkTiles
        const y = row * terrainChunkTiles
        this.textures.addCanvas(key, terrainTexture(this.map, x, y,
          Math.min(terrainChunkTiles, this.map.width - x), Math.min(terrainChunkTiles, this.map.height - y)))
        this.terrainChunks.set(key, this.add.image(x * TILE, y * TILE, key).setOrigin(0).setDepth(-5))
      }
    }
    for (const [key, image] of this.terrainChunks) {
      if (visible.has(key)) continue
      image.destroy()
      this.textures.remove(key)
      this.terrainChunks.delete(key)
    }
  }

  update(time: number, delta: number) {
    if (!this.initialized) return
    const horizontal = Number(this.keys?.RIGHT.isDown ?? false) - Number(this.keys?.LEFT.isDown ?? false)
    const vertical = Number(this.keys?.DOWN.isDown ?? false) - Number(this.keys?.UP.isDown ?? false)
    if (horizontal || vertical) this.pan(-horizontal * delta * 0.37, -vertical * delta * 0.37)
    this.water.clear()
    const riverColumn = this.map.width / 2 - 1
    for (let i = 0; i < 48; i++) {
      const y = (i * 53 + Math.floor(time * 0.024)) % this.mapHeight
      if (this.map.tiles[Math.floor(y / TILE) * this.map.width + riverColumn] !== 'water') continue
      const x = riverColumn * TILE + 5 + (i * 13) % 45
      const glint = 0.16 + 0.26 * ((Math.sin(time * 0.003 + i) + 1) / 2)
      this.water.fillStyle(0xa4e0d8, glint).fillRect(x, y, 5 + i % 8, 2)
      this.water.fillStyle(0x72cbd1, glint).fillRect(x + 4, y + 2, 8 + i % 5, 1)
    }
    this.graphics.clear()
    const blend = Math.min(1, delta / 70)
    const camera = this.cameras.main
    const center = this.cameraCenter()
    const halfWidth = camera.width / camera.zoom / 2 + 96
    const halfHeight = camera.height / camera.zoom / 2 + 96
    this.updateTerrain(center, halfWidth, halfHeight)
    const walkFrame = Math.floor(time / 125) % 2
    for (const visual of this.visuals.values()) {
      const { entity, sprite, lastHp } = visual
      const visible = Math.abs(entity.x - center.x) < halfWidth && Math.abs(entity.y - center.y) < halfHeight
      if (sprite.visible !== visible) sprite.setVisible(visible)
      if (!visible) {
        if (sprite.x !== entity.x || sprite.y !== entity.y) sprite.setPosition(entity.x, entity.y)
        this.releaseRing(visual)
        continue
      }
      const building = !isUnitKind(entity.kind)
      sprite.x += (entity.x + visual.offsetX - sprite.x) * blend
      sprite.y += (entity.y + visual.offsetY - sprite.y) * blend
      const depth = Math.round(sprite.y)
      if (sprite.depth !== depth) sprite.setDepth(depth)
      if (!building) {
        const texture = entity.faction + entity.kind + (entity.moving ? walkFrame : 0)
        if (sprite.texture.key !== texture) sprite.setTexture(texture)
        if (sprite.flipX !== (entity.facing < 0)) sprite.setFlipX(entity.facing < 0)
      }
      const alpha = entity.construction === undefined ? 1 :
        entity.constructionStatus === 'queued' ? 0.25 : 0.4 + entity.construction * 0.55
      if (sprite.alpha !== alpha) sprite.setAlpha(alpha)
      const radius = unitStats[entity.faction][entity.kind].radius
      if (entity.construction !== undefined && (!entity.constructionStatus || entity.constructionStatus === 'building')) {
        this.graphics.fillStyle(0x3d332d, 0.8).fillRect(sprite.x - radius, sprite.y + 1, radius * 2, 4)
        for (const side of [-1, 1]) {
          this.graphics.fillStyle(0xe4b675, 0.95).fillRect(sprite.x + side * (radius - 3) - 1, sprite.y - 12, 3, 15)
        }
        this.graphics.lineStyle(2, 0xd19a5e, 0.9).lineBetween(sprite.x - radius + 3, sprite.y - 12, sprite.x + radius - 3, sprite.y + 1)
      }
      if (entity.carrying) {
        const cargoColor = { gold: 0xf6cd61, wood: 0xc48d56, stone: 0xc4ccd3 }
        this.graphics.fillStyle(0x493920, 1).fillRect(sprite.x - 11, sprite.y - 13, 9, 8)
        this.graphics.fillStyle(cargoColor[entity.carrying], 1).fillRect(sprite.x - 9, sprite.y - 12, 5, 5)
      }
      const selected = this.selected.has(entity.id)
      const color = factionColor[entity.faction]
      if (selected) {
        if (!visual.ring) {
          const texture = 'selection-' + (building ? entity.kind : 'unit')
          visual.ring = this.ringPool.pop()?.setTexture(texture).setVisible(true) ??
            this.add.image(sprite.x, sprite.y, texture).setDepth(this.mapHeight + 1)
        }
        visual.ring.setPosition(sprite.x, sprite.y + 2)
      } else this.releaseRing(visual)
      if (selected || entity.hp < entity.maxHp || entity.kind === 'headquarters' || entity.construction !== undefined) {
        const w = building ? radius * 1.8 : 22
        const x = sprite.x - w / 2
        const y = sprite.y - (entity.kind === 'headquarters' ? 85 : entity.kind === 'tower' ? 65 : entity.kind === 'wall' ? 31 : building ? 46 : 37)
        this.graphics.fillStyle(0x1a252c, 0.95).fillRect(x - 2, y - 2, w + 4, 7)
        this.graphics.fillStyle(0x3f3e43, 1).fillRect(x, y, w, 3)
        const hp = w * entity.hp / entity.maxHp
        this.graphics.fillStyle(color, 1).fillRect(x, y, hp, 3)
        this.graphics.fillStyle(0xfff5df, 0.38).fillRect(x, y, hp, 1)
        if (entity.construction !== undefined) this.graphics.fillStyle(0xf8c972, 1).fillRect(x, y + 6, w * entity.construction, 2)
      }
      if (entity.experience !== undefined) {
        const level = heroLevel(entity.experience)
        const y = sprite.y - 54
        this.graphics.fillStyle(0x382611, 1).fillRect(sprite.x - 8, y, 16, 5)
        this.graphics.fillStyle(0xffd575, 1).fillRect(sprite.x - 7, y + 1, level * 2.8, 3)
      }
      if (building && entity.construction === undefined && entity.hp < entity.maxHp * 0.5) this.paintFire(sprite.x + 19, sprite.y - 18, time)
      if (entity.hp < lastHp) this.graphics.fillStyle(0xffdc99, 0.85).fillRect(sprite.x - 1, sprite.y - 19, 3, 3)
    }
    this.paintEffects(time, center, halfWidth, halfHeight)
    this.ui.clear()
    this.markers = this.markers.filter(mark => {
      const t = (time - mark.born) / 410
      if (t > 1) return false
      const { x, y } = mark.point
      const size = 8 + t * 13
      this.ui.lineStyle(3, 0x182822, (1 - t) * 0.8).strokeEllipse(x, y, size * 2, size)
      this.ui.lineStyle(1.5, mark.color, 1 - t).strokeEllipse(x, y, size * 2, size)
      this.ui.fillStyle(mark.color, 1 - t).fillRect(x - 1, y - 2, 3, 3)
      return true
    })
    const drag = this.controls?.selection
    if (this.placing && this.pointer) {
      const radius = unitStats[this.faction][this.placing].radius
      const points = drag && this.placing === 'wall'
        ? wallLine(this.map, this.world(drag.from), this.world(drag.to))
        : [snapToCell(this.world(this.pointer))]
      let valid = 0
      for (const at of points) {
        const ok = this.sightAt(at) === 2 && validPlacement(this.map, this.placing, at, this.entities())
        if (ok) valid++
        const color = ok ? 0x9fdf8d : 0xf27b65
        this.ui.fillStyle(color, 0.27).fillRect(at.x - radius, at.y - radius, radius * 2, radius * 2)
        this.ui.lineStyle(1, color, 0.9).strokeRect(at.x - radius, at.y - radius, radius * 2, radius * 2)
      }
      if (drag && this.placing === 'wall') this.actions.placement('wall', false, valid)
    }
    if (drag && !this.placing) {
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

  private paintEffects(time: number, center: Point, halfWidth: number, halfHeight: number) {
    this.effects = this.effects.filter(({ effect, born, sprite }) => {
      const age = time - born
      const { x, y } = effect.at
      const to = effect.to ?? effect.at
      const inView = Math.max(x, to.x) >= center.x - halfWidth && Math.min(x, to.x) <= center.x + halfWidth &&
        Math.max(y, to.y) >= center.y - halfHeight && Math.min(y, to.y) <= center.y + halfHeight
      if (effect.kind === 'shot' && effect.to) {
        const duration = Math.max(100, Math.ceil(distance(effect.at, effect.to) / 24) * 50)
        const t = age / duration
        if (t > 1) return false
        if (!inView) return true
        const dx = effect.to.x - x
        const dy = effect.to.y - y
        const start = Math.max(0, t - 0.09)
        const arc = Math.sin(t * Math.PI) * 17
        const tipX = x + dx * t
        const tipY = y + dy * t - 15 - arc
        const tailX = x + dx * start
        const tailY = y + dy * start - 15 - Math.sin(start * Math.PI) * 17
        this.graphics.lineStyle(3, 0x322d34, 0.78).lineBetween(tailX, tailY, tipX, tipY)
        this.graphics.lineStyle(1.5, 0xfce0a2, 0.95).lineBetween(tailX, tailY, tipX, tipY)
        this.graphics.fillStyle(0xfff4d5, 1).fillRect(tipX - 1, tipY - 1, 3, 3)
      } else if (effect.kind === 'hit') {
        if (age > 230) return false
        if (!inView) return true
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
        if (sprite && sprite.visible !== inView) sprite.setVisible(inView)
        if (!inView) return true
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
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(this.fogTexture.canvas, 0, 0, w, h)
    for (const { entity } of this.visuals.values()) {
      ctx.fillStyle = entity.faction === 'human' ? '#a3d6ff' : '#ff9575'
      const r = entity.kind === 'headquarters' ? 3 : isUnitKind(entity.kind) ? 1.3 : 1.8
      ctx.fillRect(entity.x / this.mapWidth * w - r, entity.y / this.mapHeight * h - r, r * 2, r * 2)
    }
    const camera = this.cameras.main
    const start = this.world({ x: 0, y: 0 })
    ctx.strokeStyle = '#ffdf98'
    ctx.strokeRect(start.x / this.mapWidth * w, start.y / this.mapHeight * h,
      camera.width / camera.zoom / this.mapWidth * w, camera.height / camera.zoom / this.mapHeight * h)
  }
}
