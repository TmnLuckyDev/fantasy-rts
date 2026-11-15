import { isFaction } from '../shared/protocol.ts'
import type { Faction, Order, ServerMessage } from '../shared/protocol.ts'
import type { SoloInput, SoloOutput, SoloSave } from './solo.worker.ts'

const key = 'ash-and-iron-solo'
const activeKey = 'ash-and-iron-solo-active'
type Slot = { version: 1, owner: string, save: SoloSave | null }

function readSlot(): Slot | null {
  try {
    const slot = JSON.parse(localStorage.getItem(key) ?? 'null') as Slot | null
    return slot?.version === 1 && (!slot.save || isFaction(slot.save.faction)) ? slot : null
  } catch {
    return null
  }
}

export class SoloClient {
  private worker: Worker | null = null
  private owner = ''
  private storageAvailable = false

  constructor(private receive: (message: ServerMessage) => void, private changed: () => void) {
    document.addEventListener('visibilitychange', () => this.post({ type: 'pause', paused: document.hidden }))
    window.addEventListener('pagehide', () => this.post({ type: 'pause', paused: true }))
    window.addEventListener('pageshow', () => this.post({ type: 'pause', paused: document.hidden }))
    window.addEventListener('storage', event => {
      if (event.key !== key) return
      if (this.active && this.storageAvailable && readSlot()?.owner !== this.owner) this.replaced()
      this.changed()
    })
  }

  get active() { return Boolean(this.worker) }
  get saved() { return Boolean(readSlot()?.save) }
  get restoreOnReload() {
    try { return this.saved && sessionStorage.getItem(activeKey) === '1' } catch { return false }
  }

  start(faction: Faction, resume: boolean) {
    if (this.worker) return
    const save = resume ? readSlot()?.save ?? null : null
    this.worker = new Worker(new URL('./solo.worker.ts', import.meta.url), { type: 'module' })
    this.worker.addEventListener('message', (event: MessageEvent<SoloOutput>) => {
      const message = event.data
      if (message.type === 'save') {
        if (!this.storageAvailable) return
        if (readSlot()?.owner !== this.owner) this.replaced()
        else if (!this.write(message.save)) this.storageError()
      } else {
        if (message.type === 'error' && message.resetSession) this.leave()
        this.receive(message)
      }
    })
    this.worker.addEventListener('error', () => {
      this.stop()
      this.receive({ type: 'error', message: 'The solo game could not run. Try opening it again.', resetSession: true })
    })
    this.owner = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-')
    this.storageAvailable = this.write(save)
    try { sessionStorage.setItem(activeKey, '1') } catch { /* Storage may be restricted. */ }
    this.post({ type: 'start', faction, save, paused: document.hidden })
    if (!this.storageAvailable) this.storageError()
  }

  command(ids: number[], order: Order) { this.post({ type: 'command', ids, order }) }

  leave() {
    try { if (readSlot()?.owner === this.owner) localStorage.removeItem(key) } catch { /* Storage may be restricted. */ }
    this.stop()
    this.changed()
  }

  private stop() {
    this.worker?.terminate()
    this.worker = null
    try { sessionStorage.removeItem(activeKey) } catch { /* Storage may be restricted. */ }
  }

  private replaced() {
    this.stop()
    this.receive({ type: 'error', message: 'This solo match is open in another tab.', resetSession: true })
  }

  private write(save: SoloSave | null) {
    try {
      localStorage.setItem(key, JSON.stringify({ version: 1, owner: this.owner, save } satisfies Slot))
      return true
    } catch { return false }
  }

  private storageError() {
    this.storageAvailable = false
    this.receive({ type: 'error', message: 'This browser could not save solo progress.' })
  }

  private post(message: SoloInput) { this.worker?.postMessage(message) }
}
