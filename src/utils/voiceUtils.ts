export type VoiceGender = 'male' | 'female' | 'unknown'

const FEMALE_NAMES = [
  'hazel', 'serena', 'susan', 'emma', 'amy', 'kate', 'libby',
  'martha', 'ava', 'alice', 'eleanor', 'karen', 'victoria', 'moira',
  'tessa', 'fiona', 'veena', 'samantha', 'zoe',
]
const MALE_NAMES = [
  'daniel', 'george', 'arthur', 'oliver', 'harry', 'james', 'thomas',
  'peter', 'william', 'gordon', 'lee', 'freddie', 'rishi', 'callum',
  'jamie', 'malcolm', 'liam', 'aaron', 'stefan', 'eddy', 'reed',
]

export function guessVoiceGender(v: SpeechSynthesisVoice): VoiceGender {
  const name = v.name.toLowerCase()
  if (/\bfemale\b/.test(name)) return 'female'
  if (/\bmale\b/.test(name)) return 'male'
  for (const n of FEMALE_NAMES) if (name.includes(n)) return 'female'
  for (const n of MALE_NAMES) if (name.includes(n)) return 'male'
  return 'unknown'
}

export function isBritishVoice(v: SpeechSynthesisVoice): boolean {
  // iOS uses en_GB (underscore) rather than en-GB in some voice entries
  const lang = v.lang.replace('_', '-')
  return (
    lang === 'en-GB' ||
    lang.startsWith('en-GB') ||
    v.name.toLowerCase().includes('uk english') ||
    v.name.toLowerCase().includes('british')
  )
}

export interface GroupedVoices {
  male: SpeechSynthesisVoice[]
  female: SpeechSynthesisVoice[]
  unknown: SpeechSynthesisVoice[]
}

export interface GroupedVoicesWithLabel extends GroupedVoices {
  label: string
  isFallback: boolean
}

function groupByGender(voices: SpeechSynthesisVoice[]): GroupedVoices {
  const result: GroupedVoices = { male: [], female: [], unknown: [] }
  for (const v of voices) result[guessVoiceGender(v)].push(v)
  return result
}

export function groupBritishVoices(voices: SpeechSynthesisVoice[]): GroupedVoices {
  return groupByGender(voices.filter(isBritishVoice))
}

// All available voices, grouped by gender. British voices sort to the top within each group.
export function groupVoices(voices: SpeechSynthesisVoice[]): GroupedVoicesWithLabel {
  const sorted = [...voices].sort((a, b) => {
    const ab = isBritishVoice(a) ? 0 : 1
    const bb = isBritishVoice(b) ? 0 : 1
    return ab - bb
  })
  return { ...groupByGender(sorted), label: 'All voices', isFallback: false }
}
