import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BattlefieldInput } from '../src/client/input.ts'

test('a fresh primary touch clears a stale pointer and off-field release clears the gesture', () => {
  const view = new EventTarget()
  const document = Object.assign(new EventTarget(), { defaultView: view, hidden: false })
  const field = Object.assign(new EventTarget(), {
    ownerDocument: document,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: () => { throw Error('capture unavailable') }
  })
  let taps = 0
  const input = new BattlefieldInput(field as unknown as HTMLElement, {
    select: () => taps++,
    selectBox: () => assert.fail('unexpected drag'),
    order: () => assert.fail('unexpected order'),
    camera: () => assert.fail('unexpected pinch')
  })
  const pointer = (type: string, id: number, onField = true) =>
    Object.assign(new Event(type), {
      pointerId: id, isPrimary: true, pointerType: 'touch', button: 0, clientX: 15, clientY: 15,
      composedPath: () => onField ? [field, view] : [view]
    })
  field.dispatchEvent(pointer('pointerdown', 1))
  field.dispatchEvent(pointer('pointerdown', 2))
  view.dispatchEvent(pointer('pointerup', 2))
  assert.equal(taps, 1)
  field.dispatchEvent(pointer('pointerdown', 3))
  view.dispatchEvent(pointer('pointerup', 3, false))
  assert.equal(taps, 1)
  view.dispatchEvent(pointer('pointerup', 3))
  assert.equal(taps, 1)
  input.destroy()
})

test('panning and pinch consume both fingers through release, then short construction taps resume', t => {
  const view = new EventTarget()
  const document = Object.assign(new EventTarget(), { defaultView: view, hidden: false })
  const field = Object.assign(new EventTarget(), {
    ownerDocument: document,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture() {}
  })
  let frame: FrameRequestCallback | undefined
  Object.assign(globalThis, {
    requestAnimationFrame: (callback: FrameRequestCallback) => { frame = callback; return 1 },
    cancelAnimationFrame: () => { frame = undefined }
  })
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  })
  const camera: number[][] = []
  let taps = 0
  let drags = 0
  const input = new BattlefieldInput(field as unknown as HTMLElement, {
    select: () => taps++,
    selectBox: () => drags++,
    order: () => assert.fail('unexpected order'),
    touchDragThreshold: () => 24,
    camera: (from, to, ratio) => camera.push([to.x - from.x, ratio])
  })
  t.after(() => input.destroy())
  const pointer = (type: string, id: number, x: number, primary = id === 1) => {
    const event = Object.assign(new Event(type), {
      pointerId: id, isPrimary: primary, pointerType: 'touch', button: 0, clientX: x, clientY: 15,
      composedPath: () => [field, view]
    })
    ;(type === 'pointerup' || type === 'pointercancel' ? view : field).dispatchEvent(event)
  }
  pointer('pointerdown', 1, 20)
  pointer('pointermove', 1, 49)
  assert.ok(input.selection)
  pointer('pointerdown', 2, 120)
  assert.equal(input.selection, null)
  pointer('pointermove', 1, 69)
  pointer('pointermove', 2, 140)
  frame?.(0)
  assert.deepEqual(camera[0], [20, 1])
  pointer('pointermove', 2, 170)
  frame?.(16)
  assert.ok(camera[1][1] > 1.4)
  pointer('pointerup', 2, 170)
  pointer('pointermove', 1, 170)
  pointer('pointerup', 1, 170)
  assert.equal(taps + drags, 0)
  for (let i = 0; i < 10; i++) {
    pointer('pointerdown', 1, 20)
    pointer('pointermove', 1, 35)
    pointer('pointerup', 1, 35)
  }
  assert.equal(taps, 10)
  pointer('pointerdown', 1, 20)
  pointer('pointerup', 1, 50)
  assert.equal(drags, 1)
})
