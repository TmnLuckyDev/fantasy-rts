import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { WebSocket } from 'ws'
import { defaultMatchSettings } from '../src/shared/match-settings.ts'
import { mapForSettings } from '../src/shared/map.ts'
import type { ClientMessage, ServerMessage } from '../src/shared/protocol.ts'

class TestPeer {
  readonly messages: ServerMessage[] = []
  readonly socket: WebSocket

  constructor(url: string, origin?: string) {
    this.socket = new WebSocket(url, { origin })
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

  const connect = async (origin?: string) => {
    const peer = new TestPeer(`ws://127.0.0.1:${port}/socket`, origin)
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
  const human = await connect('https://app.ashandiron.localhost')
  const orc = await connect('capacitor://app.ashandiron.localhost')
  const intruder = await connect()
  const settings = defaultMatchSettings('twinmere-basin')
  human.send({ type: 'create', faction: 'human', settings })
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
  const [state1, state2] = await Promise.all([human.wait('room', ({ room }) => room.phase === 'playing'),
    orc.wait('room', ({ room }) => room.phase === 'playing')])
  assert.equal(typeof state1.room.mapSeed, 'number')
  assert.equal(state1.room.mapSeed, state2.room.mapSeed)
  const map = mapForSettings(settings, state1.room.mapSeed)
  assert.equal(world1.tick, world2.tick)
  assert.notEqual(world1.fog, world2.fog)
  for (const [world, faction] of [[world1, 'human'], [world2, 'orc']] as const) {
    assert.deepEqual(world.resources, { gold: 300, wood: 180, stone: 120 })
    assert.deepEqual(world.population, { used: 9, reserved: 0, limit: 10 })
    assert.equal(world.entities.length, 10)
    const hall = world.entities.find(entity => entity.kind === 'headquarters')!
    assert.deepEqual({ x: hall.x, y: hall.y }, map.bases[faction])
    assert.ok(world.entities.every(entity => entity.faction === faction))
  }
  human.send({ type: 'command', ids: [9], order: { kind: 'move', to: { x: 400, y: 400 } } })
  assert.match((await human.wait('error')).message, /cannot be issued/)
  const { x: oldX, y } = world1.entities.find(entity => entity.id === 2)!
  human.send({ type: 'command', ids: [2], order: { kind: 'move', to: { x: oldX + 32, y } } })
  const moved = await human.wait('snapshot', message => (message.entities.find(entity => entity.id === 2)?.x ?? 0) > oldX + 10)
  const unseen = await orc.wait('snapshot', message => message.tick === moved.tick)
  assert.equal(unseen.entities.some(entity => entity.id === 2), false)
  human.send({ type: 'command', ids: [2], order: { kind: 'attack', target: 8 } })
  await human.wait('error', () => human.messages.filter(message => message.type === 'error').length === 2)

  orc.socket.close()
  await human.wait('room', ({ room }) => room.phase === 'playing' && room.players.some(player => !player.connected))
  intruder.send({ type: 'resume', code, token: '0'.repeat(64) })
  assert.equal((await intruder.wait('error', error => Boolean(error.resetSession))).resetSession, true)
  const replacement = await connect('capacitor://app.ashandiron.localhost')
  replacement.send({ type: 'resume', code, token })
  assert.equal((await replacement.wait('session')).faction, 'orc')
  const returnedRoom = await replacement.wait('room', ({ room }) => room.phase === 'playing')
  assert.equal(returnedRoom.room.mapSeed, state1.room.mapSeed)
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

test('two independently chosen Elf seats survive a multiplayer reconnect', { timeout: 12_000 }, async t => {
  const connect = await startServer(t)
  const host = await connect()
  const guest = await connect()
  host.send({ type: 'create', race: 'elf' })
  const { code } = await host.wait('session')
  guest.send({ type: 'join', code, race: 'dwarf' })
  const identity = await guest.wait('session')
  await host.wait('room', ({ room }) => room.players.some(player => player.race === 'dwarf'))
  host.send({ type: 'ready', ready: true })
  await host.wait('room', ({ room }) => room.players[0].ready)
  guest.send({ type: 'race', race: 'elf' })
  await host.wait('room', ({ room }) => room.players.length === 2 && room.players.every(player => player.race === 'elf' && !player.ready))
  host.send({ type: 'ready', ready: true })
  guest.send({ type: 'ready', ready: true })
  const [left, right] = await Promise.all([host.wait('snapshot'), guest.wait('snapshot')])
  assert.equal(left.tick, right.tick)
  assert.ok(left.entities.every(unit => unit.faction === 'human' && unit.race === 'elf'))
  assert.ok(right.entities.every(unit => unit.faction === 'orc' && unit.race === 'elf'))
  guest.socket.close()
  await host.wait('room', ({ room }) => room.paused === true)
  const resumed = await connect()
  resumed.send({ type: 'resume', code, token: identity.token })
  assert.equal((await resumed.wait('session')).faction, identity.faction)
  const world = await resumed.wait('snapshot')
  assert.deepEqual(world.entities.map(unit => unit.id), right.entities.map(unit => unit.id))
  assert.ok(world.entities.every(unit => unit.race === 'elf'))
})


test('WebSocket upgrade continues rejecting unrelated and opaque origins', { timeout: 12_000 }, async t => {
  const connect = await startServer(t)
  for (const origin of ['https://app.ashandiron.localhost.example.com', 'null']) {
    await assert.rejects(connect(origin), /403/)
  }
})

test('the public queue pairs two live players and respects cancellation', { timeout: 12_000 }, async t => {
  const connect = await startServer(t)
  const first = await connect()
  first.send({ type: 'queue', race: 'dwarf' })
  await first.wait('queue-status', state => state.waiting)
  first.send({ type: 'cancel-queue' })
  await first.wait('queue-status', state => !state.waiting)
  const second = await connect()
  second.send({ type: 'queue', race: 'elf' })
  await second.wait('queue-status', state => state.waiting)
  first.send({ type: 'queue', race: 'dwarf' })
  const [a, b] = await Promise.all([first.wait('room', ({ room }) => room.phase === 'playing'),
    second.wait('room', ({ room }) => room.phase === 'playing')])
  assert.equal(a.room.code, b.room.code)
  assert.equal(a.room.settings?.populationCap, 120)
  assert.deepEqual(a.room.players.map(player => player.race), ['elf', 'dwarf'])
})
