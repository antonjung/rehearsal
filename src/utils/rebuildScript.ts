import type { Script, ScriptLine, Scene } from '../types'

export function rebuildScript(script: Script, editedLines: ScriptLine[]): Script {
  // Re-index lines sequentially
  const lines: ScriptLine[] = editedLines.map((l, i) => ({
    ...l,
    lineIndex: i,
    id: `line-${i}`,
  }))

  // Re-derive characters from dialogue lines
  const charSet = new Set<string>()
  for (const l of lines) {
    if (l.type === 'dialogue' && l.character) charSet.add(l.character)
  }
  const characters = [...charSet].sort()

  // Re-derive scenes from heading lines
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

  const isActLabel = (t: string) => /^ACT\s+\d+$/i.test(t)
  const isSceneStart = (t: string) =>
    /^(PROLOGUE|EPILOGUE|INDUCTION|Scene\s+\d+)$/i.test(t)

  for (const l of lines) {
    if (l.type === 'heading') {
      if (isActLabel(l.text)) {
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
