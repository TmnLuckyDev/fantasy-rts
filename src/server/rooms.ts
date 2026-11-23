import { defaultMatchSettings } from '../shared/match-settings.ts'
import type { MatchSettings } from '../shared/match-settings.ts'
import { randomBytes, randomInt } from 'node:crypto'
import { WebSocket } from 'ws'
import { defaultRaces, opposite } from '../shared/protocol.ts'
import type { ClientMessage, Faction, Race, RoomState, ServerMessage, Snapshot } from '../shared/protocol.ts'
import { deltaProtocol, makeDelta } from '../shared/snapshot-delta.ts'
import { Match } from './match.ts'
import type { MatchCheckpoint } from './match.ts'
import { ComputerOpponent } from './computer.ts'
import type { ComputerCheckpoint } from './computer.ts'

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const reconnectWindow = 45_000
const roomLimit = 40
const lobbyLifetime = 30 * 60_000
const resultLifetime = 5 * 60_000

type Seat = {
  faction: Faction
  race: Race
  ready: boolean
  token: string
  peer: WebSocket | null
  disconnectedAt: number
}
type Room = {
  code: string
  seats: Seat[]
  settings: MatchSettings
  match: Match | null
  computer: ComputerOpponent | null
  reconnectSeconds?: number
  rematchReady?: Set<Faction>
  rematchOptions?: Pick<Extract<ClientMessage, { type: 'rematch' }>, 'map' | 'swap'>
  updatedAt: number
  finishedAt: number
}
export type SavedRoom = {
  code: string
  seats: Array<Pick<Seat, 'faction' | 'ready' | 'token'> & { race?: Race }>
  match: MatchCheckpoint
  computer?: ComputerCheckpoint
  finishedAt: number
}
type Session = { room: Room, seat: Seat }

const send = (peer: WebSocket | null, message: ServerMessage) => {
  if (peer?.readyState === WebSocket.OPEN && peer.bufferedAmount < 256_000) peer.send(JSON.stringify(message))
}

export class Rooms {
  private rooms = new Map<string, Room>()
  private queue = new Map<WebSocket, Race>()
  private sessions = new Map<WebSocket, Session>()
  private revealed = new WeakSet<WebSocket>()
  private snapshots = new WeakMap<WebSocket, Snapshot>()

  checkpoint(): SavedRoom[] {
    return [...this.rooms.values()].flatMap(room => room.match ? [{
      code: room.code,
      seats: room.seats.map(({ faction, race, ready, token }) => ({ faction, race, ready, token })),
      match: room.match.checkpoint(),
      computer: room.computer?.checkpoint(),
      finishedAt: room.finishedAt
    }] : [])
  }

  restore(saved: SavedRoom[], now = Date.now()) {
    const restored = new Map<string, Room>()
    for (const room of saved) {
      if (room.match.result && now - room.finishedAt > resultLifetime) continue
      const match = Match.restore(room.match)
      const computer = room.computer
        ? new ComputerOpponent(opposite(room.seats[0].faction), match.map, room.computer.difficulty, room.computer.strategy) : null
      if (computer && room.computer) computer.restore(room.computer)
      const seats = room.seats.map(seat => ({ ...seat, race: match.races[seat.faction], peer: null, disconnectedAt: now }))
      restored.set(room.code, { ...room, match, computer, seats, settings: match.settings, updatedAt: now })
    }
    this.rooms = restored
  }

