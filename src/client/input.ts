import type { Point } from '../shared/protocol.ts'

export type SelectionRect = { from: Point, to: Point }

type Actions = {
  select: (point: Point, append: boolean, touch: boolean) => void
  selectBox: (rect: SelectionRect, append: boolean) => void
  order: (point: Point) => void
  camera: (from: Point, to: Point, zoomRatio: number) => void
}

type CameraGesture = { center: Point, span: number, initialSpan: number, zooming: boolean }
const dragThreshold = 8
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export class BattlefieldInput {
  selection: SelectionRect | null = null
  private pointers = new Map<number, Point>()
  private down: Point | null = null
  private gesture: CameraGesture | null = null
  private frame = 0
  private listeners = new AbortController()

  private readonly element: HTMLElement
  private readonly actions: Actions

  constructor(element: HTMLElement, actions: Actions) {
    this.element = element
    this.actions = actions
    const options = { signal: this.listeners.signal }
    element.addEventListener('contextmenu', event => event.preventDefault(), options)
    element.addEventListener('pointerdown', this.start, options)
    element.addEventListener('pointermove', this.move, options)
    const document = element.ownerDocument
    const capture = { ...options, capture: true }
    document.defaultView?.addEventListener('pointerup', this.end, capture)
    document.defaultView?.addEventListener('pointercancel', this.cancel, capture)
    document.defaultView?.addEventListener('blur', this.resetInput, options)
    document.defaultView?.addEventListener('pagehide', this.resetInput, options)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.resetInput()
    }, options)
    element.addEventListener('lostpointercapture', this.cancel, options)
    element.addEventListener('wheel', event => {
      event.preventDefault()
      const point = this.point(event)
      this.actions.camera(point, point, Math.exp(-event.deltaY * 0.0012))
    }, { ...options, passive: false })
  }

  destroy() {
    this.listeners.abort()
    this.resetInput()
  }

  resetInput = () => {
    this.pointers.clear()
    this.down = null
    this.selection = null
    this.resetGesture()
  }

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
    // A new primary touch means the browser has no earlier active touch contacts.
    if (event.pointerType === 'touch' && event.isPrimary) this.resetInput()
    try {
      this.element.setPointerCapture(event.pointerId)
    } catch {
      // A pointer that has already ended can no longer be captured.
    }
    this.pointers.set(event.pointerId, point)
    if (this.pointers.size === 1) {
      this.down = point
    } else {
      this.down = null
      this.selection = null
      this.resetGesture()
    }
  }

  private move = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId)) return
    const point = this.point(event)
    this.pointers.set(event.pointerId, point)
    if (this.gesture) {
      if (!this.frame) this.frame = requestAnimationFrame(this.updateGesture)
    } else if (this.down && (this.selection || distance(this.down, point) >= dragThreshold)) {
      this.selection = { from: this.down, to: point }
    }
  }

  private updateGesture = () => {
    this.frame = 0
    const gesture = this.gesture
    if (!gesture) return
    const [a, b] = this.pointers.values()
    const center = middle(a, b)
    const span = Math.max(8, distance(a, b))
    // Sample both pointers once per frame so translation does not look like a pinch.
    gesture.zooming ||= Math.abs(span - gesture.initialSpan) >= Math.max(9, gesture.initialSpan * 0.07)
    this.actions.camera(gesture.center, center, gesture.zooming ? span / gesture.span : 1)
    gesture.center = center
    gesture.span = span
  }

  private resetGesture() {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    this.gesture = null
    if (this.pointers.size === 2) {
      const [a, b] = this.pointers.values()
      const span = Math.max(8, distance(a, b))
      this.gesture = { center: middle(a, b), span, initialSpan: span, zooming: false }
    }
  }

  private end = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId)) return
    const point = this.point(event)
    if (this.frame) {
      cancelAnimationFrame(this.frame)
      this.pointers.set(event.pointerId, point)
      this.updateGesture()
    }
    this.cancel(event)
  }

  private cancel = (event: PointerEvent) => {
    if (!this.pointers.delete(event.pointerId)) return
    const from = this.down
    const dragged = Boolean(this.selection)
    this.down = null
    this.selection = null
    this.resetGesture()
    if (!from || event.type !== 'pointerup' || !event.composedPath().includes(this.element)) return
    const to = this.point(event)
    if (dragged || distance(from, to) >= dragThreshold) this.actions.selectBox({ from, to }, event.shiftKey)
    else this.actions.select(to, event.shiftKey, event.pointerType !== 'mouse')
  }
}
