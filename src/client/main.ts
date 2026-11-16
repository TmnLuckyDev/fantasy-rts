import Phaser from 'phaser'
import { buildingKinds, entityNames, factionNames, formations, isRace, races, raceOf, isHeroKind, isUnitKind, opposite, resourceKinds, troopGroups, upgradeKinds } from '../shared/protocol.ts'
import type { AttackAlert, ArmyOrder, Formation, GroupCommand, TroopGroup, GlobalTrainCommand, Difficulty, Entity, EntityKind, Faction, Race, PlayerRaces, Order, Population, ResourceKind, Resources, RoomState, ServerMessage, UpgradeKind } from '../shared/protocol.ts'
import type { Cost } from '../shared/economy.ts'
import { buildings, bulkStructureCost, canAfford, FARM_POPULATION, REPAIR, repairCost, trainedAt, trainingRule, trainingCost, MAX_UPGRADE_LEVEL, structureUpgrade, upgradeLevelLimit, upgrades } from '../shared/economy.ts'
import { ashfordMap, distance, mapForSettings } from '../shared/map.ts'
import { raceRules, raceSkills } from '../shared/race-rules.ts'
import { hasHero, heroAbilities, heroDamagePerLevel, heroLevel, heroRoles, heroThresholds } from '../shared/heroes.ts'
import { TICKS_PER_SECOND } from '../shared/match-settings.ts'
import { MatchSettingsMenu, clockText, drawMatchStats } from './match-settings.ts'
import { unitStats } from '../shared/units.ts'
import { BattleAudio } from './audio.ts'
import { GlobalProduction } from './global-production.ts'
import { BattleScene } from './battle.ts'
import { ConnectionClient } from './network.ts'
import { SoloClient } from './solo.ts'
import { entityTexture } from './sprites.ts'
import type { ArmyIndex } from './troop-groups.ts'
import './style.css'

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const button = (id: string) => element<HTMLButtonElement>(id)
const lobby = element('lobby')
const match = element('match')
const battlefield = element('battlefield')
const groupBar = element('troop-groups')
const groupButtons = new Map<TroopGroup, { button: HTMLButtonElement, icon: HTMLCanvasElement, label: HTMLElement, count: HTMLElement }>()
for (const group of troopGroups) {
  const item = document.createElement('button')
  item.type = 'button'
  item.title = 'Tap again to center the camera'
  item.onclick = () => scene?.selectGroup(group)
  const icon = document.createElement('canvas')
  icon.width = icon.height = 28
  icon.setAttribute('aria-hidden', 'true')
  const label = document.createElement('span')
  const count = document.createElement('span')
  count.className = 'troop-count'
  count.setAttribute('aria-hidden', 'true')
  item.append(icon, label, count)
  groupBar.append(item)
  groupButtons.set(group, { button: item, icon, label, count })
}
const portrait = element<HTMLCanvasElement>('selection-portrait')
const minimap = element<HTMLCanvasElement>('minimap')
const joinCode = element<HTMLInputElement>('join-code')
const connection = element('connection')
const lobbyMessage = element('lobby-message')
const result = element<HTMLDialogElement>('result')
const banner = element('banner')
const attackAlerts = element('attack-alerts')
const minimapPings = element('minimap-pings')
let shownAlerts: readonly AttackAlert[] = []
const menu = element('economy-menu')
const workerActions = element('worker-actions')
const economyAction = button('economy-action')
const globalUpgradeToggle = button('global-upgrade-toggle')
const productionPanel = element('production-panel')
const productionToggle = button('production-toggle')
const globalTrainPanel = element('global-train-panel')
const globalTrainToggle = button('global-train-toggle')
const globalProduction = new GlobalProduction(globalTrainPanel, (unit, count) => {
  const message: GlobalTrainCommand = { type: 'global-train', unit, count }
  if (solo.active) solo.sendArmyCommand(message)
  else client.send(message)
}, paintPortrait)
const placementTip = element('placement-tip')
const formationButton = button('formation')
const formationOptions = element('formation-options')
const formationChoices = [...formationOptions.querySelectorAll<HTMLButtonElement>('[data-formation]')]
formationButton.onclick = () => toggleFormation(formationOptions.hidden)
for (const option of formationChoices) {
  option.onclick = () => {
    const choice = formations.find(kind => kind === option.dataset.formation)
    if (!scene || !choice) return
    scene.formation = choice
    drawFormation(choice)
    toggleFormation(false)
  }
}

function drawFormation(formation: Formation) {
  formationButton.textContent = formation[0].toUpperCase() + formation.slice(1)
  for (const choice of formationChoices) choice.setAttribute('aria-pressed', String(choice.dataset.formation === formation))
}

function toggleFormation(open: boolean) {
  formationOptions.hidden = !open
  formationButton.setAttribute('aria-expanded', String(open))
  if (open) {
    toggleGlobalTrain(false)
    toggleProduction(false)
    closeEconomyMenu()
  }
}
for (const race of ['dwarf', 'elf', 'undead'] as const) {
  const choice = document.createElement('button')
  choice.className = 'faction ' + race
  choice.type = 'button'
  choice.dataset.faction = race
  const copy = document.createElement('span')
  const title = document.createElement('strong')
  title.textContent = factionNames[race]
  const description = document.createElement('small')
  description.textContent = raceRules[race].description
  const icon = document.createElement('canvas')
  icon.className = 'race-icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.width = 48
  icon.height = 48
  paintPortrait(icon, race, 'headquarters')
  copy.append(title, description)
  choice.append(icon, copy)
  document.querySelector('.factions')!.append(choice)
}
const opponentChoice = element<HTMLSelectElement>('solo-race')
for (const race of races) opponentChoice.add(new Option(factionNames[race], race))
const factionButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-faction]')]
const audio = new BattleAudio()
const settingsMenu = new MatchSettingsMenu()
let matchSettings = settingsMenu.load()
const clock = element('match-clock')
const touch = matchMedia('(pointer: coarse)').matches

