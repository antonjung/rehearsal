import { useState, useEffect, useCallback } from 'react'
import { IconPlay, IconRecordStop, IconRecordDot, IconDismiss, IconCheckmark } from './Icons'
import { useAppStore } from '../store/useAppStore'
import { useMediaRecorder } from '../hooks/useMediaRecorder'
import { getRecording, setRecording, setRecordingDuration, deleteRecording } from '../utils/recordingStore'
import { DEFAULT_REHEARSAL_SETTINGS } from '../utils/rehearsalDefaults'
import type { ScriptLine } from '../types'

interface LineGroup {
  startIdx: number
  endIdx: number
  character: string
  text: string
}

// Each dialogue ScriptLine is already exactly one sentence (the parser
// splits dialogue at sentence boundaries), and recordings are made one per
// sentence — so that sentence-level gap playback in rehearsal mode can play
// (or gap) each sentence independently rather than as one fixed multi-sentence take.
function buildCharacterGroups(
  lines: ScriptLine[],
  character: string,
  startLine: number,
  endLine: number,
): LineGroup[] {
  const groups: LineGroup[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.type === 'dialogue' && line.character === character && i >= startLine && i <= endLine) {
      groups.push({ startIdx: i, endIdx: i, character: line.character, text: line.text })
    }
  }
  return groups
}

