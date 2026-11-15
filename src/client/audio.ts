export class BattleAudio {
  private context: AudioContext | null = null
  enabled = false
  private lastSound = 0

  async toggle() {
    this.enabled = !this.enabled
    if (this.enabled) {
      try {
        this.context ??= new AudioContext()
        await this.context.resume()
        this.play('order')
      } catch {
        this.enabled = false
      }
    }
    return this.enabled
  }

  play(kind: 'order' | 'shot' | 'hit' | 'fallen') {
    const ctx = this.context
    if (!this.enabled || !ctx || ctx.state !== 'running' || ctx.currentTime - this.lastSound < 0.06) return
    this.lastSound = ctx.currentTime
    const profiles = {
      order: [340, 510, 0.08, 'sine'],
      shot: [740, 230, 0.07, 'triangle'],
      hit: [170, 46, 0.12, 'triangle'],
      fallen: [125, 36, 0.28, 'triangle']
    } as const
    const [start, end, duration, type] = profiles[kind]
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(start, ctx.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(end, ctx.currentTime + duration)
    gain.gain.setValueAtTime(0.085, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    oscillator.connect(gain).connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + duration)
  }
}
