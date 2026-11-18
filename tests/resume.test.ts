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

function activeRoom() {
  const rooms = new Rooms()
  const host = peer()
  const guest = peer()
  const now = Date.now()
  rooms.handle(host.socket, { type: 'create', faction: 'human' }, now)
  const { code } = host.messages.find(message => message.type === 'session')!
  rooms.handle(guest.socket, { type: 'join', faction: 'orc', code }, now)
  const invite = guest.messages.find(message => message.type === 'session')!
  rooms.handle(host.socket, { type: 'ready', ready: true }, now)
  rooms.handle(guest.socket, { type: 'ready', ready: true }, now)
  return { rooms, host, guest, now, invite }
}

test('a disconnected player sees a 45-second grace period and can resume before it ends', () => {
  const { rooms, host, guest, now, invite } = activeRoom()
  rooms.disconnect(guest.socket, false, now)
  assert.equal(host.messages.filter(message => message.type === 'room').at(-1)?.room.reconnectSeconds, 45)
  rooms.step(now + 30_000)
  assert.equal(host.messages.filter(message => message.type === 'room').at(-1)?.room.reconnectSeconds, 15)
  const returned = peer()
  rooms.handle(returned.socket, { type: 'resume', code: invite.code, token: invite.token }, now + 44_999)
  assert.equal(returned.messages.find(message => message.type === 'snapshot')?.tick, 0)
  assert.equal(returned.messages.find(message => message.type === 'room')?.room.paused, false)
  rooms.step(now + 45_050)
  rooms.step(now + 45_100)
  assert.equal(returned.messages.filter(message => message.type === 'snapshot').at(-1)?.tick, 2)
})

test('a reconnect timeout awards the connected player and clears an abandoned match', () => {
  const active = activeRoom()
  active.rooms.disconnect(active.guest.socket, false, active.now)
  active.rooms.step(active.now + 45_000)
  assert.deepEqual(active.rooms.checkpoint()[0].match.result, { winner: 'human', reason: 'disconnect' })
  const abandoned = activeRoom()
  abandoned.rooms.disconnect(abandoned.guest.socket, false, abandoned.now)
  abandoned.rooms.disconnect(abandoned.host.socket, false, abandoned.now + 1_000)
  abandoned.rooms.step(abandoned.now + 45_000)
  assert.deepEqual(abandoned.rooms.checkpoint(), [])
})

test('both players must vote to rematch with the same settings and fresh commands', () => {
  const previous = activeRoom()
  const { host, guest, now } = previous
  const [saved] = previous.rooms.checkpoint()
  saved.match.result = { winner: 'human', reason: 'headquarters' }
  saved.finishedAt = now
  const rooms = new Rooms()
  rooms.restore([saved], now)
  for (const [index, player] of [host, guest].entries()) {
    rooms.handle(player.socket, { type: 'resume', code: saved.code, token: saved.seats[index].token }, now)
  }
  rooms.handle(host.socket, { type: 'rematch' }, now)
  assert.deepEqual(host.messages.filter(message => message.type === 'room').at(-1)?.room.rematchReady, ['human'])
  assert.ok(rooms.checkpoint()[0].match.result)
  rooms.handle(guest.socket, { type: 'rematch' }, now)
  const restarted = rooms.checkpoint()[0]
  assert.equal(restarted.match.result, null)
  assert.equal(restarted.match.tick, 0)
  assert.deepEqual(restarted.match.settings, saved.match.settings)
  assert.deepEqual(restarted.match.races, saved.match.races)
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
