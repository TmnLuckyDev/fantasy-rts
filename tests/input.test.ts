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
