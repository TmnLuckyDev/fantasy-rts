import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MatchCheckpoint } from '../src/server/match.ts'
import type { BattleMap } from '../src/shared/map.ts'
import { Match } from '../src/server/match.ts'
import { cellCenter, isWalkable, TILE, tileAt } from '../src/shared/map.ts'
import { combatKinds, factions } from '../src/shared/protocol.ts'
import { unitStats } from '../src/shared/units.ts'
import type { SavedRoom } from '../src/server/rooms.ts'

export async function startArmyRoom(root = process.cwd()) {
  const source = (path: string) => import(pathToFileURL(resolve(root, path)).href)
  const match: Match = resolve(root) === process.cwd() ? new Match() : new (await source('src/server/match.ts')).Match()
  const map = match.map
  const checkpoint = match.checkpoint()
  checkpoint.units = checkpoint.units.filter(unit => unit.kind === 'headquarters')
  for (const faction of factions) {
    const prototype = checkpoint.units.find(unit => unit.faction === faction)!
    for (let i = 0; i < 500; i++) {
      const kind = combatKinds[i % combatKinds.length]
      const x = map.width / 2 + (faction === 'human' ? -19 : 5) + i % 12
      let y = 7 + Math.floor(i / 48) % 10
      while (!isWalkable(tileAt(map, x, y))) y++
      const at = cellCenter(x, y)
      const health = unitStats[faction][kind].health
      checkpoint.units.push({ ...prototype, ...at, id: ++checkpoint.sequence, kind, hp: health, maxHp: health })
    }
  }
  return startSavedRoom(checkpoint, map, root)
}

export async function startSavedRoom(checkpoint: MatchCheckpoint, map: BattleMap, root = process.cwd()) {
  const directory = await mkdtemp(join(tmpdir(), 'ash-army-room-'))
  const path = join(directory, 'match.json')
  const code = 'ARMY5'
  const seats = factions.map((faction, index) => ({ faction, ready: true, token: String(index + 1).repeat(64) }))
  const rooms: SavedRoom[] = [{ code, seats, match: checkpoint, finishedAt: 0 }]
  await writeFile(path, JSON.stringify({ version: 1, rooms }))
  const server = spawn(process.execPath, ['--experimental-strip-types', 'src/server/index.ts'], {
    cwd: root, env: { ...process.env, FORCE_COLOR: '0', PORT: '0', MATCH_SAVE_FILE: path }, stdio: ['ignore', 'pipe', 'inherit']
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
      let output = ''
      const timeout = setTimeout(() => reject(new Error('Army fixture did not announce its port: ' + output)), 10000)
      server.once('error', error => { clearTimeout(timeout); reject(error) })
      server.once('exit', code => {
        clearTimeout(timeout)
        reject(new Error('Army fixture exited with code ' + code + ': ' + output))
      })
      server.stdout.on('data', (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-4000)
        const port = /listening on port (\d+)/.exec(output)?.[1]
        if (!port) return
        clearTimeout(timeout)
        resolve(port)
      })
    })
    return { url: 'http://127.0.0.1:' + port, code, seats, close, worldWidth: map.width * TILE, worldHeight: map.height * TILE }
  } catch (error) {
    await close()
    throw error
  }
}
