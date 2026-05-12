import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'

export function CharacterTable() {
  const { scripts, selectedScriptId } = useAppStore()
  const script = scripts.find((s) => s.id === selectedScriptId)
  const [view, setView] = useState<'all' | string>('all')

  if (!script) {
    return (
      <div className="text-center text-[var(--color-stage-muted)] py-12">
        Select a script on the Scripts tab to see its characters.
      </div>
    )
  }

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-stage-text)]">
          Characters in{' '}
          <span className="text-[var(--color-stage-accent-light)]">{script.name}</span>
        </h2>
        {script.scenes.length > 0 && (
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

      {script.scenes.length > 0 && view === 'all' && (
        <p className="text-xs text-[var(--color-stage-muted)]">
          {script.scenes.length} scenes extracted
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
            {sorted.map((char, i) => (
              <tr
                key={char}
                className={`border-t border-[var(--color-stage-border)] ${
                  i % 2 === 0 ? 'bg-[var(--color-stage-bg)]' : 'bg-[var(--color-stage-surface)]'
                }`}
              >
                <td className="px-4 py-2.5 font-medium text-[var(--color-stage-text)]">{char}</td>
                <td className="px-4 py-2.5 text-right text-[var(--color-stage-muted)]">
                  {lineCounts[char] ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
