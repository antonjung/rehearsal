import type { ScriptLine } from '../types'

export interface CharacterGroup {
  startIdx: number
  lineCount: number
}

// Enumerates the recordable "takes" for one character — one per dialogue
// line. Each ScriptLine is already exactly one sentence (the parser splits
// dialogue at sentence boundaries), and recordings are made per sentence so
// that sentence-level gap playback can play/gap each one independently.
export function characterGroups(lines: ScriptLine[], character: string): CharacterGroup[] {
  const groups: CharacterGroup[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type === 'dialogue' && lines[i].character === character) {
      groups.push({ startIdx: i, lineCount: 1 })
    }
  }
  return groups
}

// Just the take start indices — used to key/write recordings.
export function characterGroupStarts(lines: ScriptLine[], character: string): number[] {
  return characterGroups(lines, character).map((g) => g.startIdx)
}
