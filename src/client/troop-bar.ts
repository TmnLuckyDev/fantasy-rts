import { entityNames, troopGroups } from '../shared/protocol.ts'
import type { ArmyTemplate, Entity, Race, TroopGroup } from '../shared/protocol.ts'
import { paintPortrait } from './portraits.ts'
import { targetTotal } from './army-group-details.ts'
import type { ArmyIndex } from './troop-groups.ts'

function createGroupButton(title: string, select: () => void, hideCount = false) {
  const button = document.createElement('button')
  button.type = 'button'
  button.title = title
  button.onclick = select
  const icon = document.createElement('canvas')
  icon.width = icon.height = 28
  icon.setAttribute('aria-hidden', 'true')
  const label = document.createElement('span')
  const count = document.createElement('span')
  count.className = 'troop-count'
  if (hideCount) count.setAttribute('aria-hidden', 'true')
  button.append(icon, label, count)
  return { button, icon, label, count }
}

type GroupButton = ReturnType<typeof createGroupButton>

export class TroopBar {
  private readonly standard = new Map<TroopGroup, GroupButton>()
  private readonly custom = new Map<number, GroupButton>()

  constructor(
    private readonly bar: HTMLElement,
    selectGroup: (group: TroopGroup) => void,
    private readonly selectTemplate: (id: number) => void
  ) {
    for (const group of troopGroups) {
      const ui = createGroupButton('Tap again to center the camera', () => selectGroup(group), true)
      if (group === 'all') ui.label.textContent = 'All troops'
      if (group === 'heroes') ui.label.textContent = 'Hero'
      this.standard.set(group, ui)
      bar.append(ui.button)
    }
  }

  draw(army: ArmyIndex, selected: TroopGroup | null, templates: readonly ArmyTemplate[],
    activeTemplate: number | null | undefined, selection: readonly Entity[], race: Race) {
    this.bar.hidden = !army.size && !templates.length
    this.drawTemplates(templates, activeTemplate, race)
    for (const [group, ui] of this.standard) {
      const members = army.get(group)
      const fixedShortcut = group === 'all' || group === 'heroes'
      ui.button.hidden = !members?.length && !fixedShortcut
      ui.button.disabled = !members?.length
      if (!members?.length) {
        if (fixedShortcut) {
          if (ui.count.textContent !== '0') ui.count.textContent = '0'
          const description = group === 'heroes' ? 'No living hero' : 'No living troops'
          if (ui.button.getAttribute('aria-description') !== description) ui.button.setAttribute('aria-description', description)
          if (ui.button.hasAttribute('aria-pressed')) ui.button.removeAttribute('aria-pressed')
          paintPortrait(ui.icon, race, group === 'heroes' ? 'vanguard' : 'blade')
        }
        continue
      }
      const kind = group === 'all' ? 'blade' : members[0].kind
      const label = group === 'all' ? 'All troops' : group === 'heroes' ? 'Hero' : entityNames[race][kind]
      if (ui.label.textContent !== label) ui.label.textContent = label
      const count = String(members.length)
      if (ui.count.textContent !== count) {
        ui.count.textContent = count
        ui.button.setAttribute('aria-description', count + ' living · Tap again to center camera')
      }
      const pressed = String(group === selected || (group === 'heroes' && selection.length === 1 && selection[0].id === members[0].id))
      if (ui.button.getAttribute('aria-pressed') !== pressed) ui.button.setAttribute('aria-pressed', pressed)
      paintPortrait(ui.icon, race, kind)
    }
  }

  private drawTemplates(templates: readonly ArmyTemplate[], activeTemplate: number | null | undefined, race: Race) {
    const present = new Set(templates.map(group => group.id))
    for (const [id, ui] of this.custom) {
      if (!present.has(id)) {
        ui.button.remove()
        this.custom.delete(id)
      }
    }
    const firstUnitType = this.standard.get('blade')!.button
    let previous = this.standard.get('heroes')!.button
    for (const group of templates) {
      let ui = this.custom.get(group.id)
      if (!ui) {
        ui = createGroupButton('Tap again to center. Hold or right-click to manage.', () => this.selectTemplate(group.id))
        ui.button.dataset.armyGroup = String(group.id)
        this.custom.set(group.id, ui)
      }
      if (previous.nextElementSibling !== ui.button) this.bar.insertBefore(ui.button, previous.nextElementSibling ?? firstUnitType)
      previous = ui.button
      const count = group.members.length + '/' + targetTotal(group)
      if (ui.count.textContent !== count) ui.count.textContent = count
      if (ui.label.textContent !== group.name) ui.label.textContent = group.name
      const pressed = String(activeTemplate === group.id)
      if (ui.button.getAttribute('aria-pressed') !== pressed) ui.button.setAttribute('aria-pressed', pressed)
      paintPortrait(ui.icon, race, group.targets[0]?.kind ?? 'blade')
    }
  }
}
