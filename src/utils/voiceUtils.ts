export interface VoiceLocaleGroup {
  lang: string
  label: string
  voices: SpeechSynthesisVoice[]
}

function localeLabel(lang: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) ?? lang
  } catch {
    return lang
  }
}

// Group voices by language/region, same structure as iOS Settings.
// British English sorts first; within each group voices are alphabetical.
export function groupVoicesByLocale(voices: SpeechSynthesisVoice[]): VoiceLocaleGroup[] {
  const map = new Map<string, SpeechSynthesisVoice[]>()
  for (const v of voices) {
    const lang = v.lang.replace('_', '-') || 'unknown'
    if (!map.has(lang)) map.set(lang, [])
    map.get(lang)!.push(v)
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      const ukA = a === 'en-GB' || a.startsWith('en-GB-') ? 0 : 1
      const ukB = b === 'en-GB' || b.startsWith('en-GB-') ? 0 : 1
      if (ukA !== ukB) return ukA - ukB
      return localeLabel(a).localeCompare(localeLabel(b))
    })
    .map(([lang, vs]) => ({
      lang,
      label: localeLabel(lang),
      voices: vs.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }))
}
