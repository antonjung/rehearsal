import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { ScriptLine } from '../types'

export function CharacterTable() {
  const { scripts, selectedScriptId } = useAppStore()
  const script = scripts.find((s) => s.id === selectedScriptId)
  // '' = blank (no scene info), 'all' = all scene chips per row, scene ID = specific scene
  const [sceneMode, setSceneMode] = useState<string>('')
  // set when user clicks a chip in 'all' mode to highlight a character in a scene
  const [charHighlight, setCharHighlight] = useState<{ char: string; sceneId: string } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (sceneMode !== '' && sceneMode !== 'all') setCharHighlight(null)
  }, [sceneMode])

  useEffect(() => {
    if (charHighlight || (sceneMode !== '' && sceneMode !== 'all')) {
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [charHighlight, sceneMode])

  if (!script) {
    return (
      <div className="text-center text-[var(--color-stage-muted)] py-12">
        Select a script on the Scripts tab to see its characters.
      </div>
    )
  }

  const hasScenes = script.scenes.length > 0
  const specificScene = sceneMode !== '' && sceneMode !== 'all'
    ? script.scenes.find((s) => s.id === sceneMode) ?? null
    : null

  const relevantLines = specificScene
    ? script.lines.slice(specificScene.startLineIndex, specificScene.endLineIndex + 1)
    : script.lines

  const lineCounts: Record<string, number> = {}
  relevantLines.forEach((l) => {
    if (l.type === 'dialogue' && l.character) {
      lineCounts[l.character] = (lineCounts[l.character] ?? 0) + 1
    }
  })

  const characters = specificScene ? specificScene.characters : script.characters
  const sorted = characters.slice().sort((a, b) => (lineCounts[b] ?? 0) - (lineCounts[a] ?? 0))

  // Scene panel: either from chip click (with highlight) or specific-scene dropdown (no highlight)
  const panelScene = charHighlight
    ? script.scenes.find((s) => s.id === charHighlight.sceneId) ?? null
    : specificScene
  const panelLines = panelScene
    ? script.lines.slice(panelScene.startLineIndex, panelScene.endLineIndex + 1)
    : []
  const panelHighlightChar = charHighlight?.char ?? null

  const toggleChip = (char: string, sceneId: string) =>
    setCharHighlight((prev) =>
      prev?.char === char && prev?.sceneId === sceneId ? null : { char, sceneId },
    )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-stage-text)]">
          Characters in{' '}
          <span className="text-[var(--color-stage-accent-light)]">{script.name}</span>
        </h2>
        {hasScenes && (
          <select
            value={sceneMode}
            onChange={(e) => setSceneMode(e.target.value)}
            className="text-xs bg-[var(--color-stage-bg)] border border-[var(--color-stage-border)] rounded-md px-2 py-1 text-[var(--color-stage-text)] focus:outline-none focus:border-[var(--color-stage-accent)]"
          >
            <option value="">— scene —</option>
            <option value="all">All scenes</option>
            {script.scenes.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        )}
      </div>

      <div className="rounded-xl overflow-hidden border border-[var(--color-stage-border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-stage-surface)] text-[var(--color-stage-muted)] uppercase text-xs tracking-wider">
              <th className="text-left px-4 py-3">Character</th>
              <th className="text-right px-4 py-3">Lines</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((char, i) => {
              const charScenes = sceneMode === 'all'
                ? script.scenes.filter((s) => s.characters.includes(char))
                : []
              return (
                <tr
                  key={char}
                  className={`border-t border-[var(--color-stage-border)] ${
                    i % 2 === 0 ? 'bg-[var(--color-stage-bg)]' : 'bg-[var(--color-stage-surface)]'
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-[var(--color-stage-text)]">{char}</span>
                    {charScenes.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {charScenes.map((s) => {
                          const active = charHighlight?.char === char && charHighlight?.sceneId === s.id
                          return (
                            <button
                              key={s.id}
                              onClick={() => toggleChip(char, s.id)}
                              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                                active
                                  ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/20 text-[var(--color-stage-accent-light)]'
                                  : 'border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] hover:border-[var(--color-stage-accent)]/50'
                              }`}
                            >
                              {s.title}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-stage-muted)] align-top">
                    {lineCounts[char] ?? 0}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Scene panel — shown when a chip is clicked (with highlight) or a specific scene is selected */}
      {panelScene && (
        <div ref={panelRef} className="rounded-xl border border-[var(--color-stage-accent)]/40 bg-[var(--color-stage-surface)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-stage-border)] sticky top-0 bg-[var(--color-stage-surface)]">
            <div className="text-sm">
              {panelHighlightChar && (
                <>
                  <span className="font-semibold text-[var(--color-stage-accent-light)]">{panelHighlightChar}</span>
                  <span className="text-[var(--color-stage-muted)]"> in </span>
                </>
              )}
              <span className="text-[var(--color-stage-gold)]">{panelScene.title}</span>
            </div>
            <button
              onClick={() => {
                setCharHighlight(null)
                if (specificScene) setSceneMode('')
              }}
              className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] text-sm px-1"
            >
              ✕
            </button>
          </div>
          <div className="px-4 py-3 space-y-0.5 max-h-[28rem] overflow-y-auto">
            {panelLines.map((line, idx) => (
              <SceneLine key={line.id ?? idx} line={line} highlightChar={panelHighlightChar} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SceneLine({ line, highlightChar }: { line: ScriptLine; highlightChar: string | null }) {
  if (line.type === 'heading') {
    return (
      <div className="py-2 text-center text-[var(--color-stage-gold)] font-semibold text-xs uppercase tracking-widest">
        {line.text}
      </div>
    )
  }

  if (line.type === 'direction') {
    return (
      <div className="text-xs italic text-[var(--color-stage-muted)] px-2 py-0.5">
        {line.text}
      </div>
    )
  }

  const isHighlighted = highlightChar !== null && line.character === highlightChar

  return (
    <div
      className={`rounded px-2 py-1 ${
        isHighlighted
          ? 'bg-[var(--color-stage-accent)]/15 ring-1 ring-[var(--color-stage-accent)]/40'
          : ''
      }`}
    >
      <span
        className={`text-[10px] font-bold uppercase tracking-wider mr-2 ${
          isHighlighted ? 'text-[var(--color-stage-accent-light)]' : 'text-[var(--color-stage-gold)]'
        }`}
      >
        {line.character}
      </span>
      <span className={`text-sm ${isHighlighted ? 'text-white' : 'text-[var(--color-stage-text)]'}`}>
        {line.text}
      </span>
    </div>
  )
}