let faction: Faction = 'human'
let chosenRace: Race = 'human'
let explicitRace = false
let playerRaces: PlayerRaces = { human: 'human', orc: 'orc' }
let room: RoomState | null = null
let scene: BattleScene | null = null
let game: Phaser.Game | null = null
let orderMessageTimer: number | undefined
let resources: Resources = { gold: 0, wood: 0, stone: 0 }
let ownEntities: Entity[] = []
let researched: UpgradeKind[] = []
let currentTick = 0
let population: Population = { used: 0, reserved: 0, limit: 0 }
const choiceRules = new WeakMap<HTMLButtonElement, { cost: Cost, population: number, upgrade?: UpgradeKind, hero?: boolean }>()
let selection: Entity[] = []
let placing = false
let economyContext = ''
let globalUpgradeOpen = false

const invite = new URLSearchParams(location.search).get('room')
if (invite && /^[A-Z2-9]{5}$/i.test(invite)) joinCode.value = invite.toUpperCase()

const solo = new SoloClient(receive, refreshSoloButton)
const client = new ConnectionClient(receive, status)
refreshSoloButton()
if (!invite && !client.hasSeat && solo.restoreOnReload) solo.start(faction, true)

function refreshSoloButton() {
  button('solo').textContent = solo.saved ? 'Resume solo match' : 'Play vs Computer'
  button('solo').disabled = client.hasSeat
}

function status(state: 'waiting' | 'open' | 'closed') {
  const open = state === 'open'
  connection.dataset.state = state
  connection.textContent = open ? 'Online' : state === 'waiting' ? 'Connecting' : 'Reconnecting'
  button('create').disabled = !open
  button('join').disabled = !open
  button('ready').disabled = !open
  if (room) updateBanner(open)
}

function note(message: string, error = false) {
  lobbyMessage.textContent = message
  lobbyMessage.dataset.error = String(error)
}

function updateBanner(online: boolean) {
  if (!online && !solo.active) banner.textContent = 'Reconnecting to match…'
  else if (room?.paused) banner.textContent = 'Match paused · Waiting for opponent to reconnect'
  else banner.textContent = factionNames[chosenRace] + (room?.mode === 'solo' ? ' vs Computer' : '') +
    (room?.settings?.minutes ? ' · Destroy the enemy headquarters or win on score' : ' · Destroy the enemy headquarters')
}

function selectRace(race: Race) {
  chosenRace = race
  for (const item of factionButtons) item.setAttribute('aria-pressed', String(item.dataset.faction === race))
}

function showLobby() {
  result.close()
  settingsMenu.close()
  button('match-settings').textContent = 'Match settings'
  game?.destroy(true)
  game = null
  scene = null
  room = null
  match.hidden = true
  lobby.hidden = false
  element('lobby-title').textContent = 'Game lobby'
  element('room-actions').hidden = true
  element('entry-actions').hidden = false
  for (const item of factionButtons) item.disabled = false
  history.replaceState(null, '', location.pathname)
  refreshSoloButton()
  note('Choose a faction to start.')
}

function receive(message: ServerMessage) {
  switch (message.type) {
    case 'session':
      faction = message.faction
      break
    case 'room':
      room = message.room
      faction = message.faction
      playerRaces = { human: 'human', orc: 'orc' }
      for (const seat of room.players) playerRaces[seat.faction] = seat.race ?? seat.faction
      selectRace(playerRaces[faction])
      if (room.phase === 'lobby') drawLobby()
      else {
        if (!scene) showBattle()
        updateBanner(client.connected)
        if (room.result) drawResult(room.result)
      }
      break
    case 'snapshot': {
      currentTick = message.tick
      const minutes = room?.settings?.minutes
      if (minutes) setText('match-clock', clockText(Math.max(0, minutes * 60 - Math.floor(message.tick / TICKS_PER_SECOND))))
      resources = message.resources
      population = message.population
      ownEntities = message.entities.filter(entity => entity.faction === faction)
      researched = message.upgrades ?? []
      drawProduction()
      if (!globalTrainPanel.hidden) globalProduction.update(chosenRace, ownEntities, resources, population)
      drawEconomy()
      const idle = message.entities.filter(entity => entity.faction === faction && entity.idle).length
      button('idle-worker').disabled = idle === 0
      setText('idle-count', String(idle))
      drawAttackAlerts(room?.result ? [] : message.alerts ?? [])
      scene?.snapshot(message)
      break
    }
    case 'error':
      if (message.resetSession) showLobby()
      if (scene) {
        if (!globalTrainPanel.hidden) globalProduction.message(message.message)
        banner.textContent = message.message
        window.clearTimeout(orderMessageTimer)
        orderMessageTimer = window.setTimeout(() => updateBanner(client.connected), 2500)
      } else note(message.message, true)
      break
  }
}

function drawLobby() {
  if (!room) return
  element('entry-actions').hidden = true
  element('room-actions').hidden = false
  element('lobby-title').textContent = 'War room'
  element('room-code').textContent = room.code
  element('room-map').textContent = ashfordMap(room.settings?.map).name
  button('match-settings').textContent = room.host === faction ? 'Edit match settings' : 'View match settings'
  const mine = room.players.find(seat => seat.faction === faction)
  button('ready').textContent = mine?.ready ? 'Cancel ready' : 'Ready'
  const rows = room.players.map(seat => {
    const row = document.createElement('div')
    row.className = 'seat ' + seat.faction
    const name = document.createElement('span')
    const state = document.createElement('span')
    name.textContent = factionNames[seat.race ?? seat.faction] + (seat.faction === faction ? ' · You' : '')
    state.textContent = !seat.connected ? 'Disconnected' : seat.ready ? 'Ready' : 'Preparing'
    row.append(name, state)
    return row
  })
  element('seats').replaceChildren(...rows)
  note(room.players.length === 1 ? 'Share the invite or room code with your opponent.' : 'The match starts when both players are ready.')
}

