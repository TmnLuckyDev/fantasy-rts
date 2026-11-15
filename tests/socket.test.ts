import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '../src/shared/protocol.ts'

class TestPeer {
  readonly messages: ServerMessage[] = []
  readonly socket: WebSocket

  constructor(url: string) {
    this.socket = new WebSocket(url)
    this.socket.on('message', data => this.messages.push(JSON.parse(data.toString()) as ServerMessage))
  }

  send(message: ClientMessage) { this.socket.send(JSON.stringify(message)) }

  async wait<T extends ServerMessage['type']>(
    type: T,
    predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true
  ) {
    const find = () => this.messages.find((message): message is Extract<ServerMessage, { type: T }> =>
      message.type === type && predicate(message as Extract<ServerMessage, { type: T }>))
    const match = find()
    if (match) return match
    return new Promise<Extract<ServerMessage, { type: T }>>((resolve, reject) => {
      const onMessage = () => {
        const message = find()
        if (!message) return
        clearTimeout(timer)
        this.socket.off('message', onMessage)
        resolve(message)
      }
      const timer = setTimeout(() => {
        this.socket.off('message', onMessage)
        reject(new Error('No matching ' + type + ' message'))
      }, 4000)
      this.socket.on('message', onMessage)
    })
  }
}

async function startServer(t: TestContext, saveFile?: string) {
  const processServer = spawn(process.execPath, ['--experimental-strip-types', 'src/server/index.ts'], {
    env: { ...process.env, PORT: '0', MATCH_SAVE_FILE: saveFile ?? '' }, stdio: ['ignore', 'pipe', 'inherit']
  })
  t.after(() => processServer.kill())
  const [line] = await once(processServer.stdout, 'data') as [Buffer]
  const port = line.toString().trim().split(' ').at(-1)
  assert.match(port ?? '', /^\d+$/)
  const baseURL = `http://127.0.0.1:${port}`
  const health = await fetch(baseURL + '/healthz')
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok' })

  const connect = async () => {
    const peer = new TestPeer(`ws://127.0.0.1:${port}/socket`)
    t.after(() => peer.socket.terminate())
    await once(peer.socket, 'open')
    return peer
  }
  return Object.assign(connect, { stop: async () => {
    const stopped = once(processServer, 'exit')
    processServer.kill('SIGTERM')
    await stopped
  } })
}

test('two sockets share a room, reject forged commands and recover a seat after reconnect', { timeout: 12_000 }, async t => {
  const connect = await startServer(t)
  const human = await connect()
  const orc = await connect()
  const intruder = await connect()
  human.send({ type: 'create', faction: 'human' })
  const { code } = await human.wait('session')
  orc.send({ type: 'join', code, faction: 'human' })
  const { token, faction } = await orc.wait('session')
  assert.equal(faction, 'orc')
  intruder.send({ type: 'join', code, faction: 'human' })
  assert.match((await intruder.wait('error')).message, /already full/)
  human.send({ type: 'ready', ready: true })
  await human.wait('room', ({ room }) => room.players[0].ready)
  assert.equal(human.messages.some(message => message.type === 'snapshot'), false)
  orc.send({ type: 'ready', ready: true })
  const [world1, world2] = await Promise.all([human.wait('snapshot'), orc.wait('snapshot')])
  assert.equal(world1.tick, world2.tick)
  assert.notEqual(world1.fog, world2.fog)
  for (const [world, faction] of [[world1, 'human'], [world2, 'orc']] as const) {
    assert.deepEqual(world.resources, { gold: 300, wood: 180, stone: 120 })
    assert.deepEqual(world.population, { used: 9, reserved: 0, limit: 10 })
    assert.equal(world.entities.length, 10)
    assert.ok(world.entities.every(entity => entity.faction === faction))
  }
  human.send({ type: 'command', ids: [9], order: { kind: 'move', to: { x: 400, y: 400 } } })
  assert.match((await human.wait('error')).message, /cannot be issued/)
  const oldX = world1.entities.find(entity => entity.id === 2)!.x
  human.send({ type: 'command', ids: [2], order: { kind: 'move', to: { x: oldX + 130, y: 337 } } })
  const moved = await human.wait('snapshot', message => (message.entities.find(entity => entity.id === 2)?.x ?? 0) > oldX + 10)
  const unseen = await orc.wait('snapshot', message => message.tick === moved.tick)
  assert.equal(unseen.entities.some(entity => entity.id === 2), false)
  human.send({ type: 'command', ids: [2], order: { kind: 'attack', target: 8 } })
  await human.wait('error', () => human.messages.filter(message => message.type === 'error').length === 2)

  orc.socket.close()
  await human.wait('room', ({ room }) => room.phase === 'playing' && room.players.some(player => !player.connected))
  intruder.send({ type: 'resume', code, token: '0'.repeat(64) })
  assert.equal((await intruder.wait('error', error => Boolean(error.resetSession))).resetSession, true)
  const replacement = await connect()
  replacement.send({ type: 'resume', code, token })
  assert.equal((await replacement.wait('session')).faction, 'orc')
  const resumed = await replacement.wait('snapshot', message => message.tick > world2.tick)
  assert.equal(resumed.fog, world2.fog)
  assert.ok(resumed.entities.every(entity => entity.faction === 'orc'))
  replacement.send({ type: 'leave' })
  const { room } = await human.wait('room', message => message.room.phase === 'finished')
  assert.deepEqual(room.result, { winner: 'human', reason: 'disconnect' })
})


