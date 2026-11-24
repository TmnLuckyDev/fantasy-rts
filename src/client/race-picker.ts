import { factionNames, races } from '../shared/protocol.ts'
import type { Race } from '../shared/protocol.ts'
import { paintPortrait } from './portraits.ts'

const raceCards: Record<Race, string> = {
  human: 'Flexible infantry · Moderate mobility',
  orc: 'Fast attacks · Shorter ranged reach',
  dwarf: 'Strong siege · Slow armies',
  elf: 'Fast archers · Fragile troops',
  undead: 'Cheap skeletons · Slow economy'
}

export function populateRacePicker(container: HTMLElement, opponentChoice: HTMLSelectElement) {
  const buttons = races.map(race => {
    const choice = document.createElement('button')
    choice.className = 'faction ' + race
    choice.type = 'button'
    choice.dataset.faction = race
    choice.setAttribute('aria-label', factionNames[race])
    choice.setAttribute('aria-pressed', String(race === 'human'))
    const icon = document.createElement('canvas')
    icon.className = 'race-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.width = icon.height = 48
    paintPortrait(icon, race, 'headquarters')
    const copy = document.createElement('span')
    const title = document.createElement('strong')
    title.textContent = factionNames[race]
    const description = document.createElement('small')
    description.textContent = raceCards[race]
    copy.append(title, description)
    choice.append(icon, copy)
    opponentChoice.add(new Option(factionNames[race], race))
    return choice
  })
  container.replaceChildren(...buttons)
  return buttons
}