function preferredBattleRenderer() {
  // Touch devices can mask their GPU information. Use the faster renderer from the mobile load tests.
  if (touch) return Phaser.CANVAS
  // A CPU-backed WebGL context can be slower than drawing this pixel art with Canvas 2D.
  const probe = document.createElement('canvas')
  const gl = probe.getContext('webgl', { failIfMajorPerformanceCaveat: true })
  if (!gl) return Phaser.CANVAS
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return /swiftshader|llvmpipe|software/i.test(renderer) ? Phaser.CANVAS : Phaser.AUTO
}

function showBattle() {
  settingsMenu.close()
  lobby.hidden = true
  match.hidden = false
  const minutes = room?.settings?.minutes
  clock.hidden = !minutes
  if (minutes) setText('match-clock', clockText(minutes * 60))
  match.dataset.faction = faction
  button('advance').setAttribute('aria-pressed', 'false')
  const map = room?.settings ? mapForSettings(room.settings, room.mapSeed) : ashfordMap(room?.map)
  element('result-map').textContent = map.name
  scene = new BattleScene(faction, playerRaces, map, battlefield, minimap, {
    order: issueOrder,
    groupOrder: issueGroupOrder,
    groups: drawTroopGroups,
    selection: drawSelection,
    resource: showResourceInfo,
    placement: (kind, blocked, segmentCount) => {
      placing = Boolean(kind)
      placementTip.hidden = !kind
      syncWorkerActions()
      if (!kind) return
      if (segmentCount !== undefined) {
        const price = buildings.wall.cost.stone!
        const count = Math.min(segmentCount, Math.floor(resources.stone / price))
        setText('placement-message', count + ' wall segments · ' + (count * price) + ' stone')
        return
      }
      const action = kind === 'wall' ? 'Drag to queue a wall line, or tap a tile.' : 'Tap each tile to queue another.'
      element('placement-message').textContent = blocked ? 'Choose explored, open ground.' : entityNames[chosenRace][kind] + ' · ' + action
    },
    effect: kind => audio.play(kind)
  })
  button('idle-worker').disabled = true
  setText('idle-count', '0')
  scene.advanceMode = false
  drawFormation(scene.formation)
  toggleFormation(false)
  resources = { gold: 0, wood: 0, stone: 0 }
  ownEntities = []
  researched = []
  toggleProduction(false)
  toggleGlobalTrain(false)
  drawProduction()
  population = { used: 0, reserved: 0, limit: 0 }
  drawEconomy()
  placementTip.hidden = true
  placing = false
  closeEconomyMenu()
  drawAttackAlerts([])
  drawTroopGroups(new Map(), null)
  drawSelection([])
  game = new Phaser.Game({
    type: preferredBattleRenderer(),
    parent: battlefield,
    width: battlefield.clientWidth,
    height: battlefield.clientHeight,
    scale: { mode: Phaser.Scale.RESIZE },
    backgroundColor: '#121a11',
    pixelArt: true,
    input: { mouse: false, touch: false, keyboard: true, gamepad: false },
    audio: { noAudio: true },
    scene
  })
}

function paintPortrait(target: HTMLCanvasElement, side: Race, kind: EntityKind) {
  const key = side + kind
  if (target.dataset.sprite === key) return
  target.dataset.sprite = key
  const sprite = entityTexture(side, kind)
  const ctx = target.getContext('2d')!
  const scale = Math.min(target.width / sprite.width, target.height / sprite.height)
  const width = Math.floor(sprite.width * scale)
  const height = Math.floor(sprite.height * scale)
  ctx.clearRect(0, 0, target.width, target.height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sprite, Math.floor((target.width - width) / 2), Math.floor((target.height - height) / 2), width, height)
}

function drawAttackAlerts(alerts: readonly AttackAlert[]) {
  if (alerts.length === shownAlerts.length && alerts.every((alert, i) => alert.id === shownAlerts[i].id)) return
  if (alerts.some(alert => !shownAlerts.some(previous => previous.id === alert.id))) audio.play('alert')
  shownAlerts = alerts
  attackAlerts.hidden = !alerts.length
  const labels = { base: 'Base under attack', building: 'Building under attack',
    workers: 'Workers under attack', army: 'Army under attack' }
  const notices: HTMLButtonElement[] = []
  const pings: HTMLButtonElement[] = []
  for (const alert of alerts) {
    const item = document.createElement('button')
    item.type = 'button'
    item.dataset.severity = alert.kind
    item.textContent = labels[alert.kind]
    item.title = 'Center camera on attack'
    item.onclick = () => scene?.focusAlert(alert.at)
    notices.push(item)
    const position = scene?.minimapPosition(alert.at)
    if (!position) continue
    const ping = document.createElement('button')
    ping.type = 'button'
    ping.dataset.severity = alert.kind
    ping.setAttribute('aria-label', 'Minimap ping · ' + labels[alert.kind])
    ping.style.left = position.x * 100 + '%'
    ping.style.top = position.y * 100 + '%'
    ping.onclick = item.onclick
    pings.push(ping)
  }
  attackAlerts.replaceChildren(...notices)
  minimapPings.replaceChildren(...pings)
}

function drawTroopGroups(army: ArmyIndex, selected: TroopGroup | null) {
  groupBar.hidden = !army.size
  for (const [group, ui] of groupButtons) {
    const members = army.get(group)
    ui.button.hidden = !members?.length
    if (!members?.length) continue
    const kind = group === 'all' ? 'blade' : members[0].kind
    const label = group === 'all' ? 'All troops' : group === 'heroes' ? 'Heroes' : entityNames[chosenRace][kind]
    if (ui.label.textContent !== label) ui.label.textContent = label
    const count = String(members.length)
    if (ui.count.textContent !== count) {
      ui.count.textContent = count
      ui.button.setAttribute('aria-description', count + ' living · Tap again to center camera')
    }
    const pressed = String(group === selected)
    if (ui.button.getAttribute('aria-pressed') !== pressed) ui.button.setAttribute('aria-pressed', pressed)
    paintPortrait(ui.icon, chosenRace, kind)
  }
}

