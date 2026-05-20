import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { ScriptEditor } from './ScriptEditor'
import type { Script } from '../types'

export function ScriptManager() {
  const { scripts, selectedScriptId, removeScript, selectScript } = useAppStore()
  const [editingScript, setEditingScript] = useState<Script | null>(null)

  if (scripts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-[var(--color-stage-text)] font-medium mb-1">No scripts loaded</p>
        <p className="text-[var(--color-stage-muted)] text-sm">Use ☰ to load a script</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {scripts.map((script: Script) => (
        <ScriptCard
          key={script.id}
          script={script}
          selected={script.id === selectedScriptId}
          onSelect={() => selectScript(script.id)}
          onRemove={() => removeScript(script.id)}
          onEdit={() => setEditingScript(script)}
        />
      ))}
      {editingScript && (
        <ScriptEditor script={editingScript} onClose={() => setEditingScript(null)} />
      )}
    </div>
  )
}

function ScriptCard({
  script,
  selected,
  onSelect,
  onRemove,
  onEdit,
}: {
  script: Script
  selected: boolean
  onSelect: () => void
  onRemove: () => void
  onEdit: () => void
}) {
  const dialogueCount = script.lines.filter((l) => l.type === 'dialogue').length

  return (
    <div
      className={`rounded-lg border px-4 py-3 flex items-center justify-between cursor-pointer transition-colors ${
        selected
          ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/10'
          : 'border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] hover:border-[var(--color-stage-accent-light)]'
      }`}
      onClick={onSelect}
    >
      <div>
        <p className="font-semibold text-[var(--color-stage-text)]">{script.name}</p>
        <p className="text-xs text-[var(--color-stage-muted)] mt-0.5">
          {script.characters.length} characters · {dialogueCount} lines
        </p>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-accent-light)] transition-colors p-1 rounded text-sm"
          aria-label="Edit script"
          title="Edit script"
        >
          ✏️
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="text-[var(--color-stage-muted)] hover:text-red-400 transition-colors p-1 rounded"
          aria-label="Remove script"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
