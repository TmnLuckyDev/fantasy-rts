import { mapOptions } from '../shared/map.ts'
import { ARMY_SCORE_PER_UNIT, DEPOSIT_STOCK_MAX, MAX_DEPOSITS, STARTING_RESOURCE_MAX, TIME_LIMIT_MAX_MINUTES,
  WORKER_LIMIT_MAX, MAX_POPULATION_CAP, defaultMatchSettings, parseMatchSettings, treeLimit } from '../shared/match-settings.ts'
import type { MatchReport, MatchSettings } from '../shared/match-settings.ts'
import { factionNames, factions, resourceKinds } from '../shared/protocol.ts'

const resourceName = { gold: 'Gold', wood: 'Wood', stone: 'Stone' }
const sourceName = { gold: 'Gold mines', stone: 'Stone quarries', wood: 'Trees' }
const format = new Intl.NumberFormat()
const preferenceKey = 'ash-and-iron-match-settings'

export function clockText(seconds: number) {
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
}

export class MatchSettingsMenu {
  private readonly dialog = document.querySelector<HTMLDialogElement>('#settings-dialog')!
  private readonly form = document.querySelector<HTMLFormElement>('#settings-form')!
  private readonly fields = document.querySelector<HTMLFieldSetElement>('#settings-fields')!
  private readonly save = document.querySelector<HTMLButtonElement>('#save-settings')!
  private readonly reset = document.querySelector<HTMLButtonElement>('#reset-settings')!
  private accept?: (settings: MatchSettings) => void
  private map: MatchSettings['map'] = 'ashford-expanded'

  constructor() {
    const groups = document.querySelector('#resource-settings')!
    for (const resource of ['gold', 'stone', 'wood'] as const) {
      const section = document.createElement('section')
      const title = document.createElement('h3')
      title.textContent = sourceName[resource]
      section.append(title)
      for (const [key, label, min, max] of [
        ['count', 'Sites per side', 0, MAX_DEPOSITS],
        ['stock', 'Stock per site', 1, DEPOSIT_STOCK_MAX],
        ['workers', 'Active workers per site', 1, WORKER_LIMIT_MAX],
        ['starting', 'Starting ' + resource, 0, STARTING_RESOURCE_MAX]
      ] as const) {
        const caption = document.createElement('label')
        caption.textContent = label
        const input = document.createElement('input')
        input.type = 'number'
        input.inputMode = 'numeric'
        input.name = resource + '-' + key
        input.min = String(min)
        input.max = String(max)
        input.required = key === 'count' || key === 'starting'
        if (!input.required) input.placeholder = 'Unlimited'
        caption.append(input)
        section.append(caption)
      }
      groups.append(section)
    }
    this.input('minutes').max = String(TIME_LIMIT_MAX_MINUTES)
    this.input('population-cap').max = String(MAX_POPULATION_CAP)
    document.querySelector('#score-rule')!.textContent =
      'At the time limit, one point per gold, wood or stone in reserve and ' + ARMY_SCORE_PER_UNIT +
      ' points per surviving soldier or hero. Equal scores draw. Losing your headquarters ends the match.'
    document.querySelector<HTMLButtonElement>('#close-settings')!.onclick = () => this.close()
    this.reset.onclick = () => this.fill(defaultMatchSettings(this.map))
    const mapInput = this.form.elements.namedItem('map') as HTMLSelectElement
    for (const map of mapOptions) {
      const option = document.createElement('option')
      option.value = map.id
      const edition = map.id === 'ashford-original' ? ' Classic' : map.id === 'ashford-expanded' ? ' Expanded' : ''
      option.textContent = map.name + edition + ' · ' + map.width + ' × ' + map.height
      mapInput.append(option)
    }
    mapInput.onchange = () => {
      const map = mapInput.value as MatchSettings['map']
      const defaults = defaultMatchSettings(map)
      const previous = defaultMatchSettings(this.map)
      for (const resource of resourceKinds) {
        const field = this.input(resource + '-count')
        if (field.valueAsNumber === previous.sources[resource].count) field.value = String(defaults.sources[resource].count)
      }
      const wood = this.input('wood-count')
      wood.max = String(treeLimit(map))
      if (wood.valueAsNumber > treeLimit(map)) wood.value = wood.max
      this.map = map
    }
    this.form.onsubmit = event => {
      event.preventDefault()
      if (!this.accept) return
      const settings = defaultMatchSettings(this.map)
      const number = (key: string) => this.input(key).value === '' ? null : this.input(key).valueAsNumber
      settings.randomStarts = this.input('random-starts').checked
      settings.minutes = number('minutes')
      settings.populationCap = this.input('population-cap').valueAsNumber
      for (const resource of resourceKinds) {
        settings.sources[resource] = {
          count: this.input(resource + '-count').valueAsNumber,
          stock: number(resource + '-stock'),
          workers: number(resource + '-workers')
        }
        settings.starting[resource] = this.input(resource + '-starting').valueAsNumber
      }
      const valid = parseMatchSettings(settings)
      if (!valid) return
      this.accept(valid)
      this.close()
    }
  }

