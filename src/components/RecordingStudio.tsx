import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useMediaRecorder } from '../hooks/useMediaRecorder'
import { getRecording, setRecording, deleteRecording } from '../utils/recordingStore'
import type { ScriptLine } from '../types'

interface LineGroup {
  startIdx: number
  endIdx: number
  character: string
  text: string
}

function buildCharacterGroups(
  lines: ScriptLine[],
  character: string,
  startLine: number,
  endLine: number,
): LineGroup[] {
  const groups: LineGroup[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.type === 'dialogue') {
      let j = i
      const texts = [line.text]
      while (
        j + 1 < lines.length &&
        lines[j + 1].type === 'dialogue' &&
        lines[j + 1].character === line.character
      ) {
        j++
        texts.push(lines[j].text)
      }
      if (
        line.character === character &&
        i >= startLine &&
        i <= endLine
      ) {
        groups.push({ startIdx: i, endIdx: j, character: line.character!, text: texts.join('\n') })
      }
      i = j + 1
    } else {
      i++
    }
  }
  return groups
}

export function RecordingStudio() {
  const { scripts, selectedScriptId } = useAppStore()
  const script = scripts.find((s) => s.id === selectedScriptId)

  const [character, setCharacter] = useState('')
  const [sceneId, setSceneId] = useState<string | null>(null)
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
    const blob = await stopRec()
    await setRecording(script!.id, group.startIdx, blob)
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
      <div>
        <p className="text-xs text-[var(--color-stage-muted)]">{script.name}</p>
        <h2 className="text-lg font-semibold text-[var(--color-stage-text)]">Record</h2>
      </div>

      <div className="flex gap-3">
        <select
          value={character}
          onChange={(e) => {
            const c = e.target.value
            setCharacter(c)
            // clear scene if it doesn't include the new character
            if (sceneId && c) {
              const sc = script.scenes.find((s) => s.id === sceneId)
              if (sc && !sc.characters.includes(c)) setSceneId(null)
            }
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
              setSceneId(id)
              // clear character if it's not in the new scene
              if (id && character) {
                const sc = script.scenes.find((s) => s.id === id)
                if (sc && !sc.characters.includes(character)) setCharacter('')
              }
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
                <p className="text-sm text-[var(--color-stage-text)] mb-3">
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
                      ■ Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRecord(group)}
                      disabled={recording}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] text-xs text-[var(--color-stage-text)] hover:border-red-400 hover:text-red-400 disabled:opacity-40 transition-colors min-h-[36px]"
                    >
                      ● {recorded ? 'Re-record' : 'Record'}
                    </button>
                  )}

                  {recorded && (
                    <>
                      <button
                        onClick={() => handlePlay(group)}
                        disabled={isPlayingThis}
                        className="px-3 py-1.5 rounded-lg border border-[var(--color-stage-border)] text-xs text-[var(--color-stage-accent-light)] hover:border-[var(--color-stage-accent)] disabled:opacity-40 transition-colors min-h-[36px]"
                      >
                        {isPlayingThis ? '▶ Playing…' : '▶ Play'}
                      </button>
                      <button
                        onClick={() => handleDelete(group)}
                        className="px-3 py-1.5 rounded-lg text-xs text-[var(--color-stage-muted)] hover:text-red-400 transition-colors min-h-[36px]"
                      >
                        ✕ Delete
                      </button>
                      <span className="text-xs text-green-400 ml-auto">✓ Recorded</span>
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
