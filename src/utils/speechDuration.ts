// Estimate how long it takes to speak text at the given TTS rate.
// Assumes ~140 words per minute at rate=1.0, with a 500ms breathing margin.
const WPM = 140

export function estimateDuration(text: string, rate: number): number {
  const words = text.trim().split(/\s+/).length
  const ms = (words / WPM) * 60_000 / rate
  return Math.round(ms) + 500
}
