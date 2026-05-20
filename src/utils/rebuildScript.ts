import type { Script, ScriptLine, Scene } from '../types'

// Mirror scriptParser.ts heading classifiers exactly
const isActScene = (t: string) =>
  /^ACT\s+[\dIVXivx]+\s*[:\s]\s*Scene\s+\d+/i.test(t) ||
  /^Act\s+\d+[,\s]+Scene\s+\d+/i.test(t)

const isActLabel = (t: string) =>
  /^ACT\s+[\dIVXivx]+[\s:–—-]*(–|—|-)?$/i.test(t.trim()) ||
  /^ACT\s+[\dIVXivx]+$/.test(t.trim())

const isSceneStart = (t: string) =>
  /^Scene\s+\d+/i.test(t) ||
  /^(PROLOGUE|EPILOGUE|INDUCTION)$/i.test(t)

export function rebuildScript(script: Script, editedLines: ScriptLine[]): Script {
  const lines: ScriptLine[] = editedLines.map((l, i) => ({
    ...l,
    // Reclassify bracketed lines as directions regardless of stored type
    type: l.text.startsWith('[') ? 'direction' : l.type,
    character: l.text.startsWith('[') ? undefined : l.character,
    lineIndex: i,
    id: `line-${i}`,
  }))

  const charSet = new Set<string>()
  for (const l of lines) {
    if (l.type === 'dialogue' && l.character) charSet.add(l.character)
  }
  const characters = [...charSet].sort()

  const scenes: Scene[] = []
  let currentAct = ''
  let currentSceneTitle = ''
  let sceneStart = -1
  let sceneChars = new Set<string>()

  const closeScene = (endIdx: number) => {
    if (sceneStart < 0) return
    scenes.push({
      id: crypto.randomUUID(),
      title: currentAct && currentSceneTitle
        ? `${currentAct} · ${currentSceneTitle}`
        : currentSceneTitle || currentAct,
      actTitle: currentAct,
      sceneTitle: currentSceneTitle,
      startLineIndex: sceneStart,
      endLineIndex: endIdx,
      characters: [...sceneChars].sort(),
    })
    sceneChars = new Set()
    sceneStart = -1
  }

  for (const l of lines) {
    if (l.type === 'heading') {
      if (isActScene(l.text)) {
        closeScene(l.lineIndex - 1)
        const actMatch = l.text.match(/^(ACT\s+[\dIVXivx]+)/i)
        currentAct = actMatch ? actMatch[1].trim() : ''
        currentSceneTitle = l.text
        sceneStart = l.lineIndex
      } else if (isActLabel(l.text)) {
        closeScene(l.lineIndex - 1)
        currentAct = l.text
        currentSceneTitle = ''
      } else if (isSceneStart(l.text)) {
        closeScene(l.lineIndex - 1)
        currentSceneTitle = l.text
        sceneStart = l.lineIndex
      }
    } else if (l.type === 'dialogue' && l.character) {
      sceneChars.add(l.character)
    }
  }
  closeScene(lines.length - 1)

  return { ...script, lines, characters, scenes }
}
