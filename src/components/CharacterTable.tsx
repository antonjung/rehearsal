import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { ScriptLine } from '../types'

interface LineGroup {
  type: 'dialogue' | 'direction' | 'heading'
  character?: string
  lines: ScriptLine[]
}

function groupSceneLines(lines: ScriptLine[]): LineGroup[] {
  const groups: LineGroup[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.type === 'dialogue') {
      const g: LineGroup = { type: 'dialogue', character: line.character, lines: [line] }
      while (
        i + 1 < lines.length &&
        lines[i + 1].type === 'dialogue' &&
        lines[i + 1].character === line.character
      ) {
        i++
        g.lines.push(lines[i])
      }
      groups.push(g)
    } else {
      groups.push({ type: line.type, character: line.character, lines: [line] })
    }
    i++
  }
  return groups
}

export function CharacterTable() {
  const { scripts, selectedScriptId } = useAppStore()
  const script = scripts.find((s) => s.id === selectedScriptId)
  // '' = no scene info | 'all' = all scene chips | scene ID = one chip per character
  const [sceneMode, setSceneMode] = useState<string>('')
  const [charHighlight, setCharHighlight] = useState<{ char: string; sceneId: string } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Clear panel when scene mode changes
  useEffect(() => { setCharHighlight(null) }, [sceneMode])

  useEffect(() => {
    if (charHighlight) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [charHighlight])

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
    if (l.type === 'dialogue' && l.character)
      lineCounts[l.character] = (lineCounts[l.character] ?? 0) + 1
  })

  const characters = specificScene ? specificScene.characters : script.characters
  const sorted = characters.slice().sort((a, b) => (lineCounts[b] ?? 0) - (lineCounts[a] ?? 0))

  // Which chips to show per character row
  const getChips = (char: string) => {
    if (sceneMode === '') return []
    if (sceneMode === 'all') return script.scenes.filter((s) => s.characters.includes(char))
    return specificScene?.characters.includes(char) ? [specificScene] : []
  }

  const panelScene = charHighlight
    ? script.scenes.find((s) => s.id === charHighlight.sceneId) ?? null
    : null
  const panelGroups = panelScene
    ? groupSceneLines(script.lines.slice(panelScene.startLineIndex, panelScene.endLineIndex + 1))
    : []

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
              const chips = getChips(char)
              return (
                <tr
                  key={char}
                  className={`border-t border-[var(--color-stage-border)] ${
                    i % 2 === 0 ? 'bg-[var(--color-stage-bg)]' : 'bg-[var(--color-stage-surface)]'
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-[var(--color-stage-text)]">{char}</span>
                    {chips.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {chips.map((s) => {
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

      {panelScene && charHighlight && (
        <div ref={panelRef} className="rounded-xl border border-[var(--color-stage-accent)]/40 bg-[var(--color-stage-surface)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-stage-border)] sticky top-0 bg-[var(--color-stage-surface)]">
            <div className="text-sm">
              <span className="font-semibold text-[var(--color-stage-accent-light)]">{charHighlight.char}</span>
              <span className="text-[var(--color-stage-muted)]"> in </span>
              <span className="text-[var(--color-stage-gold)]">{panelScene.title}</span>
            </div>
            <button
              onClick={() => setCharHighlight(null)}
              className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] text-sm px-1"
            >
              ✕
            </button>
          </div>
          <div className="px-4 py-3 space-y-0.5 max-h-[28rem] overflow-y-auto">
            {panelGroups.map((group, idx) => (
              <SceneLineGroup key={idx} group={group} highlightChar={charHighlight.char} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SceneLineGroup({ group, highlightChar }: { group: LineGroup; highlightChar: string }) {
  if (group.type === 'heading') {
    return (
      <div className="py-2 text-center text-[var(--color-stage-gold)] font-semibold text-xs uppercase tracking-widest">
        {group.lines[0].text}
      </div>
    )
  }
  if (group.type === 'direction') {
    return (
      <div className="text-xs italic text-[var(--color-stage-muted)] px-2 py-0.5">
        {group.lines[0].text}
      </div>
    )
  }

  const isHighlighted = group.character === highlightChar

  return (
    <div
      className={`rounded px-2 py-1.5 ${
        isHighlighted ? 'bg-[var(--color-stage-accent)]/15 ring-1 ring-[var(--color-stage-accent)]/40' : ''
      }`}
    >
      <span
        className={`block text-[10px] font-bold uppercase tracking-wider mb-0.5 ${
          isHighlighted ? 'text-[var(--color-stage-accent-light)]' : 'text-[var(--color-stage-gold)]'
        }`}
      >
        {group.character}
      </span>
      {group.lines.map((line, i) => (
        <span
          key={i}
          className={`block text-sm ${isHighlighted ? 'text-white' : 'text-[var(--color-stage-text)]'}`}
        >
          {line.text}
        </span>
      ))}
    </div>
  )
}