  load() {
    try { return parseMatchSettings(JSON.parse(localStorage.getItem(preferenceKey) ?? 'null')) ?? defaultMatchSettings() }
    catch { return defaultMatchSettings() }
  }

  remember(settings: MatchSettings) {
    try { localStorage.setItem(preferenceKey, JSON.stringify(settings)) } catch { /* Storage is optional. */ }
  }

  show(settings: MatchSettings, accept?: (settings: MatchSettings) => void) {
    this.accept = accept
    this.fields.disabled = !accept
    this.reset.hidden = this.save.hidden = !accept
    this.fill(settings)
    if (!this.dialog.open) this.dialog.showModal()
  }

  close() { this.dialog.close() }

  private input(name: string) { return this.form.elements.namedItem(name) as HTMLInputElement }

  private fill(settings: MatchSettings) {
    this.map = settings.map
    const mapInput = this.form.elements.namedItem('map') as HTMLSelectElement
    mapInput.value = settings.map
    this.input('random-starts').checked = settings.randomStarts !== false
    this.input('minutes').value = String(settings.minutes ?? '')
    this.input('population-cap').value = String(settings.populationCap ?? defaultMatchSettings().populationCap)
    this.input('wood-count').max = String(treeLimit(settings.map))
    for (const resource of resourceKinds) {
      const { count, stock, workers } = settings.sources[resource]
      this.input(resource + '-count').value = String(count)
      this.input(resource + '-stock').value = String(stock ?? '')
      this.input(resource + '-workers').value = String(workers ?? '')
      this.input(resource + '-starting').value = String(settings.starting[resource])
    }
  }
}

export function drawMatchStats(target: HTMLElement, report?: MatchReport) {
  target.hidden = !report
  target.replaceChildren()
  if (!report) return
  const table = document.createElement('table')
  const caption = table.createCaption()
  caption.textContent = 'Match stats · ' + clockText(report.elapsedSeconds) + ' played'
  const heading = table.createTHead().insertRow()
  for (const text of ['Statistic', ...factions.map(faction => factionNames[faction])]) {
    const cell = document.createElement('th')
    cell.scope = 'col'
    cell.textContent = text
    heading.append(cell)
  }
  const body = table.createTBody()
  const row = (label: string, values: number[]) => {
    const line = body.insertRow()
    const title = document.createElement('th')
    title.scope = 'row'
    title.textContent = label
    line.append(title)
    for (const value of values) line.insertCell().textContent = format.format(value)
  }
  for (const resource of resourceKinds) row(resourceName[resource] + ' gathered', factions.map(faction => report.sides[faction].gathered[resource]))
  for (const [name, metric] of [
    ['Soldiers and heroes trained', 'troopsTrained'], ['Units trained (including workers)', 'unitsTrained'],
    ['Buildings completed', 'buildingsBuilt'], ['Enemy buildings razed', 'buildingsRazed'],
    ['Enemy units killed', 'enemiesKilled'], ['Units lost', 'unitsLost'], ['Buildings lost', 'buildingsLost'],
    ['Surviving army', 'army']
  ] as const) row(name, factions.map(faction => report.sides[faction][metric]))
  row('Resources in reserve', factions.map(faction => resourceKinds.reduce((total, resource) => total + report.sides[faction].bank[resource], 0)))
  row('Final score', factions.map(faction => report.sides[faction].score))
  target.append(table)
}
