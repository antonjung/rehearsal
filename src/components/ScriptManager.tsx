import { useState, useEffect, useCallback } from 'react'
import { IconEdit, IconDismiss, IconUpload, IconDownload, IconRename, IconPersonVoice, IconMore } from './Icons'
import { useAppStore } from '../store/useAppStore'
import { ScriptEditor } from './ScriptEditor'
import type { Script, ScriptLine } from '../types'
import { uploadScriptToLibrary, listSharedScripts, uploadVoiceTrack, listVoiceTracks, downloadVoiceTrackLines } from '../utils/shareScript'
import {
  getAllRecordings, setRecordingRaw, getRecordedAt,
  getVoiceTrackUploadedAt, setVoiceTrackUploadedAt,
  getVoiceTrackDownloadedAt, setVoiceTrackDownloadedAt,
} from '../utils/recordingStore'

// Enumerates the recordable "slots" for one character across the whole
// script — the start index of each run of consecutive same-character
// dialogue lines — mirroring RecordingStudio's buildCharacterGroups but
// unscoped by scene, since a voice track covers the entire script.
function characterGroupStarts(lines: ScriptLine[], character: string): number[] {
  const starts: number[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.type === 'dialogue') {
      let j = i
      while (j + 1 < lines.length && lines[j + 1].type === 'dialogue' && lines[j + 1].character === line.character) j++
      if (line.character === character) starts.push(i)
      i = j + 1
    } else {
      i++
    }
  }
  return starts
}

// Characters in a script that have local recordings newer than their last
// voice-track upload (or never uploaded at all) — used both to decide what
// to upload and to show a "not uploaded" indicator on the script card.
async function pendingUploadCharacters(script: Script, allRecordings: Map<string, Blob>): Promise<string[]> {
  const pending: string[] = []
  for (const character of script.characters) {
    const groupStarts = characterGroupStarts(script.lines, character)
    if (groupStarts.length === 0) continue

    let newestRecordedAt = 0
    let hasAny = false
    for (const idx of groupStarts) {
      if (!allRecordings.has(`${script.id}:${idx}`)) continue
      hasAny = true
      const at = await getRecordedAt(script.id, idx)
      if (at && at > newestRecordedAt) newestRecordedAt = at
    }
    if (!hasAny) continue

    const lastUploaded = await getVoiceTrackUploadedAt(script.id, character)
    if (!lastUploaded || newestRecordedAt > lastUploaded) pending.push(character)
  }
  return pending
}

