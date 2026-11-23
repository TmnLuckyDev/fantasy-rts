import { formationSlots } from '../server/formations.ts'
import Phaser from 'phaser'
import { TILE, cellCenter, distance, isWalkable, resourceAt, snapToCell, tileAt, wallLine } from '../shared/map.ts'
import type { BattleMap } from '../shared/map.ts'
import { raceOf, MAX_SELECTION, entityKinds, inTroopGroup, isArmyOrder, isHeroKind, isShipKind, isUnitKind } from '../shared/protocol.ts'
import { decodeFog } from '../shared/fog.ts'
import { attackRange, placementError, buildingFootprint, selectedAttackRange } from '../shared/economy.ts'
import type { ArmyOrder, Formation, TroopGroup, BuildingKind, Effect, Entity, Faction, PlayerRaces, Order, Point, ResourceKind, Snapshot } from '../shared/protocol.ts'
import { CONTROL_RADIUS } from '../shared/match-settings.ts'
import { heroLevel } from '../shared/heroes.ts'
import { unitStats } from '../shared/units.ts'
import { factionColor, propTexture, randomAt, terrainColor, terrainTexture } from './art.ts'
import { entityTexture } from './sprites.ts'
import { canvas } from './voxel.ts'
import { BattlefieldInput } from './input.ts'
import { indexArmy } from './troop-groups.ts'
import type { ArmyIndex } from './troop-groups.ts'
import type { SelectionRect } from './input.ts'

const terrainChunkTiles = 24
const largeBattleCount = 220
const effectBudget: Record<Effect['kind'], number> = { shot: 16, hit: 8, fallen: 6 }
type Visual = { entity: Entity, sprite: Phaser.GameObjects.Image, lastHp: number, offsetX: number, offsetY: number, ring?: Phaser.GameObjects.Image }
type AnimatedEffect = { effect: Effect, born: number, sprite?: Phaser.GameObjects.Image }
type BattleActions = {
  dismissBuildMenu: () => boolean
  groupOrder: (group: TroopGroup, order: ArmyOrder) => void
  groups: (army: ArmyIndex, selected: TroopGroup | null) => void
  order: (ids: number[], order: Order) => void
  selection: (entities: Entity[], interactive: boolean) => void
  placement: (kind: BuildingKind | null, error?: string | null, segmentCount?: number) => void
  buildRequirement: (kind: BuildingKind) => string | null
  effect: (kind: Effect['kind']) => void
  resource: (kind: ResourceKind, remaining: number | null) => void
}

export class BattleScene extends Phaser.Scene {
  private visuals = new Map<number, Visual>()
  private ringPool: Phaser.GameObjects.Image[] = []
  private selected = new Set<number>()
  private selectedGroup: TroopGroup | null = null
  private selectedTemplate: number | null = null

  get activeTemplate() { return this.selectedTemplate }
  private army: ArmyIndex = new Map()
  private lastIdleWorker = 0
  private lastBuildHint: string | null | undefined
  private lastTap?: { id: number, at: Point, time: number }
  selectionFilter: 'all' | 'military' | 'workers' = 'all'
  quality: 'low' | 'medium' | 'high' | 'auto' = 'high'
  singleFingerPan = false
  private frameTime = 16.7
  private previousCamera?: { center: Point, zoom: number }
  private formationPreview?: { slots: Point[], point: Point, heading: Point, born: number }
  private effects: AnimatedEffect[] = []
  private newest: Snapshot | null = null
  private selectedResource: number | null = null
  private graphics!: Phaser.GameObjects.Graphics
  private water!: Phaser.GameObjects.Graphics
  private waterTiles: number[] = []
  private ui!: Phaser.GameObjects.Graphics
  private controls!: BattlefieldInput

  resetInput() { this.controls?.resetInput() }
  private miniTerrain!: HTMLCanvasElement
  private fogTexture!: Phaser.Textures.CanvasTexture
  private fogPixels!: ImageData
  private fogMask = ''
  private fog: Uint8Array
  private terrainChunks = new Map<string, Phaser.GameObjects.Image>()
  private terrainWindow = ''
  private readonly terrainProps = new Map<number, Phaser.GameObjects.Image>()
  private readonly resourceProps = new Map<number, Phaser.GameObjects.Image>()
  private readonly depleted = new Set<number>()
  private lastDepletion?: number[]

  private get mapWidth() { return this.map.width * TILE }
  private get mapHeight() { return this.map.height * TILE }
  private markers: Array<{ point: Point, color: number, born: number }> = []
  private keys!: Record<string, Phaser.Input.Keyboard.Key>
  private minimapDirty = true
  private initialized = false
  private hasSnapshot = false
  private lastMiniDraw = 0
  advanceMode = false
  formation: Formation = 'line'
  private unloadTargets: number[] = []
  private transferTargets: number[] = []
  private groupRallyTarget: number | null = null
  private rallyTarget: number | null = null
  private placing: BuildingKind | null = null
  private pointer: Point | null = null
  private practiceMine?: Point