function issueGroupOrder(group: TroopGroup, order: ArmyOrder) {
  const message: GroupCommand = { type: 'group-command', group, order }
  if (solo.active) solo.sendArmyCommand(message)
  else client.send(message)
  audio.play('order')
}

function issueOrder(ids: number[], order: Order) {
  if (solo.active) solo.command(ids, order)
  else client.send({ type: 'command', ids, order })
  if (order.kind === 'train') audio.play('train')
  else if (order.kind === 'build' || order.kind === 'wall-line') audio.play('build')
  else audio.play('order')
}

function showResourceInfo(kind: ResourceKind, remaining: number | null) {
  drawSelection([], true)
  element('selection-name').textContent = kind === 'wood' ? 'Tree' : kind === 'gold' ? 'Gold mine' : 'Stone quarry'
  element('selection-detail').textContent = remaining === null ? 'Unlimited resources' : `${remaining.toLocaleString()} resources remaining`
}

function drawSelection(entities: Entity[], interactive = false) {
  selection = entities
  const selected = entities[0]
  const workers = entities.some(entity => entity.kind === 'worker')
  const trainer = entities.length === 1 && selected && selected.construction === undefined &&
    trainedAt(selected.kind, chosenRace).length ? selected : undefined
  const smithy = entities.length === 1 && selected?.kind === 'smithy' && selected.construction === undefined
  const building = entities.length === 1 && selected && !isUnitKind(selected.kind) ? selected : undefined
  const foundation = building?.construction !== undefined
  const nextContext = globalUpgradeOpen ? 'global-upgrades' : workers ? 'build' : (building && !foundation && (building.kind === 'tower' || building.kind === 'wall')) ? 'fortify:' + building.id : trainer ? 'train:' + trainer.id :
    smithy ? 'research:' + selected.id : foundation ? 'cancel:' + building.id :
    building ? 'manage:' + building.id : ''
  const changed = nextContext !== economyContext
  economyContext = nextContext
  economyAction.hidden = globalUpgradeOpen || !nextContext
  economyAction.textContent = workers ? 'Build' : smithy ? 'Upgrade' : (building && (building.kind === 'tower' || building.kind === 'wall')) ? 'Upgrade' : foundation ? 'Construction' : trainer ? 'Train' : 'Manage'
  if (!nextContext || (!globalUpgradeOpen && workers && (changed || interactive))) closeEconomyMenu()
  else if ((!workers || globalUpgradeOpen) && (changed || interactive)) openEconomyMenu(changed)
  else if (!menu.hidden) updateEconomyOptions()
  const label = element('selection-name')
  const detail = element('selection-detail')
  const meter = element<HTMLMeterElement>('selection-health')
  formationButton.hidden = !entities.some(entity => isUnitKind(entity.kind) && entity.kind !== 'worker')
  if (formationButton.hidden && !formationOptions.hidden) toggleFormation(false)
  button('explore').hidden = !entities.some(entity => entity.kind === 'scout')
  button('dismiss-units').hidden = !entities.length || !entities.every(entity => entity.kind === 'worker' || entity.kind === 'scout')
  button('unload').hidden = !(entities.length === 1 && selected?.kind === 'transport')
  if (selected?.kind === 'transport') button('unload').disabled = !(selected.passengers?.length)
  const selectedHero = entities.length === 1 && selected && isHeroKind(selected.kind) ? selected : undefined
  const skill = entities.length === 1 && selected && isUnitKind(selected.kind) ? raceSkills[raceOf(selected)]?.[selected.kind] : undefined
  const heroSkillButton = button('hero-skill')
  heroSkillButton.hidden = !selectedHero && !skill
  if (selected && (selectedHero || skill)) {
    const ability = skill ?? heroAbilities[selected.kind as keyof typeof heroAbilities]
    const remaining = Math.max(0, (selected.abilityReadyAt ?? 0) - currentTick)
    heroSkillButton.textContent = remaining ? ability.name + ' · ' + Math.ceil(remaining / TICKS_PER_SECOND) + 's' : ability.name
    heroSkillButton.disabled = remaining > 0
    heroSkillButton.title = 'description' in ability ? ability.description : ability.passive
  }
  const movable = entities.some(entity => isUnitKind(entity.kind))
  button('advance').disabled = !movable
  button('halt').disabled = !movable
  meter.hidden = !selected
  portrait.hidden = !selected
  if (!selected) {
    label.textContent = 'No units selected'
    detail.textContent = touch ? 'Drag to select · Two fingers to pan.' : 'Click or drag to select.'
    return
  }
  paintPortrait(portrait, raceOf(selected), selected.kind)
  const hp = entities.reduce((total, entity) => total + entity.hp, 0)
  const totalHp = entities.reduce((total, entity) => total + entity.maxHp, 0)
  const stats = unitStats[raceOf(selected)][selected.kind]
  meter.value = hp / totalHp * 100
  if (entities.length === 1) {
    label.textContent = entityNames[raceOf(selected)][selected.kind]
    if (selected.construction !== undefined) detail.textContent = constructionSummary(selected)
    else if (selected.repairing) detail.textContent = selected.kind === 'worker' ? 'Repairing a building' : `Repairing · ${hp}/${totalHp} HP`
    else if (selected.research) detail.textContent = upgrades[selected.research.kind].name + ' · ' + percentage(selected.research.progress)
    else if (selected.training) {
      detail.textContent = trainingSummary(selected.training)
    } else if (selected.kind === 'worker') {
      detail.textContent = selected.carrying ? `Carrying ${selected.carrying}` : selected.idle ? 'Idle · ' + gatherHint() : gatherHint()
    } else if (selected.kind === 'transport') detail.textContent = `${hp}/${totalHp} HP · ${selected.passengerPop ?? 0}/30 population aboard`
    else if (selected.kind === 'farm') detail.textContent = `+${FARM_POPULATION} population · ${hp}/${totalHp} HP` + (raceOf(selected) === 'dwarf' ? ' · Stone drop-off' : '')
    else detail.textContent = (selected.level ? `Level ${selected.level}/${MAX_UPGRADE_LEVEL} · ` : '') + (stats.damage ? `${hp}/${totalHp} HP · ${stats.damage + (selected.weaponLevel ?? 0) * upgrades.weapons.bonus + ((selected.kind === 'ranged' || selected.kind === 'marksman' || selected.kind === 'pathfinder' || selected.kind === 'warship') ? (selected.precisionLevel ?? 0) * upgrades.precision.bonus : 0)} damage` : `${hp}/${totalHp} HP`) + (selected.upgradeProgress !== undefined ? ` · Upgrading ${percentage(selected.upgradeProgress)}` : '')
  } else {
    const onlyWorkers = entities.every(entity => entity.kind === 'worker')
    label.textContent = `${entities.length} ${onlyWorkers ? 'workers' : 'troops'} selected`
    detail.textContent = onlyWorkers
      ? gatherHint()
      : (touch ? 'Tap ground to move or an enemy to attack.' : 'Right-click ground to move or an enemy to attack.')
  }
}

