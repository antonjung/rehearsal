import type { Script, ScriptLine, Scene, LineType } from '../types'

// ── Classifiers ──────────────────────────────────────────────────────────────

// "ABIGAIL" / "FIRST SISTER" / "MRS. PROCTOR" etc.  Allow trailing comma.
const isAllCaps = (s: string) => /^[A-Z][A-Z0-9\s\-'.]+$/.test(s)

const stripTrailingComma = (s: string) => s.endsWith(',') ? s.slice(0, -1).trimEnd() : s

// "ACT I", "ACT 2", "ACT ONE" — no Scene part
const isActOnly = (s: string) =>
  /^ACT\s+[\dIVXivx]+[\s:–—-]*(–|—|-)?$/i.test(s.trim()) ||
  /^ACT\s+[\dIVXivx]+$/.test(s.trim())

// "ACT I: Scene 1", "Act 1, Scene 2", "Act 1, Scene 2 - Description"
const isActScene = (s: string) =>
  /^ACT\s+[\dIVXivx]+\s*[:\s]\s*Scene\s+\d+/i.test(s) ||
  /^Act\s+\d+[,\s]+Scene\s+\d+/i.test(s)

// "Scene 1", "PROLOGUE", "EPILOGUE", "INDUCTION"
const isSceneOnly = (s: string) =>
  /^Scene\s+\d+/i.test(s) ||
  /^(PROLOGUE|EPILOGUE|INDUCTION)$/i.test(s)

// Parenthetical or bracketed direction
const isParenDirection = (s: string) =>
  (s.startsWith('(') && s.endsWith(')')) || s.startsWith('[')

// "Enter the Sisters", "Exeunt", "Exit Ross", "Exeunt all"
const isEnterExit = (s: string) => /^(Enter|Exit|Exeunt)\b/i.test(s)

const isSeparator = (s: string) => /^[=\-]{3,}$/.test(s)

// Lone page numbers produced by PDF extraction
const isPageNumber = (s: string) => /^\d{1,4}$/.test(s)

// Non-character all-caps keywords used as script labels
const LABEL_KEYWORDS = new Set(['SETTING', 'SCENE', 'TIME', 'PLACE', 'NOTE', 'NOTES', 'CAST'])

// ── Main parser ───────────────────────────────────────────────────────────────

export function parseScript(text: string, name: string): Script {
  const rawLines = text.split(/\r?\n/)
  const lines: ScriptLine[] = []
  const characterSet = new Set<string>()
  let idx = 0
  let currentCharacter: string | null = null
  let playStarted = false

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

    if (!trimmed || isSeparator(trimmed) || isPageNumber(trimmed)) continue

    // ── Headings ──────────────────────────────────────────────────────────────
    if (isActScene(trimmed)) {
      playStarted = true
      currentCharacter = null
      closeScene(lines.length - 1)
      // Preserve full title but split act/scene for tracking
      const actMatch = trimmed.match(/^(ACT\s+[\dIVXivx]+)/i)
      currentAct = actMatch ? actMatch[1].trim() : ''
      currentSceneTitle = trimmed  // use full line as the scene title
      sceneStartLineIdx = lines.length
      lines.push(mkLine(idx++, 'heading', trimmed))
      continue
    }

    if (isActOnly(trimmed)) {
      playStarted = true
      currentCharacter = null
      closeScene(lines.length - 1)
      currentAct = trimmed
      currentSceneTitle = ''
      lines.push(mkLine(idx++, 'heading', trimmed))
      continue
    }

    if (isSceneOnly(trimmed)) {
      playStarted = true
      currentCharacter = null
      closeScene(lines.length - 1)
      currentSceneTitle = trimmed
      sceneStartLineIdx = lines.length
      lines.push(mkLine(idx++, 'heading', trimmed))
      continue
    }

    if (!playStarted) continue

    // ── Directions ────────────────────────────────────────────────────────────
    if (isParenDirection(trimmed)) {
      lines.push(mkLine(idx++, 'direction', trimmed))
      continue
    }

    if (isEnterExit(trimmed)) {
      currentCharacter = null
      lines.push(mkLine(idx++, 'direction', trimmed))
      continue
    }

    // ── Inline "CHARACTER: dialogue" (e.g. The Crucible) ────────────────────
    const colonMatch = trimmed.match(/^([A-Z][A-Z0-9\s\-'.]*[A-Z0-9])(?:,)?\s*:\s+(.+)$/)
    if (colonMatch) {
      const charName = colonMatch[1].trim()
      const dialogue = colonMatch[2].trim()
      if (isAllCaps(charName) && charName.length >= 2 && charName.length <= 50 && !LABEL_KEYWORDS.has(charName)) {
        characterSet.add(charName)
        sceneCharacters.add(charName)
        currentCharacter = charName
        lines.push(mkLine(idx++, 'dialogue', dialogue, charName))
        continue
      }
      // LABEL_KEYWORDS match → treat as direction
      if (LABEL_KEYWORDS.has(charName)) {
        lines.push(mkLine(idx++, 'direction', trimmed))
        continue
      }
    }

    // ── Inline "CHARACTER  dialogue" or "CHARACTER\tdialogue" ────────────────
    const inlineMatch = trimmed.match(/^([A-Z][A-Z0-9\s\-'.]+?)(?:\s{2,}|\t)(.+)$/)
    if (inlineMatch) {
      const charName = inlineMatch[1].trim()
      const dialogue = inlineMatch[2].trim()
      if (isAllCaps(charName) && charName.length >= 2 && charName.length <= 50 && !LABEL_KEYWORDS.has(charName)) {
        characterSet.add(charName)
        sceneCharacters.add(charName)
        currentCharacter = charName
        lines.push(mkLine(idx++, 'dialogue', dialogue, charName))
        continue
      }
    }

    // ── Pure character name (possibly with trailing comma) ───────────────────
    const stripped = stripTrailingComma(trimmed)
    if (isAllCaps(stripped) && stripped.length >= 2 && stripped.length <= 50 && !LABEL_KEYWORDS.has(stripped)) {
      characterSet.add(stripped)
      sceneCharacters.add(stripped)
      currentCharacter = stripped
      continue
    }

    // ── Dialogue continuation or bare direction ───────────────────────────────
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

function mkLine(lineIndex: number, type: LineType, text: string, character?: string): ScriptLine {
  return { id: `line-${lineIndex}`, type, text, character, lineIndex }
}
