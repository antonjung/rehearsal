import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis'
import { getRecording, setRecording } from '../utils/recordingStore'
import { useMediaRecorder } from '../hooks/useMediaRecorder'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { wordAccuracy, buildWordDiff } from '../utils/textDiff'
import { estimateDuration } from '../utils/speechDuration'
import { AccuracySummary } from './AccuracySummary'
import { unlockAudio, playPing, playCompletion, getAudioContext } from '../utils/sounds'
import type { WordDiff } from '../types'

interface Props {
  onExit: () => void
}

type Phase =
  | 'idle'
  | 'playing-other'
  | 'my-line-silence'
  | 'my-line-reading'
  | 'my-line-listening'
  | 'paused'
  | 'done'

interface LineGroup {
  startIdx: number
  endIdx: number
  type: 'dialogue' | 'direction' | 'heading'
  character?: string
  text: string
}

export function RehearsalMode({ onExit }: Props) {
  const { scripts, rehearsalSettings } = useAppStore()
  const { speak, cancel } = useSpeechSynthesis()
  const { listening, supported, listen, abort, reset: resetTranscript } = useSpeechRecognition()
  const { recording: micRecording, start: startMic, stop: stopMic } = useMediaRecorder()

  const settings = rehearsalSettings!
  const script = scripts.find((s) => s.id === settings.scriptId)!
  const lines = script.lines

  const activeScene = settings.sceneId
    ? script.scenes.find((s) => s.id === settings.sceneId) ?? null
    : null
  const firstLine = activeScene?.startLineIndex ?? 0
  const sceneEnd = activeScene?.endLineIndex ?? lines.length - 1

  // Build line groups
  const allGroups = useMemo((): LineGroup[] => {
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
        groups.push({ startIdx: i, endIdx: j, type: 'dialogue', character: line.character, text: texts.join('\n') })
        i = j + 1
      } else {
        groups.push({ startIdx: i, endIdx: i, type: line.type, character: line.character, text: line.text })
        i++
      }
    }
    return groups
  }, [lines])

  // Visible groups (within scene boundaries)
  const sceneGroups = useMemo(
    () => allGroups.filter((g) => g.startIdx >= firstLine && g.startIdx <= sceneEnd),
    [allGroups, firstLine, sceneEnd],
  )

  // Default block start = group before user's first line
  const defaultBlockStart = useMemo(() => {
    const firstUserIdx = sceneGroups.findIndex(
      (g) => g.type === 'dialogue' && g.character === settings.myCharacter,
    )
    if (firstUserIdx > 0) return sceneGroups[firstUserIdx - 1].startIdx
    if (firstUserIdx === 0) return sceneGroups[0].startIdx
    return firstLine
  }, [sceneGroups, settings.myCharacter, firstLine])

  // Default block end = group after user's last line
  const defaultBlockEnd = useMemo(() => {
    let lastUserIdx = -1
    for (let i = 0; i < sceneGroups.length; i++) {
      if (sceneGroups[i].type === 'dialogue' && sceneGroups[i].character === settings.myCharacter) {
        lastUserIdx = i
      }
    }
    if (lastUserIdx >= 0 && lastUserIdx + 1 < sceneGroups.length) {
      return sceneGroups[lastUserIdx + 1].startIdx
    }
    if (lastUserIdx >= 0) return sceneGroups[lastUserIdx].startIdx
    return sceneEnd
  }, [sceneGroups, settings.myCharacter, sceneEnd])

  const accuracyEnabled = settings.accuracyEnabled !== false

  // --- State ---
  const [currentIdx, setCurrentIdx] = useState(defaultBlockStart)
  const [blockStart, setBlockStart] = useState(defaultBlockStart)
  const [blockEnd, setBlockEnd] = useState(defaultBlockEnd)
  const [phase, setPhase] = useState<Phase>('idle')
  const [accuracies, setAccuracies] = useState<Record<number, number>>({})
  const [transcripts, setTranscripts] = useState<Record<number, string>>({})
  const [wordDiffs, setWordDiffs] = useState<Record<number, WordDiff[]>>({})
  const accuraciesRef = useRef<Record<number, number>>({})
  const [showAllMyLines, setShowAllMyLines] = useState(false)
  const [revealedLines, setRevealedLines] = useState<Record<number, true>>({})
  const [recordingLineIdx, setRecordingLineIdx] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [rate, setRate] = useState(settings.speechRate)
  const loopRef = useRef(false)
  loopRef.current = loopEnabled

  // --- Refs ---
  const lineRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const stopRef = useRef(false)
  const runIdRef = useRef(0)
  const pauseRef = useRef(false)
  const draggingRef = useRef<'start' | 'end' | null>(null)
  const dragLastGiRef = useRef(-1)
  const dragTouchYRef = useRef(0)
  const dragScrollRafRef = useRef<number | null>(null)
  const dragOverlayRef = useRef<HTMLDivElement>(null)
  const dragLabelRef = useRef<HTMLSpanElement>(null)
  const blockStartRef = useRef(defaultBlockStart)
  const blockEndRef = useRef(defaultBlockEnd)
  const pauseResolveRef = useRef<(() => void) | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const recSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const recResolveRef = useRef<((ok: boolean) => void) | null>(null)
  const recMapRef = useRef<Map<number, Blob>>(new Map())

  // --- Audio helpers ---
  // Uses AudioContext (already unlocked via unlockAudio() in handlePlay) so
  // playback works on iOS without requiring a direct user gesture per-element.
  const playRecording = (blob: Blob): Promise<boolean> =>
    new Promise((resolve) => {
      const audioCtx = getAudioContext()
      if (!audioCtx || audioCtx.state === 'closed') { resolve(false); return }

      const done = (ok: boolean) => {
        recSourceRef.current = null
        recResolveRef.current = null
        resolve(ok)
      }
      recResolveRef.current = done

      blob.arrayBuffer()
        .then((buf) => audioCtx.decodeAudioData(buf))
        .then((audioBuf) => {
          if (recResolveRef.current !== done) { resolve(false); return }
          const source = audioCtx.createBufferSource()
          source.buffer = audioBuf
          source.connect(audioCtx.destination)
          recSourceRef.current = source
          source.onended = () => done(true)
          source.start(0)
          if (audioCtx.state === 'suspended') void audioCtx.resume()
        })
        .catch(() => done(false))
    })

  const cancelRecording = () => {
    try { recSourceRef.current?.stop() } catch { /* source not started */ }
    recSourceRef.current = null
    recResolveRef.current?.(false)
    recResolveRef.current = null
  }

  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      pauseResolveRef.current = () => { clearTimeout(timer); resolve() }
    })

  const waitWhilePaused = async () => {
    while (pauseRef.current && !stopRef.current) {
      await new Promise<void>((r) => { pauseResolveRef.current = r })
    }
  }

  const scrollToLine = (idx: number) =>
    lineRefs.current[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' })

  // --- Pre-load all recordings (sync lookup during playback avoids IDB async mid-loop) ---
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const map = new Map<number, Blob>()
      for (let i = firstLine; i <= sceneEnd; i++) {
        if (lines[i]?.type === 'dialogue') {
          const blob = await getRecording(script.id, i)
          if (blob) map.set(i, blob)
        }
      }
      if (!cancelled) recMapRef.current = map
    }
    load()
    return () => { cancelled = true }
  }, [script.id, firstLine, sceneEnd, lines])

  useEffect(() => {
    return () => { stopRef.current = true; cancel(); abort() }
  }, [cancel, abort])

  // --- Playback loop ---
  const runPlayback = useCallback(
    async (startIdx: number, endIdx: number) => {
      const runId = ++runIdRef.current
      stopRef.current = false
      let i = startIdx

      while (i <= endIdx && !stopRef.current) {
        await waitWhilePaused()
        if (stopRef.current) break

        const lineIdx = i
        const line = lines[lineIdx]

        // Group consecutive same-character dialogue lines
        let groupEnd = lineIdx
        if (line.type === 'dialogue') {
          while (
            groupEnd + 1 <= endIdx &&
            lines[groupEnd + 1].type === 'dialogue' &&
            lines[groupEnd + 1].character === line.character
          ) {
            groupEnd++
          }
        }
        const groupText =
          line.type === 'dialogue'
            ? lines.slice(lineIdx, groupEnd + 1).map((l) => l.text).join('\n')
            : line.text

        setCurrentIdx(lineIdx)
        scrollToLine(lineIdx)

        if (line.type === 'heading') {
          await delay(300)
          i = groupEnd + 1
          continue
        }

        if (line.type === 'direction') {
          if (settings.readStageDirections) {
            setPhase('playing-other')
            await speak(groupText, { rate })
          } else {
            await delay(100)
          }
          i = groupEnd + 1
          continue
        }

        const isMyLine = line.character === settings.myCharacter
        const gap = estimateDuration(groupText, rate)
        const silenceMs = settings.endLineSilenceMs ?? 1000

        if (!isMyLine) {
          setPhase('playing-other')
          const rec = recMapRef.current.get(lineIdx)
          if (!rec || !(await playRecording(rec))) { if (!stopRef.current) await speak(groupText, { rate }) }
        } else {
          const { myLineMode } = settings

          if (myLineMode === 'silence') {
            if (accuracyEnabled && supported) {
              setPhase('my-line-listening')
              resetTranscript()
              const heard = await listen({ expectedText: groupText, silenceMs })
              // iOS needs a moment to hand the audio session back from mic to speaker
              await delay(600)
              if (!stopRef.current) {
                setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
                if (heard) {
                  const acc = wordAccuracy(groupText, heard)
                  const diff = buildWordDiff(groupText, heard)
                  const next = { ...accuraciesRef.current, [lineIdx]: acc }
                  accuraciesRef.current = next
                  setAccuracies(next)
                  setTranscripts((t) => ({ ...t, [lineIdx]: heard }))
                  setWordDiffs((d) => ({ ...d, [lineIdx]: diff }))
                  await playPing(acc, settings.accuracyWarningThreshold)
                }
              }
            } else {
              // No speech recognition: listen for voice activity or fall back to fixed gap
              setPhase('my-line-silence')
              if (supported) {
                await listen({ silenceMs })
                await delay(600)
              } else {
                await delay(gap)
              }
              if (!stopRef.current) setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
            }
          } else if (myLineMode === 'read') {
            setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
            setPhase('my-line-reading')
            const rec = recMapRef.current.get(lineIdx)
            if (!rec || !(await playRecording(rec))) { if (!stopRef.current) await speak(groupText, { rate }) }
          } else if (myLineMode === 'gap-before') {
            // Wait for user to finish attempting the line, then read it
            setPhase('my-line-silence')
            if (supported) {
              await listen({ silenceMs })
              await delay(600)
            } else {
              await delay(gap)
            }
            if (!stopRef.current) {
              setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
              setPhase('my-line-reading')
              const rec = recMapRef.current.get(lineIdx)
              if (!rec || !(await playRecording(rec))) { if (!stopRef.current) await speak(groupText, { rate }) }
            }
          } else {
            // gap-after: read the line, then wait for user to repeat
            setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
            setPhase('my-line-reading')
            const rec = recMapRef.current.get(lineIdx)
            if (!rec || !(await playRecording(rec))) { if (!stopRef.current) await speak(groupText, { rate }) }
            if (!stopRef.current) {
              setPhase('my-line-listening')
              if (supported) {
                const heard = await listen({ expectedText: groupText, silenceMs })
                await delay(600)
                if (!stopRef.current && heard && accuracyEnabled) {
                  const acc = wordAccuracy(groupText, heard)
                  const diff = buildWordDiff(groupText, heard)
                  const next = { ...accuraciesRef.current, [lineIdx]: acc }
                  accuraciesRef.current = next
                  setAccuracies(next)
                  setTranscripts((t) => ({ ...t, [lineIdx]: heard }))
                  setWordDiffs((d) => ({ ...d, [lineIdx]: diff }))
                  await playPing(acc, settings.accuracyWarningThreshold)
                }
              } else {
                await delay(gap)
              }
            }
          }
        }

        if (stopRef.current) break
        i = groupEnd + 1
      }

      // If a newer run has started (line tap mid-play), don't clobber its phase.
      if (runIdRef.current !== runId) return
      if (!stopRef.current) {
        await playCompletion()
        if (loopRef.current && runIdRef.current === runId) {
          const loopRunId = runId
          setTimeout(() => {
            if (runIdRef.current !== loopRunId) return
            stopRef.current = false
            setCurrentIdx(blockStartRef.current)
            setRevealedLines({})
            setAccuracies({})
            setTranscripts({})
            setWordDiffs({})
            accuraciesRef.current = {}
            runPlayback(blockStartRef.current, blockEndRef.current)
          }, 600)
        } else {
          setPhase('done')
        }
      } else {
        setPhase('idle')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, settings, speak, rate, accuracyEnabled, supported, listen, resetTranscript],
  )

  const interruptPlayback = (cb?: () => void) => {
    runIdRef.current++
    stopRef.current = true
    pauseRef.current = false
    cancel()
    cancelRecording()
    abort()
    pauseResolveRef.current?.()
    if (cb) setTimeout(cb, 50)
  }

  const prevGroupStart = (idx: number) => {
    const gi = sceneGroups.findIndex((g) => g.startIdx <= idx && idx <= g.endIdx)
    return gi > 0 ? sceneGroups[gi - 1].startIdx : firstLine
  }
  const nextGroupStart = (idx: number) => {
    const gi = sceneGroups.findIndex((g) => g.startIdx <= idx && idx <= g.endIdx)
    return gi >= 0 && gi + 1 < sceneGroups.length ? sceneGroups[gi + 1].startIdx : sceneEnd
  }

  const handlePlay = () => {
    // iOS requires speechSynthesis.speak() to be called synchronously inside a
    // user-gesture handler to activate the audio session. cancel() alone is not enough.
    try {
      const prime = new SpeechSynthesisUtterance(' ')
      prime.volume = 0
      speechSynthesis.speak(prime)
    } catch { /* ignore */ }
    speechSynthesis.cancel()
    unlockAudio()
    if (phase === 'paused') {
      interruptPlayback(() => { stopRef.current = false; runPlayback(currentIdx, blockEnd) })
    } else {
      runPlayback(blockStart, blockEnd)
    }
  }

  const handlePause = () => {
    pauseRef.current = true
    cancel()
    cancelRecording()
    abort()
    setPhase('paused')
  }

  const handleStop = () => { interruptPlayback(); setPhase('idle') }

  const handleSkip = () =>
    interruptPlayback(() => {
      stopRef.current = false
      runPlayback(Math.min(nextGroupStart(currentIdx), blockEnd), blockEnd)
    })

  const handleBack = () =>
    interruptPlayback(() => {
      stopRef.current = false
      runPlayback(Math.max(prevGroupStart(currentIdx), blockStart), blockEnd)
    })

  const handleLineSelect = (idx: number) => {
    if (isPlaying) {
      handlePause()
      setCurrentIdx(idx)
    } else if (phase === 'paused') {
      interruptPlayback(() => { stopRef.current = false; setCurrentIdx(idx); runPlayback(idx, blockEnd) })
    } else {
      setCurrentIdx(idx)
    }
  }

  const handleRecordLine = async (lineIdx: number) => {
    if (recordingLineIdx !== null) {
      const blob = await stopMic()
      await setRecording(script.id, recordingLineIdx, blob)
      recMapRef.current.set(recordingLineIdx, blob)
      setRecordingLineIdx(null)
    } else {
      if (isPlaying) {
        pauseRef.current = true
        cancel()
        cancelRecording()
        abort()
        setPhase('paused')
      }
      const ok = await startMic()
      if (ok) setRecordingLineIdx(lineIdx)
    }
  }

  const toggleReveal = (lineIdx: number) => {
    setRevealedLines((r) => {
      const next = { ...r }
      if (next[lineIdx]) {
        delete next[lineIdx]
      } else {
        next[lineIdx] = true
      }
      return next
    })
  }

  // Keep refs in sync for use inside non-reactive event handlers
  blockStartRef.current = blockStart
  blockEndRef.current = blockEnd

  // Document-level touch drag for clip markers (non-passive so we can preventDefault)
  useEffect(() => {
    const onMove = (e: TouchEvent) => {
      if (!draggingRef.current) return
      e.preventDefault()
      const touch = e.touches[0]
      dragTouchYRef.current = touch.clientY

      // Primary: find the [data-gi] wrapper under the touch point
      let gi = -1
      const el = document.elementFromPoint(touch.clientX, touch.clientY)
      const row = el?.closest('[data-gi]') as HTMLElement | null
      if (row) gi = parseInt(row.dataset.gi ?? '-1', 10)

      // Fallback: closest visible line by Y distance (handles edges where touch is between rows)
      if (gi < 0) {
        let bestDist = Infinity
        sceneGroups.forEach((group, i) => {
          const domEl = lineRefs.current[group.startIdx]
          if (!domEl) return
          const rect = domEl.getBoundingClientRect()
          const dist = Math.abs(touch.clientY - (rect.top + rect.bottom) / 2)
          if (dist < bestDist) { bestDist = dist; gi = i }
        })
      }

      // Last resort: keep last known position so drag never gets stuck
      if (gi < 0) gi = dragLastGiRef.current
      if (gi < 0 || gi >= sceneGroups.length) return
      dragLastGiRef.current = gi

      if (dragOverlayRef.current) dragOverlayRef.current.style.top = `${touch.clientY}px`
    }
    const onEnd = () => {
      // Commit final position on drop (not during drag — keeps DOM stable so iOS touch chain is unbroken)
      const gi = dragLastGiRef.current
      if (draggingRef.current && gi >= 0 && gi < sceneGroups.length) {
        const startIdx = sceneGroups[gi].startIdx
        if (draggingRef.current === 'start' && startIdx <= blockEndRef.current) setBlockStart(startIdx)
        if (draggingRef.current === 'end'   && startIdx >= blockStartRef.current) setBlockEnd(startIdx)
      }
      draggingRef.current = null
      dragLastGiRef.current = -1
      if (dragScrollRafRef.current !== null) { cancelAnimationFrame(dragScrollRafRef.current); dragScrollRafRef.current = null }
      if (dragOverlayRef.current) dragOverlayRef.current.style.display = 'none'
      setIsDragging(false)
    }
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    return () => {
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
    }
  }, [sceneGroups])

  const startScrollLoop = () => {
    if (dragScrollRafRef.current !== null) cancelAnimationFrame(dragScrollRafRef.current)
    const ZONE = 80
    const SPEED = 10
    const loop = () => {
      if (!draggingRef.current || !scrollContainerRef.current) { dragScrollRafRef.current = null; return }
      const rect = scrollContainerRef.current.getBoundingClientRect()
      const y = dragTouchYRef.current
      const distTop = y - rect.top
      const distBot = rect.bottom - y
      if (distTop < ZONE) {
        scrollContainerRef.current.scrollTop -= Math.ceil(SPEED * Math.max(0, 1 - distTop / ZONE))
      } else if (distBot < ZONE) {
        scrollContainerRef.current.scrollTop += Math.ceil(SPEED * Math.max(0, 1 - distBot / ZONE))
      }
      dragScrollRafRef.current = requestAnimationFrame(loop)
    }
    dragScrollRafRef.current = requestAnimationFrame(loop)
  }

  const startDrag = (type: 'start' | 'end', gi: number, clientY: number) => {
    draggingRef.current = type
    dragLastGiRef.current = gi
    dragTouchYRef.current = clientY
    setIsDragging(true)
    startScrollLoop()
    if (dragOverlayRef.current) {
      dragOverlayRef.current.style.top = `${clientY}px`
      dragOverlayRef.current.style.display = 'flex'
    }
    if (dragLabelRef.current) {
      dragLabelRef.current.textContent = type === 'start' ? '▲ clip start' : 'clip end ▼'
    }
  }

  const isPlaying = ['playing-other', 'my-line-reading', 'my-line-silence', 'my-line-listening'].includes(phase)

  return (
    <div className="flex flex-col h-full">
      {/* Sub-header: just script name + rate */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-stage-border)] shrink-0 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onExit} className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] text-sm shrink-0">
            ← Back
          </button>
          <span className="text-sm font-semibold text-[var(--color-stage-text)] truncate">{script.name}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-[var(--color-stage-muted)]">{rate.toFixed(1)}×</span>
          <input
            type="range" min={0.5} max={2} step={0.1} value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="w-20 accent-[var(--color-stage-accent)]"
            disabled={isPlaying}
          />
        </div>
      </div>

      {/* Show/hide my lines toggle */}
      <div className="px-4 py-2 border-b border-[var(--color-stage-border)] shrink-0 flex items-center justify-between">
        <span className="text-xs text-[var(--color-stage-text)]">Show all my lines</span>
        <ToggleSwitch checked={showAllMyLines} onChange={(v) => {
          setShowAllMyLines(v)
          setRevealedLines({})
        }} />
      </div>

      {/* Drag overlay: fixed line that follows the finger during clip marker drag */}
      <div
        ref={dragOverlayRef}
        className="fixed left-0 right-0 -translate-y-1/2 flex items-center gap-1.5 px-4 pointer-events-none z-50"
        style={{ display: 'none', top: 0 }}
      >
        <div className="flex-1 h-0.5 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]" />
        <span ref={dragLabelRef} className="text-[10px] text-red-400 font-bold px-1 shrink-0" />
        <div className="flex-1 h-0.5 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]" />
      </div>

      {/* Script area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {sceneGroups.map((group, gi) => {
          const isCurrentGroup = group.startIdx <= currentIdx && currentIdx <= group.endIdx
          const isMyLine = group.character === settings.myCharacter
          const lineVisible = !isMyLine || showAllMyLines || revealedLines[group.startIdx] === true
          const acc = accuracies[group.startIdx] ?? null

          const isInClip = group.startIdx >= blockStart && group.startIdx <= blockEnd

          return (
            <div key={group.startIdx} data-gi={gi} className={isInClip ? 'bg-amber-400/10 rounded' : ''}>
              {group.startIdx === blockStart && (
                <ClipMarker type="start" hidden={isDragging} onTouchStart={(e) => startDrag('start', gi, e.touches[0].clientY)} />
              )}
              <LineRow
                group={group}
                isCurrent={isCurrentGroup}
                phase={phase}
                isMyLine={isMyLine}
                lineVisible={lineVisible}
                accuracy={accuracyEnabled ? acc : null}
                transcript={transcripts[group.startIdx] ?? ''}
                wordDiff={wordDiffs[group.startIdx] ?? []}
                threshold={settings.accuracyWarningThreshold}
                onSelect={() => handleLineSelect(group.startIdx)}
                onReveal={isMyLine && !showAllMyLines ? () => toggleReveal(group.startIdx) : undefined}
                onRecord={
                  group.type === 'dialogue' && !isPlaying && phase !== 'paused'
                    ? () => handleRecordLine(group.startIdx)
                    : undefined
                }
                isRecordingThis={recordingLineIdx === group.startIdx}
                anyRecording={micRecording || recordingLineIdx !== null}
                ref={(el) => { lineRefs.current[group.startIdx] = el }}
              />
              {group.startIdx === blockEnd && (
                <ClipMarker type="end" hidden={isDragging} onTouchStart={(e) => startDrag('end', gi, e.touches[0].clientY)} />
              )}
            </div>
          )
        })}

        {phase === 'done' && (
          <>
            <div className="text-center py-6 text-[var(--color-stage-gold)] text-lg font-semibold">
              🎭 End of scene
            </div>
            <AccuracySummary script={script} settings={settings} accuracies={accuracies} transcripts={transcripts} />
          </>
        )}
      </div>

      {/* Controls */}
      <div className="px-4 py-3 border-t border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] shrink-0">
        {/* Repeat toggle — always visible */}
        <div className="flex justify-center mb-2.5">
          <button
            onClick={() => setLoopEnabled((v) => !v)}
            className={`text-xs px-4 py-1 rounded-full font-semibold transition-colors ${
              loopEnabled
                ? 'bg-[var(--color-stage-accent)] text-white'
                : 'bg-[var(--color-stage-border)] text-[var(--color-stage-muted)]'
            }`}
          >
            ↺ Repeat
          </button>
        </div>
        {isPlaying || phase === 'paused' ? (
          <div className="flex items-center justify-center gap-4">
            <CtrlBtn onClick={handleBack} title="Previous beat">⏮</CtrlBtn>
            <CtrlBtn onClick={phase === 'paused' ? handlePlay : handlePause} large title={phase === 'paused' ? 'Resume' : 'Pause'}>
              {phase === 'paused' ? '▶' : '⏸'}
            </CtrlBtn>
            <CtrlBtn onClick={handleStop} title="Stop">⏹</CtrlBtn>
            <CtrlBtn onClick={handleSkip} title="Skip beat">⏭</CtrlBtn>
          </div>
        ) : (
          <div className="flex items-center justify-center">
            <CtrlBtn onClick={handlePlay} large title="Play clip">▶</CtrlBtn>
          </div>
        )}
        <div className="text-center mt-2 text-xs text-[var(--color-stage-muted)] h-4">
          {phase === 'my-line-listening' && listening && '🎙 Listening…'}
          {phase === 'my-line-silence' && !listening && 'Your line…'}
          {phase === 'my-line-reading' && 'Reading your line…'}
          {phase === 'playing-other' && 'Playing…'}
          {phase === 'paused' && 'Paused — tap a line to restart from it'}
          {phase === 'done' && 'Scene complete'}
          {phase === 'idle' && 'Tap ▶ to play · tap a line to select · drag red lines to set clip'}
        </div>
      </div>
    </div>
  )
}

