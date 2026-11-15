import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import { Match } from '../src/server/match.ts'
import { ComputerOpponent } from '../src/server/computer.ts'
import { Rooms } from '../src/server/rooms.ts'
import { cellCenter } from '../src/shared/map.ts'
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
