import type { MatchSettings } from '../shared/match-settings.ts'
import { isFaction } from '../shared/protocol.ts'
import type { Difficulty, Faction, Race, PracticeLesson, GlobalTrainCommand, GroupCommand, Order, ServerMessage } from '../shared/protocol.ts'
import type { SoloInput, SoloOutput, SoloSave } from './solo-runtime.ts'

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

type Transport = Pick<Worker, 'postMessage' | 'terminate'>

export class SoloClient {
  private transport: Transport | null = null
  private appActive = true
  private owner = ''
  private practicing = false
  private manualPause = false
  private storageAvailable = false

  constructor(private receive: (message: ServerMessage) => void, private changed: () => void, private allowWorkerFallback = false) {
    document.addEventListener('visibilitychange', () => this.syncPause())
    window.addEventListener('pagehide', () => this.post({ type: 'pause', paused: true }))
    window.addEventListener('pageshow', () => this.syncPause())
    window.addEventListener('storage', event => {
      if (event.key !== key) return
      if (this.active && this.storageAvailable && readSlot()?.owner !== this.owner) this.replaced()
      this.changed()
    })
  }

  get paused() { return this.manualPause }
  togglePause() {
    if (!this.active) return
    this.manualPause = !this.manualPause
    this.syncPause()
    this.changed()
  }

  setAppActive(active: boolean) {
    if (this.appActive === active) return
    this.appActive = active
    this.syncPause()
  }

  private get simulationPaused() { return this.manualPause || document.hidden || !this.appActive }
  private syncPause() { this.post({ type: 'pause', paused: this.simulationPaused }) }

  get active() { return Boolean(this.transport) }
  get practice() { return this.practicing }
  get saved() { return Boolean(readSlot()?.save) }
  get savedMatch() {
    const save = readSlot()?.save
    if (!save?.match) return
    return { map: save.match.settings?.map, tick: save.match.tick, race: save.match.races?.[save.faction] ?? save.faction }
  }
  get restoreOnReload() {
    try { return this.saved && sessionStorage.getItem(activeKey) === '1' } catch { return false }
  }

  start(faction: Faction, resume: boolean, difficulty?: Difficulty, settings?: MatchSettings, race?: Race, opponentRace?: Race, practice = false, lesson?: PracticeLesson) {
    if (this.transport) return
    this.manualPause = false
    this.practicing = practice
    const save = resume && !practice ? readSlot()?.save ?? null : null
    this.owner = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-')
    this.storageAvailable = !practice && this.write(save)
    if (!practice) {
      try { sessionStorage.setItem(activeKey, '1') } catch { /* Storage may be restricted. */ }
    }
    this.startSimulation({ type: 'start', faction, save, difficulty, settings, race, opponentRace, practice, lesson, paused: this.simulationPaused })
    if (!practice && !this.storageAvailable) this.storageError()
  }

  private startSimulation(start: Extract<SoloInput, { type: 'start' }>) {
    let started = false
    const owner = this.owner
    const fail = () => {
      this.stop()
      this.receive({ type: 'error', message: 'The solo game could not run. Try opening it again.', resetSession: true })
    }
    const fallback = () => {
      if (!this.allowWorkerFallback || started) return fail()
      this.transport?.terminate()
      this.transport = { postMessage() {}, terminate() {} }
      void import('./solo-runtime.ts').then(({ createSoloRuntime }) => {
        if (!this.active || this.owner !== owner) return
        // Keep delivery asynchronous, as it is with a Web Worker.
        const runtime = createSoloRuntime(message => queueMicrotask(() => {
          if (this.transport === transport) this.receiveOutput(message)
        }))
        const transport: Transport = {
          postMessage: (message: SoloInput) => runtime.receive(message),
          terminate: runtime.stop
        }
        this.transport = transport
        runtime.receive({ ...start, paused: this.simulationPaused })
      }).catch(() => { if (this.active && this.owner === owner) fail() })
    }
    try {
      const worker = new Worker(new URL('./solo.worker.ts', import.meta.url), { type: 'module' })
      this.transport = worker
      worker.addEventListener('message', (event: MessageEvent<SoloOutput>) => {
        if (this.transport !== worker) return
        if (event.data.type === 'room') started = true
        this.receiveOutput(event.data)
      })
      worker.addEventListener('error', () => { if (this.transport === worker) fallback() })
      worker.postMessage(start)
    } catch {
      fallback()
    }
  }

  private receiveOutput(message: SoloOutput) {
    if (message.type === 'save') {
      if (!this.storageAvailable) return
      if (readSlot()?.owner !== this.owner) this.replaced()
      else if (!this.write(message.save)) this.storageError()
    } else {
      if (message.type === 'error' && message.resetSession) this.leave()
      this.receive(message)
    }
  }

  sendArmyCommand(message: GroupCommand | GlobalTrainCommand) { this.post(message) }

  command(ids: number[], order: Order) { this.post({ type: 'command', ids, order }) }

  leave() {
    try { if (!this.practicing && readSlot()?.owner === this.owner) localStorage.removeItem(key) } catch { /* Storage may be restricted. */ }
    this.stop()
    this.changed()
  }

  private stop() {
    this.transport?.terminate()
    this.transport = null
    this.manualPause = false
    this.practicing = false
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

  private post(message: SoloInput) { this.transport?.postMessage(message) }
}