function drawEconomy() {
  for (const kind of resourceKinds) setText(kind, String(resources[kind]))
  const committed = population.used + population.reserved
  setText('population', `${committed}/${population.limit}`)
  const meter = element('population-meter')
  meter.dataset.full = String(committed >= population.limit)
  meter.title = `${population.used} in play · ${population.reserved} queued · ${population.limit} capacity`
}

function setText(id: string, text: string) {
  const target = element(id)
  if (target.textContent !== text) target.textContent = text
}

function gatherHint() {
  return touch ? 'Tap a mine, tree or quarry to gather.' : 'Right-click a mine, tree or quarry to gather.'
}

function closeEconomyMenu() {
  menu.hidden = true
  economyAction.setAttribute('aria-expanded', 'false')
  globalUpgradeToggle.setAttribute('aria-expanded', 'false')
  syncWorkerActions()
}

function syncWorkerActions() {
  workerActions.hidden = economyContext !== 'build' || placing || !menu.hidden || !productionPanel.hidden
}

function updateEconomyOptions() {
  const available = population.limit - population.used - population.reserved
  let needsFarm = false
  let heroTaken: boolean | undefined
  for (const choice of menu.querySelectorAll<HTMLButtonElement>('button')) {
    const rule = choiceRules.get(choice)
    if (!rule) continue
    const needsSpace = rule.population > 0 && rule.population > available
    needsFarm ||= needsSpace
    const unavailable = rule.upgrade && (researched.filter(kind => kind === rule.upgrade).length >= upgradeLevelLimit(rule.upgrade) ||
      Boolean(selection[0]?.research) || ownEntities.some(entity => entity.research?.kind === rule.upgrade))
    if (rule.hero) heroTaken ??= hasHero(ownEntities)
    choice.disabled = Boolean(unavailable) || needsSpace || !canAfford(resources, rule.cost) ||
      Boolean(rule.hero && heroTaken)
    if (rule.hero) choice.title = heroTaken ? 'You already have a hero or one is in training.' : 'One hero per faction.'
    if (rule.upgrade) choice.title = researched.filter(kind => kind === rule.upgrade).length >= upgradeLevelLimit(rule.upgrade) ? 'Max level' : ''
  }
  const fortify = menu.querySelector<HTMLButtonElement>('[data-fortify]')
  if (fortify) {
    const site = selection[0]
    fortify.disabled = (site.level ?? 1) >= MAX_UPGRADE_LEVEL || site.upgradeProgress !== undefined ||
      !canAfford(resources, structureUpgrade(site.kind as 'tower' | 'wall', (site.level ?? 1) + 1).cost)
  }
  for (const choice of menu.querySelectorAll<HTMLButtonElement>('[data-bulk-fortify]')) {
    const kind = choice.dataset.bulkFortify as 'wall' | 'tower'
    const eligible = ownEntities.filter(entity => entity.kind === kind && entity.construction === undefined &&
      entity.upgradeProgress === undefined && (entity.level ?? 1) < MAX_UPGRADE_LEVEL)
    const total: Resources = { gold: 0, wood: 0, stone: 0 }
    for (const entity of eligible) {
      const cost = bulkStructureCost(kind, (entity.level ?? 1) + 1)
      for (const resource of resourceKinds) total[resource] += cost[resource] ?? 0
    }
    choice.disabled = !eligible.length || !canAfford(resources, total)
    choice.textContent = `Upgrade all ${kind === 'wall' ? 'walls' : 'towers'} (${eligible.length}) · ` +
      resourceKinds.filter(resource => total[resource]).map(resource => `${total[resource]} ${resource}`).join(' · ')
    if (!eligible.length) choice.textContent = `Upgrade all ${kind === 'wall' ? 'walls' : 'towers'} (none eligible)`
  }
  const repair = menu.querySelector<HTMLButtonElement>('[data-repair]')
  if (repair) {
    const site = selection[0]
    const reason = site.repairing ? 'Repair in progress.' : site.hp >= site.maxHp ? 'Building is at full health.' :
      !canAfford(resources, repairCost(site.kind)) ? 'More resources are needed.' :
      !ownEntities.some(entity => entity.idle) ? 'Select a worker and target this building to repair it.' : ''
    repair.disabled = Boolean(reason)
    repair.title = reason
    repair.textContent = site.repairing ? 'Repairing…' : repair.getAttribute('aria-label')
  }
  const findHero = menu.querySelector<HTMLButtonElement>('[data-find-hero]')
  if (findHero) findHero.hidden = !ownEntities.some(unit => isHeroKind(unit.kind))
  const hint = menu.querySelector<HTMLElement>('.economy-hint')
  if (hint) hint.hidden = !needsFarm
}

