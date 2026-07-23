import { useState } from 'react'
import { IconEdit, IconDismiss, IconExport, IconShare } from './Icons'
import { useAppStore } from '../store/useAppStore'
import { ScriptEditor } from './ScriptEditor'
import type { Script } from '../types'
import { buildExportBundle, downloadBundle } from '../utils/exportImport'
import { encodeScriptForShare, buildShareUrl } from '../utils/shareScript'

export function ScriptManager() {
  const { scripts, selectedScriptId, removeScript, selectScript } = useAppStore()
  const [editingScript, setEditingScript] = useState<Script | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null)
  const [sharingId, setSharingId] = useState<string | null>(null)
  const [sharedId, setSharedId] = useState<string | null>(null)

  async function handleExport(script: Script) {
    setExportingId(script.id)
    setExportProgress(null)
    try {
      const bundle = await buildExportBundle([script], (done, total) => setExportProgress({ done, total }))
      downloadBundle(bundle, script.name)
    } catch (err) {
      console.error('Export failed', err)
    } finally {
      setExportingId(null)
      setExportProgress(null)
    }
  }

  async function handleShare(script: Script) {
    setSharingId(script.id)
    try {
      const encoded = await encodeScriptForShare(script)
      const url = buildShareUrl(encoded)
      if (navigator.share) {
        await navigator.share({ title: `CueLine — ${script.name}`, text: `Rehearse "${script.name}" with me on CueLine`, url })
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        setSharedId(script.id)
        setTimeout(() => setSharedId(null), 2000)
      } else {
        window.prompt('Copy this link to share:', url)
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') console.error('Share failed', err)
    } finally {
      setSharingId(null)
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
              exporting={exportingId === script.id}
              exportProgress={exportingId === script.id ? exportProgress : undefined}
              sharing={sharingId === script.id}
              shared={sharedId === script.id}
              onSelect={() => selectScript(script.id)}
              onRemove={() => removeScript(script.id)}
              onEdit={() => setEditingScript(script)}
              onExport={() => handleExport(script)}
              onShare={() => handleShare(script)}
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
  sharing,
  shared,
  onSelect,
  onRemove,
  onEdit,
  onExport,
  onShare,
}: {
  script: Script
  selected: boolean
  exporting: boolean
  exportProgress?: { done: number; total: number } | null
  sharing: boolean
  shared: boolean
  onSelect: () => void
  onRemove: () => void
  onEdit: () => void
  onExport: () => void
  onShare: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const dialogueCount = script.lines.filter((l) => l.type === 'dialogue').length
  const progressPct = exportProgress == null
    ? null  // indeterminate
    : exportProgress.total === 0 ? 100 : Math.round(exportProgress.done / exportProgress.total * 100)

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
        {shared && <span className="text-[10px] text-[var(--color-stage-accent-light)] mr-0.5">Copied!</span>}
        <button
          onClick={(e) => { e.stopPropagation(); if (!sharing) onShare() }}
          className={`transition-colors p-1 rounded ${sharing ? 'text-[var(--color-stage-accent-light)] opacity-60 cursor-wait' : 'text-[var(--color-stage-muted)] hover:text-[var(--color-stage-accent-light)]'}`}
          aria-label="Share script"
          title="Share script"
          disabled={sharing}
        >
          <IconShare />
        </button>
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
          {progressPct == null ? (
            <div className="h-full bg-[var(--color-stage-accent)] w-1/3 animate-pulse" />
          ) : (
            <div
              className="h-full bg-[var(--color-stage-accent)] transition-all duration-300 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          )}
        </div>
      )}
    </div>
  )
}
