import Phaser from 'phaser'
import { buildingKinds, combatKinds, entityNames, factionNames, isFaction, isUnitKind, opposite } from '../shared/protocol.ts'
import type { Entity, Faction, RoomState, ServerMessage, UnitKind } from '../shared/protocol.ts'
import { buildings, training, TRAINING_QUEUE_LIMIT } from '../shared/economy.ts'
import { unitStats } from '../shared/units.ts'
import { BattleAudio } from './audio.ts'
import { BattleScene } from './battle.ts'
import { ConnectionClient } from './network.ts'
import './style.css'

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const button = (id: string) => element<HTMLButtonElement>(id)
const lobby = element('lobby')
const match = element('match')
const battlefield = element('battlefield')
const minimap = element<HTMLCanvasElement>('minimap')
const joinCode = element<HTMLInputElement>('join-code')
const connection = element('connection')
const lobbyMessage = element('lobby-message')
const result = element<HTMLDialogElement>('result')
const banner = element('banner')
const menu = element('economy-menu')
const economyAction = button('economy-action')
const placementTip = element('placement-tip')
const factionButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-faction]')]
const audio = new BattleAudio()
const touch = matchMedia('(pointer: coarse)').matches

let faction: Faction = 'human'
let room: RoomState | null = null
let scene: BattleScene | null = null
let game: Phaser.Game | null = null
let box = false
let orderMessageTimer: number | undefined
let gold = 0
let selection: Entity[] = []
let placing = false
let economyContext = ''

const invite = new URLSearchParams(location.search).get('room')
if (invite && /^[A-Z2-9]{5}$/i.test(invite)) joinCode.value = invite.toUpperCase()

const client = new ConnectionClient(receive, status)

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
  if (!online) banner.textContent = 'Reconnecting to match…'
  else if (room?.players.some(seat => seat.faction === opposite(faction) && !seat.connected)) banner.textContent = 'Opponent disconnected · 45s to return'
  else banner.textContent = factionNames[faction] + ' · Destroy the enemy headquarters'
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
  element('lobby-title').textContent = 'Multiplayer lobby'
  element('room-actions').hidden = true
  element('entry-actions').hidden = false
  for (const item of factionButtons) item.disabled = false
  history.replaceState(null, '', location.pathname)
  note('Choose a faction and invite an opponent.')
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
      gold = message.gold[faction]
      element('gold').textContent = String(gold)
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
  box = false
  button('box').setAttribute('aria-pressed', 'false')
  button('advance').setAttribute('aria-pressed', 'false')
  scene = new BattleScene(faction, battlefield, minimap, {
    order: (ids, order) => {
      client.send({ type: 'command', ids, order })
      audio.play('order')
    },
    selection: drawSelection,
    placement: (active, blocked) => {
      placing = active
      placementTip.hidden = !active
      element('placement-message').textContent = blocked ? 'This spot is blocked. Choose open ground.' : 'Choose a clear tile to build on.'
    },
    effect: kind => audio.play(kind)
  })
  scene.advanceMode = false
  gold = 0
  element('gold').textContent = '0'
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

