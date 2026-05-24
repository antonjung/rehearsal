import { useState } from 'react'
import { IconEdit, IconDismiss, IconExport } from './Icons'
import { useAppStore } from '../store/useAppStore'
import { ScriptEditor } from './ScriptEditor'
import type { Script } from '../types'
import { buildExportBundle, downloadBundle } from '../utils/exportImport'

export function ScriptManager() {
  const { scripts, selectedScriptId, removeScript, selectScript } = useAppStore()
  const [editingScript, setEditingScript] = useState<Script | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })

  async function handleExport(script: Script) {
    setExportingId(script.id)
    setExportProgress({ done: 0, total: 0 })
    const bundle = await buildExportBundle([script], (done, total) => setExportProgress({ done, total }))
    downloadBundle(bundle, script.name)
    setExportingId(null)
  }

  return (
    <>
      {scripts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[var(--color-stage-text)] font-medium mb-1">No scripts loaded</p>
          <p className="text-[var(--color-stage-muted)] text-sm">Use ☰ to load a script</p>
        </div>
      ) : (
        <div className="space-y-2">
          {scripts.map((script: Script) => (
            <ScriptCard
              key={script.id}
              script={script}
              selected={script.id === selectedScriptId}
              exporting={exportingId === script.id}
              exportProgress={exportingId === script.id ? exportProgress : null}
              onSelect={() => selectScript(script.id)}
              onRemove={() => removeScript(script.id)}
              onEdit={() => setEditingScript(script)}
              onExport={() => handleExport(script)}
            />
          ))}
        </div>
      )}

      {editingScript && (
        <ScriptEditor script={editingScript} onClose={() => setEditingScript(null)} />
      )}
    </>
  )
}

function ScriptCard({
  script,
  selected,
  exporting,
  exportProgress,
  onSelect,
  onRemove,
  onEdit,
  onExport,
}: {
  script: Script
  selected: boolean
  exporting: boolean
  exportProgress: { done: number; total: number } | null
  onSelect: () => void
  onRemove: () => void
  onEdit: () => void
  onExport: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dialogueCount = script.lines.filter((l) => l.type === 'dialogue').length
  const progressPct = exportProgress
    ? exportProgress.total === 0 ? 100 : Math.round(exportProgress.done / exportProgress.total * 100)
    : 0

  if (confirmDelete) {
    return (
      <div className={`rounded-lg border px-4 py-3 flex items-center justify-between ${
        selected ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/10' : 'border-[var(--color-stage-border)] bg-[var(--color-stage-surface)]'
      }`}>
        <p className="text-sm text-[var(--color-stage-text)]">Delete <span className="font-semibold">{script.name}</span>?</p>
        <div className="flex items-center gap-3">
          <button onClick={onRemove} className="text-sm font-semibold text-red-400 hover:text-red-300 transition-colors">Delete</button>
          <button onClick={() => setConfirmDelete(false)} className="text-sm text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors">Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`rounded-lg border overflow-hidden cursor-pointer transition-colors ${
        selected
          ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/10'
          : 'border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] hover:border-[var(--color-stage-accent-light)]'
      }`}
      onClick={onSelect}
    >
      <div className="px-4 py-3 flex items-center justify-between">
      <div>
        <p className="font-semibold text-[var(--color-stage-text)]">{script.name}</p>
        <p className="text-xs text-[var(--color-stage-muted)] mt-0.5">
          {script.characters.length} characters · {dialogueCount} lines
        </p>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => { e.stopPropagation(); if (!exporting) onExport() }}
          className={`transition-colors p-1 rounded ${exporting ? 'text-[var(--color-stage-accent-light)] opacity-60 cursor-wait' : 'text-[var(--color-stage-muted)] hover:text-[var(--color-stage-accent-light)]'}`}
          aria-label="Export script"
          title="Export script"
          disabled={exporting}
        >
          <IconExport />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-accent-light)] transition-colors p-1 rounded text-sm"
          aria-label="Edit script"
          title="Edit script"
        >
          <IconEdit />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
          className="text-[var(--color-stage-muted)] hover:text-red-400 transition-colors p-1 rounded"
          aria-label="Remove script"
        >
          <IconDismiss />
        </button>
      </div>
      </div>
      {exporting && (
        <div className="h-1 bg-[var(--color-stage-border)]">
          <div
            className="h-full bg-[var(--color-stage-accent)] transition-all duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </div>
  )
}