  constructor(
    readonly faction: Faction,
    private readonly races: PlayerRaces,
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
    this.map.tiles.forEach((tile, index) => { if (tile === 'water') this.waterTiles.push(index) })
    for (const tile of ['forest', 'rock', 'mine', 'quarry'] as const) {
      for (let v = 0; v < (tile === 'forest' || tile === 'rock' ? 3 : 1); v++) this.textures.addCanvas(tile + v, propTexture(tile, v))
    }
    for (const faction of ['human', 'orc'] as const) {
      for (const kind of entityKinds) {
        this.textures.addCanvas(faction + kind + '0', entityTexture(this.races[faction], kind))
        if (isUnitKind(kind)) this.textures.addCanvas(faction + kind + '1', entityTexture(this.races[faction], kind, 1))
        if (kind === 'worker' && this.races[faction] === 'human') {
          for (const frame of [0, 1]) this.textures.addCanvas(faction + kind + 'dark' + frame, entityTexture('human', kind, frame, 1))
        }
      }
    }
    this.map.tiles.forEach((tile, i) => {
      if (tile !== 'forest' && tile !== 'rock' && tile !== 'mine' && tile !== 'quarry') return
      const point = cellCenter(i % this.map.width, Math.floor(i / this.map.width))
      const rand = randomAt(Math.imul(i + 1, 0x9e3779b9))
      const variant = tile === 'forest' || tile === 'rock' ? Math.floor(rand() * 3) : 0
      const sprite = this.add.image(point.x + (rand() - 0.5) * 8, point.y + (rand() - 0.5) * 4, tile + variant)
      this.terrainProps.set(i, sprite)
      if (tile !== 'rock') this.resourceProps.set(i, sprite)
      sprite.setScale(tile === 'forest' ? 1.06 : 0.96).setOrigin(0.5, 40 / 48).setDepth(point.y - 1)
    })
    this.textures.addCanvas('selection-unit', this.ringTexture(27, 12))
    for (const kind of entityKinds) {
      if (!isUnitKind(kind)) {
        this.textures.addCanvas('selection-' + kind, this.ringTexture(unitStats[this.races[this.faction]][kind].radius * 2.1, 22))
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
      select: (point, append, touch) => {
        if (!this.actions.dismissBuildMenu()) this.click(point, append, touch)
      },
      selectBox: (rect, append) => { if (!this.actions.dismissBuildMenu()) this.selectBox(rect, append) },
      order: point => {
        if (!this.actions.dismissBuildMenu()) this.orderAt(point)
      },
      singleFingerPan: () => this.singleFingerPan && !this.placing && !this.advanceMode && !this.targetingRally && !this.targetingUnload && !this.targetingTransfer,
      touchDragThreshold: () => this.placing && this.placing !== 'wall' ? 24 : 8,
      camera: (from, to, ratio) => this.transformCamera(from, to, ratio)
    })
    const track = (event: PointerEvent) => {
      const rect = this.host.getBoundingClientRect()
      this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    this.host.addEventListener('pointermove', track)
    this.host.addEventListener('pointerdown', track)
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
      this.host.removeEventListener('pointerdown', track)
      this.scale.off(Phaser.Scale.Events.RESIZE, onResize)
      resize.disconnect()
    })
    this.keys = this.input.keyboard?.addKeys('UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>
    if (this.newest) this.snapshot(this.newest)
  }

