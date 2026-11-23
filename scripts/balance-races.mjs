import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const fromGame = path => import(process.env.BALANCE_ROOT ?
  pathToFileURL(resolve(process.env.BALANCE_ROOT, 'src', path)).href : new URL('../src/' + path, import.meta.url).href)
const [{ unitStats, siegeBalance }, { ComputerOpponent }, { Match, TICK_HZ },
  { ashfordMap, cellCenter, distance, isWalkable, isWater, resourceAt, tileAt }, { defaultMatchSettings },
  { trainingCost, trainingRule }, { factions, isUnitKind, races, resourceKinds }] = await Promise.all([
  'shared/units.ts', 'server/computer.ts', 'server/match.ts', 'shared/map.ts', 'shared/match-settings.ts',
  'shared/economy.ts', 'shared/protocol.ts'
].map(fromGame))

const mode = process.argv[2] ?? 'skirmish'
const games = Number(process.argv[3] ?? (mode === 'bots' ? 2 : 100))
if (!['bots', 'skirmish', 'fleet', 'economy'].includes(mode) || !Number.isSafeInteger(games) || games < 1) {
  throw new Error('Usage: node scripts/balance-races.mjs [skirmish|fleet|bots|economy] [games per matchup and map]')
}

function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

const maps = mode === 'fleet' ? ['shattered-isles'] : ['pinewatch-vale', 'ironbreak-pass', 'shattered-isles']
const selectedMap = process.env.BALANCE_MAP
if (selectedMap && !maps.includes(selectedMap)) throw Error('Unknown BALANCE_MAP: ' + selectedMap)
const botDifficulty = process.env.BALANCE_DIFFICULTY ?? 'normal'
if (!['easy', 'normal', 'hard'].includes(botDifficulty)) throw Error('Invalid difficulty')
const botMinutes = Number(process.env.BALANCE_MINUTES ?? 5)
if (![5, 10, 20].includes(botMinutes)) throw new Error('BALANCE_MINUTES must be 5, 10 or 20')
const landArmy = ['blade', 'blade', 'ranged', 'ranged', 'polearm', 'heavy']
const seaArmy = ['warship', 'warship', 'warship']
const phase = process.env.BALANCE_PHASE
const limit = process.env.BALANCE_LIMIT ?? 'population'
const phases = {
  early: { units: ['blade', 'ranged', 'blade', 'polearm'], population: 7, budget: { gold: 575, wood: 0, stone: 0 }, research: 0 },
  mid: { units: ['blade', 'polearm', 'ranged', 'marksman', 'heavy'], population: 12, budget: { gold: 1240, wood: 60, stone: 25 }, research: 1 },
  late: { units: ['vanguard', 'siege', 'heavy', 'blade', 'polearm', 'ranged', 'marksman'], population: 17, budget: { gold: 2450, wood: 320, stone: 180 }, research: 3 }
}
if (phase && (!(phase in phases) || !['population', 'budget'].includes(limit))) throw Error('Invalid phase or army limit')
function phasedArmy(race, seed) {
  const { units, population, budget } = phases[phase]
  const multiplier = [0.9, 0.95, 1, 1.05, 1.1, 1.15][(seed - 1) % 6]
  const remaining = Object.fromEntries(resourceKinds.map(kind => [kind, Math.floor(budget[kind] * multiplier)]))
  const army = []
  let slots = population
  while (true) {
    let added = false
    for (const unit of units) {
      if (unit === 'vanguard' && army.includes(unit)) continue
      const cost = trainingCost(unit, race)
      const rule = trainingRule(unit, race)
      if (limit === 'population' && rule.population > slots ||
          limit === 'budget' && resourceKinds.some(kind => (cost[kind] ?? 0) > remaining[kind])) continue
      army.push(unit)
      slots -= rule.population
      for (const kind of resourceKinds) remaining[kind] -= cost[kind] ?? 0
      added = true
    }
    if (!added) return army
  }
}
function fleetFor(race) {
  const budget = trainingCost('warship', 'human')
  const cost = trainingCost('warship', race)
  const count = Math.min(...resourceKinds.filter(resource => cost[resource] > 0)
    .map(resource => Math.floor(budget[resource] * 10 / cost[resource])))
  return Array(count).fill('warship')
}
const strategies = ['balanced', 'rush', 'defensive', 'counter', 'expansion']

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