test('a solo room starts immediately, reserves the opponent for the CPU and survives a reconnect', { timeout: 12_000 }, async t => {
  const connect = await startServer(t)
  const player = await connect()
  player.send({ type: 'solo', faction: 'orc' })
  const session = await player.wait('session')
  const { room } = await player.wait('room')
  assert.equal(room.mode, 'solo')
  assert.equal(room.phase, 'playing')
  assert.deepEqual(room.players, [
    { faction: 'orc', ready: true, connected: true },
    { faction: 'human', ready: true, connected: true }
  ])
  const start = await player.wait('snapshot')
  assert.ok(start.entities.every(entity => entity.faction === 'orc'))

  const intruder = await connect()
  intruder.send({ type: 'join', code: session.code, faction: 'human' })
  assert.match((await intruder.wait('error')).message, /already full/)

  player.send({ type: 'command', ids: [2], order: { kind: 'halt' } })
  assert.match((await player.wait('error')).message, /cannot be issued/)
  player.socket.close()
  await once(player.socket, 'close')

  const replacement = await connect()
  replacement.send({ type: 'resume', code: session.code, token: session.token })
  assert.equal((await replacement.wait('room')).room.mode, 'solo')
  const resumed = await replacement.wait('snapshot')
  await replacement.wait('snapshot', snapshot => snapshot.tick > resumed.tick)
  replacement.send({ type: 'leave' })
  replacement.send({ type: 'resume', code: session.code, token: session.token })
  assert.equal((await replacement.wait('error')).resetSession, true)
})


test('on-disk restart restores both multiplayer seats and a paid training queue', { timeout: 12_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ash-iron-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'matches.json')
  const before = await startServer(t, file)
  const host = await before()
  const guest = await before()
  host.send({ type: 'create', faction: 'human' })
  const hostSeat = await host.wait('session')
  guest.send({ type: 'join', code: hostSeat.code, faction: 'orc' })
  const guestSeat = await guest.wait('session')
  host.send({ type: 'ready', ready: true })
  guest.send({ type: 'ready', ready: true })
  await host.wait('snapshot')
  host.send({ type: 'command', ids: [1], order: { kind: 'train', unit: 'worker' } })
  await host.wait('snapshot', snapshot => snapshot.population.reserved === 1)
  await before.stop()

  const after = await startServer(t, file)
  const returned = await after()
  returned.send({ type: 'resume', code: hostSeat.code, token: hostSeat.token })
  await returned.wait('room', ({ room }) => Boolean(room.paused))
  const saved = await returned.wait('snapshot')
  assert.equal(saved.resources.gold, 240)
  assert.equal(saved.population.reserved, 1)
  const other = await after()
  other.send({ type: 'resume', code: guestSeat.code, token: guestSeat.token })
  await returned.wait('room', ({ room }) => !room.paused)
  await returned.wait('snapshot', ({ tick }) => tick > saved.tick)
  await after.stop()
})