  handle(peer: WebSocket, message: ClientMessage, now = Date.now()) {
    const session = this.sessions.get(peer)
    if (message.type === 'cancel-queue') {
      this.queue.delete(peer)
      send(peer, { type: 'queue-status', waiting: false })
      return
    }
    if (message.type === 'queue') {
      if (!session) this.enqueue(peer, message.race, now)
      return
    }
    if (message.type === 'resume' || message.type === 'create' || message.type === 'solo' || message.type === 'join') this.queue.delete(peer)
    if (message.type === 'resume') {
      if (session) return
      const room = this.rooms.get(message.code)
      if (room) this.expireDisconnected(room, now)
      const seat = room && this.rooms.has(room.code) ? room.seats.find(candidate => candidate.token === message.token) : undefined
      if (!room || !seat) {
        send(peer, { type: 'error', message: 'This room is no longer available.', resetSession: true })
        return
      }
      if (seat.peer) {
        const previous = seat.peer
        this.sessions.delete(previous)
        previous.close(4000, 'Session replaced')
      }
      this.attach(peer, room, seat, now)
      return
    }
    if (message.type === 'create' || message.type === 'solo' || message.type === 'join') {
      if (session) return
      if (message.type === 'join') {
        const room = this.rooms.get(message.code)
        if (!room || room.match || room.seats.length >= 2) {
          send(peer, { type: 'error', message: 'Room is unavailable or already full.' })
          return
        }
        const preferred = message.faction ?? 'human'
        const faction = room.seats.some(seat => seat.faction === preferred) ? opposite(preferred) : preferred
        this.join(peer, room, faction, message.race ?? faction)
      } else {
        const race = message.race ?? message.faction ?? 'human'
        const faction = message.faction ?? (race === 'orc' ? 'orc' : 'human')
        const room = this.createRoom(faction, race, message.type === 'solo', now, message.settings, message.opponentRace)
        if (!room) send(peer, { type: 'error', message: 'Server is full. Try again shortly.' })
        else this.join(peer, room, faction, race)
      }
      return
    }
    if (!session) return
    const { room, seat } = session
    if (message.type === 'leave') {
      this.disconnect(peer, true, now)
      return
    }
    if (message.type === 'rematch') {
      if (!room.match?.result || room.computer || room.seats.length !== 2 || !room.seats.every(member => member.peer)) return
      const votes = room.rematchReady ??= new Set()
      if (!votes.size) room.rematchOptions = { map: message.map, swap: message.swap }
      votes.add(seat.faction)
      if (votes.size === 2) {
        const map = room.rematchOptions?.map
        const swap = room.rematchOptions?.swap
        if (map && map !== room.settings.map) room.settings = { ...room.settings, map, sources: defaultMatchSettings(map).sources }
        if (swap) for (const member of room.seats) member.faction = opposite(member.faction)
        const races = { ...defaultRaces }
        for (const member of room.seats) races[member.faction] = member.race
        room.match = Match.start(room.settings, races)
        room.rematchOptions = undefined
        room.finishedAt = 0
        room.rematchReady = undefined
        for (const member of room.seats) {
          this.revealed.delete(member.peer!)
          this.snapshots.delete(member.peer!)
        }
        if (swap) for (const member of room.seats) {
          send(member.peer, { type: 'session', code: room.code, token: member.token, faction: member.faction })
        }
        this.broadcastRoom(room, now)
        this.broadcastSnapshot(room)
      } else this.broadcastRoom(room, now)
      return
    }
    if (message.type === 'command' || message.type === 'group-command' || message.type === 'global-train') {
      if (this.paused(room)) {
        send(peer, { type: 'error', message: 'The match is paused until everyone reconnects.' })
        return
      }
      if (!room.match) return
      if (message.type === 'global-train') {
        const error = room.match.trainGlobally(seat.faction, message.unit, message.count)
        if (error) send(peer, { type: 'error', message: error })
        return
      }
      const error = message.type === 'group-command' ?
        room.match.executeGroup(seat.faction, message.group, message.order) :
        room.match.execute(seat.faction, message.ids, message.order)
      if (error) send(peer, { type: 'error', message: error })
      return
    }
    if (room.match) return
    room.updatedAt = now
    if (message.type === 'faction' && seat.faction !== message.faction) {
      const other = room.seats.find(candidate => candidate !== seat)
      if (other) {
        send(peer, { type: 'error', message: 'Choose your faction before the second player joins.' })
        return
      }
      seat.faction = message.faction
      seat.race = message.faction
      seat.ready = false
    }
    if (message.type === 'race' && seat.race !== message.race) {
      seat.race = message.race
      for (const member of room.seats) member.ready = false
    }
    if (message.type === 'settings') {
      if (seat !== room.seats[0]) {
        send(peer, { type: 'error', message: 'Only the host can change match settings.' })
        return
      }
      room.settings = message.settings
      for (const member of room.seats) member.ready = false
    }
    if (message.type === 'ready') seat.ready = message.ready
    if (room.seats.length === 2 && room.seats.every(candidate => candidate.ready && candidate.peer)) {
      const races = { ...defaultRaces }
      for (const member of room.seats) races[member.faction] = member.race
      room.match = Match.start(room.settings, races)
    }
    this.broadcastRoom(room)
    if (room.match) this.broadcastSnapshot(room)
  }

