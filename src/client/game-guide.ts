import { trainedAt, trainingCost, trainingRule, unitTier } from '../shared/economy.ts'
import { heroAbilities, heroRoles } from '../shared/heroes.ts'
import { TICKS_PER_SECOND } from '../shared/match-settings.ts'
import { buildingKinds, entityNames, factionNames, isHeroKind, isRace, races, resourceKinds, unitKinds } from '../shared/protocol.ts'
import type { Race, UnitKind } from '../shared/protocol.ts'
import { raceRules, raceSkills } from '../shared/race-rules.ts'
import { siegeBalance, unitStats } from '../shared/units.ts'

const roles: Record<UnitKind, string> = {
  blade: 'Basic melee infantry for the front line.',
  polearm: 'Melee infantry with longer reach.',
  ranged: 'Back-line unit that attacks from a distance.',
  marksman: 'Specialist ranged unit for supporting the front line.',
  heavy: 'Heavy front-line unit that costs more population.',
  vanguard: heroRoles.vanguard + ' with a faction ability.',
  pathfinder: heroRoles.pathfinder + ' with a faction ability.',
  siege: 'Bombards buildings from farther away and deals bonus damage to structures.',
  support: 'Uses a faction ability to support your army.',
  scout: 'Fast reconnaissance unit. Use Explore to discover the map.',
  worker: 'Gathers resources, constructs buildings and repairs structures.',
  transport: 'Carries land troops and workers across water.',
  warship: 'Armed ship for naval battles and coastal attacks.'
}

function unitEntry(race: Race, kind: UnitKind, producers: string[]) {
  const stats = unitStats[race][kind]
  const rule = trainingRule(kind, race)
  const cost = trainingCost(kind, race)
  const skill = raceSkills[race]?.[kind]
  const entry = document.createElement('details')
  const name = document.createElement('summary')
  name.textContent = entityNames[race][kind]
  entry.append(name)
  const lines = [
    roles[kind],
    'Trained at ' + producers.join(' or ') + (unitTier(kind) > 1 ? ' · Headquarters level ' + unitTier(kind) : ''),
    resourceKinds.flatMap(resource => cost[resource] ? [cost[resource] + ' ' + resource] : []).join(' · ') +
      ' · ' + rule.population + ' population · ' + rule.ticks / TICKS_PER_SECOND + 's to train',
    stats.health + ' HP · ' + stats.armor + ' armor · ' + stats.speed + ' speed' +
      (stats.damage ? ' · ' + stats.damage + ' damage · ' + stats.range + ' range' : '')
  ]
  if (kind === 'siege') lines.push(Math.max(stats.range, siegeBalance.structureRange) + ' range against structures.')
  if (raceRules[race].ambush?.includes(kind)) lines.push('Can ambush from forests.')
  if (skill) lines.push(skill.name + ' · ' + skill.description + ' Cooldown ' + skill.cooldown / TICKS_PER_SECOND + 's.')
  else if (isHeroKind(kind)) {
    const ability = heroAbilities[kind]
    const effect = kind === 'vanguard' ? 'Temporarily increases nearby allies’ attack damage.' :
      'Hits up to ' + heroAbilities.pathfinder.maxTargets + ' nearby enemies.'
    lines.push(ability.name + ' · ' + effect + ' Cooldown ' + ability.cooldown / TICKS_PER_SECOND + 's.', ability.passive)
  }
  for (const line of lines) {
    const paragraph = document.createElement('p')
    paragraph.textContent = line
    entry.append(paragraph)
  }
  return entry
}

export function configureGameGuide() {
  const dialog = document.querySelector<HTMLDialogElement>('#game-guide')!
  const title = dialog.querySelector<HTMLHeadingElement>('#guide-title')!
  const howTo = dialog.querySelector<HTMLElement>('#guide-how-to')!
  const wiki = dialog.querySelector<HTMLElement>('#guide-wiki')!
  const raceChoice = dialog.querySelector<HTMLSelectElement>('#wiki-race')!
  const description = dialog.querySelector<HTMLElement>('#wiki-race-description')!
  const units = dialog.querySelector<HTMLElement>('#wiki-units')!
  const howToTab = dialog.querySelector<HTMLButtonElement>('#guide-how-to-tab')!
  const wikiTab = dialog.querySelector<HTMLButtonElement>('#guide-wiki-tab')!
  for (const race of races) raceChoice.add(new Option(factionNames[race], race))

  function drawWiki() {
    const race = raceChoice.value
    if (!isRace(race)) return
    description.textContent = raceRules[race].description
    const entries = unitKinds.flatMap(kind => {
      const producers = (['headquarters', ...buildingKinds] as const)
        .filter(building => trainedAt(building, race).includes(kind))
        .map(building => entityNames[race][building])
      return producers.length ? [unitEntry(race, kind, producers)] : []
    })
    units.replaceChildren(...entries)
  }

  function showSection(showWiki: boolean) {
    title.textContent = showWiki ? 'Game wiki' : 'How to play'
    wiki.hidden = !showWiki
    howTo.hidden = showWiki
    howToTab.setAttribute('aria-pressed', String(!showWiki))
    wikiTab.setAttribute('aria-pressed', String(showWiki))
    if (showWiki && !units.childElementCount) drawWiki()
    dialog.scrollTop = 0
  }

  raceChoice.onchange = drawWiki
  howToTab.onclick = () => showSection(false)
  wikiTab.onclick = () => showSection(true)
  document.querySelector<HTMLButtonElement>('#open-how-to')!.onclick = () => { showSection(false); dialog.showModal() }
  document.querySelector<HTMLButtonElement>('#open-wiki')!.onclick = () => { showSection(true); dialog.showModal() }
}
