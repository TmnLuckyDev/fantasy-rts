import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Match } from '../src/server/match.ts'
import { canStand, findPath } from '../src/server/navigation.ts'
import { TILE, cellCenter, distance, mapForSettings, mapIds } from '../src/shared/map.ts'
import { defaultMatchSettings, MAX_DEPOSITS, parseMatchSettings } from '../src/shared/match-settings.ts'
import { factions, resourceKinds } from '../src/shared/protocol.ts'
import { unitStats } from '../src/shared/units.ts'

const resources = { mine: 'gold', quarry: 'stone', forest: 'wood' } as const
const tileTypes = Object.keys(resources) as Array<keyof typeof resources>

test('every battlefield has varied mirrored starts with walkable troops and all resources nearby', () => {
  for (const id of mapIds) {
    const starts = new Set<string>()
    const settings = defaultMatchSettings(id)
    for (let seed = 0; seed < 24; seed++) {
      const match = Match.configured(settings, seed)
      const { map } = match
      assert.deepEqual([...map.tiles].reverse(), map.tiles)
      starts.add(JSON.stringify(map.bases.human))
      assert.ok(map.bases.human.x < map.width * TILE / 2)
      assert.equal(map.bases.human.x + map.bases.orc.x, map.width * TILE)
      assert.equal(map.bases.human.y + map.bases.orc.y, map.height * TILE)
      for (const unit of match.units.values()) {
        assert.ok(canStand(map, unit, [], unitStats[unit.faction][unit.kind].radius), `${id} ${seed} blocked unit ${unit.id}`)
      }
      for (const tile of tileTypes) {
        const resource = resources[tile]
        const deposits = map.tiles.flatMap((kind, i) => kind === tile ? [cellCenter(i % map.width, Math.floor(i / map.width))] : [])
        assert.equal(deposits.length, settings.sources[resource].count * 2)
        for (const faction of factions) {
          const base = map.bases[faction]
          assert.ok(deposits.some(at => distance(base, at) <= TILE * 4.5 &&
            match.availableDeposit(faction, at) && findPath(map, base, at, [], unitStats[faction].worker.radius)
              .some(point => distance(at, point) < 49)), `${id} ${seed} ${faction} missing ${resource}`)
        }
      }
    }
    assert.ok(starts.size >= 3, `${id} only has ${starts.size} starts`)
  }
})

test('new battlefields offer a route across the map and support custom resource counts', () => {
  for (const id of ['pinewatch-vale', 'ironbreak-pass', 'twinmere-basin'] as const) {
    const settings = defaultMatchSettings(id)
    assert.deepEqual(parseMatchSettings(settings), settings)
    settings.sources.gold.count = MAX_DEPOSITS
    settings.sources.stone.count = 1
    settings.sources.wood.count = 0
    const map = mapForSettings(settings, 21)
    assert.deepEqual(tileTypes.map(tile => map.tiles.filter(kind => kind === tile).length), [48, 2, 0])
    const route = findPath(map, map.bases.human, map.bases.orc, [], 13)
    assert.deepEqual(route.at(-1), map.bases.orc, id)
  }
})

test('checkpoint restoration keeps the chosen terrain, starts and resource settings', () => {
  const settings = defaultMatchSettings('twinmere-basin')
  for (const kind of resourceKinds) settings.sources[kind].count = 1
  const match = Match.configured(settings, 5831)
  const saved = structuredClone(match.checkpoint())
  const restored = Match.restore(saved)
  assert.equal(saved.mapSeed, 5831)
  assert.deepEqual(restored.map, match.map)
  assert.deepEqual(restored.view('human'), match.view('human'))
  assert.notDeepEqual(mapForSettings(settings, 5832).bases, match.map.bases)
  const fixed = Match.start({ ...defaultMatchSettings(), randomStarts: false })
  assert.equal(fixed.map.seed, undefined)
})
