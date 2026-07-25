import type { RehearsalSettings } from '../types'

// Minimal fallback used when persisting a character/scene selection before
// any full rehearsal settings exist yet — only the required fields need values.
export const DEFAULT_REHEARSAL_SETTINGS: RehearsalSettings = {
  scriptId: '',
  myCharacter: '',
  readStageDirections: false,
  myLineMode: 'silence',
  speechRate: 1,
  accuracyWarningThreshold: 70,
  accuracyEnabled: true,
  sceneId: null,
  endLineSilenceMs: 400,
  errorPromptEnabled: false,
  errorPromptPhrase: 'The correct line is',
}
