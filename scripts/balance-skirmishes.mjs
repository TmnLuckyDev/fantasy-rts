import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(process.argv[2] ?? '.')
const source = file => import(pathToFileURL(resolve(root, file)).href)
const { Match } = await source('src/server/match.ts')
const { combatKinds } = await source('src/shared/protocol.ts')
const levels = [5, 20, 50]
const groups = [combatKinds, ['blade', 'blade', 'polearm', 'ranged', 'marksman'], ['blade', 'ranged', 'ranged', 'marksman', 'heavy']]
const tiles = Array(88 * 40).fill('grass')
const map = { width: 88, height: 40, name: 'Test field', tiles, bases: { human: { x: 160, y: 160 }, orc: { x: 2640, y: 1120 } } }

function outcome(match, teams, limit) {
  let tick = 0
  for (; tick < limit; tick++) {
    match.step()
    if (!teams.every(army => army.some(unit => unit.hp > 0)) && limit - tick > 12) limit = tick + 12
  }
  const [human, orc] = teams.map(army => army.filter(unit => unit.hp > 0))
  const margin = (side, team) => side.reduce((hp, unit) => hp + unit.hp / unit.maxHp, 0) / team.length
  return { winner: human.length && !orc.length ? 'human' : orc.length && !human.length ? 'orc' : 'unresolved',
    hpMargin: margin(human, teams[0]) - margin(orc, teams[1]), survivors: human.length + orc.length }
}

function trial(size, kinds, mirrored, gap, variant) {
  const match = new Match(map)
  for (const [id, unit] of match.units) if (unit.kind !== 'headquarters') match.units.delete(id)
  const teams = ['human', 'orc'].map((faction, index) => {
    const direction = (index ? 1 : -1) * (mirrored ? -1 : 1)
    return Array.from({ length: size }, (_, i) => {
      const kind = kinds[i % kinds.length]
      const x = 1360 + direction * (gap / 2 + Math.floor(i / 8) * 28)
      const y = 470 + (i % 8 - 3.5) * 27 + (variant ? direction * 14 : 0)
      return match.spawn(faction, kind, { x, y })
    })
  })
  for (const army of teams) {
    const faction = army[0].faction
    const to = teams.find(side => side !== army)[0]
    match.command(faction, army.map(unit => unit.id), { kind: 'advance', to: { x: to.x, y: size === 1 ? to.y : 470 } })
  }
  return outcome(match, teams, 900)
}

function measure(cases) {
  const summary = { human: 0, orc: 0, unresolved: 0, meanHumanHpMargin: 0 }
  let margin = 0
  for (const outcome of cases) {
    summary[outcome.winner]++
    margin += outcome.hpMargin
  }
  summary.meanHumanHpMargin = +(margin / cases.length).toFixed(4)
  return summary
}

const duel = () => Object.fromEntries(combatKinds.map(kind => [kind, measure(
  [19, 32, 70, 138, 168, 250, 360, 420].flatMap(gap => [false, true].map(mirror => trial(1, [kind], mirror, gap, 0))))]))
const mixed = () => Object.fromEntries(levels.map(size => [size, measure(groups.flatMap(kinds =>
  [120, 300].flatMap(gap => [false, true].flatMap(mirror => [0, 1].map(variant => trial(size, kinds, mirror, gap, variant))))))]))
console.log(JSON.stringify({ duel: duel(), mixed: mixed() }))
