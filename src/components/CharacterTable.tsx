import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { ScriptLine } from '../types'

export function CharacterTable() {
  const { scripts, selectedScriptId } = useAppStore()
  const script = scripts.find((s) => s.id === selectedScriptId)
  const [view, setView] = useState<'all' | string>('all')
  const [sceneView, setSceneView] = useState<{ char: string; sceneId: string } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (sceneView) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [sceneView])

  if (!script) {
    return (
      <div className="text-center text-[var(--color-stage-muted)] py-12">
        Select a script on the Scripts tab to see its characters.
      </div>
    )
  }

  const hasScenes = script.scenes.length > 0
  const activeScene = view !== 'all' ? script.scenes.find((s) => s.id === view) : null

  const relevantLines = activeScene
    ? script.lines.slice(activeScene.startLineIndex, activeScene.endLineIndex + 1)
    : script.lines

  const lineCounts: Record<string, number> = {}
  relevantLines.forEach((l) => {
    if (l.type === 'dialogue' && l.character) {
      lineCounts[l.character] = (lineCounts[l.character] ?? 0) + 1
    }
  })

  const characters = activeScene ? activeScene.characters : script.characters
  const sorted = characters.slice().sort((a, b) => (lineCounts[b] ?? 0) - (lineCounts[a] ?? 0))

  const focusedScene = sceneView ? script.scenes.find((s) => s.id === sceneView.sceneId) : null
  const sceneLines = focusedScene
    ? script.lines.slice(focusedScene.startLineIndex, focusedScene.endLineIndex + 1)
    : []

  const toggleSceneView = (char: string, sceneId: string) =>
    setSceneView((prev) =>
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
            value={view}
            onChange={(e) => setView(e.target.value)}
            className="text-xs bg-[var(--color-stage-bg)] border border-[var(--color-stage-border)] rounded-md px-2 py-1 text-[var(--color-stage-text)] focus:outline-none focus:border-[var(--color-stage-accent)]"
          >
            <option value="all">All scenes</option>
            {script.scenes.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        )}
      </div>

      {hasScenes && view === 'all' && (
        <p className="text-xs text-[var(--color-stage-muted)]">
          {script.scenes.length} scenes extracted — tap a scene tag to view a character's lines
        </p>
      )}

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
              const charScenes = hasScenes
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
                          const active = sceneView?.char === char && sceneView?.sceneId === s.id
                          return (
                            <button
                              key={s.id}
                              onClick={() => toggleSceneView(char, s.id)}
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

      {/* Inline scene view */}
      {sceneView && focusedScene && (
        <div ref={panelRef} className="rounded-xl border border-[var(--color-stage-accent)]/40 bg-[var(--color-stage-surface)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-stage-border)] sticky top-0 bg-[var(--color-stage-surface)]">
            <div className="text-sm">
              <span className="font-semibold text-[var(--color-stage-accent-light)]">{sceneView.char}</span>
              <span className="text-[var(--color-stage-muted)]"> in </span>
              <span className="text-[var(--color-stage-gold)]">{focusedScene.title}</span>
            </div>
            <button
              onClick={() => setSceneView(null)}
              className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] text-sm px-1"
            >
              ✕
            </button>
          </div>
          <div className="px-4 py-3 space-y-0.5 max-h-[28rem] overflow-y-auto">
            {sceneLines.map((line, idx) => (
              <SceneLine key={line.id ?? idx} line={line} highlightChar={sceneView.char} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SceneLine({ line, highlightChar }: { line: ScriptLine; highlightChar: string }) {
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

  const isHighlighted = line.character === highlightChar

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