function economyChoice(kind: EntityKind, cost: Cost, population: number, act: () => void, upgrade?: UpgradeKind) {
  const choice = document.createElement('button')
  choice.type = 'button'
  choiceRules.set(choice, { cost, population, upgrade })
  const prices = resourceKinds.flatMap(kind => cost[kind] ? [`${cost[kind]} ${kind}`] : [])
  if (population > 1) prices.push(`${population} pop`)
  const name = upgrade ? `${upgrades[upgrade].name} · Lv ${Math.min(upgradeLevelLimit(upgrade), researched.filter(kind => kind === upgrade).length + 1)}/${upgradeLevelLimit(upgrade)}` : entityNames[chosenRace][kind]
  choice.setAttribute('aria-label', [name, ...prices].join(' · '))
  const icon = document.createElement('canvas')
  icon.width = icon.height = 36
  icon.setAttribute('aria-hidden', 'true')
  paintPortrait(icon, chosenRace, kind)
  const caption = document.createElement('span')
  const title = document.createElement('strong')
  title.textContent = name
  const price = document.createElement('small')
  price.textContent = prices.join(' · ')
  caption.append(title, price)
  choice.append(icon, caption)
  choice.onclick = act
  return choice
}

function gatherChoice(resource: ResourceKind, label: string) {
  const choice = document.createElement('button')
  choice.type = 'button'
  choice.className = 'gather-choice resource ' + resource
  const icon = document.createElement('span')
  icon.setAttribute('aria-hidden', 'true')
  choice.append(icon, label)
  choice.onclick = () => {
    if (!scene?.gatherNearest(resource)) receive({ type: 'error', message: 'Explore a source of ' + resource + ' first.' })
  }
  return choice
}

workerActions.append(gatherChoice('gold', 'Mine gold'), gatherChoice('wood', 'Chop wood'), gatherChoice('stone', 'Quarry stone'))

function buildChoices() {
  return buildingKinds.map(kind => economyChoice(kind, buildings[kind].cost, 0, () => {
    scene?.place(kind)
    closeEconomyMenu()
  }))
}

function actionButton(label: string, run: () => void) {
  const choice = document.createElement('button')
  choice.type = 'button'
  choice.textContent = label
  choice.onclick = run
  return choice
}

function productionChoices(building: Entity) {
  const choices = trainedAt(building.kind, chosenRace).map(kind => {
    const choice = economyChoice(kind, trainingCost(kind, chosenRace), trainingRule(kind, chosenRace).population, () =>
      issueOrder([building.id], { kind: 'train', unit: kind }))
    if (isHeroKind(kind)) {
      choiceRules.get(choice)!.hero = true
      const price = choice.querySelector('small')!
      price.textContent += ' · ' + heroRoles[kind]
    }
    return choice
  })
  if (building.kind === 'headquarters') {
    const findHero = actionButton('Find hero', () => scene?.selectHero())
    findHero.dataset.findHero = ''
    choices.push(findHero)
  }
  const cancelLast = actionButton('Cancel last', () =>
    issueOrder([building.id], { kind: 'cancel-train', count: 1 }))
  const hint = document.createElement('small')
  hint.className = 'economy-hint'
  hint.textContent = 'Build more farms to train this unit.'
  return [...choices, cancelLast, hint]
}

function buildingActions(site: Entity) {
  const repair = actionButton('Repair', () => {
    const worker = ownEntities.filter(entity => entity.idle)
      .reduce<Entity | undefined>((nearest, entity) =>
        !nearest || distance(entity, site) < distance(nearest, site) ? entity : nearest, undefined)
    if (worker) issueOrder([worker.id], { kind: 'repair', target: site.id })
  })
  repair.dataset.repair = ''
  const materials = site.kind === 'wall' ? '1 stone' : '1 wood + 1 stone'
  repair.setAttribute('aria-label', `Repair · ${materials} per ${REPAIR.health} HP`)
  const actions = [repair]
  if (trainedAt(site.kind, chosenRace).length) actions.push(actionButton('Set rally point', () => {
    scene?.setRallyTarget(site.id)
    closeEconomyMenu()
    banner.textContent = 'Tap a tile to set the rally point.'
  }))
  if (site.kind === 'headquarters') return actions
  const demolish = actionButton('Demolish', () => {
    const name = entityNames[raceOf(site)][site.kind]
    if (window.confirm('Demolish ' + name + '? No resources are refunded.')) issueOrder([site.id], { kind: 'demolish' })
  })
  demolish.classList.add('demolish-action')
  return [...actions, demolish]
}