export function ScriptManager() {
  const { scripts, selectedScriptId, removeScript, selectScript, updateScript, libraryOrg, libraryPin } = useAppStore()
  const [editingScript, setEditingScript] = useState<Script | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [uploadedId, setUploadedId] = useState<string | null>(null)
  const [uploadErrorId, setUploadErrorId] = useState<string | null>(null)
  const [needsCredsId, setNeedsCredsId] = useState<string | null>(null)
  const [vtBusyId, setVtBusyId] = useState<string | null>(null)
  const [vtUploadedId, setVtUploadedId] = useState<string | null>(null)
  const [vtDownloadedId, setVtDownloadedId] = useState<string | null>(null)
  const [vtErrorId, setVtErrorId] = useState<string | null>(null)
  const [vtMessageId, setVtMessageId] = useState<string | null>(null)
  const [pendingByScript, setPendingByScript] = useState<Record<string, string[]>>({})

  const refreshPendingUploads = useCallback(async () => {
    const allRecordings = await getAllRecordings()
    const result: Record<string, string[]> = {}
    for (const script of scripts) {
      const pending = await pendingUploadCharacters(script, allRecordings)
      if (pending.length > 0) result[script.id] = pending
    }
    setPendingByScript(result)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts])

  useEffect(() => {
    refreshPendingUploads()
  }, [refreshPendingUploads])

  async function handleUpload(script: Script) {
    if (!libraryOrg || !libraryPin) {
      setNeedsCredsId(script.id)
      setTimeout(() => setNeedsCredsId(null), 4000)
      return
    }
    setUploadErrorId(null)

    let conflict = false
    try {
      const existing = await listSharedScripts(libraryOrg)
      conflict = existing.some((e) => e.name === script.name)
    } catch (err) {
      console.error('Failed to check shared library', err)
    }

    const message = conflict
      ? `"${script.name}" already exists in the shared library for "${libraryOrg}". Overwrite it?`
      : `Upload "${script.name}" to the shared library for "${libraryOrg}"?`
    if (!window.confirm(message)) return

    setUploadingId(script.id)
    try {
      await uploadScriptToLibrary(script, libraryOrg, libraryPin)
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

  async function handleUploadVoiceTracks(script: Script) {
    if (!libraryOrg || !libraryPin) {
      setNeedsCredsId(script.id)
      setTimeout(() => setNeedsCredsId(null), 4000)
      return
    }

    setVtBusyId(script.id)
    try {
      const allRecordings = await getAllRecordings()
      const pendingCharacters = await pendingUploadCharacters(script, allRecordings)
      const toUpload: { character: string; recordings: Map<number, Blob>; totalLines: number }[] = []

      for (const character of pendingCharacters) {
        const groupStarts = characterGroupStarts(script.lines, character)
        const recordings = new Map<number, Blob>()
        for (const idx of groupStarts) {
          const blob = allRecordings.get(`${script.id}:${idx}`)
          if (blob) recordings.set(idx, blob)
        }
        toUpload.push({ character, recordings, totalLines: groupStarts.length })
      }

      if (toUpload.length === 0) {
        setVtBusyId(null)
        setVtMessageId(script.id)
        setTimeout(() => setVtMessageId(null), 3000)
        return
      }

      const names = toUpload.map((c) => c.character).join(', ')
      if (!window.confirm(`Upload voice tracks for: ${names}?`)) {
        setVtBusyId(null)
        return
      }

      for (const { character, recordings, totalLines } of toUpload) {
        const { createdAt } = await uploadVoiceTrack(libraryOrg, libraryPin, script.name, character, totalLines, recordings)
        await setVoiceTrackUploadedAt(script.id, character, createdAt)
        // This device already has the content it just sent — treat it as
        // downloaded too, so "check voice tracks" doesn't re-offer our own upload.
        await setVoiceTrackDownloadedAt(script.id, character, createdAt)
      }
      setVtUploadedId(script.id)
      setTimeout(() => setVtUploadedId(null), 2500)
      refreshPendingUploads()
    } catch (err) {
      console.error('Voice track upload failed', err)
      setVtErrorId(script.id)
      setTimeout(() => setVtErrorId(null), 3000)
    } finally {
      setVtBusyId(null)
    }
  }

  async function handleCheckVoiceTracks(script: Script) {
    if (!libraryOrg || !libraryPin) {
      setNeedsCredsId(script.id)
      setTimeout(() => setNeedsCredsId(null), 4000)
      return
    }

    setVtBusyId(script.id)
    try {
      const entries = await listVoiceTracks(libraryOrg, script.name)

      const newEntries = []
      for (const entry of entries) {
        const lastDownloaded = await getVoiceTrackDownloadedAt(script.id, entry.character)
        if (!lastDownloaded || entry.createdAt > lastDownloaded) newEntries.push(entry)
      }

      if (newEntries.length === 0) {
        setVtBusyId(null)
        setVtMessageId(script.id)
        setTimeout(() => setVtMessageId(null), 3000)
        return
      }

      const names = newEntries.map((e) => e.character).join(', ')
      if (!window.confirm(`Download voice tracks for: ${names}?`)) {
        setVtBusyId(null)
        return
      }

      const existing = await getAllRecordings()
      for (const entry of newEntries) {
        const lines = await downloadVoiceTrackLines(entry.id, libraryOrg, libraryPin)
        for (const [lineIdxStr, blob] of lines) {
          const key = `${script.id}:${lineIdxStr}`
          if (existing.has(key)) continue
          await setRecordingRaw(key, blob)
        }
        await setVoiceTrackDownloadedAt(script.id, entry.character, entry.createdAt)
      }
      setVtDownloadedId(script.id)
      setTimeout(() => setVtDownloadedId(null), 2500)
    } catch (err) {
      console.error('Voice track download failed', err)
      setVtErrorId(script.id)
      setTimeout(() => setVtErrorId(null), 3000)
    } finally {
      setVtBusyId(null)
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
              uploading={uploadingId === script.id}
              uploaded={uploadedId === script.id}
              uploadError={uploadErrorId === script.id}
              needsCreds={needsCredsId === script.id}
              vtBusy={vtBusyId === script.id}
              vtUploaded={vtUploadedId === script.id}
              vtDownloaded={vtDownloadedId === script.id}
              vtError={vtErrorId === script.id}
              vtMessage={vtMessageId === script.id}
              pendingCharacters={pendingByScript[script.id] ?? []}
              existingNames={scripts.filter((s) => s.id !== script.id).map((s) => s.name)}
              onSelect={() => selectScript(script.id)}
              onRemove={() => removeScript(script.id)}
              onEdit={() => setEditingScript(script)}
              onUpload={() => handleUpload(script)}
              onRename={(name) => updateScript({ ...script, name })}
              onUploadVoiceTracks={() => handleUploadVoiceTracks(script)}
              onCheckVoiceTracks={() => handleCheckVoiceTracks(script)}
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

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        danger
          ? 'text-red-400 hover:bg-red-400/10'
          : 'text-[var(--color-stage-text)] hover:bg-[var(--color-stage-accent)]/10'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      {label}
    </button>
  )
}

function ScriptCard({
  script,
  selected,
  uploading,
  uploaded,
  uploadError,
  needsCreds,
  vtBusy,
  vtUploaded,
  vtDownloaded,
  vtError,
  vtMessage,
  pendingCharacters,
  existingNames,
  onSelect,
  onRemove,
  onEdit,
  onUpload,
  onRename,
  onUploadVoiceTracks,
  onCheckVoiceTracks,
}: {
  script: Script
  selected: boolean
  uploading: boolean
  uploaded: boolean
  uploadError: boolean
  needsCreds: boolean
  vtBusy: boolean
  vtUploaded: boolean
  vtDownloaded: boolean
  vtError: boolean
  vtMessage: boolean
  pendingCharacters: string[]
  existingNames: string[]
  onSelect: () => void
  onRemove: () => void
  onEdit: () => void
  onUpload: () => void
  onRename: (name: string) => void
  onUploadVoiceTracks: () => void
  onCheckVoiceTracks: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(script.name)
  const [renameError, setRenameError] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
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
      className={`relative rounded-lg border cursor-pointer transition-colors ${
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
        {vtUploaded && <span className="text-[10px] text-[var(--color-stage-accent-light)] mr-0.5">Voice tracks uploaded!</span>}
        {vtDownloaded && <span className="text-[10px] text-[var(--color-stage-accent-light)] mr-0.5">Voice tracks downloaded!</span>}
        {vtError && <span className="text-[10px] text-red-400 mr-0.5">Voice track sync failed</span>}
        {vtMessage && <span className="text-[10px] text-[var(--color-stage-muted)] mr-0.5">Nothing new</span>}
        {needsCreds && <span className="text-[10px] text-red-400 mr-0.5">Set organisation &amp; PIN in Settings</span>}
        {!vtUploaded && !vtDownloaded && !vtError && !vtMessage && pendingCharacters.length > 0 && (
          <span
            className="text-[10px] text-amber-400 mr-0.5"
            title={`Not uploaded: ${pendingCharacters.join(', ')}`}
          >
            Voice track{pendingCharacters.length > 1 ? 's' : ''} not uploaded
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
          className="relative text-[var(--color-stage-muted)] hover:text-[var(--color-stage-accent-light)] transition-colors p-1 rounded"
          aria-label="Script options"
          title="Script options"
        >
          <IconMore />
          {pendingCharacters.length > 0 && (
            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
          )}
        </button>
      </div>
      </div>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenuOpen(false) }} />
          <div
            className="absolute right-3 top-11 z-20 w-56 rounded-lg border border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] shadow-lg py-1"
            onClick={(e) => e.stopPropagation()}
          >
            <MenuItem icon={<IconRename />} label="Rename" onClick={() => { setMenuOpen(false); setNameDraft(script.name); setRenaming(true) }} />
            <MenuItem icon={<IconUpload />} label="Upload script" onClick={() => { setMenuOpen(false); onUpload() }} disabled={uploading} />
            <MenuItem icon={<IconDownload />} label="Check voice tracks" onClick={() => { setMenuOpen(false); onCheckVoiceTracks() }} disabled={vtBusy} />
            <MenuItem
              icon={<IconPersonVoice />}
              label={pendingCharacters.length > 0 ? `Upload voice tracks (${pendingCharacters.length})` : 'Upload voice tracks'}
              onClick={() => { setMenuOpen(false); onUploadVoiceTracks() }}
              disabled={vtBusy}
            />
            <MenuItem icon={<IconEdit />} label="Edit" onClick={() => { setMenuOpen(false); onEdit() }} />
            <MenuItem icon={<IconDismiss />} label="Delete" danger onClick={() => { setMenuOpen(false); setConfirmDelete(true) }} />
          </div>
        </>
      )}
    </div>
  )
}
