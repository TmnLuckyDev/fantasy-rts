import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Match } from '../src/server/match.ts'
import { cellCenter, isWalkable, ashford, tileAt } from '../src/shared/map.ts'
import { combatKinds, factions } from '../src/shared/protocol.ts'
import { unitStats } from '../src/shared/units.ts'
import type { SavedRoom } from '../src/server/rooms.ts'

export async function startArmyRoom(root = process.cwd()) {
  const directory = await mkdtemp(join(tmpdir(), 'ash-army-room-'))
  const path = join(directory, 'match.json')
  const checkpoint = new Match().checkpoint()
  checkpoint.units = checkpoint.units.filter(unit => unit.kind === 'headquarters')
  for (const faction of factions) {
    const prototype = checkpoint.units.find(unit => unit.faction === faction)!
    for (let i = 0; i < 500; i++) {
      const kind = combatKinds[i % combatKinds.length]
      const x = (faction === 'human' ? 25 : 49) + i % 12
      let y = 7 + Math.floor(i / 48) % 10
      while (!isWalkable(tileAt(ashford, x, y))) y++
      const at = cellCenter(x, y)
      const health = unitStats[faction][kind].health
      checkpoint.units.push({ ...prototype, ...at, id: ++checkpoint.sequence, kind, hp: health, maxHp: health })
    }
  }
  const code = 'ARMY5'
  const seats = factions.map((faction, index) => ({ faction, ready: true, token: String(index + 1).repeat(64) }))
  const rooms: SavedRoom[] = [{ code, seats, match: checkpoint, finishedAt: 0 }]
  await writeFile(path, JSON.stringify({ version: 1, rooms }))
  const server = spawn(process.execPath, ['--experimental-strip-types', 'src/server/index.ts'], {
    cwd: root, env: { ...process.env, PORT: '0', MATCH_SAVE_FILE: path }, stdio: ['ignore', 'pipe', 'inherit']
  })
  const close = async () => {
    if (server.exitCode === null) {
      const exiting = once(server, 'exit')
      server.kill('SIGTERM')
      await exiting
    }
    await rm(directory, { recursive: true, force: true })
  }
  try {
    const port = await new Promise<string>((resolve, reject) => {
      server.once('error', reject)
      server.once('exit', code => reject(new Error('Army fixture exited with code ' + code)))
      server.stdout.on('data', (chunk: Buffer) => {
        const port = /listening on port (\d+)/.exec(chunk.toString())?.[1]
        if (port) resolve(port)
      })
    })
    return { url: 'http://127.0.0.1:' + port, code, seats, close }
  } catch (error) {
    await close()
    throw error
  }
}
