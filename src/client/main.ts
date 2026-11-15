import Phaser from 'phaser'
import { entityNames, factionNames, isFaction, opposite } from '../shared/protocol.ts'
import type { Entity, Faction, RoomState, ServerMessage } from '../shared/protocol.ts'
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
const factionButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-faction]')]
const audio = new BattleAudio()
const touch = matchMedia('(pointer: coarse)').matches

let faction: Faction = 'human'
let room: RoomState | null = null
let scene: BattleScene | null = null
let game: Phaser.Game | null = null
let box = false
let orderMessageTimer: number | undefined

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
    effect: kind => audio.play(kind)
  })
  scene.advanceMode = false
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
  const selected = entities[0]
  const label = element('selection-name')
  const detail = element('selection-detail')
  const meter = element<HTMLMeterElement>('selection-health')
  const movable = entities.some(entity => entity.kind !== 'headquarters')
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
    detail.textContent = selected.kind === 'headquarters' ? `${hp}/${totalHp} HP · Headquarters` :
      `${hp}/${totalHp} HP · ${stats.damage} damage · ${stats.armor} armor`
  } else {
    label.textContent = `${entities.length} troops selected`
    detail.textContent = touch ? 'Tap ground to move or an enemy to attack.' : 'Right-click ground to move or an enemy to attack.'
  }
}

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
