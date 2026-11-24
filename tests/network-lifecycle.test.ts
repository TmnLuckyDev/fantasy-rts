import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConnectionClient } from '../src/client/network.ts'

test('deferred multiplayer stays idle through backgrounding and opens on demand', t => {
  const sockets: TestSocket[] = []
  class TestSocket extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    readyState = TestSocket.CONNECTING
    readonly sent: string[] = []
    readonly url: URL
    constructor(url: URL) { super(); this.url = url; sockets.push(this) }
    send(message: string) { this.sent.push(message) }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')) }
    open() { this.readyState = TestSocket.OPEN; this.dispatchEvent(new Event('open')) }
  }
  const window = Object.assign(new EventTarget(), { clearTimeout })
  const document = Object.assign(new EventTarget(), { hidden: false })
  const globals = { window, document, location: { href: 'https://app.ashandiron.localhost/', search: '' },
    sessionStorage: { getItem: () => null }, WebSocket: TestSocket }
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
  const statuses: string[] = []
  const client = new ConnectionClient(() => {}, state => statuses.push(state), 'https://example.com', true)
  client.setAppActive(false)
  client.setAppActive(true)
  window.dispatchEvent(new Event('online'))
  document.dispatchEvent(new Event('visibilitychange'))
  assert.deepEqual(statuses, ['idle'])
  assert.equal(sockets.length, 0)

  client.sendLobby({ type: 'queue', race: 'human' })
  assert.equal(sockets.length, 1)
  assert.equal(sockets[0].url.href, 'wss://example.com/socket')
  sockets[0].open()
  assert.deepEqual(statuses, ['idle', 'waiting', 'open'])
  assert.deepEqual(sockets[0].sent.map(message => JSON.parse(message)), [{ type: 'queue', race: 'human' }])
  client.setAppActive(false)
  assert.equal(client.connected, false)
  client.setAppActive(true)
  assert.equal(sockets.length, 2)
  sockets[1].open()
  assert.equal(client.connected, true)
  assert.deepEqual(statuses, ['idle', 'waiting', 'open', 'closed', 'waiting', 'open'])
})
