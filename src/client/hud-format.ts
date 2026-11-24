import type { Cost } from '../shared/economy.ts'
import { entityNames, resourceKinds } from '../shared/protocol.ts'
import type { Entity, Race } from '../shared/protocol.ts'

export function costLabel(cost: Cost) {
  return resourceKinds.flatMap(kind => cost[kind] ? [cost[kind] + ' ' + kind] : []).join(' · ') || 'No cost'
}

export function percentage(progress: number) {
  return Math.floor(progress * 100) + '%'
}

export function constructionSummary(entity: Entity) {
  const progress = percentage(entity.construction ?? 0)
  if (entity.constructionStatus === 'queued') return 'Queued · ' + progress
  if (entity.constructionStatus === 'paused') return 'Paused · ' + progress
  return 'Building · ' + progress + (entity.constructionSeconds === undefined ? '' : ' · est. ' + entity.constructionSeconds + 's')
}

export function trainingSummary(training: NonNullable<Entity['training']>, race: Race) {
  const names = entityNames[race]
  const runs = training.queue ?? []
  const waiting = runs.map((run, index) => ({ ...run, count: run.count - Number(index === 0) }))
    .filter(run => run.count > 0)
  const labels = waiting.slice(0, 5).map(run => names[run.kind] + ' × ' + run.count)
  if (waiting.length > 5) labels.push('+' + (waiting.length - 5) + ' batches')
  const active = names[training.kind] + ' · ' + percentage(training.progress) +
    (training.seconds === undefined ? '' : ' · ' + training.seconds + 's')
  return labels.length ? active + ' → ' + labels.join(', ') : active
}
