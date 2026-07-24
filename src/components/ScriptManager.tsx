import { useState } from 'react'
import { IconEdit, IconDismiss, IconUpload, IconRename } from './Icons'
import { useAppStore } from '../store/useAppStore'
import { ScriptEditor } from './ScriptEditor'
import { OrgPinPrompt } from './OrgPinPrompt'
import type { Script } from '../types'
import { uploadScriptToLibrary, listSharedScripts } from '../utils/shareScript'

export function ScriptManager() {
  const { scripts, selectedScriptId, removeScript, selectScript, updateScript, libraryOrg, libraryPin, setLibraryCredentials } = useAppStore()
  const [editingScript, setEditingScript] = useState<Script | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [uploadedId, setUploadedId] = useState<string | null>(null)
  const [uploadErrorId, setUploadErrorId] = useState<string | null>(null)
  const [pendingUploadScript, setPendingUploadScript] = useState<Script | null>(null)

  async function doUpload(script: Script, org: string, pin: string) {
    setUploadingId(script.id)
    setUploadErrorId(null)
    try {
      const existing = await listSharedScripts(org)
      const conflict = existing.some((e) => e.name === script.name)
      if (conflict && !window.confirm(`"${script.name}" already exists in the shared library for "${org}". Overwrite it?`)) {
        return
      }
      await uploadScriptToLibrary(script, org, pin)
      setUploadedId(script.id)
      setTimeout(() => setUploadedId(null), 2000)
    } catch (err) {
      console.error('Upload failed', err)
      setUploadErrorId(script.id)
      setTimeout(() => setUploadErrorId(null), 3000)
    } finally {
      setUploadingId(null)
    }
  }

  function handleUpload(script: Script) {
    if (!libraryOrg || !libraryPin) {
      setPendingUploadScript(script)
      return
    }
    void doUpload(script, libraryOrg, libraryPin)
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
              uploading={uploadingId === script.id}
              uploaded={uploadedId === script.id}
              uploadError={uploadErrorId === script.id}
              existingNames={scripts.filter((s) => s.id !== script.id).map((s) => s.name)}
              onSelect={() => selectScript(script.id)}
              onRemove={() => removeScript(script.id)}
              onEdit={() => setEditingScript(script)}
              onUpload={() => handleUpload(script)}
              onRename={(name) => updateScript({ ...script, name })}
            />
          ))}
        </div>
      )}

      {editingScript && (
        <ScriptEditor script={editingScript} onClose={() => setEditingScript(null)} />
      )}

      {pendingUploadScript && (
        <OrgPinPrompt
          initialOrg={libraryOrg}
          onCancel={() => setPendingUploadScript(null)}
          onSubmit={(org, pin) => {
            setLibraryCredentials(org, pin)
            const script = pendingUploadScript
            setPendingUploadScript(null)
            void doUpload(script, org, pin)
          }}
        />
      )}
    </>
  )
}

function ScriptCard({
  script,
  selected,
  uploading,
  uploaded,
  uploadError,
  existingNames,
  onSelect,
  onRemove,
  onEdit,
  onUpload,
  onRename,
}: {
  script: Script
  selected: boolean
  uploading: boolean
  uploaded: boolean
  uploadError: boolean
  existingNames: string[]
  onSelect: () => void
  onRemove: () => void
  onEdit: () => void
  onUpload: () => void
  onRename: (name: string) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(script.name)
  const [renameError, setRenameError] = useState(false)
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
      className={`rounded-lg border overflow-hidden cursor-pointer transition-colors ${
        selected
          ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/10'
          : 'border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] hover:border-[var(--color-stage-accent-light)]'
      }`}
      onClick={onSelect}
    >
      <div className="px-4 py-3 flex items-center justify-between">
      <div className="min-w-0 flex-1">
        {renaming ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') { setNameDraft(script.name); setRenaming(false) }
            }}
            onBlur={() => {
              const trimmed = nameDraft.trim()
              if (trimmed && trimmed !== script.name) {
                if (existingNames.includes(trimmed)) {
                  setRenameError(true)
                  setTimeout(() => setRenameError(false), 3000)
                  setNameDraft(script.name)
                } else {
                  onRename(trimmed)
                }
              } else {
                setNameDraft(script.name)
              }
              setRenaming(false)
            }}
            className="font-semibold text-[var(--color-stage-text)] bg-transparent border-b border-[var(--color-stage-accent)] focus:outline-none w-full"
          />
        ) : (
          <p className="font-semibold text-[var(--color-stage-text)] truncate">{script.name}</p>
        )}
        {renameError ? (
          <p className="text-xs text-red-400 mt-0.5">A script with that name already exists</p>
        ) : (
          <p className="text-xs text-[var(--color-stage-muted)] mt-0.5">
            {script.characters.length} characters · {dialogueCount} lines
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {uploaded && <span className="text-[10px] text-[var(--color-stage-accent-light)] mr-0.5">Uploaded!</span>}
        {uploadError && <span className="text-[10px] text-red-400 mr-0.5">Upload failed</span>}
        <button
          onClick={(e) => { e.stopPropagation(); setNameDraft(script.name); setRenaming(true) }}
          className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-accent-light)] transition-colors p-1 rounded"
          aria-label="Rename script"
          title="Rename script"
        >
          <IconRename />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); if (!uploading) onUpload() }}
          className={`transition-colors p-1 rounded ${uploading ? 'text-[var(--color-stage-accent-light)] opacity-60 cursor-wait' : 'text-[var(--color-stage-muted)] hover:text-[var(--color-stage-accent-light)]'}`}
          aria-label="Upload to shared library"
          title="Upload to shared library"
          disabled={uploading}
        >
          <IconUpload />
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
    </div>
  )
}