function drawSelection(entities: Entity[]) {
  selection = entities
  const selected = entities[0]
  const workers = entities.some(entity => entity.kind === 'worker')
  const trainer = entities.length === 1 && selected?.construction === undefined &&
    (selected?.kind === 'headquarters' || selected?.kind === 'barracks') ? selected : undefined
  const nextContext = workers ? 'build' : trainer ? 'train:' + trainer.id : ''
  if (nextContext !== economyContext) closeEconomyMenu()
  economyContext = nextContext
  economyAction.hidden = !nextContext
  economyAction.textContent = workers ? 'Build' : 'Train'
  if (!menu.hidden) updateEconomyOptions()
  const label = element('selection-name')
  const detail = element('selection-detail')
  const meter = element<HTMLMeterElement>('selection-health')
  const movable = entities.some(entity => isUnitKind(entity.kind))
  button('advance').disabled = !movable
  button('halt').disabled = !movable
  meter.hidden = !selected
  if (!selected) {
    label.textContent = 'No units selected'
    detail.textContent = touch ? 'Tap a troop or use All troops.' : 'Click or drag to select.'
    return
  }
  const hp = entities.reduce((total, entity) => total + entity.hp, 0)
  const totalHp = entities.reduce((total, entity) => total + entity.maxHp, 0)
  const stats = unitStats[selected.faction][selected.kind]
  meter.value = hp / totalHp * 100
  if (entities.length === 1) {
    label.textContent = entityNames[selected.faction][selected.kind]
    if (selected.construction !== undefined) detail.textContent = 'Building · ' + Math.floor(selected.construction * 100) + '%'
    else if (selected.training) {
      const next = entityNames[faction][selected.training.kind]
      detail.textContent = `${next} · ${Math.floor(selected.training.progress * 100)}% · ${selected.training.remaining} queued`
    } else if (selected.kind === 'worker') {
      detail.textContent = selected.carryingGold ? 'Carrying gold to the hall.' : touch ? 'Tap a gold mine to gather.' : 'Right-click a gold mine to gather.'
    } else detail.textContent = stats.damage ? `${hp}/${totalHp} HP · ${stats.damage} damage` : `${hp}/${totalHp} HP`
  } else {
    const onlyWorkers = entities.every(entity => entity.kind === 'worker')
    label.textContent = `${entities.length} ${onlyWorkers ? 'workers' : 'troops'} selected`
    detail.textContent = onlyWorkers
      ? (touch ? 'Tap a gold mine to gather.' : 'Right-click a gold mine to gather.')
      : (touch ? 'Tap ground to move or an enemy to attack.' : 'Right-click ground to move or an enemy to attack.')
  }
}

function closeEconomyMenu() {
  menu.hidden = true
  economyAction.setAttribute('aria-expanded', 'false')
}

function updateEconomyOptions() {
  const full = economyContext.startsWith('train:') && (selection[0]?.training?.remaining ?? 0) >= TRAINING_QUEUE_LIMIT
  for (const choice of menu.querySelectorAll<HTMLButtonElement>('button')) {
    choice.disabled = full || Number(choice.dataset.gold) > gold
  }
}

function economyChoice(name: string, cost: number, act: () => void) {
  const choice = document.createElement('button')
  choice.type = 'button'
  choice.dataset.gold = String(cost)
  choice.textContent = `${name} · ${cost} gold`
  choice.onclick = act
  return choice
}

economyAction.onclick = () => {
  if (!menu.hidden || placing) {
    closeEconomyMenu()
    scene?.place(null)
    return
  }
  const names = entityNames[faction]
  if (economyContext === 'build') {
    menu.replaceChildren(...buildingKinds.map(kind => economyChoice(names[kind], buildings[kind].gold, () => {
      closeEconomyMenu()
      scene?.place(kind)
    })))
  } else {
    const building = selection[0]
    if (!building) return
    const kinds: readonly UnitKind[] = building.kind === 'headquarters' ? ['worker'] : combatKinds
    menu.replaceChildren(...kinds.map(kind => economyChoice(names[kind], training[kind].gold, () => {
      client.send({ type: 'command', ids: [building.id], order: { kind: 'train', unit: kind } })
      audio.play('order')
    })))
  }
  updateEconomyOptions()
  menu.hidden = false
  economyAction.setAttribute('aria-expanded', 'true')
}

button('workers').onclick = () => scene?.selectWorkers()
button('cancel-placement').onclick = () => scene?.place(null)

function drawResult(outcome: NonNullable<RoomState['result']>) {
  element('result-title').textContent = !outcome.winner ? 'Draw' : outcome.winner === faction ? 'Victory' : 'Defeat'
  element('result-detail').textContent = outcome.reason === 'headquarters'
    ? outcome.winner ? factionNames[outcome.winner] + ' destroyed the enemy headquarters.' : 'Both headquarters fell.'
    : outcome.winner ? factionNames[outcome.winner] + ' won by forfeit.' : 'Both players disconnected.'
  if (!result.open) result.showModal()
}

function leave() {
  client.send({ type: 'leave' })
  client.clear()
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
  if (room?.phase === 'finished' || window.confirm('Leave the battle and forfeit?')) leave()
}
button('all').onclick = () => scene?.selectAll()
button('box').onclick = () => {
  box = !box
  button('box').setAttribute('aria-pressed', String(box))
  scene?.setBoxMode(box)
}
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
    case 'q': scene.selectAll(); break
    case 'a': toggleAdvance(); break
    case 's': scene.halt(); break
    case 'h': scene.home(); break
  }
})
