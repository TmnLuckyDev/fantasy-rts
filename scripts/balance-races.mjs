import { performance } from 'node:perf_hooks'
import { ComputerOpponent } from '../src/server/computer.ts'
import { Match, TICK_HZ } from '../src/server/match.ts'
import { ashfordMap, cellCenter, isWalkable, isWater, tileAt } from '../src/shared/map.ts'
import { defaultMatchSettings } from '../src/shared/match-settings.ts'
import { trainingRule } from '../src/shared/economy.ts'
import { factions, isUnitKind, races } from '../src/shared/protocol.ts'

const mode = process.argv[2] ?? 'skirmish'
const games = Number(process.argv[3] ?? (mode === 'bots' ? 2 : 100))
if (!['bots', 'skirmish'].includes(mode) || !Number.isSafeInteger(games) || games < 1) {
  throw new Error('Usage: node scripts/balance-races.mjs [skirmish|bots] [games per matchup and map]')
}

function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

const maps = ['pinewatch-vale', 'ironbreak-pass', 'shattered-isles']
const landArmy = ['blade', 'blade', 'ranged', 'ranged', 'polearm', 'heavy']
const seaArmy = ['warship', 'warship', 'warship']
const strategies = ['balanced', 'rush', 'defensive', 'counter']

function battlefront(map) {
  const water = map.id === 'shattered-isles'
  const acceptable = water ? isWater : isWalkable
  const cx = Math.floor(map.width / 2), cy = water ? 35 : Math.floor(map.height / 2)
  let best
  let shortest = Infinity
  for (let y = 6; y < map.height - 6; y++) for (let x = 8; x < map.width - 8; x++) {
    const gap = (x - cx) ** 2 + (y - cy) ** 2
    if (gap >= shortest) continue
    const sides = water ? [-4, -3, -2, -1, 0, 1, 2, 3, 4].map(offset => x + offset) : [x - 4, x + 4]
    if (sides.every(col => [-2, -1, 0, 1, 2].every(row => acceptable(tileAt(map, col, y + row))))) {
      best = { x, y }
      shortest = gap
    }
  }
  if (!best) throw new Error('No arena on ' + map.id)
  return best
}

function runSkirmish(map, front, lineup, rand) {
  const match = new Match(map, defaultMatchSettings(map.id), lineup)
  for (const [id, unit] of match.units) if (unit.kind !== 'headquarters') {
    match.units.delete(id)
    match.nearby[unit.faction].remove(unit)
  }
  for (const [seat, side] of factions.entries()) {
    const direction = seat ? -1 : 1
    const units = map.id === 'shattered-isles' ? seaArmy : [...landArmy]
    if (map.id !== 'shattered-isles' && lineup[side] === 'undead') {
      const gold = race => units.reduce((total, unit) => total + trainingRule(unit, race).gold, 0)
      if (gold('human') - gold('undead') >= trainingRule('blade', 'undead').gold) units.push('blade')
    }
    const army = units.map((kind, i) => {
      const { x, y } = cellCenter(front.x - (map.id === 'shattered-isles' ? 2 : 4) * direction, front.y + i % 5 - 2)
      return match.spawn(side, kind, { x: x + (rand() - .5) * 10, y: y + (rand() - .5) * 12 }).id
    })
    match.command(side, army, { kind: 'advance', to: cellCenter(front.x + 4 * direction, front.y) })
  }
  let counts = [0, 0]
  while (!match.result && match.tick < 25 * TICK_HZ) {
    match.step()
    counts = factions.map(side => [...match.units.values()].filter(unit => unit.faction === side && isUnitKind(unit.kind)).length)
    if (!counts.every(Boolean)) break
  }
  return { winner: !counts[0] && counts[1] ? 'orc' : counts[0] && !counts[1] ? 'human' : null, match }
}

function runBots(map, lineup, seed) {
  const settings = { ...defaultMatchSettings(map.id), minutes: 5, randomStarts: true }
  const match = Match.configured(settings, seed, lineup)
  const bots = factions.map(side => new ComputerOpponent(side, match.map, 'normal', strategies[(seed - 1) % strategies.length]))
  while (!match.result) {
    for (const bot of bots) bot.think(match)
    match.step()
    if (match.tick % 20 === 0) match.snapshot(true)
  }
  return { winner: match.result.winner, match }
}

for (const id of maps) {
  const map = ashfordMap(id)
  const front = mode === 'skirmish' ? battlefront(map) : undefined
  for (let i = 0; i < races.length; i++) for (let j = i; j < races.length; j++) {
    const start = performance.now()
    const pair = [races[i], races[j]]
    const wins = [0, 0], kills = [0, 0], unitsTrained = [0, 0], gathered = [0, 0]
    let draws = 0, headquartersWins = 0, totalTicks = 0
    for (let game = 0; game < games; game++) {
      const left = game % 2, right = 1 - left
      const seed = 1 + Math.floor(game / 2)
      const lineup = { human: pair[left], orc: pair[right] }
      const trial = mode === 'bots' ? runBots(map, lineup, seed) : runSkirmish(map, front, lineup, random(seed))
      if (trial.winner) wins[trial.winner === 'human' ? left : right]++
      else draws++
      if (trial.match.result?.reason === 'headquarters') headquartersWins++
      totalTicks += trial.match.tick
      const { sides } = trial.match.report()
      for (const [side, slot] of [['human', left], ['orc', right]]) {
        kills[slot] += sides[side].enemiesKilled
        unitsTrained[slot] += sides[side].troopsTrained
        gathered[slot] += Object.values(sides[side].gathered).reduce((sum, amount) => sum + amount, 0)
      }
    }
    console.log(JSON.stringify({ mode, map: id, pair, games, wins, draws, headquartersWins, kills, unitsTrained, gathered,
      meanGameSeconds: +(totalTicks / (TICK_HZ * games)).toFixed(2), runtimeMs: Math.round(performance.now() - start) }))
  }
}
