import { applyDelta, deltaProtocol } from '../shared/snapshot-delta.ts'
import type { SnapshotDelta } from '../shared/snapshot-delta.ts'
import type { ClientMessage, Faction, ServerMessage, Snapshot } from '../shared/protocol.ts'

import { socketUrl } from './multiplayer-endpoint.ts'

type Connection = 'idle' | 'waiting' | 'open' | 'closed'
type SavedSeat = { code: string, token: string, faction: Faction }

export class ConnectionClient {
  private socket: WebSocket | null = null
  private active = true
  private delay = 500
  private retry: number | undefined
  private seat: SavedSeat | null = null
  private started = false
  private pending: ClientMessage | undefined

  constructor(
    private receive: (message: ServerMessage) => void,
    private status: (connection: Connection) => void,
    private backend?: string,
    defer = false
  ) {
    try {
      const saved = JSON.parse(sessionStorage.getItem('ash-and-iron-seat') ?? 'null') as SavedSeat | null
      if (saved && new URLSearchParams(location.search).get('room') !== saved.code &&
          new URLSearchParams(location.search).has('room')) this.clear()
      else this.seat = saved
    } catch { /* Storage is optional. */ }
    window.addEventListener('online', () => this.connect())
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.socket?.readyState !== WebSocket.OPEN) this.connect()
    })
    this.started = !defer || Boolean(this.seat)
    if (this.started) this.connect()
    else this.status('idle')
  }

  sendLobby(message: ClientMessage) {
    if (this.connected) { this.send(message); return }
    this.started = true
    this.pending = message
    this.connect()
  }

  cancelPendingLobby() { this.pending = undefined }

  get hasSeat() { return Boolean(this.seat) }

  get connected() { return this.socket?.readyState === WebSocket.OPEN }

  send(message: ClientMessage) {
    if (this.connected) this.socket?.send(JSON.stringify(message))
  }

  clear() {
    this.seat = null
    try { sessionStorage.removeItem('ash-and-iron-seat') } catch { /* Storage is optional. */ }
  }

  setAppActive(active: boolean) {
    if (active === this.active) return
    this.active = active
    if (active) {
      this.connect()
    } else {
      window.clearTimeout(this.retry)
      const socket = this.socket
      this.socket = null
      socket?.close()
      this.status('closed')
    }
  }

  reconnect() {
    if (this.connected) return
    const socket = this.socket
    this.socket = null
    socket?.close()
    this.connect()
  }

  private connect() {
    if (!this.active || !this.started) return
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return
    window.clearTimeout(this.retry)
    this.status('waiting')
    const url = socketUrl(location.href, this.backend)
    let base: Snapshot | undefined
    const socket = new WebSocket(url, deltaProtocol)
    this.socket = socket
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      this.delay = 500
      if (this.seat) this.send({ type: 'resume', code: this.seat.code, token: this.seat.token })
      this.status('open')
      const pending = this.pending
      this.pending = undefined
      if (pending && !this.seat) this.send(pending)
    })
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return
      const message = JSON.parse(String(event.data)) as ServerMessage | SnapshotDelta
      if (message.type === 'delta') {
        const next = applyDelta(base, message)
        if (!next) {
          socket.close(4001, 'Snapshot base changed')
          return
        }
        base = next
        this.receive(next)
        return
      }
      if (message.type === 'snapshot') base = message
      if (message.type === 'session') {
        base = undefined
        this.seat = { code: message.code, token: message.token, faction: message.faction }
        try { sessionStorage.setItem('ash-and-iron-seat', JSON.stringify(this.seat)) } catch { /* Storage is optional. */ }
      }
      if (message.type === 'error' && message.resetSession) this.clear()
      this.receive(message)
    })
    socket.addEventListener('close', event => {
      if (this.socket !== socket) return
      this.status('closed')
      if (event.code === 4000) {
        this.clear()
        this.receive({ type: 'error', message: 'This seat is active in another tab.', resetSession: true })
      }
      this.retry = window.setTimeout(() => this.connect(), this.delay)
      this.delay = Math.min(this.delay * 2, 5000)
    })
  }
}
