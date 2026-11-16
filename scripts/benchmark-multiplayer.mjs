import { once } from 'node:events'
import { performance } from 'node:perf_hooks'
import { WebSocket } from 'ws'
import { startArmyRoom } from './army-room.ts'
import { applyDelta, deltaProtocol } from '../src/shared/snapshot-delta.ts'

const room = await startArmyRoom(process.env.BENCH_SOURCE)
const target = Number(process.env.BENCH_FRAMES ?? 80)
const peers = []
try {
  for (const { faction, token } of room.seats) {
    const socket = new WebSocket(room.url.replace('http:', 'ws:') + '/socket',
      process.env.BENCH_DELTA === '0' ? undefined : deltaProtocol)
    const record = { socket, faction, bytes: 0, frames: 0, latest: undefined, start: 0, last: 0, gaps: [], shots: 0 }
    peers.push(record)
    socket.on('message', buffer => {
      const packet = JSON.parse(buffer.toString())
      if (packet.type !== 'snapshot' && packet.type !== 'delta') return
      record.latest = packet.type === 'snapshot' ? packet : applyDelta(record.latest, packet)
      if (!record.latest) throw Error('Snapshot chain is broken')
      if (record.frames >= target) return
      const now = performance.now()
      record.start ||= now
      if (record.last) record.gaps.push(now - record.last)
      record.last = now
      record.bytes += buffer.length
      record.frames++
      record.shots += record.latest.effects.filter(effect => effect.kind === 'shot').length
    })
    await once(socket, 'open')
    socket.send(JSON.stringify({ type: 'resume', code: room.code, token }))
  }
  const until = async (predicate, description) => {
    const end = performance.now() + 20000
    while (!predicate()) {
      if (performance.now() > end) throw Error('Timed out: ' + description)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  await until(() => peers.every(peer => peer.latest), 'initial snapshot')
  for (const peer of peers) {
    const ids = peer.latest.entities.filter(unit => unit.faction === peer.faction && unit.kind !== 'headquarters').map(unit => unit.id)
    if (ids.length !== 500 || new Set(ids).size !== 500) throw Error('Invalid initial army')
    peer.socket.send(JSON.stringify({ type: 'command', ids, order: { kind: 'advance', to: { x: peer.faction === 'human' ? 1810 : 1050, y: 335 } } }))
  }
  await until(() => peers.every(peer => peer.frames >= target), 'battle snapshots')
  console.log(JSON.stringify(peers.map(({ faction, bytes, frames, latest, gaps, start, last, shots }) => {
    const p95 = [...gaps].sort((a, b) => a - b)[Math.ceil(gaps.length * .95) - 1]
    return { faction, bytes, frames, seconds: (last - start) / 1000, meanBytesPerSecond: bytes * 1000 / (last - start),
      maxSnapshotGapMs: Math.max(...gaps), p95SnapshotGapMs: p95, lastTick: latest.tick, shots,
      survivors: latest.entities.filter(unit => unit.faction === faction && unit.kind !== 'headquarters').length }
  })))
} finally {
  for (const { socket } of peers) socket.terminate()
  await room.close()
}
