type Sound = 'order' | 'build' | 'train' | 'shot' | 'hit' | 'fallen' | 'alert'
type Tone = readonly [OscillatorType, number, number, number, number, number]
type Noise = readonly [BiquadFilterType, number, number, number]

const preferenceKey = 'ash-and-iron-sound'
const sounds: Record<Sound, { tones: readonly Tone[], noise?: Noise }> = {
  alert: { tones: [['triangle', 340, 300, 0.16, 0.18, 0], ['triangle', 420, 330, 0.23, 0.16, 0.17]] },
  order: { tones: [['triangle', 265, 190, 0.07, 0.11, 0]], noise: ['bandpass', 880, 0.045, 0.10] },
  build: { tones: [['triangle', 236, 104, 0.09, 0.15, 0], ['triangle', 310, 130, 0.08, 0.09, 0.08]], noise: ['bandpass', 790, 0.072, 0.20] },
  train: { tones: [['triangle', 262, 256, 0.12, 0.14, 0], ['triangle', 393, 380, 0.16, 0.12, 0.065]] },
  shot: { tones: [['triangle', 490, 185, 0.085, 0.11, 0]], noise: ['bandpass', 1500, 0.09, 0.31] },
  hit: { tones: [['triangle', 174, 67, 0.11, 0.16, 0], ['sine', 750, 630, 0.10, 0.05, 0.008]], noise: ['highpass', 1300, 0.09, 0.25] },
  fallen: { tones: [['sawtooth', 126, 53, 0.23, 0.07, 0], ['triangle', 80, 40, 0.18, 0.15, 0.045]], noise: ['lowpass', 580, 0.18, 0.32] },
}

function soundPreference() {
  try { return localStorage.getItem(preferenceKey) !== 'off' } catch { return true }
}

// Short original synthesized sounds evoke low-resolution fantasy game effects.
export class BattleAudio {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private lastPlayed = new Map<Sound, number>()
  enabled = soundPreference()

  async unlock() {
    if (!this.enabled || this.context?.state === 'running') return
    try {
      if (!this.context) {
        const ctx = new AudioContext()
        this.context = ctx
        this.master = ctx.createGain()
        this.master.gain.value = 0.32
        this.master.connect(ctx.destination)
        this.noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.2), ctx.sampleRate)
        const samples = this.noise.getChannelData(0)
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
      }
      await this.context.resume()
    } catch {
      // A later user gesture can retry audio restricted by the browser.
    }
  }

  toggle() {
    this.enabled = !this.enabled
    try { localStorage.setItem(preferenceKey, this.enabled ? 'on' : 'off') } catch { /* storage is optional */ }
    if (this.master) this.master.gain.value = this.enabled ? 0.32 : 0
    if (this.enabled) void this.unlock().then(() => this.play('order'))
  }

  play(kind: Sound) {
    const ctx = this.context
    const master = this.master
    if (!this.enabled || !ctx || !master || ctx.state !== 'running') return
    const now = ctx.currentTime
    if (now - (this.lastPlayed.get(kind) ?? -Infinity) < 0.085) return
    this.lastPlayed.set(kind, now)
    const { tones, noise } = sounds[kind]
    const envelope = (start: number, duration: number, volume: number) => {
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.001, start)
      gain.gain.linearRampToValueAtTime(volume, start + 0.005)
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration)
      gain.connect(master)
      return gain
    }
    for (const [type, from, to, duration, volume, delay] of tones) {
      const start = now + delay
      const tone = ctx.createOscillator()
      const gain = envelope(start, duration, volume)
      tone.type = type
      tone.frequency.setValueAtTime(from, start)
      tone.frequency.exponentialRampToValueAtTime(to, start + duration)
      tone.connect(gain)
      tone.onended = () => { tone.disconnect(); gain.disconnect() }
      tone.start(start)
      tone.stop(start + duration)
    }
    if (noise && this.noise) {
      const [type, frequency, duration, volume] = noise
      const source = ctx.createBufferSource()
      const filter = ctx.createBiquadFilter()
      const gain = envelope(now, duration, volume)
      source.buffer = this.noise
      filter.type = type
      filter.frequency.value = frequency
      filter.Q.value = 0.7
      source.connect(filter).connect(gain)
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect() }
      source.start(now)
      source.stop(now + duration)
    }
  }
}
