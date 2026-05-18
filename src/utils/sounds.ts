let ctx: AudioContext | null = null

export function getAudioContext(): AudioContext | null { return ctx }

export function unlockAudio(): void {
  try {
    if (!ctx) {
      ctx = new AudioContext()
    } else if (ctx.state === 'suspended') {
      void ctx.resume()
    }
  } catch {
    // AudioContext unavailable
  }
}

function tone(freq: number, duration: number, startOffset = 0, vol = 0.35): Promise<void> {
  return new Promise((resolve) => {
    if (!ctx || ctx.state === 'closed') { resolve(); return }
    try {
      const t = ctx.currentTime + startOffset
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(vol, t + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration)
      osc.start(t)
      osc.stop(t + duration + 0.05)
      osc.onended = () => resolve()
    } catch {
      resolve()
    }
  })
}

export function playPing(accuracy: number, threshold: number): Promise<void> {
  if (accuracy >= 100) return tone(880, 0.2)     // green: bright high
  if (accuracy >= threshold) return tone(660, 0.2) // yellow: mid
  return tone(330, 0.25)                            // red: low
}

export function playCompletion(): Promise<void> {
  return new Promise((resolve) => {
    if (!ctx || ctx.state === 'closed') { resolve(); return }
    tone(523, 0.35, 0)           // C5
    tone(784, 0.45, 0.3).then(resolve) // G5
  })
}
