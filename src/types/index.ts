export type LineType = 'dialogue' | 'direction' | 'heading'

export interface ScriptLine {
  id: string
  type: LineType
  character?: string
  text: string
  lineIndex: number
}

export interface Scene {
  id: string
  title: string
  actTitle: string
  sceneTitle: string
  startLineIndex: number
  endLineIndex: number
  characters: string[]
}

export interface Script {
  id: string
  name: string
  lines: ScriptLine[]
  characters: string[]
  scenes: Scene[]
  createdAt: number
}

export type MyLineMode = 'silence' | 'read' | 'gap-before' | 'gap-after'

export interface VoiceCommandWords {
  play:   string[]
  stop:   string[]
  back:   string[]
  skip:   string[]
  repeat: string[]
  loop:   string[]
}

export const DEFAULT_VOICE_COMMANDS: VoiceCommandWords = {
  play:   ['play', 'go', 'start'],
  stop:   ['stop', 'end'],
  back:   ['back', 'again'],
  skip:   ['skip', 'next'],
  repeat: ['repeat', 'restart'],
  loop:   ['loop', 'cycle'],
}

export interface RehearsalSettings {
  scriptId: string
  myCharacter: string
  readStageDirections: boolean
  myLineMode: MyLineMode
  speechRate: number
  accuracyWarningThreshold: number
  accuracyEnabled: boolean
  sceneId: string | null
  endLineSilenceMs: number
  errorPromptEnabled: boolean
  errorPromptPhrase: string
  voiceCommands?: VoiceCommandWords
  highlighterColor?: 'yellow' | 'pink' | 'green' | 'blue'
  handsFreeEnabled?: boolean
  voiceURI?: string
  maxPauseMs?: number
  linePingEnabled?: boolean
  scenePingEnabled?: boolean
  clipStartPingEnabled?: boolean
  voiceCalibration?: number
  speechCoverageThreshold?: number
  condensedLines?: number
}

export interface MarkedBlock {
  startIndex: number
  endIndex: number
}

export type RepeatMode = 'always' | 'below-threshold' | 'off'

export interface WordDiff {
  word: string
  match: boolean
}

export interface Note {
  id: string
  text: string
  done: boolean
  createdAt: number
}