function runSkirmish(map, front, lineup, seed) {
  const rand = random(seed)
  const match = new Match(map, defaultMatchSettings(map.id), lineup)
  for (const [id, unit] of match.units) if (unit.kind !== 'headquarters') {
    match.units.delete(id)
    match.nearby[unit.faction].remove(unit)
  }
  for (const [seat, side] of factions.entries()) {
    const direction = seat ? -1 : 1
    const landPhase = phase && map.id !== 'shattered-isles'
    const units = mode === 'fleet' ? fleetFor(lineup[side]) : map.id === 'shattered-isles' ? seaArmy :
      landPhase ? phasedArmy(lineup[side], seed) : [...landArmy]
    if (landPhase) {
      for (let level = 0; level < phases[phase].research; level++) {
        match.checkpoint().upgrades[side].push('weapons', 'armor', 'range', 'speed')
      }
    }
    if (!landPhase && map.id !== 'shattered-isles' && lineup[side] === 'undead') {
      const gold = race => units.reduce((total, unit) => total + trainingRule(unit, race).gold, 0)
      if (gold('human') - gold('undead') >= trainingRule('blade', 'undead').gold) units.push('blade')
    }
    const army = units.map((kind, i) => {
      const frontDepth = landPhase ? 3 + Math.floor(i / 5) : mode === 'fleet' ? 2 + Math.floor(i / 5) : map.id === 'shattered-isles' ? 2 : 4
      const { x, y } = cellCenter(front.x - frontDepth * direction, front.y + i % 5 - 2)
      return match.spawn(side, kind, { x: x + (rand() - .5) * 10, y: y + (rand() - .5) * 12 }).id
    })
    match.command(side, army, { kind: 'advance', to: cellCenter(front.x + 4 * direction, front.y) })
  }
  let counts = [0, 0]
  while (!match.result && match.tick < (map.id === 'shattered-isles' ? 75 : 30) * TICK_HZ) {
    match.step()
    counts = factions.map(side => [...match.units.values()].filter(unit => unit.faction === side && isUnitKind(unit.kind)).length)
    if (!counts.every(Boolean)) break
  }
  return { winner: !counts[0] && counts[1] ? 'orc' : counts[0] && !counts[1] ? 'human' : null, match }
}

function runBots(map, lineup, seed) {
  const settings = { ...defaultMatchSettings(map.id), minutes: botMinutes, randomStarts: true, progression: true }
  const match = Match.configured(settings, seed, lineup)
  const bots = factions.map(side => new ComputerOpponent(side, match.map, botDifficulty, strategies[(seed - 1) % strategies.length]))
  const firstAssault = [null, null]
  const advanced = [null, null]
  while (!match.result) {
    for (const [i, bot] of bots.entries()) {
      bot.think(match)
      if (firstAssault[i] === null && match.tick % TICK_HZ === 0 && bot.checkpoint().attacking.length) firstAssault[i] = match.tick / TICK_HZ
      if (advanced[i] === null && match.hallLevel(bot.faction) >= 3) advanced[i] = match.tick / TICK_HZ
    }
    match.step()
    if (match.tick % 20 === 0) match.snapshot(true)
  }
  return { winner: match.result.winner, match, firstAssault, advanced }
}

