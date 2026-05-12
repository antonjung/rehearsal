export type VoiceGender = 'male' | 'female' | 'unknown'

const FEMALE_NAMES = [
  'hazel', 'serena', 'susan', 'emma', 'amy', 'kate', 'libby',
  'martha', 'ava', 'alice', 'eleanor', 'karen', 'victoria', 'moira',
  'tessa', 'fiona', 'veena', 'samantha', 'zoe',
]
const MALE_NAMES = [
  'daniel', 'george', 'arthur', 'oliver', 'harry', 'james', 'thomas',
  'peter', 'william', 'gordon', 'lee', 'freddie', 'rishi', 'callum',
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
  return (
    v.lang === 'en-GB' ||
    v.lang.startsWith('en-GB') ||
    v.name.toLowerCase().includes('uk english') ||
    v.name.toLowerCase().includes('british')
  )
}

export interface GroupedVoices {
  male: SpeechSynthesisVoice[]
  female: SpeechSynthesisVoice[]
  unknown: SpeechSynthesisVoice[]
}

export function groupBritishVoices(voices: SpeechSynthesisVoice[]): GroupedVoices {
  const british = voices.filter(isBritishVoice)
  const result: GroupedVoices = { male: [], female: [], unknown: [] }
  for (const v of british) result[guessVoiceGender(v)].push(v)
  return result
}
