import type { TtsVoice } from './voiceUtils'

export const DEFAULT_VOICE = 'en-GB-Neural2-B'

export const NEURAL2_VOICES: TtsVoice[] = [
  // British English
  { name: 'en-GB-Neural2-A', lang: 'en-GB', voiceURI: 'en-GB-Neural2-A', label: 'Neural2-A (Female)' },
  { name: 'en-GB-Neural2-B', lang: 'en-GB', voiceURI: 'en-GB-Neural2-B', label: 'Neural2-B (Male)' },
  { name: 'en-GB-Neural2-C', lang: 'en-GB', voiceURI: 'en-GB-Neural2-C', label: 'Neural2-C (Female)' },
  { name: 'en-GB-Neural2-D', lang: 'en-GB', voiceURI: 'en-GB-Neural2-D', label: 'Neural2-D (Male)' },
  { name: 'en-GB-Neural2-F', lang: 'en-GB', voiceURI: 'en-GB-Neural2-F', label: 'Neural2-F (Female)' },
  // American English
  { name: 'en-US-Neural2-A', lang: 'en-US', voiceURI: 'en-US-Neural2-A', label: 'Neural2-A (Female)' },
  { name: 'en-US-Neural2-C', lang: 'en-US', voiceURI: 'en-US-Neural2-C', label: 'Neural2-C (Female)' },
  { name: 'en-US-Neural2-D', lang: 'en-US', voiceURI: 'en-US-Neural2-D', label: 'Neural2-D (Male)' },
  { name: 'en-US-Neural2-E', lang: 'en-US', voiceURI: 'en-US-Neural2-E', label: 'Neural2-E (Female)' },
  { name: 'en-US-Neural2-F', lang: 'en-US', voiceURI: 'en-US-Neural2-F', label: 'Neural2-F (Female)' },
  { name: 'en-US-Neural2-G', lang: 'en-US', voiceURI: 'en-US-Neural2-G', label: 'Neural2-G (Female)' },
  { name: 'en-US-Neural2-H', lang: 'en-US', voiceURI: 'en-US-Neural2-H', label: 'Neural2-H (Female)' },
  { name: 'en-US-Neural2-I', lang: 'en-US', voiceURI: 'en-US-Neural2-I', label: 'Neural2-I (Male)' },
  { name: 'en-US-Neural2-J', lang: 'en-US', voiceURI: 'en-US-Neural2-J', label: 'Neural2-J (Male)' },
  // Australian English
  { name: 'en-AU-Neural2-A', lang: 'en-AU', voiceURI: 'en-AU-Neural2-A', label: 'Neural2-A (Female)' },
  { name: 'en-AU-Neural2-B', lang: 'en-AU', voiceURI: 'en-AU-Neural2-B', label: 'Neural2-B (Male)' },
  { name: 'en-AU-Neural2-C', lang: 'en-AU', voiceURI: 'en-AU-Neural2-C', label: 'Neural2-C (Female)' },
  { name: 'en-AU-Neural2-D', lang: 'en-AU', voiceURI: 'en-AU-Neural2-D', label: 'Neural2-D (Male)' },
  // Indian English
  { name: 'en-IN-Neural2-A', lang: 'en-IN', voiceURI: 'en-IN-Neural2-A', label: 'Neural2-A (Female)' },
  { name: 'en-IN-Neural2-B', lang: 'en-IN', voiceURI: 'en-IN-Neural2-B', label: 'Neural2-B (Male)' },
  { name: 'en-IN-Neural2-C', lang: 'en-IN', voiceURI: 'en-IN-Neural2-C', label: 'Neural2-C (Male)' },
  { name: 'en-IN-Neural2-D', lang: 'en-IN', voiceURI: 'en-IN-Neural2-D', label: 'Neural2-D (Female)' },
  // French
  { name: 'fr-FR-Neural2-A', lang: 'fr-FR', voiceURI: 'fr-FR-Neural2-A', label: 'Neural2-A (Female)' },
  { name: 'fr-FR-Neural2-B', lang: 'fr-FR', voiceURI: 'fr-FR-Neural2-B', label: 'Neural2-B (Male)' },
  { name: 'fr-FR-Neural2-C', lang: 'fr-FR', voiceURI: 'fr-FR-Neural2-C', label: 'Neural2-C (Female)' },
  { name: 'fr-FR-Neural2-D', lang: 'fr-FR', voiceURI: 'fr-FR-Neural2-D', label: 'Neural2-D (Male)' },
  { name: 'fr-FR-Neural2-E', lang: 'fr-FR', voiceURI: 'fr-FR-Neural2-E', label: 'Neural2-E (Female)' },
  // German
  { name: 'de-DE-Neural2-A', lang: 'de-DE', voiceURI: 'de-DE-Neural2-A', label: 'Neural2-A (Female)' },
  { name: 'de-DE-Neural2-B', lang: 'de-DE', voiceURI: 'de-DE-Neural2-B', label: 'Neural2-B (Male)' },
  { name: 'de-DE-Neural2-C', lang: 'de-DE', voiceURI: 'de-DE-Neural2-C', label: 'Neural2-C (Female)' },
  { name: 'de-DE-Neural2-D', lang: 'de-DE', voiceURI: 'de-DE-Neural2-D', label: 'Neural2-D (Male)' },
  { name: 'de-DE-Neural2-F', lang: 'de-DE', voiceURI: 'de-DE-Neural2-F', label: 'Neural2-F (Male)' },
  // Spanish (Spain)
  { name: 'es-ES-Neural2-A', lang: 'es-ES', voiceURI: 'es-ES-Neural2-A', label: 'Neural2-A (Female)' },
  { name: 'es-ES-Neural2-B', lang: 'es-ES', voiceURI: 'es-ES-Neural2-B', label: 'Neural2-B (Male)' },
  { name: 'es-ES-Neural2-C', lang: 'es-ES', voiceURI: 'es-ES-Neural2-C', label: 'Neural2-C (Female)' },
  { name: 'es-ES-Neural2-D', lang: 'es-ES', voiceURI: 'es-ES-Neural2-D', label: 'Neural2-D (Female)' },
  { name: 'es-ES-Neural2-E', lang: 'es-ES', voiceURI: 'es-ES-Neural2-E', label: 'Neural2-E (Male)' },
  { name: 'es-ES-Neural2-F', lang: 'es-ES', voiceURI: 'es-ES-Neural2-F', label: 'Neural2-F (Male)' },
  // Italian
  { name: 'it-IT-Neural2-A', lang: 'it-IT', voiceURI: 'it-IT-Neural2-A', label: 'Neural2-A (Female)' },
  { name: 'it-IT-Neural2-C', lang: 'it-IT', voiceURI: 'it-IT-Neural2-C', label: 'Neural2-C (Male)' },
]

export const VALID_VOICE_NAMES = new Set(NEURAL2_VOICES.map((v) => v.voiceURI))
