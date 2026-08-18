import { useState, useEffect, useCallback, useRef } from 'react'
import { IconEdit, IconDismiss, IconUpload, IconDownload, IconRename, IconPersonVoice, IconMore, IconPlay, IconPause } from './Icons'
import { useAppStore } from '../store/useAppStore'
import { ScriptEditor } from './ScriptEditor'
import type { Script } from '../types'
import { uploadScriptToLibrary, listSharedScripts, uploadVoiceTrack, listVoiceTracks, downloadVoiceTrackLines } from '../utils/shareScript'
import {
  getAllRecordings, setRecordingRaw, getRecordedAt,
  getVoiceTrackUploadedAt, setVoiceTrackUploadedAt,
  getVoiceTrackDownloadedAt, setVoiceTrackDownloadedAt,
  getVoiceTrackLineIdxs, setVoiceTrackLineIdxs,
} from '../utils/recordingStore'
import { characterGroupStarts } from '../utils/characterGroups'

interface VoiceConflictItem {
  key: string
  character: string
  lineText: string
  incomingBlob: Blob
  existingBlob: Blob
}

async function blobsEqual(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false
  const [bufA, bufB] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()])
  const viewA = new Uint8Array(bufA)
  const viewB = new Uint8Array(bufB)
  for (let i = 0; i < viewA.length; i++) {
    if (viewA[i] !== viewB[i]) return false
  }
  return true
}

// Characters in a script that have local recordings newer than their last
// voice-track upload (or never uploaded at all) — used both to decide what
// to upload and to show a "not uploaded" indicator on the script card.
// `remoteCharacters`, when given, is the set of characters currently found
// in the shared library for this script — local "already uploaded" timestamps
// survive a remote deletion (e.g. via the admin portal), so anything missing
// from the remote listing is always treated as pending regardless of them.
async function pendingUploadCharacters(
  script: Script,
  allRecordings: Map<string, Blob>,
  remoteCharacters?: Set<string>,
): Promise<string[]> {
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

    if (remoteCharacters && !remoteCharacters.has(character)) {
      pending.push(character)
      continue
    }

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
  const [conflicts, setConflicts] = useState<VoiceConflictItem[] | null>(null)

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

      let remoteCharacters: Set<string> | undefined
      try {
        remoteCharacters = new Set((await listVoiceTracks(libraryOrg, script.name)).map((e) => e.character))
      } catch (err) {
        console.error('Failed to check remote voice tracks before upload', err)
      }

      const pendingCharacters = await pendingUploadCharacters(script, allRecordings, remoteCharacters)
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
        await setVoiceTrackLineIdxs(script.id, character, [...recordings.keys()])
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
      const existing = await getAllRecordings()

      // An entry needs (re-)downloading either because the server has a
      // newer version than we last pulled, or — even with nothing new on the
      // server — because a line from the version we already have has since
      // been deleted locally (e.g. via the ✕ in Record or Run Through) and
      // should be restored from the shared library.
      const newEntries = []
      for (const entry of entries) {
        const lastDownloaded = await getVoiceTrackDownloadedAt(script.id, entry.character)
        if (!lastDownloaded || entry.createdAt > lastDownloaded) {
          newEntries.push(entry)
          continue
        }
        const knownLineIdxs = await getVoiceTrackLineIdxs(script.id, entry.character)
        const deletedLocally = (knownLineIdxs ?? []).some((idx) => !existing.has(`${script.id}:${idx}`))
        if (deletedLocally) newEntries.push(entry)
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

      const newConflicts: VoiceConflictItem[] = []
      for (const entry of newEntries) {
        const lines = await downloadVoiceTrackLines(entry.id, libraryOrg, libraryPin)
        for (const [lineIdxStr, blob] of lines) {
          const key = `${script.id}:${lineIdxStr}`
          const existingBlob = existing.get(key)
          if (!existingBlob) {
            await setRecordingRaw(key, blob)
            continue
          }
          if (await blobsEqual(existingBlob, blob)) continue // unchanged — nothing to do
          newConflicts.push({
            key,
            character: entry.character,
            lineText: script.lines[Number(lineIdxStr)]?.text ?? '',
            incomingBlob: blob,
            existingBlob,
          })
        }
        await setVoiceTrackDownloadedAt(script.id, entry.character, entry.createdAt)
        await setVoiceTrackLineIdxs(script.id, entry.character, [...lines.keys()].map(Number))
      }

      if (newConflicts.length > 0) {
        setConflicts(newConflicts)
      } else {
        setVtDownloadedId(script.id)
        setTimeout(() => setVtDownloadedId(null), 2500)
      }
    } catch (err) {
      console.error('Voice track download failed', err)
      setVtErrorId(script.id)
      setTimeout(() => setVtErrorId(null), 3000)
    } finally {
      setVtBusyId(null)
    }
  }

  async function handleResolveConflicts(selectedKeys: Set<string>) {
    if (!conflicts) return
    for (const item of conflicts) {
      if (selectedKeys.has(item.key)) {
        await setRecordingRaw(item.key, item.incomingBlob)
      }
    }
    setConflicts(null)
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

      {conflicts && (
        <VoiceTrackConflictModal
          items={conflicts}
          onResolve={(keys) => void handleResolveConflicts(keys)}
          onCancel={() => setConflicts(null)}
        />
      )}
    </>
  )
}