function openEconomyMenu(rebuild = false) {
  toggleGlobalTrain(false)
  if (!economyContext || placing) return
  if (rebuild) {
    if (economyContext === 'global-upgrades') {
      const smith = ownEntities.find(entity => entity.kind === 'smithy' && entity.construction === undefined)
      const choices = upgradeKinds.filter(kind => kind !== 'fortress').map(kind => {
        const choice = economyChoice('smithy', upgrades[kind].cost, 0, () => {
          const available = ownEntities.find(entity => entity.kind === 'smithy' && entity.construction === undefined && !entity.research)
          if (available) issueOrder([available.id], { kind: 'upgrade', upgrade: kind })
        }, kind)
        if (!smith) choice.disabled = true
        return choice
      })
      for (const kind of ['wall', 'tower'] as const) {
        const choice = actionButton('', () => {
          const id = ownEntities[0]?.id
          if (id) issueOrder([id], { kind: 'bulk-structure-upgrade', building: kind })
        })
        choice.dataset.bulkFortify = kind
        choices.push(choice)
      }
      menu.replaceChildren(...choices)
    } else if (economyContext === 'build') menu.replaceChildren(...buildChoices())
    else if (economyContext.startsWith('cancel:')) {
      const site = selection[0]
      menu.replaceChildren(actionButton('Cancel construction', () => issueOrder([site.id], { kind: 'cancel-build' })))
    } else if (economyContext.startsWith('fortify:')) {
      const site = selection[0]
      const level = site.level ?? 1
      const button = actionButton(`Upgrade to level ${level + 1}/${MAX_UPGRADE_LEVEL}`, () => issueOrder([site.id], { kind: 'structure-upgrade' }))
      const cost = structureUpgrade(site.kind as 'wall' | 'tower', level + 1).cost
      button.textContent += ' · ' + resourceKinds.filter(kind => cost[kind]).map(kind => `${cost[kind]} ${kind}`).join(' · ')
      button.dataset.fortify = ''
      button.disabled = level >= MAX_UPGRADE_LEVEL || site.upgradeProgress !== undefined || !canAfford(resources, cost)
      menu.replaceChildren(button, ...buildingActions(site))
    } else if (selection[0]?.kind === 'smithy') {
      const smith = selection[0]
      menu.replaceChildren(...upgradeKinds.filter(kind => kind !== 'fortress').map(kind => economyChoice('smithy', upgrades[kind].cost, 0, () =>
        issueOrder([smith.id], { kind: 'upgrade', upgrade: kind }), kind)), ...productionChoices(smith), ...buildingActions(smith))
    } else {
      const building = selection[0]
      if (!building) return
      const production = trainedAt(building.kind, chosenRace).length ? productionChoices(building) : []
      if (chosenRace === 'dwarf' && building.kind === 'elite') {
        production.push(economyChoice('elite', upgrades.fortress.cost, 0, () =>
          issueOrder([building.id], { kind: 'upgrade', upgrade: 'fortress' }), 'fortress'))
      }
      menu.replaceChildren(...production, ...buildingActions(building))
    }
  }
  updateEconomyOptions()
  toggleProduction(false)
  menu.hidden = false
  economyAction.setAttribute('aria-expanded', 'true')
  syncWorkerActions()
}

globalUpgradeToggle.onclick = () => {
  globalUpgradeOpen = !globalUpgradeOpen
  if (globalUpgradeOpen) {
    economyContext = 'global-upgrades'
    openEconomyMenu(true)
    globalUpgradeToggle.setAttribute('aria-expanded', 'true')
  } else {
    closeEconomyMenu()
    drawSelection(selection, true)
  }
}

economyAction.onclick = () => {
  if (placing) scene?.place(null)
  if (menu.hidden) openEconomyMenu(economyContext === 'build')
  else closeEconomyMenu()
}

button('explore').onclick = () => scene?.explore()
button('dismiss-units').onclick = () => {
  const ids = selection.filter(entity => entity.kind === 'worker' || entity.kind === 'scout').map(entity => entity.id)
  if (ids.length && ids.length === selection.length && window.confirm(`Permanently dismiss ${ids.length} selected peasant(s) or scout(s)?`)) {
    issueOrder(ids, { kind: 'dismiss' })
  }
}
button('unload').onclick = () => scene?.unload()
button('hero-skill').onclick = () => {
  if (selection.length === 1 && !isHeroKind(selection[0].kind)) issueOrder([selection[0].id], { kind: 'unit-ability' })
  else scene?.castHeroAbility()
}
button('idle-worker').onclick = () => scene?.selectIdleWorker()
button('workers').onclick = () => scene?.selectWorkers()
button('cancel-placement').onclick = () => scene?.place(null)

function percentage(progress: number) { return Math.floor(progress * 100) + '%' }

function constructionSummary(entity: Entity) {
  if (entity.constructionStatus === 'queued') return 'Queued'
  if (entity.constructionStatus === 'paused') return 'Paused · ' + percentage(entity.construction ?? 0)
  return 'Building · ' + percentage(entity.construction ?? 0)
}

function trainingSummary(training: NonNullable<Entity['training']>) {
  const names = entityNames[chosenRace]
  const runs = training.queue ?? []
  const waiting = runs.map((run, index) => ({ ...run, count: run.count - Number(index === 0) }))
    .filter(run => run.count > 0)
  const labels = waiting.slice(0, 5).map(run => names[run.kind] + ' × ' + run.count)
  if (waiting.length > 5) labels.push('+' + (waiting.length - 5) + ' batches')
  const active = names[training.kind] + ' · ' + percentage(training.progress) +
    (training.seconds === undefined ? '' : ' · ' + training.seconds + 's')
  return labels.length ? active + ' → ' + labels.join(', ') : active
}

function toggleGlobalTrain(open: boolean) {
  globalTrainPanel.hidden = !open
  globalTrainToggle.setAttribute('aria-expanded', String(open))
  if (!open) return
  toggleFormation(false)
  toggleProduction(false)
  closeEconomyMenu()
  scene?.place(null)
  globalProduction.message('')
  globalProduction.update(chosenRace, ownEntities, resources, population)
}

globalTrainToggle.onclick = () => toggleGlobalTrain(globalTrainPanel.hidden)

function toggleProduction(open: boolean) {
  productionPanel.hidden = !open
  productionToggle.setAttribute('aria-expanded', String(open))
  syncWorkerActions()
  if (open) {
    toggleFormation(false)
    toggleGlobalTrain(false)
    closeEconomyMenu()
    drawProduction()
  }
}