function ClipMarker({ type, hidden, onTouchStart }: {
  type: 'start' | 'end'
  hidden?: boolean
  onTouchStart: (e: React.TouchEvent) => void
}) {
  return (
    <div
      className={`flex items-center gap-1.5 py-0.5 select-none ${hidden ? '' : 'cursor-ns-resize'}`}
      style={{ touchAction: 'none', opacity: hidden ? 0 : 1 }}
      onTouchStart={hidden ? undefined : (e) => { e.preventDefault(); onTouchStart(e) }}
    >
      <div className="flex-1 h-px bg-red-500 opacity-70" />
      <span className="text-[10px] text-red-400 font-semibold shrink-0 px-1">
        {type === 'start' ? '▲ clip start' : 'clip end ▼'}
      </span>
      <div className="flex-1 h-px bg-red-500 opacity-70" />
    </div>
  )
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer shrink-0">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
      <div className={`w-11 h-6 rounded-full transition-colors relative ${checked ? 'bg-[var(--color-stage-accent)]' : 'bg-[var(--color-stage-border)]'}`}>
        <div className={`absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </div>
    </label>
  )
}

function CtrlBtn({
  onClick, disabled, title, large, active, children,
}: {
  onClick: () => void; disabled?: boolean; title?: string; large?: boolean; active?: boolean; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed
        hover:bg-[var(--color-stage-accent)] hover:text-white
        ${active ? 'bg-[var(--color-stage-accent)] text-white' : 'bg-[var(--color-stage-border)] text-[var(--color-stage-text)]'}
        ${large ? 'w-14 h-14 text-2xl' : 'w-10 h-10 text-lg'}`}
    >
      {children}
    </button>
  )
}

