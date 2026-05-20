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

// "Enter the Sisters", "Exeunt", "Exit Ross", "Exeunt all"
const isEnterExit = (s: string) => /^(Enter|Exit|Exeunt)\b/i.test(s)

const isSeparator = (s: string) => /^[=\-]{3,}$/.test(s)

// Lone page numbers produced by PDF extraction
const isPageNumber = (s: string) => /^\d{1,4}$/.test(s)

// Non-character all-caps keywords used as script labels or production directions
const LABEL_KEYWORDS = new Set(['SETTING', 'SCENE', 'TIME', 'PLACE', 'NOTE', 'NOTES', 'CAST', 'MUSIC', 'SOUND', 'SFX', 'EFFECTS', 'SFXS'])

// ── Main parser ───────────────────────────────────────────────────────────────

export function parseScript(text: string, name: string): Script {
  const rawLines = text.split(/\r?\n/)
  const lines: ScriptLine[] = []
  const characterSet = new Set<string>()
  let idx = 0
  let currentCharacter: string | null = null
  let playStarted = false
  // State for multi-line direction that opens on one line and closes on another
  let pendingDirOpener: '(' | '[' | null = null
  let pendingDirText = ''

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

  // Emit dialogue text for `char`, extracting any inline (…) or […] as direction lines.
  // Direction segments are emitted in-place; surrounding text becomes dialogue lines.
  // If a bracket opens but doesn't close within `text`, sets pendingDirOpener/Text for
  // the next raw line to continue.
  const emitDialogue = (dialogueText: string, char: string) => {
    let remaining = dialogueText.trim()
    while (remaining.length > 0) {
      const pIdx = remaining.indexOf('(')
      const bIdx = remaining.indexOf('[')
      const openIdx = pIdx < 0 ? bIdx : bIdx < 0 ? pIdx : Math.min(pIdx, bIdx)

      if (openIdx < 0) {
        lines.push(mkLine(idx++, 'dialogue', remaining, char))
        break
      }

      const openCh = remaining[openIdx] as '(' | '['
      const closer = openCh === '(' ? ')' : ']'
      const before = remaining.slice(0, openIdx).trim()
      const fromOpen = remaining.slice(openIdx)
      const closeIdx = fromOpen.indexOf(closer)

      if (before) lines.push(mkLine(idx++, 'dialogue', before, char))

      if (closeIdx >= 0) {
        lines.push(mkLine(idx++, 'direction', fromOpen.slice(0, closeIdx + 1)))
        remaining = fromOpen.slice(closeIdx + 1).trim()
      } else {
        // Bracket opens here but closes on a later line
        pendingDirOpener = openCh
        pendingDirText = fromOpen
        remaining = ''
      }
    }
  }

  for (const raw of rawLines) {
    const trimmed = raw.trim()

    if (!trimmed || isSeparator(trimmed) || isPageNumber(trimmed)) continue

    // ── Headings always break any pending multi-line direction ────────────────
    if (isActScene(trimmed) || isActOnly(trimmed) || isSceneOnly(trimmed)) {
      pendingDirOpener = null
      pendingDirText = ''
    }

    if (isActScene(trimmed)) {
      playStarted = true
      currentCharacter = null
      closeScene(lines.length - 1)
      const actMatch = trimmed.match(/^(ACT\s+[\dIVXivx]+)/i)
      currentAct = actMatch ? actMatch[1].trim() : ''
      currentSceneTitle = trimmed
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

    // ── Continue accumulating a multi-line direction ───────────────────────────
    if (pendingDirOpener !== null) {
      const closer = pendingDirOpener === '(' ? ')' : ']'
      const closeIdx = trimmed.indexOf(closer)
      if (closeIdx >= 0) {
        const dirFull = (pendingDirText + ' ' + trimmed.slice(0, closeIdx + 1)).trim()
        lines.push(mkLine(idx++, 'direction', dirFull))
        pendingDirOpener = null
        pendingDirText = ''
        const rest = trimmed.slice(closeIdx + 1).trim()
        if (rest && currentCharacter) emitDialogue(rest, currentCharacter)
      } else {
        pendingDirText += ' ' + trimmed
      }
      continue
    }

    // Stage directions in [] or () that occupy the whole line — recognised even before play starts
    if (trimmed.startsWith('[') || (trimmed.startsWith('(') && trimmed.endsWith(')'))) {
      lines.push(mkLine(idx++, 'direction', trimmed))
      continue
    }

    // Scripts without ACT/SCENE headings: a valid "CHARACTER: dialogue" triggers parsing
    if (!playStarted) {
      const peek = trimmed.match(/^([A-Z][A-Z0-9\s\-'.]*[A-Z0-9])\s*:\s+.+$/)
      if (peek) {
        const n = peek[1].trim()
        if (isAllCaps(n) && n.length >= 2 && n.length <= 50 && !LABEL_KEYWORDS.has(n)) {
          playStarted = true
        }
      }
    }
    if (!playStarted) continue

    // ── Directions ────────────────────────────────────────────────────────────
    if (isEnterExit(trimmed)) {
      currentCharacter = null
      lines.push(mkLine(idx++, 'direction', trimmed))
      continue
    }

    // ── Inline "CHARACTER: dialogue" ────────────────────────────────────────
    const colonMatch = trimmed.match(/^([A-Z][A-Z0-9\s\-'.]*[A-Z0-9])(?:,)?\s*:\s+(.+)$/)
    if (colonMatch) {
      const charName = colonMatch[1].trim()
      const dialogue = colonMatch[2].trim()
      if (isAllCaps(charName) && charName.length >= 2 && charName.length <= 50 && !LABEL_KEYWORDS.has(charName)) {
        characterSet.add(charName)
        sceneCharacters.add(charName)
        currentCharacter = charName
        emitDialogue(dialogue, charName)
        continue
      }
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
        emitDialogue(dialogue, charName)
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
      emitDialogue(trimmed, currentCharacter)
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