  snapshot(snapshot: Snapshot) {
    this.newest = snapshot
    if (!this.initialized) return
    if (this.selectedResource !== null) {
      const index = this.selectedResource
      const info = snapshot.deposits?.find(deposit => deposit.index === index)
      const at = cellCenter(index % this.map.width, Math.floor(index / this.map.width))
      const kind = resourceAt(this.map, at)
      if (!info || !kind) {
        this.selectedResource = null
        this.selectionChanged()
      }
    }
    if (snapshot.fog !== this.fogMask) {
      this.fogMask = snapshot.fog
      this.fog = decodeFog(snapshot.fog, this.map.tiles.length)
      this.paintFog()
    }
    if (snapshot.depleted !== this.lastDepletion) {
      this.lastDepletion = snapshot.depleted
      for (const index of snapshot.depleted ?? []) {
        if (this.depleted.has(index)) continue
        this.depleted.add(index)
        const prop = this.resourceProps.get(index)
        if (this.map.tiles[index] === 'forest') {
          // Finite timber is actually felled. Remove the tree rather than tinting it.
          prop?.destroy()
          this.resourceProps.delete(index)
          this.terrainProps.delete(index)
          const x = index % this.map.width, y = Math.floor(index / this.map.width)
          const tw = this.miniTerrain.width / this.map.width
          const th = this.miniTerrain.height / this.map.height
          const mini = this.miniTerrain.getContext('2d')!
          mini.fillStyle = terrainColor.grass
          mini.fillRect(x * tw, y * th, Math.ceil(tw), Math.ceil(th))
        } else {
          prop?.setTint(0x777777).setAlpha(0.72)
        }
      }
    }
    this.army = indexArmy(snapshot.entities, this.faction)
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
          .setScale(isHeroKind(entity.kind) ? 2.35 : isUnitKind(entity.kind) ? 1.21 : entity.kind === 'headquarters' ? 1.55 : 1.4)
        this.visuals.set(entity.id, { entity, sprite, lastHp: entity.hp, offsetX: 0, offsetY: 0 })
      }
    }
    this.spreadCrowds()
    const crowded = this.visuals.size >= largeBattleCount
    const counts = { shot: 0, hit: 0, fallen: 0 }
    if (crowded) for (const item of this.effects) counts[item.effect.kind]++
    const center = this.cameraCenter()
    const camera = this.cameras.main
    const effectRadius = Math.hypot(camera.width, camera.height) / camera.zoom / 2 + 160
    for (const effect of snapshot.effects) {
      const nearby = distance(effect.at, center) < effectRadius
      if (crowded && (!nearby || counts[effect.kind] >= effectBudget[effect.kind])) continue
      counts[effect.kind]++
      let sprite: Phaser.GameObjects.Image | undefined
      if (!crowded && this.quality === 'high' && effect.kind === 'fallen' && isUnitKind(effect.entityKind)) {
        sprite = this.add.image(effect.at.x, effect.at.y, effect.faction + effect.entityKind + '0')
          .setOrigin(0.5, 0.83).setScale(1.21).setDepth(effect.at.y - 1)
      }
      this.effects.push({ effect, born: this.time.now, sprite })
      if (nearby) this.actions.effect(effect.kind)
    }
    this.hasSnapshot = true
    this.minimapDirty = true
    if (this.selectedGroup) {
      this.selected = new Set(this.army.get(this.selectedGroup)?.map(entity => entity.id))
      if (!this.selected.size) this.selectedGroup = null
    }
    if (this.selectedTemplate !== null) {
      const group = snapshot.templates?.find(group => group.id === this.selectedTemplate)
      if (group) this.selectTemplateMembers(group.members)
      else {
        this.selectedTemplate = null
        this.selected.clear()
      }
    }
    this.selectionChanged()
    if (this.selectedResource !== null) {
      const site = snapshot.deposits?.find(item => item.index === this.selectedResource)
      const kind = resourceAt(this.map, cellCenter(this.selectedResource % this.map.width, Math.floor(this.selectedResource / this.map.width)))
      if (site && kind) this.actions.resource(kind, site.remaining)
    }
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

  castHeroAbility() {
    const heroes = [...this.selected].filter(id => isHeroKind(this.visuals.get(id)?.entity.kind))
    if (heroes.length) this.actions.order(heroes, { kind: 'hero-ability' })
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

  deselect() {
    this.cancelTargeting()
    this.selectedGroup = null
    this.selectedTemplate = null
    this.selectedResource = null
    this.selected.clear()
    this.selectionChanged(true)
  }

  selectAll() { this.selectGroup('all') }

  selectGroup(group: TroopGroup, center = this.selectedGroup === group) {
    const members = this.army.get(group)
    if (!members?.length) return
    const heroAlreadySelected = this.selected.size === 1 && this.selected.has(members[0].id)
    this.place(null)
    this.selectedGroup = group
    this.selectedTemplate = null
    this.selected = new Set(members.map(entity => entity.id))
    if (center || (group === 'heroes' && heroAlreadySelected)) this.frame(members)
    this.selectionChanged(true)
  }

  selectTemplate(id: number, center = this.selectedTemplate === id) {
    const group = this.newest?.templates?.find(group => group.id === id)
    if (!group) return
    this.cancelTargeting()
    this.selectedGroup = null
    this.selectedTemplate = id
    this.selectedResource = null
    this.selectTemplateMembers(group.members)
    if (center) this.frame([...this.selected].map(id => this.visuals.get(id)!.entity))
    this.selectionChanged(true)
  }

  private selectTemplateMembers(members: readonly { id: number }[]) {
    this.selected = new Set(members.flatMap(({ id }) => this.visuals.get(id)?.entity.faction === this.faction ? [id] : []))
  }

  selectWorkers() {
    this.selectedGroup = null
    this.selectedTemplate = null
    this.place(null)
    this.selected = new Set([...this.visuals.values()].filter(({ entity }) =>
      this.ownUnit(entity) && entity.kind === 'worker').slice(0, MAX_SELECTION).map(({ entity }) => entity.id))
    this.selectionChanged(true)
  }

  selectIdleWorker() {
    const idle = [...this.visuals.values()].map(({ entity }) => entity)
      .filter(entity => entity.faction === this.faction && entity.kind === 'worker' && entity.idle)
      .sort((a, b) => a.id - b.id)
    const next = idle.find(entity => entity.id > this.lastIdleWorker) ?? idle[0]
    if (!next) return
    this.lastIdleWorker = next.id
    this.place(null)
    this.selectedGroup = null
    this.selectedTemplate = null
    this.selected = new Set([next.id])
    this.focus(next)
    this.selectionChanged(true)
  }

  buildQueue() {
    const ids = this.workerIds()
    if (ids.length) this.actions.order(ids, { kind: 'build-queue' })
  }

  gatherNearest(resource: ResourceKind) {
    const ids = this.workerIds()
    const worker = this.visuals.get(ids[0])?.entity
    if (!worker) return false
    let nearest: Point | undefined
    let range = Infinity
    for (let index = 0; index < this.map.tiles.length; index++) {
      if (!this.fog[index] || this.depleted.has(index)) continue
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
    this.mark(nearest, 'gather')
    return true
  }

  place(kind: BuildingKind | null) {
    if (kind) {
      this.advanceMode = false
      this.unloadTargets = []
      this.rallyTarget = null
      this.selectedResource = null
    }
    this.placing = kind
    this.lastBuildHint = undefined
    this.actions.placement(kind)
  }

  private workerIds() { return this.selectedGroup ? [] : [...this.selected].filter(id => this.visuals.get(id)?.entity.kind === 'worker') }

  halt() {
    this.cancelTargeting()
    this.issue({ kind: 'halt' })
    this.selectionChanged(true)
  }
  board(transport?: number) {
    const units = this.mobileUnits().filter(id => !isShipKind(this.visuals.get(id)?.entity.kind))
    if (units.length) this.actions.order(units, { kind: 'board', transport })
  }
  get targetingTransfer() { return this.transferTargets.length > 0 }
  transfer() {
    this.cancelTargeting()
    this.transferTargets = this.mobileUnits().filter(id => !isShipKind(this.visuals.get(id)?.entity.kind))
    this.selectionChanged(true)
  }
  get targetingUnload() { return this.unloadTargets.length > 0 }

  cancelTargeting() {
    this.advanceMode = false
    this.transferTargets = []
    this.unloadTargets = []
    this.rallyTarget = null
    this.groupRallyTarget = null
    this.place(null)
    if (this.initialized) this.selectionChanged()
  }

  unload() {
    const wasTargeting = this.targetingUnload
    this.cancelTargeting()
    this.unloadTargets = wasTargeting ? [] : [...this.selected].filter(id => {
      const ship = this.visuals.get(id)?.entity
      return ship?.kind === 'transport' && ship.passengers?.length
    })
    this.selectionChanged(true)
  }

  private targetUnload(screen: Point) {
    if (this.targetingTransfer) {
      const at = this.world(screen)
      const ids = this.transferTargets
      this.transferTargets = []
      this.actions.order(ids, { kind: 'transfer', at })
      this.mark(at, 'move')
      this.selectionChanged(true)
      return true
    }
    if (!this.targetingUnload) return false
    const at = this.world(screen)
    const ships = this.unloadTargets.filter(id => this.visuals.get(id)?.entity.passengers?.length)
    this.unloadTargets = []
    for (let start = 0; start < ships.length; start += MAX_SELECTION) {
      this.actions.order(ships.slice(start, start + MAX_SELECTION), { kind: 'unload', at })
    }
    this.markers.push({ point: at, color: 0xffdc82, born: this.time.now })
    this.selectionChanged(true)
    return true
  }
  explore() {
    const ids = [...this.selected].filter(id => this.visuals.get(id)?.entity.kind === 'scout')
    if (ids.length) this.actions.order(ids, { kind: 'explore' })
  }
  retreat() {
    const ids = this.mobileUnits()
    const to = this.newest?.templates?.find(group => group.id === this.selectedTemplate)?.rally ?? this.map.bases[this.faction]
    if (ids.length) {
      this.actions.order(ids, { kind: 'move', to, formation: this.formation })
      this.mark(to, 'move')
    }
  }
  home() { if (this.initialized) this.focus(this.map.bases[this.faction]) }
  focusAlert(point: Point) {
    if (!this.initialized) return
    this.previousCamera ??= { center: this.cameraCenter(), zoom: this.cameras.main.zoom }
    this.focus(point)
  }

  restoreCamera() {
    if (!this.previousCamera) return
    this.cameras.main.setZoom(this.previousCamera.zoom)
    this.focus(this.previousCamera.center)
    this.previousCamera = undefined
  }

  private frame(members: readonly Point[]) {
    if (!members.length) return
    if (members.length === 1) { this.focus(members[0]); return }
    const bounds = (axis: 'x' | 'y') => {
      const values = members.map(member => member[axis]).sort((a, b) => a - b)
      const trim = members.length >= 5 ? Math.max(1, Math.floor(members.length * .08)) : 0
      return [values[trim], values[values.length - 1 - trim]]
    }
    const [left, right] = bounds('x')
    const [top, bottom] = bounds('y')
    const camera = this.cameras.main
    camera.setZoom(Math.max(.38, Math.min(1.25, camera.width / (right - left + 112), camera.height / (bottom - top + 112))))
    this.focus({ x: (left + right) / 2, y: (top + bottom) / 2 })
  }

  focusPracticeMine() {
    const home = this.map.bases[this.faction]
    let nearest: Point | undefined
    for (const { index } of this.newest?.deposits ?? []) {
      if (this.map.tiles[index] !== 'mine') continue
      const point = cellCenter(index % this.map.width, Math.floor(index / this.map.width))
      if (!nearest || distance(home, point) < distance(home, nearest)) nearest = point
    }
    this.practiceMine = nearest
    if (nearest) this.focus(nearest)
  }


  clearPracticeMine() { this.practiceMine = undefined }

  minimapPosition(point: Point) { return { x: point.x / this.mapWidth, y: point.y / this.mapHeight } }
  minimapFocus(x: number, y: number) { if (this.initialized) this.focus({ x: x * this.mapWidth, y: y * this.mapHeight }) }

  private ownUnit(entity: Entity) { return entity.faction === this.faction && isUnitKind(entity.kind) }

  get targetingRally() { return this.rallyTarget !== null || this.groupRallyTarget !== null }

  setGroupRallyTarget(id: number) {
    this.cancelTargeting()
    this.groupRallyTarget = id
  }

  setRallyTarget(id: number) {
    this.cancelTargeting()
    this.rallyTarget = id
  }

  private placeRally(screen: Point) {
    if (this.groupRallyTarget !== null) {
      const group = this.groupRallyTarget
      this.groupRallyTarget = null
      const hall = this.newest?.entities.find(entity => entity.kind === 'headquarters' && entity.faction === this.faction)
      const at = this.world(screen)
      if (hall) this.actions.order([hall.id], { kind: 'template-rally', template: group, at })
      this.mark(at, 'rally')
      this.selectionChanged()
      return true
    }
    if (this.rallyTarget === null) return false
    const at = this.world(screen)
    this.actions.order([this.rallyTarget], { kind: 'rally', to: at })
    this.rallyTarget = null
    this.selectionChanged()
    this.mark(at, 'rally')
    return true
  }

  private click(screen: Point, append: boolean, touch: boolean) {
    if (this.targetUnload(screen) || this.placeRally(screen)) return
    const point = this.world(screen)
    if (this.placing) {
      const ids = this.workerIds()
      const at = snapToCell(point)
      const error = this.buildError(this.placing, at)
      if (!error) {
        this.actions.order(ids, { kind: 'build', building: this.placing, at })
      } else this.actions.placement(this.placing, error)
      return
    }
    const picked = this.pick(point, touch)
    if (!this.advanceMode && !append && this.selectSameKind(picked, screen)) return
    if (!this.advanceMode && this.inspectMine(point, touch)) return
    if (touch && this.workerIds().length && this.gatherPoint(point)) {
      this.orderAt(screen)
      return
    }
    if (this.advanceMode && (this.selectedGroup || this.mobileUnits().length)) {
      this.orderAt(screen)
      return
    }
    if (!picked && this.sightAt(point) === 2) {
      const index = Math.floor(point.y / TILE) * this.map.width + Math.floor(point.x / TILE)
      const kind = resourceAt(this.map, point)
      const deposit = this.newest?.deposits?.find(entry => entry.index === index)
      if (kind && deposit) {
        this.selectedGroup = null
        this.selectedTemplate = null
        this.selected.clear()
        this.selectionChanged(true)
        this.selectedResource = index
        this.actions.resource(kind, deposit.remaining)
        return
      }
    }
    this.selectedResource = null
    if (touch && this.workOnBuilding(this.workerIds(), picked)) return
    if (touch && picked?.kind === 'transport' && picked.faction === this.faction &&
        this.mobileUnits().some(id => !isShipKind(this.visuals.get(id)?.entity.kind))) {
      this.board(picked.id)
      return
    }
    if (picked?.faction === this.faction) {
      this.selectedGroup = null
      this.selectedTemplate = null
      if (!append) this.selected.clear()
      if (append && this.selected.has(picked.id)) this.selected.delete(picked.id)
      else if (this.selected.size < MAX_SELECTION) this.selected.add(picked.id)
      this.selectionChanged(true)
    } else if (touch && (this.selectedGroup || this.mobileUnits().length)) this.orderAt(screen)
    else if (!append) {
      this.selectedGroup = null
      this.selectedTemplate = null
      this.selected.clear()
      this.selectionChanged(true)
    }
  }

  private inspectMine(point: Point, touch: boolean) {
    const candidates = touch ? [point, { x: point.x, y: point.y + 12 }] : [point]
    for (const at of candidates) {
      const kind = resourceAt(this.map, at)
      if (kind !== 'gold' && kind !== 'stone') continue
      const index = Math.floor(at.y / TILE) * this.map.width + Math.floor(at.x / TILE)
      const deposit = this.newest?.deposits?.find(entry => entry.index === index)
      if (!deposit || this.sightAt(at) !== 2) continue
      const workers = this.workerIds()
      this.selectedGroup = null
      this.selectedTemplate = null
      this.selected = new Set(workers)
      this.selectedResource = index
      this.selectionChanged(true)
      this.actions.resource(kind, deposit.remaining)
      return true
    }
    return false
  }

  gatherInspectedDeposit() {
    const index = this.selectedResource
    const workers = this.workerIds()
    if (index === null || !workers.length || this.depleted.has(index)) return
    const at = cellCenter(index % this.map.width, Math.floor(index / this.map.width))
    this.actions.order(workers, { kind: 'gather', at })
    this.mark(at, 'gather')
  }

  private selectSameKind(picked: Entity | undefined, screen: Point) {
    const last = this.lastTap
    this.lastTap = picked && this.ownUnit(picked) ? { id: picked.id, at: screen, time: performance.now() } : undefined
    if (!picked || !last || last.id !== picked.id || !this.ownUnit(picked) ||
        performance.now() - last.time > 320 || distance(last.at, screen) > 24) return false
    this.lastTap = undefined
    const center = this.cameraCenter()
    const camera = this.cameras.main
    this.selectedGroup = null
    this.selectedTemplate = null
    this.selectedResource = null
    this.selected.clear()
    for (const { entity, sprite } of this.visuals.values()) {
      if (this.selected.size >= MAX_SELECTION) break
      if (entity.kind === picked.kind && this.ownUnit(entity) &&
          Math.abs(sprite.x - center.x) <= camera.width / camera.zoom / 2 &&
          Math.abs(sprite.y - center.y) <= camera.height / camera.zoom / 2) this.selected.add(entity.id)
    }
    this.selectionChanged(true)
    return true
  }

  private pick(point: Point, touch = false) {
    let best: Entity | undefined
    let bestScore = Infinity
    for (const { entity, sprite } of this.visuals.values()) {
      const dx = Math.abs(point.x - sprite.x)
      const dy = sprite.y - point.y
      const unit = isUnitKind(entity.kind)
      const hero = isHeroKind(entity.kind)
      const width = unit ? isShipKind(entity.kind) ? 30 : hero ? 26 : touch ? 24 : 14 :
        unitStats[raceOf(entity)][entity.kind].radius + (touch ? 15 : 10)
      const height = unit ? hero ? 64 : 35 : entity.kind === 'headquarters' ? 76 : entity.kind === 'tower' ? 61 : 35
      if (dx >= width || dy < -12 || dy >= height) continue
      const score = dx ** 2 + (dy - (hero ? 27 : 14)) ** 2 + (unit ? 0 : 10000)
      if (score > bestScore || (score === bestScore && best && entity.id > best.id)) continue
      best = entity
      bestScore = score
    }
    return best
  }

  private buildError(kind: BuildingKind, at: Point) {
    return this.actions.buildRequirement(kind) ?? (this.sightAt(at) ? placementError(this.map, kind, at, this.entities()) : 'Unexplored territory.')
  }

  private selectBox(rect: SelectionRect, append: boolean) {
    if (this.targetingUnload || this.targetingTransfer || this.advanceMode) return
    this.lastTap = undefined
    this.selectedResource = null
    const a = this.world(rect.from)
    const b = this.world(rect.to)
    if (this.placing) {
      if (this.placing === 'wall' && wallLine(this.map, a, b).length) {
        this.actions.order(this.workerIds(), { kind: 'wall-line', from: a, to: b })
      } else if (this.placing !== 'wall') this.deselect()
      return
    }
    this.selectedGroup = null
    this.selectedTemplate = null
    if (!append) this.selected.clear()
    for (const { entity, sprite } of this.visuals.values()) {
      if (this.selected.size < MAX_SELECTION && this.ownUnit(entity) &&
          (this.selectionFilter === 'all' || (this.selectionFilter === 'workers' ? entity.kind === 'worker' : inTroopGroup(entity.kind, 'all'))) && sprite.x >= Math.min(a.x, b.x) && sprite.x <= Math.max(a.x, b.x) &&
          sprite.y >= Math.min(a.y, b.y) && sprite.y - 15 <= Math.max(a.y, b.y)) this.selected.add(entity.id)
    }
    this.selectionChanged(true)
  }

  private selectionChanged(interactive = false) {
    const entities = [...this.selected].flatMap(id => {
      const entry = this.visuals.get(id)
      return entry ? [entry.entity] : []
    })
    this.actions.selection(entities, interactive)
    this.actions.groups(this.army, this.selectedGroup)
  }

  private mobileUnits() {
    return [...this.selected].filter(id => isUnitKind(this.visuals.get(id)?.entity.kind))
  }

  private *entities() {
    for (const current of this.visuals.values()) yield current.entity
  }

  private gatherPoint(point: Point) {
    for (const at of [point, { x: point.x, y: point.y + 12 }]) {
      if (!this.sightAt(at) || !resourceAt(this.map, at)) continue
      const index = Math.floor(at.y / TILE) * this.map.width + Math.floor(at.x / TILE)
      if (!this.depleted.has(index)) return snapToCell(at)
    }
    return null
  }

  private orderAt(screen: Point) {
    if (this.targetUnload(screen) || this.placeRally(screen)) return
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
      this.mark(resource, 'gather')
      return
    }
    if (this.workOnBuilding(workers, picked)) return
    if (picked?.kind === 'transport' && picked.faction === this.faction && this.mobileUnits().some(id => !isShipKind(this.visuals.get(id)?.entity.kind))) {
      this.board(picked.id)
    } else if (picked && picked.faction !== this.faction) this.issue({ kind: 'attack', target: picked.id }, { x: picked.x, y: picked.y })
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
    if (!this.selected.size) return
    if (point) this.mark(point, order.kind)
    const military = this.selectedGroup || [...this.selected].some(id => {
      const kind = this.visuals.get(id)?.entity.kind
      return isUnitKind(kind) && kind !== 'worker'
    })
    if (military && (order.kind === 'move' || order.kind === 'advance' || order.kind === 'attack')) {
      order = { ...order, formation: this.formation }
      if (order.kind === 'move' || order.kind === 'advance') {
        const troops = [...this.selected].flatMap(id => {
          const entity = this.visuals.get(id)?.entity
          return entity && isUnitKind(entity.kind) ? [entity] : []
        })
        if (troops.length > 1) {
          const { to } = order
          const slots = [troops.filter(unit => !isShipKind(unit.kind)), troops.filter(unit => isShipKind(unit.kind))]
            .flatMap(group => formationSlots(group, to, this.formation).map(slot => slot.at))
          const center = troops.reduce((sum, troop) => ({ x: sum.x + troop.x / troops.length, y: sum.y + troop.y / troops.length }), { x: 0, y: 0 })
          const length = Math.max(1, distance(center, order.to))
          this.formationPreview = { slots, point: order.to, heading: { x: (order.to.x - center.x) / length, y: (order.to.y - center.y) / length }, born: this.time.now }
        }
      }
    }
    if (this.advanceMode && (order.kind === 'advance' || order.kind === 'attack')) {
      this.advanceMode = false
      this.selectionChanged()
    }
    if (this.selectedGroup && isArmyOrder(order)) this.actions.groupOrder(this.selectedGroup, order)
    else {
      const ids = this.mobileUnits()
      if (ids.length) this.actions.order(ids, order)
    }
  }

  private mark(point: Point, kind: Order['kind']) {
    const colors = { move: 0xadd995, attack: 0xff846f, advance: 0xffc070, gather: 0x6cdac8, rally: 0xb0b1ff }
    const color = colors[kind as keyof typeof colors] ?? 0xffdc82
    this.markers.push({ point, color, born: this.time.now })
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
    for (const [index, prop] of this.terrainProps) {
      const col = Math.floor(index % this.map.width / terrainChunkTiles)
      const row = Math.floor(Math.floor(index / this.map.width) / terrainChunkTiles)
      prop.setVisible(col >= left && col <= right && row >= top && row <= bottom)
    }
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
    this.frameTime += (Math.min(delta, 80) - this.frameTime) * 0.035
    const quality = this.quality === 'auto' ? this.frameTime > 33 ? 'low' : this.frameTime > 22 ? 'medium' : 'high' : this.quality
    const crowded = this.visuals.size >= largeBattleCount
    this.water.clear()
    const glints = crowded || quality === 'low' ? 0 : Math.min(quality === 'medium' ? 18 : 48, this.waterTiles.length)
    for (let i = 0; i < glints; i++) {
      const tile = this.waterTiles[Math.floor(i * this.waterTiles.length / glints)]
      const x = tile % this.map.width * TILE + 3 + (i * 13) % 12
      const y = Math.floor(tile / this.map.width) * TILE + (i * 17 + Math.floor(time * 0.014)) % 27
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
    for (const corpse of this.newest?.corpses ?? []) {
      if (Math.abs(corpse.x - center.x) >= halfWidth || Math.abs(corpse.y - center.y) >= halfHeight) continue
      this.graphics.fillStyle(0xe9d7c0, 0.65).fillRect(corpse.x - 4, corpse.y - 2, 8, 3)
      if (!crowded) this.graphics.fillStyle(0xa087af, 0.5).fillEllipse(corpse.x, corpse.y + 2, 13, 4)
    }
    this.updateTerrain(center, halfWidth, halfHeight)
    const walkFrame = quality === 'low' ? 0 : Math.floor(time / (crowded || quality === 'medium' ? 200 : 125)) % 2
    let healthBars = 0
    const groupMarkers = new Set<number>()
    const rangeMarkers: Visual[] = []
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
      const depth = crowded && !building ? Math.round(sprite.y / 6) * 6 : Math.round(sprite.y)
      if (sprite.depth !== depth) sprite.setDepth(depth)
      if (!building) {
        const texture = entity.faction + entity.kind +
          (entity.kind === 'worker' && raceOf(entity) === 'human' && (Math.imul(entity.id, 0x9e3779b1) >>> 0) % 2 === 0 ? 'dark' : '') +
          (entity.moving ? walkFrame : 0)
        if (sprite.texture.key !== texture) sprite.setTexture(texture)
        if (sprite.flipX !== (entity.facing < 0)) sprite.setFlipX(entity.facing < 0)
      }
      const alpha = entity.construction === undefined ? 1 :
        entity.constructionStatus === 'queued' ? 0.25 : 0.4 + entity.construction * 0.55
      const visibilityAlpha = entity.concealed ? alpha * 0.62 : alpha
      if (sprite.alpha !== visibilityAlpha) sprite.setAlpha(visibilityAlpha)
      const radius = unitStats[raceOf(entity)][entity.kind].radius
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
      // One visible representative per type, capped at three for a full army.
      if (selected && rangeMarkers.length < 3 && !rangeMarkers.some(marker => marker.entity.kind === entity.kind) &&
          selectedAttackRange(entity, this.newest?.tick ?? 0)) rangeMarkers.push(visual)
      const color = factionColor[entity.faction]
      if (selected && (!crowded || building || this.selected.size < 30)) {
        if (!visual.ring) {
          const texture = 'selection-' + (building ? entity.kind : 'unit')
          visual.ring = this.ringPool.pop()?.setTexture(texture).setVisible(true) ??
            this.add.image(sprite.x, sprite.y, texture).setDepth(this.mapHeight + 1)
        }
        visual.ring.setPosition(sprite.x, sprite.y + 2)
      } else {
        this.releaseRing(visual)
        if (selected) {
          const cell = Math.floor(sprite.x / 14) + Math.floor(sprite.y / 14) * 65536
          if (!groupMarkers.has(cell)) {
            groupMarkers.add(cell)
            this.graphics.fillStyle(0xe9d996, 0.85).fillRect(sprite.x - 4, sprite.y + 3, 8, 2)
          }
        }
      }
      const fullDetail = building || isHeroKind(entity.kind) || selected && this.selected.size <= 12
      if (entity.hp > 0 && (fullDetail || selected && this.selected.size === 1 ||
          entity.hp < entity.maxHp && healthBars++ < (crowded ? 30 : 65))) {
        const w = building ? radius * 1.8 : 22
        const x = sprite.x - w / 2
        const y = sprite.y - (entity.kind === 'headquarters' ? 85 : entity.kind === 'tower' ? 65 : entity.kind === 'wall' ? 31 : building ? 46 : 37)
        const hp = w * entity.hp / entity.maxHp
        if (fullDetail) {
          this.graphics.fillStyle(0x1a252c, 0.95).fillRect(x - 2, y - 2, w + 4, 7)
          this.graphics.fillStyle(0x3f3e43, 1).fillRect(x, y, w, 3)
          this.graphics.fillStyle(0xfff5df, 0.38).fillRect(x, y - 1, hp, 1)
        }
        this.graphics.fillStyle(color, 1).fillRect(x, y, hp, fullDetail ? 3 : 2)
        if (entity.construction !== undefined) this.graphics.fillStyle(0xf8c972, 1).fillRect(x, y + 6, w * entity.construction, 2)
      }
      if (entity.kind === 'tower' || entity.kind === 'wall') {
        const level = entity.level ?? 1
        const y = sprite.y - (entity.kind === 'tower' ? 76 : 41)
        for (let i = 0; i < 5; i++) {
          this.graphics.fillStyle(i < level ? 0xffd575 : 0x3b4145, 0.95)
          this.graphics.fillRect(sprite.x - 13 + i * 6, y, 5, 4)
        }
        if (entity.upgradeProgress !== undefined) {
          this.graphics.fillStyle(0x262c31, 0.9).fillRect(sprite.x - 14, y - 6, 30, 3)
          this.graphics.fillStyle(0x74d9a1, 1).fillRect(sprite.x - 14, y - 6, 30 * entity.upgradeProgress, 3)
        }
      }
      if ((!crowded || (selected && this.selected.size === 1)) && !building && entity.kind !== 'worker' && entity.kind !== 'scout' && !isHeroKind(entity.kind)) {
        const weapons = entity.weaponLevel ?? 0
        const armor = entity.armorLevel ?? 0
        const precision = entity.precisionLevel ?? 0
        const vitality = entity.vitalityLevel ?? 0
        const y = sprite.y - 47
        if (weapons || armor || precision || vitality) {
          this.graphics.fillStyle(0x2c3035, 0.9).fillRect(sprite.x - 13, y, 26, 12)
          for (let i = 0; i < Math.min(5, weapons); i++) {
            this.graphics.fillStyle(0xe5a456, 1).fillRect(sprite.x - 12 + i * 3, y + 1, 2, 2)
          }
          for (let i = 0; i < Math.min(5, armor); i++) {
            this.graphics.fillStyle(0x86c7f0, 1).fillRect(sprite.x - 12 + i * 3, y + 4, 2, 2)
          }
          for (let i = 0; i < Math.min(5, precision); i++) {
            this.graphics.fillStyle(0xe6d477, 1).fillRect(sprite.x - 12 + i * 3, y + 7, 2, 2)
          }
          for (let i = 0; i < Math.min(5, vitality); i++) {
            this.graphics.fillStyle(0x86e6a3, 1).fillRect(sprite.x - 12 + i * 3, y + 10, 2, 2)
          }
        }
      }
      if (entity.experience !== undefined) {
        const level = heroLevel(entity.experience)
        const y = sprite.y - 54
        this.graphics.fillStyle(0x382611, 1).fillRect(sprite.x - 8, y, 16, 5)
        this.graphics.fillStyle(0xffd575, 1).fillRect(sprite.x - 7, y + 1, level * 2.8, 3)
      }
      if (quality !== 'low' && building && entity.construction === undefined && entity.hp < entity.maxHp * 0.5) this.paintFire(sprite.x + 19, sprite.y - 18, time)
      if (!crowded && entity.hp < lastHp) this.graphics.fillStyle(0xffdc99, 0.85).fillRect(sprite.x - 1, sprite.y - 19, 3, 3)
    }
    this.paintEffects(time, center, halfWidth, halfHeight, crowded || quality !== 'high')
    this.ui.clear()
    for (const { entity, sprite } of rangeMarkers) {
      const tick = this.newest?.tick ?? 0
      const range = selectedAttackRange(entity, tick)
      const structureRange = selectedAttackRange(entity, tick, true)
      this.ui.fillStyle(0xc7dc9e, .035).fillCircle(sprite.x, sprite.y, range)
      this.ui.lineStyle(1.5 / camera.zoom, 0xc7dc9e, .58).strokeCircle(sprite.x, sprite.y, range)
      if (structureRange > range) {
        this.ui.lineStyle(1.5 / camera.zoom, 0xe7b46b, .6).strokeCircle(sprite.x, sprite.y, structureRange)
      }
    }
    if (this.practiceMine) {
      const { x, y } = this.practiceMine
      this.ui.lineStyle(2, 0xffd575, 1).strokeRect(x - 16, y - 16, 32, 32)
    }
    for (const site of this.newest?.controlSites ?? []) {
      const color = site.owner ? factionColor[site.owner] : 0xffdf98
      this.ui.lineStyle(2, color, 0.55).strokeCircle(site.x, site.y, CONTROL_RADIUS)
      this.ui.fillStyle(color, 0.85).fillRect(site.x - 4, site.y - 4, 8, 8)
    }
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
    const preview = this.formationPreview
    if (preview && time - preview.born < 620) {
      this.ui.fillStyle(0xcde8b8, .34)
      for (const at of preview.slots) this.ui.fillCircle(at.x, at.y, 3)
      this.ui.lineStyle(2, 0xcde8b8, .65).lineBetween(preview.point.x, preview.point.y,
        preview.point.x + preview.heading.x * 24, preview.point.y + preview.heading.y * 24)
    } else this.formationPreview = undefined
    const drag = this.controls?.selection
    if (this.placing && this.pointer && (!drag || this.placing === 'wall')) {
      const radius = buildingFootprint(this.placing)
      const points = drag && this.placing === 'wall'
        ? wallLine(this.map, this.world(drag.from), this.world(drag.to))
        : [snapToCell(this.world(drag?.to ?? this.pointer))]
      let valid = 0
      for (const at of points) {
        const error = this.buildError(this.placing, at)
        const ok = !error
        if (!drag && error !== this.lastBuildHint) {
          this.lastBuildHint = error
          this.actions.placement(this.placing, error)
        }
        if (this.placing === 'tower') {
          const level = this.newest?.upgrades?.filter(kind => kind === 'range').length ?? 0
          const range = attackRange(this.races[this.faction], 'tower', level)
          this.ui.fillStyle(ok ? 0x9fdf8d : 0xf27b65, .10).fillCircle(at.x, at.y, range)
          this.ui.lineStyle(1.5, ok ? 0x9fdf8d : 0xf27b65, .65).strokeCircle(at.x, at.y, range)
        }
        if (ok) valid++
        const color = ok ? 0x9fdf8d : 0xf27b65
        this.ui.fillStyle(color, 0.27).fillRect(at.x - radius, at.y - radius, radius * 2, radius * 2)
        this.ui.lineStyle(1, color, 0.9).strokeRect(at.x - radius, at.y - radius, radius * 2, radius * 2)
      }
      if (drag && this.placing === 'wall') this.actions.placement('wall', null, valid)
    }
    if (drag && !this.placing) {
      const a = this.world(drag.from)
      const b = this.world(drag.to)
      const x = Math.min(a.x, b.x)
      const y = Math.min(a.y, b.y)
      this.ui.fillStyle(0xe2ce87, 0.15).fillRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y))
      this.ui.lineStyle(1, 0xe2ce87, 0.9).strokeRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    }
    if (this.hasSnapshot && this.minimapDirty && time - this.lastMiniDraw > (quality === 'low' ? 240 : crowded ? 170 : 60)) {
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

  private paintEffects(time: number, center: Point, halfWidth: number, halfHeight: number, crowded: boolean) {
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
        if (!crowded) this.graphics.lineStyle(3, 0x322d34, 0.78).lineBetween(tailX, tailY, tipX, tipY)
        this.graphics.lineStyle(1.5, 0xfce0a2, 0.95).lineBetween(tailX, tailY, tipX, tipY)
        if (!crowded) this.graphics.fillStyle(0xfff4d5, 1).fillRect(tipX - 1, tipY - 1, 3, 3)
      } else if (effect.kind === 'hit') {
        if (age > 230) return false
        if (!inView) return true
        const t = age / 230
        for (let i = 0; i < (crowded ? 1 : 5); i++) {
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
        else if (!crowded) {
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
    const clusters = new Map<string, { x: number, y: number, count: number, color: string }>()
    for (const { entity } of this.visuals.values()) {
      const x = entity.x / this.mapWidth * w
      const y = entity.y / this.mapHeight * h
      const color = entity.faction === 'human' ? '#a3d6ff' : '#ff9575'
      ctx.fillStyle = color
      if (entity.kind === 'headquarters') {
        ctx.fillRect(x - 4, y - 4, 8, 8)
        ctx.fillStyle = '#182421'
        ctx.fillRect(x - 2, y - 2, 4, 4)
      } else if (isHeroKind(entity.kind) || entity.kind === 'siege') {
        const diamond = isHeroKind(entity.kind)
        ctx.beginPath()
        ctx.moveTo(x, y - 3.5)
        ctx.lineTo(x + 3, y + (diamond ? 0 : 2.5))
        if (diamond) ctx.lineTo(x, y + 3.5)
        ctx.lineTo(x - 3, y + (diamond ? 0 : 2.5))
        ctx.fill()
      } else if (!isUnitKind(entity.kind)) ctx.fillRect(x - 2, y - 2, 4, 4)
      else {
        const key = entity.faction + Math.floor(x / 5) + ',' + Math.floor(y / 5)
        const cluster = clusters.get(key)
        if (cluster) cluster.count++
        else clusters.set(key, { x, y, count: 1, color })
      }
    }
    for (const { x, y, count, color } of clusters.values()) {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, count >= 5 ? 2.6 : 1.15, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const { index, remaining } of this.newest?.deposits ?? []) {
      const tile = this.map.tiles[index]
      if (remaining === 0 || (tile !== 'mine' && tile !== 'quarry')) continue
      ctx.fillStyle = tile === 'mine' ? '#d69345' : '#d3d6dc'
      ctx.fillRect((index % this.map.width + .5) / this.map.width * w - 1, (Math.floor(index / this.map.width) + .5) / this.map.height * h - 1, 2, 2)
    }
    for (const site of this.newest?.controlSites ?? []) {
      ctx.fillStyle = site.owner === 'human' ? '#a3d6ff' : site.owner === 'orc' ? '#ff9575' : '#ffdf98'
      ctx.fillRect(site.x / this.mapWidth * w - 2, site.y / this.mapHeight * h - 2, 4, 4)
    }
    const camera = this.cameras.main
    const start = this.world({ x: 0, y: 0 })
    ctx.strokeStyle = '#ffdf98'
    ctx.strokeRect(start.x / this.mapWidth * w, start.y / this.mapHeight * h,
      camera.width / camera.zoom / this.mapWidth * w, camera.height / camera.zoom / this.mapHeight * h)
  }
}