function VoiceTrackConflictModal({
  items,
  onResolve,
  onCancel,
}: {
  items: VoiceConflictItem[]
  onResolve: (selectedKeys: Set<string>) => void
  onCancel: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => () => { audioRef.current?.pause() }, [])

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function playVariant(item: VoiceConflictItem, variant: 'existing' | 'incoming') {
    audioRef.current?.pause()
    const id = `${item.key}:${variant}`
    if (playingId === id) { setPlayingId(null); return }
    const blob = variant === 'existing' ? item.existingBlob : item.incomingBlob
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audioRef.current = audio
    const cleanup = () => { URL.revokeObjectURL(url); setPlayingId(null) }
    audio.onended = cleanup
    audio.onerror = cleanup
    audio.play().catch(cleanup)
    setPlayingId(id)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-xl border border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] shadow-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[var(--color-stage-border)]">
          <p className="font-semibold text-[var(--color-stage-text)]">Recordings already exist</p>
          <p className="text-xs text-[var(--color-stage-muted)] mt-0.5">
            These lines changed in the shared version. Listen to yours, then choose which to overwrite.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-stage-border)]">
          {items.map((item) => (
            <div key={item.key} className="px-4 py-2.5 flex items-start gap-3">
              <input
                type="checkbox"
                checked={selected.has(item.key)}
                onChange={() => toggle(item.key)}
                className="mt-1 rounded shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[var(--color-stage-accent-light)]">{item.character}</p>
                <p className="text-sm text-[var(--color-stage-text)] truncate">{item.lineText}</p>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button
                  onClick={() => playVariant(item, 'existing')}
                  className="flex items-center gap-1 text-[10px] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-accent-light)] transition-colors px-1.5 py-1 rounded border border-[var(--color-stage-border)]"
                  aria-label="Play your existing recording"
                  title="Play your existing recording"
                >
                  {playingId === `${item.key}:existing` ? <IconPause /> : <IconPlay />} Yours
                </button>
                <button
                  onClick={() => playVariant(item, 'incoming')}
                  className="flex items-center gap-1 text-[10px] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-accent-light)] transition-colors px-1.5 py-1 rounded border border-[var(--color-stage-border)]"
                  aria-label="Play the downloaded recording"
                  title="Play the downloaded recording"
                >
                  {playingId === `${item.key}:incoming` ? <IconPause /> : <IconPlay />} New
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-[var(--color-stage-border)] flex gap-2">
          <button
            onClick={() => onResolve(selected)}
            disabled={selected.size === 0}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-[var(--color-stage-accent)] text-white disabled:opacity-30 hover:opacity-90 transition-opacity"
          >
            Overwrite selected ({selected.size})
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors"
          >
            Keep mine
          </button>
        </div>
      </div>
    </div>
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
          className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-accent-light)] transition-colors p-1 rounded"
          aria-label="Script options"
          title="Script options"
        >
          <IconMore />
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
