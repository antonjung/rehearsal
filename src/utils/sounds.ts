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

function tone(freq: number, duration: number, startOffset = 0, vol = 0.55): Promise<void> {
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

// Silently exercises the AudioContext pipeline. Unlike a plain timer delay,
// actually running a (silent) tone through the graph seems to be what keeps
// the OS audio session "live" between utterances — a bare setTimeout doesn't
// have the same effect, which is why lines preceded by the (audible) clip-start
// ping don't clip but otherwise-unprimed lines can.
export async function warmUpAudio(): Promise<void> {
  if (!ctx || ctx.state === 'closed') return
  if (ctx.state === 'suspended') await ctx.resume()
  return tone(440, 0.08, 0, 0)
}

export async function playClipStart(): Promise<void> {
  if (!ctx || ctx.state === 'closed') return
  // Ensure the context is running before scheduling tones — resume() in unlockAudio
  // is fire-and-forget, so the context may still be suspended when we get here.
  if (ctx.state === 'suspended') await ctx.resume()
  tone(523, 0.12, 0)           // C5 — short lead-in
  return tone(784, 0.22, 0.16) // G5 — ready cue
}

export function playPing(accuracy: number, threshold: number): Promise<void> {
  if (accuracy >= 100) return tone(880, 0.25)     // green: bright high
  if (accuracy >= threshold) return tone(660, 0.25) // yellow: mid
  return tone(330, 0.3)                              // red: low
}

export function playCompletion(): Promise<void> {
  return new Promise((resolve) => {
    if (!ctx || ctx.state === 'closed') { resolve(); return }
    tone(523, 0.35, 0)           // C5
    tone(784, 0.45, 0.3).then(resolve) // G5
  })
}