function drawProduction() {
  const rows: string[] = []
  let count = 0
  for (const entity of ownEntities) {
    const name = entityNames[chosenRace][entity.kind]
    if (entity.construction !== undefined) {
      count++
      rows.push(name + ' · ' + constructionSummary(entity))
    }
    if (entity.training) {
      count += entity.training.remaining
      rows.push(name + ' · ' + trainingSummary(entity.training))
    }
    if (entity.research) {
      count++
      rows.push(name + ' · ' + upgrades[entity.research.kind].name + ' · ' + percentage(entity.research.progress))
    }
  }
  setText('production-count', String(count))
  if (productionPanel.hidden) return
  if (!rows.length) rows.push('Nothing queued')
  const signature = rows.join('')
  if (productionPanel.dataset.rows === signature) return
  productionPanel.dataset.rows = signature
  productionPanel.replaceChildren(...rows.map(row => {
    const item = document.createElement('div')
    item.textContent = row
    return item
  }))
}

productionToggle.onclick = () => toggleProduction(productionPanel.hidden)

function drawResult(outcome: NonNullable<RoomState['result']>) {
  element('result-title').textContent = !outcome.winner ? 'Draw' : outcome.winner === faction ? 'Victory' : 'Defeat'
  drawAttackAlerts([])
  let detail: string
  if (outcome.reason === 'time') {
    setText('match-clock', '0:00')
    detail = outcome.winner ? 'Time expired. ' + factionNames[playerRaces[outcome.winner]] + ' finished with the higher score.' : 'Time expired with equal scores.'
  } else if (outcome.reason === 'headquarters') {
    detail = outcome.winner ? factionNames[playerRaces[opposite(outcome.winner)]] + ' lost their headquarters.' : 'Both headquarters fell.'
  } else {
    detail = outcome.winner ? factionNames[playerRaces[outcome.winner]] + ' won by forfeit.' : 'Both players disconnected.'
  }
  element('result-detail').textContent = detail
  drawMatchStats(element('match-stats'), room?.report, playerRaces)
  if (!result.open) result.showModal()
}

function leave() {
  if (solo.active) solo.leave()
  else {
    client.send({ type: 'leave' })
    client.clear()
  }
  showLobby()
}

function toggleAdvance() {
  if (!scene || button('advance').disabled) return
  scene.advanceMode = !scene.advanceMode
  button('advance').setAttribute('aria-pressed', String(scene.advanceMode))
}

for (const item of factionButtons) {
  item.onclick = () => {
    const choice = item.dataset.faction
    if (!isRace(choice)) return
    explicitRace = true
    if (room) client.send({ type: 'race', race: choice })
    else selectRace(choice)
  }
}
button('solo').onclick = () => {
  const opponent = opponentChoice.value
  if (!client.hasSeat) solo.start(chosenRace === 'orc' ? 'orc' : 'human', solo.saved,
    element<HTMLSelectElement>('solo-difficulty').value as Difficulty, matchSettings, chosenRace, isRace(opponent) ? opponent : undefined)
}
button('create').onclick = () => client.send({ type: 'create', race: chosenRace, settings: matchSettings })
button('match-settings').onclick = () => {
  if (room) {
    settingsMenu.show(room.settings ?? matchSettings, room.host === faction ? settings => {
      client.send({ type: 'settings', settings })
    } : undefined)
  } else {
    settingsMenu.show(matchSettings, settings => {
      matchSettings = settings
      settingsMenu.remember(settings)
    })
  }
}
element<HTMLFormElement>('join-form').onsubmit = event => {
  event.preventDefault()
  client.send({ type: 'join', code: joinCode.value.trim().toUpperCase(), ...(explicitRace ? { race: chosenRace } : { faction: 'human' }) })
}
button('ready').onclick = () => client.send({ type: 'ready', ready: !room?.players.find(seat => seat.faction === faction)?.ready })
button('copy').onclick = async () => {
  if (!room) return
  const url = new URL(location.pathname, location.origin)
  url.searchParams.set('room', room.code)
  try {
    await navigator.clipboard.writeText(url.href)
    note('Invite copied.')
  } catch {
    note('Share this room code · ' + room.code)
  }
}
button('leave').onclick = leave
button('return').onclick = leave
button('exit').onclick = () => {
  const prompt = room?.mode === 'solo' ? 'End this solo match?' : 'Leave the battle and forfeit?'
  if (room?.phase === 'finished' || window.confirm(prompt)) leave()
}
button('advance').onclick = toggleAdvance
button('halt').onclick = () => scene?.halt()
button('home').onclick = () => scene?.home()
function drawSoundButton() {
  button('sound').setAttribute('aria-pressed', String(audio.enabled))
  button('sound').setAttribute('aria-label', audio.enabled ? 'Mute sound' : 'Enable sound')
  button('sound').textContent = audio.enabled ? 'Sound on' : 'Sound off'
}

drawSoundButton()
button('sound').onclick = () => {
  audio.toggle()
  drawSoundButton()
}
function unlockSound(event: Event) {
  if (event.target !== button('sound')) void audio.unlock()
}
document.addEventListener('click', unlockSound, { capture: true })
document.addEventListener('keydown', unlockSound, { capture: true })
button('map-button').addEventListener('pointerdown', event => {
  const bounds = minimap.getBoundingClientRect()
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  scene?.minimapFocus(clamp((event.clientX - bounds.left) / bounds.width),
    clamp((event.clientY - bounds.top) / bounds.height))
})
button('map-button').addEventListener('click', event => {
  if (event.detail === 0) scene?.minimapFocus(0.5, 0.5)
})
result.oncancel = event => event.preventDefault()
window.addEventListener('keydown', event => {
  if (!scene || result.open || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
  switch (event.key.toLowerCase()) {
    case 'i': scene.selectIdleWorker(); break
    case 'q': scene.selectAll(); break
    case 'a': toggleAdvance(); break
    case 's': scene.halt(); break
    case 'h': scene.home(); break
  }
})
