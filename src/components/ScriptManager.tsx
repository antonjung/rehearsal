import { useState, useRef } from 'react'
import { IconEdit, IconDismiss, IconExport, IconImport } from './Icons'
import { useAppStore } from '../store/useAppStore'
import { ScriptEditor } from './ScriptEditor'
import type { Script } from '../types'
import {
  buildExportBundle,
  downloadBundle,
  parseImportFile,
  countRecordingConflicts,
  importBundle,
} from '../utils/exportImport'

export function ScriptManager() {
  const { scripts, selectedScriptId, removeScript, selectScript, addScript, updateScript } = useAppStore()
  const [editingScript, setEditingScript] = useState<Script | null>(null)
  const [importing, setImporting] = useState(false)
  const [importState, setImportState] = useState<{
    bundle: Awaited<ReturnType<typeof parseImportFile>>
    conflicts: number
  } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function handleExport(script: Script) {
    const bundle = await buildExportBundle([script])
    downloadBundle(bundle)
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      const bundle = await parseImportFile(file)
      const conflicts = await countRecordingConflicts(bundle)
      setImportState({ bundle, conflicts })
      setImportError(null)
    } catch {
      setImportError('Invalid file — please choose a CueLine export (.json)')
    }
  }

  async function confirmImport(keepExisting: boolean) {
    if (!importState) return
    setImporting(true)
    try {
      await importBundle(importState.bundle, keepExisting, addScript, updateScript, scripts)
    } finally {
      setImporting(false)
      setImportState(null)
    }
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
              onSelect={() => selectScript(script.id)}
              onRemove={() => removeScript(script.id)}
              onEdit={() => setEditingScript(script)}
              onExport={() => handleExport(script)}
            />
          ))}
        </div>
      )}

      {/* Import row */}
      <div className="mt-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleImportFile}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] hover:border-[var(--color-stage-accent-light)] transition-colors"
        >
          <IconImport />
          Import script
        </button>
        {importError && <p className="text-xs text-red-400 mt-1 text-center">{importError}</p>}
      </div>

      {editingScript && (
        <ScriptEditor script={editingScript} onClose={() => setEditingScript(null)} />
      )}

      {importState && (
        <ImportDialog
          bundle={importState.bundle}
          conflicts={importState.conflicts}
          importing={importing}
          onKeepExisting={() => confirmImport(true)}
          onOverwrite={() => confirmImport(false)}
          onCancel={() => setImportState(null)}
        />
      )}
    </>
  )
}

function ImportDialog({
  bundle,
  conflicts,
  importing,
  onKeepExisting,
  onOverwrite,
  onCancel,
}: {
  bundle: Awaited<ReturnType<typeof parseImportFile>>
  conflicts: number
  importing: boolean
  onKeepExisting: () => void
  onOverwrite: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] rounded-xl p-5 w-full max-w-sm space-y-4">
        <p className="font-semibold text-[var(--color-stage-text)]">Import</p>
        <p className="text-sm text-[var(--color-stage-muted)]">
          {bundle.scripts.length} script{bundle.scripts.length !== 1 ? 's' : ''} ·{' '}
          {Object.keys(bundle.recordings).length} recording{Object.keys(bundle.recordings).length !== 1 ? 's' : ''}
        </p>
        {conflicts > 0 && (
          <p className="text-sm text-amber-400">
            {conflicts} recording{conflicts !== 1 ? 's' : ''} already exist locally.
          </p>
        )}
        <p className="text-sm text-[var(--color-stage-text)]">
          {conflicts > 0 ? 'What should happen to conflicting recordings?' : 'Import these scripts and recordings?'}
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onKeepExisting}
            disabled={importing}
            className="py-2 rounded-lg text-sm font-medium bg-[var(--color-stage-accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {conflicts > 0 ? 'Keep my recordings' : 'Import'}
          </button>
          {conflicts > 0 && (
            <button
              onClick={onOverwrite}
              disabled={importing}
              className="py-2 rounded-lg text-sm font-medium border border-[var(--color-stage-border)] text-[var(--color-stage-text)] hover:border-[var(--color-stage-accent-light)] disabled:opacity-50 transition-colors"
            >
              Overwrite with imported
            </button>
          )}
          <button
            onClick={onCancel}
            disabled={importing}
            className="py-2 rounded-lg text-sm font-medium text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function ScriptCard({
  script,
  selected,
  onSelect,
  onRemove,
  onEdit,
  onExport,
}: {
  script: Script
  selected: boolean
  onSelect: () => void
  onRemove: () => void
  onEdit: () => void
  onExport: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dialogueCount = script.lines.filter((l) => l.type === 'dialogue').length

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
          onClick={(e) => { e.stopPropagation(); onExport() }}
          className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-accent-light)] transition-colors p-1 rounded"
          aria-label="Export script"
          title="Export script"
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
  )
}