  private enqueue(peer: WebSocket, race: Race, now: number) {
    this.queue.delete(peer)
    const candidate = [...this.queue].find(([other]) => other.readyState === WebSocket.OPEN && !this.sessions.has(other))
    if (!candidate) {
      this.queue.set(peer, race)
      send(peer, { type: 'queue-status', waiting: true })
      return
    }
    const [other, opponent] = candidate
    const settings = { ...defaultMatchSettings('ashford-original'), minutes: 12, populationCap: 120 }
    const room = this.createRoom('human', opponent, false, now, settings)
    if (!room) {
      send(peer, { type: 'error', message: 'Server is full. Try again shortly.' })
      return
    }
    this.queue.delete(other)
    send(other, { type: 'queue-status', waiting: false })
    send(peer, { type: 'queue-status', waiting: false })
    this.join(other, room, 'human', opponent)
    this.join(peer, room, 'orc', race)
    for (const seat of room.seats) seat.ready = true
    room.match = Match.start(settings, { human: opponent, orc: race })
    this.broadcastRoom(room, now)
    this.broadcastSnapshot(room)
  }

  private createRoom(faction: Faction, race: Race, solo: boolean, now: number, settings = defaultMatchSettings(), opponent?: Race) {
    if (this.rooms.size >= roomLimit) return
    let code: string
    do {
      code = Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join('')
    } while (this.rooms.has(code))
    const match = solo ? Match.start(settings, { ...defaultRaces, [faction]: race, [opposite(faction)]: opponent ?? opposite(faction) }) : null
    const computer = match ? new ComputerOpponent(opposite(faction), match.map) : null
    const room: Room = { code, seats: [], match, computer, settings, updatedAt: now, finishedAt: 0 }
    this.rooms.set(code, room)
    return room
  }

  private join(peer: WebSocket, room: Room, faction: Faction, race: Race) {
    const seat: Seat = { faction, race, ready: Boolean(room.computer), token: randomBytes(32).toString('hex'), peer: null, disconnectedAt: 0 }
    room.seats.push(seat)
    room.updatedAt = Date.now()
    this.attach(peer, room, seat)
  }

  private attach(peer: WebSocket, room: Room, seat: Seat, now = Date.now()) {
    seat.peer = peer
    seat.disconnectedAt = 0
    this.sessions.set(peer, { room, seat })
    send(peer, { type: 'session', code: room.code, token: seat.token, faction: seat.faction })
    this.broadcastRoom(room, now)
    this.snapshots.delete(peer)
    this.revealed.delete(peer)
    if (room.match) this.sendSnapshot(peer, room.match.view(seat.faction), Boolean(room.match.result))
  }

  disconnect(peer: WebSocket, explicit = false, now = Date.now()) {
    this.queue.delete(peer)
    const session = this.sessions.get(peer)
    if (!session) return
    this.sessions.delete(peer)
    this.snapshots.delete(peer)
    const { room, seat } = session
    seat.peer = null
    seat.disconnectedAt = now
    room.rematchReady = undefined
    if (explicit && room.computer) {
      this.close(room)
      return
    }
    if (!room.match) {
      seat.ready = false
      if (explicit) room.seats = room.seats.filter(candidate => candidate !== seat)
      if (!room.seats.length) this.rooms.delete(room.code)
    } else if (explicit && !room.match.result) {
      room.match.result = { winner: opposite(seat.faction), reason: 'disconnect' }
      room.finishedAt = now
    }
    this.broadcastRoom(room, now)
  }

  step(now = Date.now()) {
    for (const room of this.rooms.values()) {
      if (!room.match) {
        const seatsBefore = room.seats.length
        room.seats = room.seats.filter(seat => seat.peer || now - seat.disconnectedAt < reconnectWindow)
        if (!room.seats.length || now - room.updatedAt > lobbyLifetime) {
          this.close(room)
        } else if (room.seats.length !== seatsBefore) this.broadcastRoom(room)
        continue
      }
      if (room.match.result) {
        if (now - room.finishedAt > resultLifetime) this.close(room)
        else if (room.seats.some(seat => seat.peer && !this.revealed.has(seat.peer))) this.broadcastSnapshot(room)
        continue
      }
      if (this.paused(room)) {
        if (!this.expireDisconnected(room, now) && this.secondsToReconnect(room, now) !== room.reconnectSeconds) {
          this.broadcastRoom(room, now)
        }
        continue
      }
      room.computer?.think(room.match)
      room.match.step()
      if (room.match.result) {
        room.finishedAt = now
        this.broadcastSnapshot(room)
        this.broadcastRoom(room)
      } else if (room.match.tick % 2 === 0) this.broadcastSnapshot(room)
    }
  }

