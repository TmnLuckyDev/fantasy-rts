import { trainedAt, trainingRule, unitTier } from '../shared/economy.ts'
import { hasHero } from '../shared/heroes.ts'
import { TICKS_PER_SECOND } from '../shared/match-settings.ts'
import { entityNames, buildingKinds, isHeroKind, unitKinds } from '../shared/protocol.ts'
import type { Entity, Race, Population, Resources, UnitKind } from '../shared/protocol.ts'
import { trainingTimeline } from '../shared/production.ts'

export class GlobalProduction {
  private readonly rows = new Map<UnitKind, { row: HTMLElement, detail: HTMLElement, label: HTMLElement,
    portrait: HTMLCanvasElement, buttons: HTMLButtonElement[] }>()
  private readonly status = document.createElement('p')
  private readonly total = document.createElement('strong')
  private readonly locked = document.createElement('details')
  private readonly requirements = document.createElement('p')

  constructor(panel: HTMLElement, order: (unit: UnitKind, count: number) => void,
    private paint: (canvas: HTMLCanvasElement, faction: Race, kind: UnitKind) => void) {
    this.status.setAttribute('role', 'status')
    this.status.className = 'training-feedback'
    panel.append(this.total, this.status)
    for (const kind of unitKinds) {
      const row = document.createElement('div')
      row.className = 'global-train-row'
      row.hidden = true
      const portrait = document.createElement('canvas')
      portrait.width = portrait.height = 32
      portrait.setAttribute('aria-hidden', 'true')
      const caption = document.createElement('div')
      const label = document.createElement('strong')
      const detail = document.createElement('small')
      caption.append(label, detail)
      row.append(portrait, caption)
      const counts = isHeroKind(kind) ? [1] : [1, 5, 10]
      const buttons = counts.map(count => {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = '+' + count
        button.onclick = () => { this.message(''); order(kind, count) }
        row.append(button)
        return button
      })
      this.rows.set(kind, { row, label, detail, portrait, buttons })
      panel.append(row)
    }
    const summary = document.createElement('summary')
    summary.textContent = 'Locked recruits'
    this.locked.append(summary, this.requirements)
    panel.append(this.locked)
  }

  message(text: string) { if (this.status.textContent !== text) this.status.textContent = text }

  update(faction: Race, entities: readonly Entity[], resources: Resources, population: Population, hallLevel: number) {
    const ready = new Map<UnitKind, number>()
    const queued = new Map<UnitKind, { count: number, end: number }>()
    let total = 0
    let end = 0
    for (const building of entities) {
      if (building.construction !== undefined) continue
      for (const kind of trainedAt(building.kind, faction)) ready.set(kind, (ready.get(kind) ?? 0) + 1)
      const active = building.training
      if (!active?.queue?.length) continue
      const first = Math.round((1 - active.progress) * trainingRule(active.kind, faction).ticks)
      const timeline = trainingTimeline(active.queue, first, faction)
      end = Math.max(end, timeline.ticks)
      for (const run of timeline.runs) {
        const summary = queued.get(run.kind) ?? { count: 0, end: 0 }
        summary.count += run.count
        summary.end = Math.max(summary.end, run.end)
        queued.set(run.kind, summary)
        total += run.count
      }
    }
    const hero = hasHero(entities)
    const available = Math.max(0, population.limit - population.used - population.reserved)
    const headline = total ? total + ' queued · est. ' + Math.ceil(end / TICKS_PER_SECOND) + 's total' : ready.size ? 'No troops queued' : 'Build a production building first'
    if (headline !== this.total.textContent) this.total.textContent = headline
    const blocked = new Set<string>()
    const missingBuildings: string[] = []
    for (const [kind, ui] of this.rows) {
      const buildings = ready.get(kind) ?? 0
      ui.row.hidden = !buildings
      if (!buildings) {
        const producers = (['headquarters', ...buildingKinds] as const).filter(site => trainedAt(site, faction).includes(kind))
        if (producers.length) missingBuildings.push(entityNames[faction][kind] + ' requires ' +
          producers.map(site => entityNames[faction][site]).join(' or '))
        continue
      }
      const rule = trainingRule(kind, faction)
      const name = entityNames[faction][kind]
      if (ui.label.textContent !== name) ui.label.textContent = name
      this.paint(ui.portrait, faction, kind)
      const queue = queued.get(kind)
      const detail = rule.gold + ' gold' + (rule.wood ? ' · ' + rule.wood + ' wood' : '') + ' · ' + rule.population + ' pop · ' + buildings + ' ready' +
        (queue ? ' · ' + queue.count + ' queued · est. ' + Math.ceil(queue.end / TICKS_PER_SECOND) + 's' : '')
      if (ui.detail.textContent !== detail) ui.detail.textContent = detail
      ui.buttons.forEach((button, index) => {
        const count = [1, 5, 10][index]
        const error = unitTier(kind) > hallLevel ? 'Requires Town Hall 3' : isHeroKind(kind) && hero ? 'Hero already active or queued' :
          resources.gold < count * rule.gold ? 'Need more gold' : resources.wood < count * (rule.wood ?? 0) ? 'Need more wood' : available < count * rule.population ? 'Need more population' : ''
        if (error && !isHeroKind(kind)) blocked.add(error)
        const label = 'Train ' + count + ' ' + name + (error ? ' · ' + error : '')
        button.disabled = Boolean(error)
        button.title = label
        if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label)
      })
    }
    const missing = missingBuildings.join(' · ')
    if (this.requirements.textContent !== missing) this.requirements.textContent = missing
    this.locked.hidden = !missing
    this.total.dataset.limits = [...blocked].join(' · ')
  }
}
