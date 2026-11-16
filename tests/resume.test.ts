import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import { Match, TICK_HZ } from '../src/server/match.ts'
import { ComputerOpponent } from '../src/server/computer.ts'
import { Rooms } from '../src/server/rooms.ts'
import { cellCenter } from '../src/shared/map.ts'
import { defaultMatchSettings } from '../src/shared/match-settings.ts'
import type { ServerMessage } from '../src/shared/protocol.ts'

function peer() {
  const messages: ServerMessage[] = []
  const socket = {
    readyState: WebSocket.OPEN, bufferedAmount: 0,
    send: (data: string) => messages.push(JSON.parse(data) as ServerMessage)
  } as unknown as WebSocket
  return { messages, socket }
}

test('an active online game pauses and remains resumable long after a disconnect', () => {
  const rooms = new Rooms()
  const host = peer()
  const guest = peer()
  const now = Date.now()
  rooms.handle(host.socket, { type: 'create', faction: 'human' }, now)
  const session = host.messages.find(message => message.type === 'session')!
  rooms.handle(guest.socket, { type: 'join', faction: 'orc', code: session.code }, now)
  const invite = guest.messages.find(message => message.type === 'session')!
  rooms.handle(host.socket, { type: 'ready', ready: true }, now)
  rooms.handle(guest.socket, { type: 'ready', ready: true }, now)
  rooms.disconnect(guest.socket, false, now)
  assert.equal(host.messages.filter(message => message.type === 'room').at(-1)?.room.paused, true)
  for (let i = 0; i < 50; i++) rooms.step(now + 86_400_000 + i * 50)
  const returned = peer()
  rooms.handle(returned.socket, { type: 'resume', code: invite.code, token: invite.token }, now + 86_500_000)
  assert.equal(returned.messages.find(message => message.type === 'snapshot')?.tick, 0)
  assert.equal(returned.messages.find(message => message.type === 'room')?.room.paused, false)
  rooms.step(now + 86_500_050)
  rooms.step(now + 86_500_100)
  assert.equal(returned.messages.filter(message => message.type === 'snapshot').at(-1)?.tick, 2)
})

test('a serialized solo match restores worker tasks, stockpiles and the computer plan', () => {
  const match = new Match()
  const cpu = new ComputerOpponent('orc', match.map)
  assert.equal(match.view('human').entities.find(unit => unit.id === 15)?.idle, true)
  assert.ok(match.command('human', [15], { kind: 'gather', at: cellCenter(5, 18) }))
  for (let i = 0; i < 1590; i++) {
    cpu.think(match)
    match.step()
    match.snapshot(true)
  }
  assert.equal(match.view('human').entities.find(unit => unit.id === 15)?.idle, false)
  const restored = Match.restore(JSON.parse(JSON.stringify(match.checkpoint())))
  const restoredCpu = new ComputerOpponent('orc', restored.map)
  restoredCpu.restore(cpu.checkpoint())
  assert.deepEqual(restored.view('human'), match.view('human'))
  for (let i = 0; i < 1000; i++) {
    cpu.think(match)
    restoredCpu.think(restored)
    match.step()
    restored.step()
    assert.deepEqual(restored.view('human', restored.snapshot(true)), match.view('human', match.snapshot(true)))
  }
})

test('only the host can edit settings, ready resets, and restored rooms share the timed report', () => {
  const rooms = new Rooms()
  const host = peer()
  const guest = peer()
  const now = Date.now()
  const lastRoom = (client: ReturnType<typeof peer>) =>
    client.messages.filter(message => message.type === 'room').at(-1)?.room
  rooms.handle(host.socket, { type: 'create', faction: 'human' }, now)
  const hostSeat = host.messages.find(message => message.type === 'session')!
  rooms.handle(guest.socket, { type: 'join', faction: 'orc', code: hostSeat.code }, now)
  const guestSeat = guest.messages.find(message => message.type === 'session')!
  const settings = defaultMatchSettings('ashford-original')
  settings.minutes = 1
  settings.starting.gold = 888
  rooms.handle(guest.socket, { type: 'settings', settings }, now)
  assert.equal(guest.messages.at(-1)?.type, 'error')
  assert.equal(lastRoom(host)?.settings?.starting.gold, 300)
  rooms.handle(guest.socket, { type: 'ready', ready: true }, now)
  rooms.handle(host.socket, { type: 'settings', settings }, now)
  assert.deepEqual(lastRoom(guest)?.settings, settings)
  assert.ok(lastRoom(guest)?.players.every(player => !player.ready))
  rooms.handle(host.socket, { type: 'ready', ready: true }, now)
  rooms.handle(guest.socket, { type: 'ready', ready: true }, now)
  assert.equal(lastRoom(host)?.map, 'ashford-original')
  const saved = structuredClone(rooms.checkpoint())
  saved[0].match.tick = 60 * TICK_HZ - 1
  const restored = new Rooms()
  restored.restore(saved, now)
  const returnedHost = peer()
  const returnedGuest = peer()
  restored.handle(returnedHost.socket, { type: 'resume', code: hostSeat.code, token: hostSeat.token }, now)
  restored.step(now + 50)
  assert.equal(restored.checkpoint()[0].match.tick, 60 * TICK_HZ - 1)
  restored.handle(returnedGuest.socket, { type: 'resume', code: guestSeat.code, token: guestSeat.token }, now)
  restored.step(now + 100)
  const finished = lastRoom(returnedHost)!
  assert.deepEqual(finished.result, { winner: null, reason: 'time' })
  assert.deepEqual(finished.report, lastRoom(returnedGuest)?.report)
  assert.equal(finished.report?.sides.human.bank.gold, 888)
  assert.equal(finished.report?.elapsedSeconds, 60)
})
