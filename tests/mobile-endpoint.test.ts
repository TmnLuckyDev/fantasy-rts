import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inviteUrl, mobileBackend, socketUrl } from '../src/client/multiplayer-endpoint.ts'

test('browser games keep same-origin sockets and shareable invites', () => {
  assert.equal(socketUrl('http://localhost:5173/?room=ABCDE').href, 'ws://localhost:5173/socket')
  assert.equal(socketUrl('https://example.com/game/').href, 'wss://example.com/socket')
  assert.equal(inviteUrl('https://example.com/game/?other=1', 'ABCDE').href, 'https://example.com/game/?room=ABCDE')
})

test('packaged clients address the remote backend and never share a WebView URL', () => {
  assert.equal(mobileBackend(), 'https://ash-and-iron.onrender.com')
  const backend = mobileBackend('https://staging.example.com:8443')
  for (const page of ['https://app.ashandiron.localhost/', 'capacitor://app.ashandiron.localhost/']) {
    assert.equal(socketUrl(page, backend).href, 'wss://staging.example.com:8443/socket')
    assert.equal(inviteUrl(page, 'ABCDE', backend).href, 'https://staging.example.com:8443/?room=ABCDE')
  }
  for (const invalid of ['http://localhost:3000', 'https://staging.example.com/socket', 'https://staging.example.com/?secret=1']) {
    assert.throws(() => mobileBackend(invalid), /must be an HTTPS origin/)
  }
})
