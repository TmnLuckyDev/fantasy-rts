import { defaultMatchSettings } from '../shared/match-settings.ts'
import type { MatchSettings } from '../shared/match-settings.ts'
import { ComputerOpponent } from '../server/computer.ts'
import type { ComputerCheckpoint } from '../server/computer.ts'
import { Match, TICK_HZ } from '../server/match.ts'
import type { MatchCheckpoint } from '../server/match.ts'
import { opposite } from '../shared/protocol.ts'
import type { Difficulty, Faction, Race, GlobalTrainCommand, GroupCommand, Order, ServerMessage } from '../shared/protocol.ts'

export type SoloSave = { faction: Faction, match: MatchCheckpoint, computer: ComputerCheckpoint }
export type SoloInput =
  | { type: 'start', faction: Faction, save: SoloSave | null, difficulty?: Difficulty, settings?: MatchSettings, race?: Race, opponentRace?: Race, practice?: boolean, paused: boolean }
  | { type: 'pause', paused: boolean }
  | GroupCommand
  | GlobalTrainCommand
  | { type: 'command', ids: number[], order: Order }
export type SoloOutput = ServerMessage | { type: 'save', save: SoloSave }

let game: { faction: Faction, match: Match, computer: ComputerOpponent } | null = null
let paused = false
let practice = false
const send = (message: SoloOutput) => self.postMessage(message)

function save() {
  if (!game || practice) return
  const { faction, match, computer } = game
  send({ type: 'save', save: { faction, match: match.checkpoint(), computer: computer.checkpoint() } })
}

function announce() {
  if (!game) return
  const { faction, match, computer } = game
  send({ type: 'room', faction, room: {
    code: '', map: match.map.id, mapSeed: match.map.seed, settings: match.settings, report: match.result ? match.report() : undefined, mode: 'solo', difficulty: computer.checkpoint().difficulty, phase: match.result ? 'finished' : 'playing', result: match.result,
    players: [faction, computer.faction].map(side => ({ faction: side, race: match.races[side], ready: true, connected: true }))
  } })
}

self.addEventListener('message', (event: MessageEvent<SoloInput>) => {
  const message = event.data
  if (message.type === 'start') {
    try {
      const faction = message.save?.faction ?? message.faction
      practice = message.practice === true
      const races = {
        human: faction === 'human' ? message.race ?? faction : message.opponentRace ?? 'human',
        orc: faction === 'orc' ? message.race ?? faction : message.opponentRace ?? 'orc'
      }
      const match = message.save ? Match.restore(message.save.match) : practice ? Match.practice(faction, races) :
        Match.start(message.settings ?? defaultMatchSettings(), races)
      const computer = new ComputerOpponent(opposite(faction), match.map, message.save?.computer.difficulty ?? message.difficulty, message.save?.computer.strategy)
      if (message.save) computer.restore(message.save.computer)
      game = { faction, match, computer }
      paused = message.paused
      announce()
      send(match.view(faction))
      save()
    } catch {
      send({ type: 'error', message: 'The saved solo match could not be opened.', resetSession: true })
    }
  } else if (message.type === 'pause') {
    paused = message.paused
    if (paused) save()
  } else if (game && !paused) {
    if (message.type === 'global-train') {
      const error = game.match.trainGlobally(game.faction, message.unit, message.count)
      if (error) send({ type: 'error', message: error })
      else save()
      return
    }
    const accepted = message.type === 'group-command' ? game.match.commandGroup(game.faction, message.group, message.order)
      : game.match.command(game.faction, message.ids, message.order)
    if (accepted) save()
    else send({ type: 'error', message: 'That order cannot be issued.' })
  }
})

setInterval(() => {
  if (!game || paused || game.match.result) return
  const { match, computer, faction } = game
  if (!practice) computer.think(match)
  match.step()
  if (match.tick % 2 === 0 || match.result) send(match.view(faction, match.snapshot(true)))
  if (match.result) announce()
  if (match.tick % TICK_HZ === 0 || match.result) save()
}, 1000 / TICK_HZ)
