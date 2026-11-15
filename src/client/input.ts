import type { Point } from '../shared/protocol.ts'

export type SelectionRect = { from: Point, to: Point }

type Actions = {
  select: (point: Point, append: boolean, touch: boolean) => void
  selectBox: (rect: SelectionRect, append: boolean) => void
  order: (point: Point) => void
  pan: (dx: number, dy: number) => void
  zoom: (point: Point, ratio: number) => void
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export class BattlefieldInput {
  boxMode = false
  selection: SelectionRect | null = null
  private pointers = new Map<number, Point>()
  private down: Point | null = null
  private didGesture = false
  private listeners = new AbortController()

  constructor(private element: HTMLElement, private actions: Actions) {
    const options = { signal: this.listeners.signal }
    element.addEventListener('contextmenu', event => event.preventDefault(), options)
    element.addEventListener('pointerdown', this.start, options)
    element.addEventListener('pointermove', this.move, options)
    element.addEventListener('pointerup', this.end, options)
    element.addEventListener('pointercancel', this.cancel, options)
    element.addEventListener('lostpointercapture', this.cancel, options)
    element.addEventListener('wheel', event => {
      event.preventDefault()
      this.actions.zoom(this.point(event), Math.exp(-event.deltaY * 0.0012))
    }, { ...options, passive: false })
  }

  destroy() { this.listeners.abort() }

  private point(event: MouseEvent): Point {
    const bounds = this.element.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }

  private start = (event: PointerEvent) => {
    const point = this.point(event)
    if (event.button === 2) {
      event.preventDefault()
      this.actions.order(point)
      return
    }
    if (event.button !== 0) return
    this.element.setPointerCapture(event.pointerId)
    this.pointers.set(event.pointerId, point)
    if (this.pointers.size === 1) {
      this.down = point
      this.didGesture = false
    } else {
      this.didGesture = true
      this.selection = null
    }
  }

  private move = (event: PointerEvent) => {
    const previous = this.pointers.get(event.pointerId)
    if (!previous) return
    const point = this.point(event)
    this.pointers.set(event.pointerId, point)
    if (this.pointers.size === 2) {
      const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)?.[1]
      if (!other) return
      const before = middle(previous, other)
      const after = middle(point, other)
      this.actions.pan(after.x - before.x, after.y - before.y)
      const oldDistance = distance(previous, other)
      if (oldDistance > 6) this.actions.zoom(after, Math.max(0.85, Math.min(1.18, distance(point, other) / oldDistance)))
      return
    }
    if (this.didGesture || !this.down || distance(point, this.down) < 6) return
    if (event.pointerType === 'mouse' || this.boxMode) this.selection = { from: this.down, to: point }
  }

  private end = (event: PointerEvent) => {
    if (!this.pointers.delete(event.pointerId)) return
    if (this.didGesture || this.pointers.size > 0 || !this.down) return
    const point = this.point(event)
    if (this.selection) this.actions.selectBox({ from: this.selection.from, to: point }, event.shiftKey)
    else if (distance(this.down, point) < 10) this.actions.select(point, event.shiftKey, event.pointerType !== 'mouse')
    this.down = null
    this.selection = null
  }

  private cancel = (event: PointerEvent) => {
    if (!this.pointers.delete(event.pointerId)) return
    this.down = null
    this.selection = null
    this.didGesture = true
  }
}
