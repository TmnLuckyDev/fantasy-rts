import { createSoloRuntime } from './solo-runtime.ts'
import type { SoloInput } from './solo-runtime.ts'

const runtime = createSoloRuntime(message => self.postMessage(message))
self.addEventListener('message', (event: MessageEvent<SoloInput>) => runtime.receive(event.data))