// Colored accuracy dot
function AccuracyDot({ accuracy, threshold }: { accuracy: number; threshold: number }) {
  const color =
    accuracy >= 100 ? 'bg-green-400' : accuracy >= threshold ? 'bg-yellow-400' : 'bg-red-400'
  return (
    <span
      title={`${accuracy}% accuracy`}
      className={`inline-block w-2.5 h-2.5 rounded-full ml-2 shrink-0 ${color}`}
    />
  )
}

interface LineRowProps {
  group: LineGroup
  isCurrent: boolean
  phase: Phase
  isMyLine: boolean
  lineVisible: boolean
  accuracy: number | null
  transcript: string
  wordDiff: WordDiff[]
  threshold: number
  onSelect: () => void
  onReveal?: () => void
  onRecord?: () => void
  isRecordingThis?: boolean
  anyRecording?: boolean
}

const LineRow = ({
  group, isCurrent, phase, isMyLine, lineVisible,
  accuracy, threshold,
  onSelect, onReveal, onRecord, isRecordingThis, anyRecording, ref,
}: LineRowProps & { ref: React.Ref<HTMLDivElement> }) => {

  if (group.type === 'heading') {
    return (
      <div
        ref={ref}
        className="py-3 text-center text-[var(--color-stage-gold)] font-semibold text-sm uppercase tracking-widest cursor-pointer"
        onClick={onSelect}
      >
        {group.text}
      </div>
    )
  }

  if (group.type === 'direction') {
    return (
      <div
        ref={ref}
        onClick={onSelect}
        className={`text-xs italic text-[var(--color-stage-muted)] px-2 py-1.5 rounded cursor-pointer ${
          isCurrent ? 'bg-[var(--color-stage-accent)]/10' : ''
        }`}
      >
        <span className="ml-5">{group.text}</span>
      </div>
    )
  }

  const isActiveMyLine = isCurrent && isMyLine &&
    ['my-line-silence', 'my-line-listening', 'my-line-reading'].includes(phase)
  const isActiveLine = isCurrent && !isMyLine && phase === 'playing-other'

  return (
    <div
      ref={ref}
      onClick={onSelect}
      className={`rounded-lg px-2 py-2 transition-colors cursor-pointer ${
        isActiveMyLine
          ? 'bg-[var(--color-stage-accent)]/20 ring-1 ring-[var(--color-stage-accent)]'
          : isActiveLine
          ? 'bg-[var(--color-stage-gold)]/10 ring-1 ring-[var(--color-stage-gold)]/50'
          : isCurrent
          ? 'bg-[var(--color-stage-surface)]'
          : ''
      }`}
    >
      <div className="flex items-start gap-1.5">
        {/* Left column: reveal button (user lines only) */}
        <div className="flex flex-col items-center shrink-0 w-5 mt-0.5">
          {onReveal ? (
            <button
              onClick={(e) => { e.stopPropagation(); onReveal() }}
              title={lineVisible ? 'Hide line' : 'Reveal line'}
              className="text-xs text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] leading-none transition-colors"
            >
              {lineVisible ? '👁' : '◉'}
            </button>
          ) : (
            <div className="h-4" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className={`text-[10px] font-bold uppercase tracking-wider shrink-0 ${
              isMyLine ? 'text-[var(--color-stage-accent-light)]' : 'text-[var(--color-stage-gold)]'
            }`}>
              {group.character}
            </span>
            {accuracy !== null && <AccuracyDot accuracy={accuracy} threshold={threshold} />}
          </div>
          {lineVisible ? (
            <span className="text-sm text-[var(--color-stage-text)]">
              {group.text.split('\n').map((t, idx) => (
                <span key={idx} className="block">{t}</span>
              ))}
            </span>
          ) : (
            <span
              className="text-sm text-[var(--color-stage-text)] select-none"
              style={{ filter: 'blur(5px)', pointerEvents: 'none', userSelect: 'none' }}
            >
              {group.text.split('\n').map((t, idx) => (
                <span key={idx} className="block">{t}</span>
              ))}
            </span>
          )}
          {accuracy !== null && lineVisible && (
            <p className="text-[10px] text-[var(--color-stage-muted)] mt-0.5 italic">
              {accuracy}%{accuracy < threshold && ' — below threshold'}
            </p>
          )}
        </div>

        {/* Right column: record button */}
        {onRecord ? (
          <button
            onClick={(e) => { e.stopPropagation(); onRecord() }}
            disabled={!!anyRecording && !isRecordingThis}
            title={isRecordingThis ? 'Stop recording' : 'Record this line'}
            className={`shrink-0 text-sm mt-0.5 transition-colors leading-none min-w-[20px] p-0.5 ${
              isRecordingThis
                ? 'text-red-400 animate-pulse'
                : 'text-[var(--color-stage-muted)] opacity-50 hover:opacity-100 hover:text-red-400'
            } disabled:opacity-10`}
          >
            {isRecordingThis ? '■' : '●'}
          </button>
        ) : (
          <div className="w-5 shrink-0" />
        )}
      </div>
    </div>
  )
}
