import Phaser from 'phaser'
import { buildingKinds, entityNames, factionNames, isFaction, isUnitKind, resourceKinds, upgradeKinds } from '../shared/protocol.ts'
import type { Entity, EntityKind, Faction, Order, Population, ResourceKind, Resources, RoomState, ServerMessage, UpgradeKind } from '../shared/protocol.ts'
import type { Cost } from '../shared/economy.ts'
import { buildings, canAfford, FARM_POPULATION, trainedAt, training, TRAINING_QUEUE_LIMIT, upgrades } from '../shared/economy.ts'
import { unitStats } from '../shared/units.ts'
import { BattleAudio } from './audio.ts'
import { BattleScene } from './battle.ts'
import { ConnectionClient } from './network.ts'
import { SoloClient } from './solo.ts'
import { entityTexture } from './sprites.ts'
import './style.css'

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const button = (id: string) => element<HTMLButtonElement>(id)
const lobby = element('lobby')
const match = element('match')
const battlefield = element('battlefield')
const portrait = element<HTMLCanvasElement>('selection-portrait')
const minimap = element<HTMLCanvasElement>('minimap')
const joinCode = element<HTMLInputElement>('join-code')
const connection = element('connection')
const lobbyMessage = element('lobby-message')
const result = element<HTMLDialogElement>('result')
const banner = element('banner')
const menu = element('economy-menu')
const economyAction = button('economy-action')
const productionPanel = element('production-panel')
const productionToggle = button('production-toggle')
const placementTip = element('placement-tip')
const factionButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-faction]')]
const audio = new BattleAudio()
const touch = matchMedia('(pointer: coarse)').matches

let faction: Faction = 'human'
let room: RoomState | null = null
let scene: BattleScene | null = null
let game: Phaser.Game | null = null
let orderMessageTimer: number | undefined
let resources: Resources = { gold: 0, wood: 0, stone: 0 }
let ownEntities: Entity[] = []
let researched: UpgradeKind[] = []
let population: Population = { used: 0, reserved: 0, limit: 0 }
const choiceRules = new WeakMap<HTMLButtonElement, { cost: Cost, population: number, upgrade?: UpgradeKind }>()
let selection: Entity[] = []
let placing = false
let economyContext = ''

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
  else banner.textContent = factionNames[faction] + (room?.mode === 'solo' ? ' vs Computer' : '') +
    ' · Destroy the enemy headquarters'
}

function setFaction(choice: Faction) {
  faction = choice
  for (const item of factionButtons) item.setAttribute('aria-pressed', String(item.dataset.faction === faction))
}

