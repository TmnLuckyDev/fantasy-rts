import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve, sep, extname } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import { TICK_HZ } from './match.ts'
import { Rooms } from './rooms.ts'
import { parseMessage } from './validate.ts'

const port = Number(process.env.PORT ?? 3000)
const root = resolve(process.env.CLIENT_DIR ?? 'dist/client')
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean))
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}
const http = createServer((request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'same-origin')
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  } catch {
    response.writeHead(400).end()
    return
  }
  if (pathname === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(request.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok' }))
    return
  }
  const file = resolve(root, pathname === '/' ? 'index.html' : '.' + pathname)
  if (!file.startsWith(root + sep)) {
    response.writeHead(404).end()
    return
  }
  try {
    const stat = statSync(file)
    if (!stat.isFile()) throw new Error('Not a file')
    response.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    })
    if (request.method === 'HEAD') response.end()
    else createReadStream(file).on('error', () => response.destroy()).pipe(response)
  } catch {
    response.writeHead(404).end('Not found')
  }
})

const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false })
const rooms = new Rooms()
const lastPong = new Map<WebSocket, number>()
http.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin
  let allowed = !origin || allowedOrigins.has(origin)
  if (origin && !allowed) {
    try {
      const url = new URL(origin)
      allowed = (url.protocol === 'http:' || url.protocol === 'https:') && url.host === request.headers.host
    } catch {
      allowed = false
    }
  }
  if (request.url !== '/socket' || !allowed || sockets.clients.size >= 150) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    return
  }
  sockets.handleUpgrade(request, socket, head, peer => sockets.emit('connection', peer, request))
})

sockets.on('connection', peer => {
  let allowance = 20
  let checkedAt = Date.now()
  let invalid = 0
  lastPong.set(peer, checkedAt)
  peer.on('error', () => peer.terminate())
  peer.on('pong', () => lastPong.set(peer, Date.now()))
  peer.on('close', () => {
    lastPong.delete(peer)
    rooms.disconnect(peer)
  })
  peer.on('message', (data, binary) => {
    const now = Date.now()
    allowance = Math.min(20, allowance + (now - checkedAt) * 0.012)
    checkedAt = now
    if (allowance < 1 || binary) {
      peer.close(1008, 'Message limit')
      return
    }
    allowance--
    const message = parseMessage(data.toString())
    if (message) rooms.handle(peer, message, now)
    else if (++invalid >= 5) peer.close(1008, 'Invalid messages')
    else peer.send(JSON.stringify({ type: 'error', message: 'Invalid message.' }))
  })
})

const tick = setInterval(() => rooms.step(), 1000 / TICK_HZ)
const heartbeat = setInterval(() => {
  for (const [peer, seen] of lastPong) {
    if (Date.now() - seen > 25_000) peer.terminate()
    else if (peer.readyState === WebSocket.OPEN) peer.ping()
  }
}, 10_000)

function close() {
  clearInterval(heartbeat)
  clearInterval(tick)
  for (const peer of sockets.clients) peer.terminate()
  sockets.close()
  http.close()
}
process.once('SIGINT', close)
process.once('SIGTERM', close)
http.listen(port, '0.0.0.0', () => {
  const address = http.address()
  console.log('Ash & Iron listening on port', typeof address === 'object' ? address?.port : port)
})
