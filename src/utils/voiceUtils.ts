export interface TtsVoice {
  name: string
  lang: string
  voiceURI: string
  label?: string
}

export interface VoiceLocaleGroup {
  lang: string
  label: string
  voices: TtsVoice[]
}

function localeLabel(lang: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) ?? lang
  } catch {
    return lang
  }
}

// Group voices by language/region, British English sorts first.
export function groupVoicesByLocale(voices: TtsVoice[]): VoiceLocaleGroup[] {
  const map = new Map<string, TtsVoice[]>()
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