function showLobby() {
  result.close()
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
      setFaction(message.faction)
      break
    case 'room':
      room = message.room
      setFaction(message.faction)
      if (room.phase === 'lobby') drawLobby()
      else {
        if (!scene) showBattle()
        updateBanner(client.connected)
        if (room.result) drawResult(room.result)
      }
      break
    case 'snapshot':
      resources = message.resources
      population = message.population
      ownEntities = message.entities.filter(entity => entity.faction === faction)
      researched = message.upgrades ?? []
      drawProduction()
      drawEconomy()
      const idle = message.entities.filter(entity => entity.faction === faction && entity.idle).length
      button('idle-worker').disabled = idle === 0
      setText('idle-count', String(idle))
      scene?.snapshot(message)
      break
    case 'error':
      if (message.resetSession) showLobby()
      if (scene) {
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
  for (const item of factionButtons) item.disabled = room.players.length > 1
  const mine = room.players.find(seat => seat.faction === faction)
  button('ready').textContent = mine?.ready ? 'Cancel ready' : 'Ready'
  const rows = room.players.map(seat => {
    const row = document.createElement('div')
    row.className = 'seat ' + seat.faction
    const name = document.createElement('span')
    const state = document.createElement('span')
    name.textContent = factionNames[seat.faction] + (seat.faction === faction ? ' · You' : '')
    state.textContent = !seat.connected ? 'Disconnected' : seat.ready ? 'Ready' : 'Preparing'
    row.append(name, state)
    return row
  })
  element('seats').replaceChildren(...rows)
  note(room.players.length === 1 ? 'Share the invite or room code with your opponent.' : 'The match starts when both players are ready.')
}

function showBattle() {
  lobby.hidden = true
  match.hidden = false
  match.dataset.faction = faction
  button('advance').setAttribute('aria-pressed', 'false')
  scene = new BattleScene(faction, battlefield, minimap, {
    order: issueOrder,
    selection: drawSelection,
    placement: (kind, blocked) => {
      placing = Boolean(kind)
      placementTip.hidden = !kind
      if (!kind) return
      const action = kind === 'wall' ? 'Drag to queue a wall line, or tap a tile.' : 'Tap each tile to queue another.'
      element('placement-message').textContent = blocked ? 'Choose visible, open ground.' : entityNames[faction][kind] + ' · ' + action
    },
    effect: kind => audio.play(kind)
  })
  button('idle-worker').disabled = true
  setText('idle-count', '0')
  scene.advanceMode = false
  resources = { gold: 0, wood: 0, stone: 0 }
  ownEntities = []
  researched = []
  toggleProduction(false)
  drawProduction()
  population = { used: 0, reserved: 0, limit: 0 }
  drawEconomy()
  placementTip.hidden = true
  placing = false
  closeEconomyMenu()
  drawSelection([])
  game = new Phaser.Game({
    type: Phaser.AUTO,
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

function paintPortrait(target: HTMLCanvasElement, side: Faction, kind: EntityKind) {
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

function issueOrder(ids: number[], order: Order) {
  if (solo.active) solo.command(ids, order)
  else client.send({ type: 'command', ids, order })
  audio.play('order')
}

function drawSelection(entities: Entity[], interactive = false) {
  selection = entities
  const selected = entities[0]
  const workers = entities.some(entity => entity.kind === 'worker')
  const trainer = entities.length === 1 && selected && selected.construction === undefined &&
    trainedAt(selected.kind).length ? selected : undefined
  const smithy = entities.length === 1 && selected?.kind === 'smithy' && selected.construction === undefined
  const nextContext = workers ? 'build' : trainer ? 'train:' + trainer.id : smithy ? 'research:' + selected.id : ''
  const changed = nextContext !== economyContext
  economyContext = nextContext
  economyAction.hidden = !nextContext
  economyAction.textContent = workers ? 'Build' : smithy ? 'Upgrade' : 'Train'
  if (!nextContext) closeEconomyMenu()
  else if (changed || interactive) openEconomyMenu(changed)
  else if (!menu.hidden) updateEconomyOptions()
  const label = element('selection-name')
  const detail = element('selection-detail')
  const meter = element<HTMLMeterElement>('selection-health')
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
  paintPortrait(portrait, selected.faction, selected.kind)
  const hp = entities.reduce((total, entity) => total + entity.hp, 0)
  const totalHp = entities.reduce((total, entity) => total + entity.maxHp, 0)
  const stats = unitStats[selected.faction][selected.kind]
  meter.value = hp / totalHp * 100
  if (entities.length === 1) {
    label.textContent = entityNames[selected.faction][selected.kind]
    if (selected.construction !== undefined) detail.textContent = constructionSummary(selected)
    else if (selected.research) detail.textContent = upgrades[selected.research.kind].name + ' · ' + percentage(selected.research.progress)
    else if (selected.training) {
      detail.textContent = trainingSummary(selected.training)
    } else if (selected.kind === 'worker') {
      detail.textContent = selected.carrying ? `Carrying ${selected.carrying} to the hall.` : selected.idle ? 'Idle · ' + gatherHint() : gatherHint()
    } else if (selected.kind === 'farm') detail.textContent = `+${FARM_POPULATION} population · ${hp}/${totalHp} HP`
    else detail.textContent = stats.damage ? `${hp}/${totalHp} HP · ${stats.damage} damage` : `${hp}/${totalHp} HP`
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
}

function updateEconomyOptions() {
  const full = (selection[0]?.training?.remaining ?? 0) >= TRAINING_QUEUE_LIMIT
  const available = population.limit - population.used - population.reserved
  let needsFarm = false
  for (const choice of menu.querySelectorAll<HTMLButtonElement>('button')) {
    const rule = choiceRules.get(choice)
    if (!rule) continue
    const needsSpace = rule.population > 0 && rule.population > available
    needsFarm ||= needsSpace
    const unavailable = rule.upgrade && (researched.includes(rule.upgrade) ||
      Boolean(selection[0]?.research) || ownEntities.some(entity => entity.research?.kind === rule.upgrade))
    choice.disabled = Boolean(unavailable) || full || needsSpace || !canAfford(resources, rule.cost)
    if (rule.upgrade) choice.title = researched.includes(rule.upgrade) ? 'Researched' : ''
  }
  const hint = menu.querySelector<HTMLElement>('.economy-hint')
  if (hint) hint.hidden = !needsFarm
}

function economyChoice(kind: EntityKind, cost: Cost, population: number, act: () => void, upgrade?: UpgradeKind) {
  const choice = document.createElement('button')
  choice.type = 'button'
  choiceRules.set(choice, { cost, population, upgrade })
  const prices = resourceKinds.flatMap(kind => cost[kind] ? [`${cost[kind]} ${kind}`] : [])
  if (population > 1) prices.push(`${population} pop`)
  const name = upgrade ? upgrades[upgrade].name : entityNames[faction][kind]
  choice.setAttribute('aria-label', [name, ...prices].join(' · '))
  const icon = document.createElement('canvas')
  icon.width = icon.height = 36
  icon.setAttribute('aria-hidden', 'true')
  paintPortrait(icon, faction, kind)
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
    if (scene?.gatherNearest(resource)) closeEconomyMenu()
    else receive({ type: 'error', message: 'Explore a source of ' + resource + ' first.' })
  }
  return choice
}

function buildChoices() {
  const gathering = document.createElement('div')
  gathering.className = 'gather-choices'
  gathering.append(gatherChoice('gold', 'Mine gold'), gatherChoice('wood', 'Chop wood'), gatherChoice('stone', 'Quarry stone'))
  return [gathering, ...buildingKinds.map(kind => economyChoice(kind, buildings[kind].cost, 0, () => {
    closeEconomyMenu()
    scene?.place(kind)
  }))]
}

function openEconomyMenu(rebuild = false) {
  if (!economyContext || placing) return
  if (rebuild) {
    if (economyContext === 'build') menu.replaceChildren(...buildChoices())
    else if (economyContext.startsWith('research:')) {
      const smith = selection[0]
      menu.replaceChildren(...upgradeKinds.map(kind => economyChoice('smithy', upgrades[kind].cost, 0, () =>
        issueOrder([smith.id], { kind: 'upgrade', upgrade: kind }), kind)))
    } else {
      const building = selection[0]
      if (!building) return
      const hint = document.createElement('small')
      hint.className = 'economy-hint'
      hint.textContent = 'Build a farm to raise your population limit.'
      menu.replaceChildren(...trainedAt(building.kind).map(kind =>
        economyChoice(kind, { gold: training[kind].gold }, training[kind].population, () =>
          issueOrder([building.id], { kind: 'train', unit: kind }))), hint)
    }
  }
  updateEconomyOptions()
  toggleProduction(false)
  menu.hidden = false
  economyAction.setAttribute('aria-expanded', 'true')
}

economyAction.onclick = () => {
  if (placing) scene?.place(null)
  if (menu.hidden) openEconomyMenu()
  else closeEconomyMenu()
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
  const names = entityNames[faction]
  const waiting = training.queue?.slice(1).map(kind => names[kind]) ?? []
  const active = names[training.kind] + ' · ' + percentage(training.progress)
  return waiting.length ? active + ' → ' + waiting.join(', ') : active
}

function toggleProduction(open: boolean) {
  productionPanel.hidden = !open
  productionToggle.setAttribute('aria-expanded', String(open))
  if (open) {
    closeEconomyMenu()
    drawProduction()
  }
}

function drawProduction() {
  const rows: string[] = []
  let count = 0
  for (const entity of ownEntities) {
    const name = entityNames[faction][entity.kind]
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
  element('result-detail').textContent = outcome.reason === 'headquarters'
    ? outcome.winner ? factionNames[outcome.winner] + ' destroyed the enemy headquarters.' : 'Both headquarters fell.'
    : outcome.winner ? factionNames[outcome.winner] + ' won by forfeit.' : 'Both players disconnected.'
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
    if (!isFaction(choice)) return
    if (room) client.send({ type: 'faction', faction: choice })
    else setFaction(choice)
  }
}
button('solo').onclick = () => {
  if (!client.hasSeat) solo.start(faction, solo.saved)
}
button('create').onclick = () => client.send({ type: 'create', faction })
element<HTMLFormElement>('join-form').onsubmit = event => {
  event.preventDefault()
  client.send({ type: 'join', code: joinCode.value.trim().toUpperCase(), faction })
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
button('all').onclick = () => scene?.selectAll()
button('advance').onclick = toggleAdvance
button('halt').onclick = () => scene?.halt()
button('home').onclick = () => scene?.home()
button('sound').onclick = async () => {
  const enabled = await audio.toggle()
  button('sound').setAttribute('aria-pressed', String(enabled))
  button('sound').setAttribute('aria-label', enabled ? 'Mute sound' : 'Enable sound')
  button('sound').textContent = enabled ? 'Sound on' : 'Sound off'
}
button('map-button').addEventListener('pointerdown', event => {
  const bounds = minimap.getBoundingClientRect()
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  scene?.minimapFocus(clamp((event.clientX - bounds.left) / bounds.width), clamp((event.clientY - bounds.top) / bounds.height))
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
