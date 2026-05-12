import type { Script, ScriptLine, Scene, LineType } from '../types'

const isAllCaps = (s: string) => /^[A-Z][A-Z0-9\s\-'.]+$/.test(s)
const isActLabel = (s: string) => /^ACT\s+\d+$/i.test(s)
const isSceneStart = (s: string) =>
  /^(PROLOGUE|EPILOGUE|INDUCTION|Scene\s+\d+)$/i.test(s)
const isSeparator = (s: string) => /^[=\-]{3,}$/.test(s)
const isDirection = (s: string) =>
  s.startsWith('[') || (s.startsWith('(') && s.endsWith(')'))

export function parseScript(text: string, name: string): Script {
  const rawLines = text.split(/\r?\n/)
  const lines: ScriptLine[] = []
  const characterSet = new Set<string>()
  let idx = 0
  let currentCharacter: string | null = null
  let playStarted = false

  // Scene tracking
  let currentAct = ''
  let currentSceneTitle = ''
  let sceneStartLineIdx = -1
  let sceneCharacters = new Set<string>()
  const scenes: Scene[] = []

  const closeScene = (endIdx: number) => {
    if (sceneStartLineIdx < 0) return
    scenes.push({
      id: crypto.randomUUID(),
      title: currentAct && currentSceneTitle
        ? `${currentAct} · ${currentSceneTitle}`
        : currentSceneTitle || currentAct,
      actTitle: currentAct,
      sceneTitle: currentSceneTitle,
      startLineIndex: sceneStartLineIdx,
      endLineIndex: endIdx,
      characters: Array.from(sceneCharacters).sort(),
    })
    sceneCharacters = new Set()
    sceneStartLineIdx = -1
  }

  for (const raw of rawLines) {
    const trimmed = raw.trim()

    if (!trimmed || isSeparator(trimmed)) continue

    if (isActLabel(trimmed)) {
      playStarted = true
      currentCharacter = null
      closeScene(lines.length - 1)
      currentAct = trimmed
      currentSceneTitle = ''
      lines.push(mkLine(idx++, 'heading', trimmed))
      continue
    }

    if (isSceneStart(trimmed)) {
      playStarted = true
      currentCharacter = null
      closeScene(lines.length - 1)
      currentSceneTitle = trimmed
      sceneStartLineIdx = lines.length  // heading line is the first line of this scene
      lines.push(mkLine(idx++, 'heading', trimmed))
      continue
    }

    if (!playStarted) continue

    if (isDirection(trimmed)) {
      lines.push(mkLine(idx++, 'direction', trimmed))
      continue
    }

    // Inline character + dialogue: "CHARACTER  text" (2+ spaces or tab)
    const inlineMatch = trimmed.match(/^([A-Z][A-Z0-9\s\-'.]+?)(?:\s{2,}|\t)(.+)$/)
    if (inlineMatch) {
      const charName = inlineMatch[1].trim()
      const dialogue = inlineMatch[2].trim()
      if (isAllCaps(charName) && charName.length >= 2 && charName.length <= 50) {
        characterSet.add(charName)
        sceneCharacters.add(charName)
        currentCharacter = charName
        lines.push(mkLine(idx++, 'dialogue', dialogue, charName))
        continue
      }
    }

    // Pure character name line
    if (isAllCaps(trimmed) && trimmed.length >= 2 && trimmed.length <= 50) {
      characterSet.add(trimmed)
      sceneCharacters.add(trimmed)
      currentCharacter = trimmed
      continue
    }

    // Dialogue continuation
    if (currentCharacter) {
      lines.push(mkLine(idx++, 'dialogue', trimmed, currentCharacter))
    } else {
      lines.push(mkLine(idx++, 'direction', trimmed))
    }
  }

  closeScene(lines.length - 1)

  return {
    id: crypto.randomUUID(),
    name,
    lines,
    characters: Array.from(characterSet).sort(),
    scenes,
    createdAt: Date.now(),
  }
}

function mkLine(
  lineIndex: number,
  type: LineType,
  text: string,
  character?: string,
): ScriptLine {
  return { id: `line-${lineIndex}`, type, text, character, lineIndex }
}
