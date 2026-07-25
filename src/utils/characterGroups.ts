import type { ScriptLine } from '../types'

// Enumerates the recordable "slots" for one character across the whole
// script — the start index of each run of consecutive same-character
// dialogue lines (one recorded take covers a whole run).
export function characterGroupStarts(lines: ScriptLine[], character: string): number[] {
  const starts: number[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.type === 'dialogue') {
      let j = i
      while (j + 1 < lines.length && lines[j + 1].type === 'dialogue' && lines[j + 1].character === line.character) j++
      if (line.character === character) starts.push(i)
      i = j + 1
    } else {
      i++
    }
  }
  return starts
}