function measureEconomy() {
  const settings = { ...defaultMatchSettings('pinewatch-vale'), randomStarts: false }
  const map = Match.configured(settings).map
  const base = map.bases.human
  const deposits = map.tiles.map((_, i) => cellCenter(i % map.width, Math.floor(i / map.width)))
    .filter(at => resourceAt(map, at)).sort((a, b) => distance(a, base) - distance(b, base))
  for (const race of races) {
    const match = new Match(map, settings, { human: race, orc: 'human' })
    const workers = [...match.units.values()].filter(unit => unit.faction === 'human' && unit.kind === 'worker')
    for (const [i, resource] of resourceKinds.entries()) {
      const at = deposits.find(point => resourceAt(map, point) === resource && match.availableDeposit('human', point))
      if (!at || !match.command('human', [workers[i].id], { kind: 'gather', at })) throw Error('Unreachable benchmark deposit: ' + resource)
    }
    const gathered = {}
    for (const minutes of [5, 10, 20]) {
      while (match.tick < minutes * 60 * TICK_HZ) match.step()
      gathered[minutes] = { ...match.report().sides.human.gathered }
    }
    const kinds = ['blade', 'polearm', 'ranged', 'marksman', 'heavy', 'warship']
    kinds.push('siege', 'vanguard', 'pathfinder')
    const roster = kinds.map(kind => {
      const { health, armor, damage, cooldown, speed, range } = unitStats[race][kind]
      const { ticks, population } = trainingRule(kind, race)
      const dps = damage * TICK_HZ / cooldown
      // Effective HP against repeat hits of 20 damage before armor and active abilities.
      const effectiveHp = Math.ceil(health / Math.max(1, 20 - armor)) * 20
      return { kind, dps, effectiveHp, healthPerPopulation: health / population, cost: trainingCost(kind, race),
        trainingSeconds: ticks / TICK_HZ, speed, range, damagePerHitAgainstUnarmoredBuilding: damage + (kind === 'siege' ? siegeBalance?.structureBonus ?? 10 : 0),
        siegeStructureRange: kind === 'siege' ? Math.max(range, siegeBalance?.structureRange ?? range) : undefined }
    })
    console.log(JSON.stringify({ mode, race, gathered, roster }))
  }
}

if (mode === 'economy') {
  measureEconomy()
  process.exit(0)
}

for (const id of selectedMap ? [selectedMap] : maps) {
  const map = ashfordMap(id)
  const front = mode !== 'bots' ? battlefront(map) : undefined
  for (let i = 0; i < races.length; i++) for (let j = i; j < races.length; j++) {
    const start = performance.now()
    const pair = [races[i], races[j]]
    if (process.env.BALANCE_PAIR && ![pair.join(','), [...pair].reverse().join(',')].includes(process.env.BALANCE_PAIR)) continue
    const wins = [0, 0], kills = [0, 0], unitsTrained = [0, 0]
    const gathered = pair.map(() => ({ gold: 0, wood: 0, stone: 0 }))
    const assaults = [], advanced = []
    let draws = 0, headquartersWins = 0, totalTicks = 0
    for (let game = 0; game < games; game++) {
      const left = game % 2, right = 1 - left
      const seed = 1 + Math.floor(game / 2)
      const lineup = { human: pair[left], orc: pair[right] }
      const trial = mode === 'bots' ? runBots(map, lineup, seed) : runSkirmish(map, front, lineup, seed)
      if (trial.winner) wins[trial.winner === 'human' ? left : right]++
      else draws++
      if (trial.match.result?.reason === 'headquarters') headquartersWins++
      totalTicks += trial.match.tick
      if (trial.firstAssault) assaults.push(...trial.firstAssault.filter(value => value !== null))
      if (trial.advanced) advanced.push(...trial.advanced.filter(value => value !== null))
      const { sides } = trial.match.report()
      for (const [side, slot] of [['human', left], ['orc', right]]) {
        kills[slot] += sides[side].enemiesKilled
        unitsTrained[slot] += sides[side].troopsTrained
        for (const resource of Object.keys(gathered[slot])) gathered[slot][resource] += sides[side].gathered[resource]
      }
    }
    console.log(JSON.stringify({ mode, phase, limit: phase ? limit : undefined, difficulty: mode === 'bots' ? botDifficulty : undefined, map: id, pair, games, wins, draws, headquartersWins, kills, unitsTrained, gathered,
      assaults: mode === 'bots' ? assaults : undefined, advanced: mode === 'bots' ? advanced : undefined,
      meanGameSeconds: +(totalTicks / (TICK_HZ * games)).toFixed(2), runtimeMs: Math.round(performance.now() - start) }))
  }
}