  private secondsToReconnect(room: Room, now: number) {
    if (!this.paused(room)) return
    const missing = room.seats.filter(seat => !seat.peer)
    const deadline = Math.min(...missing.map(seat => seat.disconnectedAt + reconnectWindow))
    return Math.max(0, Math.ceil((deadline - now) / 1000))
  }

  private expireDisconnected(room: Room, now: number) {
    if (this.secondsToReconnect(room, now) !== 0) return false
    const connected = room.seats.find(seat => seat.peer)
    if (!connected) this.close(room)
    else if (room.match) {
      room.match.result = { winner: connected.faction, reason: 'disconnect' }
      room.finishedAt = now
      this.broadcastSnapshot(room)
      this.broadcastRoom(room, now)
    }
    return true
  }

  private paused(room: Room) {
    return Boolean(room.match && !room.match.result && room.seats.some(seat => !seat.peer))
  }

  private broadcastSnapshot(room: Room) {
    if (!room.match) return
    const snapshot = room.match.snapshot(true)
    const views = new Map<Faction, Snapshot>()
    for (const seat of room.seats) {
      const peer = seat.peer
      if (!peer || peer.readyState !== WebSocket.OPEN || peer.bufferedAmount >= 256_000) continue
      if (room.match.result && this.revealed.has(peer)) continue
      let view = views.get(seat.faction)
      if (!view) {
        view = room.match.view(seat.faction, snapshot)
        views.set(seat.faction, view)
      }
      this.sendSnapshot(peer, view, Boolean(room.match.result))
    }
  }

  private sendSnapshot(peer: WebSocket, view: Snapshot, finished = false) {
    if (peer.readyState !== WebSocket.OPEN || peer.bufferedAmount >= 256_000) return
    if (finished) this.revealed.add(peer)
    if (peer.protocol !== deltaProtocol) {
      peer.send(JSON.stringify(view))
      return
    }
    const previous = this.snapshots.get(peer)
    peer.send(JSON.stringify(previous && previous.tick < view.tick ? makeDelta(previous, view) : view))
    // Skipping a backpressured send above leaves the base at the last sent snapshot.
    this.snapshots.set(peer, view)
  }

  private broadcastRoom(room: Room, now = Date.now()) {
    room.reconnectSeconds = this.secondsToReconnect(room, now)
    const players = room.seats.map(({ faction, race, ready, peer }) => ({ faction, ...(race === faction ? {} : { race }), ready, connected: Boolean(peer) }))
    if (room.computer) {
      const faction = room.computer.faction
      const race = room.match?.races[faction] ?? faction
      players.push({ faction, ...(race === faction ? {} : { race }), ready: true, connected: true })
    }
    const state: RoomState = {
      code: room.code,
      map: room.match?.map.id,
      mapSeed: room.match?.map.seed,
      settings: room.settings,
      host: room.seats[0]?.faction,
      report: room.match?.result ? room.match.report() : undefined,
      mode: room.computer ? 'solo' : 'multiplayer',
      phase: room.match?.result ? 'finished' : room.match ? 'playing' : 'lobby',
      result: room.match?.result ?? null,
      paused: this.paused(room),
      reconnectSeconds: room.reconnectSeconds,
      rematchReady: room.rematchReady ? [...room.rematchReady] : undefined,
      rematchOptions: room.rematchReady?.size ? room.rematchOptions : undefined,
      players
    }
    for (const seat of room.seats) send(seat.peer, { type: 'room', room: state, faction: seat.faction })
  }

  private close(room: Room) {
    this.rooms.delete(room.code)
    for (const seat of room.seats) {
      if (!seat.peer) continue
      this.sessions.delete(seat.peer)
      send(seat.peer, { type: 'error', message: 'This room has expired.', resetSession: true })
    }
  }
}