export function RecordingStudio() {
  const { scripts, selectedScriptId, scriptFontSize, rehearsalSettings, saveRehearsalSettings } = useAppStore()
  const script = scripts.find((s) => s.id === selectedScriptId)

  // Retain the last-selected character/scene across the Record and Run
  // through tabs — both read/write the same persisted rehearsal settings.
  const sameScriptSettings = rehearsalSettings?.scriptId === selectedScriptId ? rehearsalSettings : null
  const initialCharacter = sameScriptSettings && script?.characters.includes(sameScriptSettings.myCharacter)
    ? sameScriptSettings.myCharacter
    : ''

  const [character, setCharacter] = useState(initialCharacter)
  const [sceneId, setSceneId] = useState<string | null>(sameScriptSettings?.sceneId ?? null)

  const persistCharacterAndScene = useCallback((newCharacter: string, newSceneId: string | null) => {
    if (!script) return
    saveRehearsalSettings({
      ...(rehearsalSettings ?? DEFAULT_REHEARSAL_SETTINGS),
      scriptId: script.id,
      myCharacter: newCharacter,
      sceneId: newSceneId,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script, rehearsalSettings])
  const [hasRec, setHasRec] = useState<Record<number, boolean>>({})
  const [recordingIdx, setRecordingIdx] = useState<number | null>(null)
  const [playingIdx, setPlayingIdx] = useState<number | null>(null)

  const { recording, error: recError, start: startRec, stop: stopRec } = useMediaRecorder()

  const scene = sceneId ? script?.scenes.find((s) => s.id === sceneId) : null
  const startLine = scene?.startLineIndex ?? 0
  const endLine = scene?.endLineIndex ?? (script ? script.lines.length - 1 : 0)

  const groups =
    script && character
      ? buildCharacterGroups(script.lines, character, startLine, endLine)
      : []

  useEffect(() => {
    if (!script || !character) { setHasRec({}); return }
    let cancelled = false
    const check = async () => {
      const rec: Record<number, boolean> = {}
      for (const g of groups) {
        rec[g.startIdx] = (await getRecording(script.id, g.startIdx)) !== null
      }
      if (!cancelled) setHasRec(rec)
    }
    check()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script?.id, character, sceneId])

  const handleRecord = useCallback(async (group: LineGroup) => {
    if (recording) return
    const ok = await startRec()
    if (ok) setRecordingIdx(group.startIdx)
  }, [recording, startRec])

  const handleStop = useCallback(async (group: LineGroup) => {
    const { blob, durationMs } = await stopRec()
    await setRecording(script!.id, group.startIdx, blob)
    if (durationMs > 0) void setRecordingDuration(script!.id, group.startIdx, durationMs)
    setHasRec((h) => ({ ...h, [group.startIdx]: true }))
    setRecordingIdx(null)
  }, [stopRec, script])

  const handlePlay = useCallback(async (group: LineGroup) => {
    const blob = await getRecording(script!.id, group.startIdx)
    if (!blob) return
    setPlayingIdx(group.startIdx)
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    const cleanup = () => { URL.revokeObjectURL(url); setPlayingIdx(null) }
    audio.onended = cleanup
    audio.onerror = cleanup
    audio.play().catch(cleanup)
  }, [script])

  const handleDelete = useCallback(async (group: LineGroup) => {
    await deleteRecording(script!.id, group.startIdx)
    setHasRec((h) => ({ ...h, [group.startIdx]: false }))
  }, [script])

  if (!script) {
    return (
      <p className="text-sm text-[var(--color-stage-muted)] text-center py-12">
        Select a script on the Scripts tab first.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-[var(--color-stage-text)]">Record</h2>

      <div className="flex gap-3">
        <select
          value={character}
          onChange={(e) => {
            const c = e.target.value
            // clear scene if it doesn't include the new character
            let newSceneId = sceneId
            if (sceneId && c) {
              const sc = script.scenes.find((s) => s.id === sceneId)
              if (sc && !sc.characters.includes(c)) newSceneId = null
            }
            setCharacter(c)
            setSceneId(newSceneId)
            persistCharacterAndScene(c, newSceneId)
          }}
          className="flex-1 select-field"
        >
          <option value="">Select character…</option>
          {(sceneId
            ? (script.scenes.find((s) => s.id === sceneId)?.characters ?? script.characters)
            : script.characters
          ).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {script.scenes.length > 0 && (
          <select
            value={sceneId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null
              // clear character if it's not in the new scene
              let newCharacter = character
              if (id && character) {
                const sc = script.scenes.find((s) => s.id === id)
                if (sc && !sc.characters.includes(character)) newCharacter = ''
              }
              setSceneId(id)
              setCharacter(newCharacter)
              persistCharacterAndScene(newCharacter, id)
            }}
            className="flex-1 select-field"
          >
            <option value="">Whole script</option>
            {(character
              ? script.scenes.filter((s) => s.characters.includes(character))
              : script.scenes
            ).map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        )}
      </div>

      {recError && (
        <p className="text-sm text-red-400">{recError}</p>
      )}

      {character && groups.length === 0 && (
        <p className="text-sm text-[var(--color-stage-muted)] text-center py-4">
          No lines for {character} in this selection.
        </p>
      )}

      {groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((group) => {
            const isRecordingThis = recordingIdx === group.startIdx
            const isPlayingThis = playingIdx === group.startIdx
            const recorded = hasRec[group.startIdx] ?? false

            return (
              <div
                key={group.startIdx}
                className="rounded-lg border border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] px-4 py-3"
              >
                <p className="text-[var(--color-stage-text)] mb-3" style={{ fontSize: `${scriptFontSize}px` }}>
                  {group.text.split('\n').map((t, i) => (
                    <span key={i} className="block">{t}</span>
                  ))}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {isRecordingThis ? (
                    <button
                      onClick={() => handleStop(group)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium animate-pulse min-h-[36px]"
                    >
                      <IconRecordStop /> Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRecord(group)}
                      disabled={recording}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] text-xs text-[var(--color-stage-text)] hover:border-red-400 hover:text-red-400 disabled:opacity-40 transition-colors min-h-[36px]"
                    >
                      <IconRecordDot /> {recorded ? 'Re-record' : 'Record'}
                    </button>
                  )}

                  {recorded && (
                    <>
                      <button
                        onClick={() => handlePlay(group)}
                        disabled={isPlayingThis}
                        className="px-3 py-1.5 rounded-lg border border-[var(--color-stage-border)] text-xs text-[var(--color-stage-accent-light)] hover:border-[var(--color-stage-accent)] disabled:opacity-40 transition-colors min-h-[36px]"
                      >
                        <IconPlay /> {isPlayingThis ? 'Playing…' : 'Play'}
                      </button>
                      <button
                        onClick={() => handleDelete(group)}
                        className="px-3 py-1.5 rounded-lg text-xs text-[var(--color-stage-muted)] hover:text-red-400 transition-colors min-h-[36px]"
                      >
                        <IconDismiss /> Delete
                      </button>
                      <span className="flex items-center gap-0.5 text-xs text-green-400 ml-auto"><IconCheckmark /> Recorded</span>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
