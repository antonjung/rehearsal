import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis'
import { getRecording, setRecording } from '../utils/recordingStore'
import { useMediaRecorder } from '../hooks/useMediaRecorder'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { wordAccuracy, buildWordDiff } from '../utils/textDiff'
import { estimateDuration } from '../utils/speechDuration'
import { AccuracySummary } from './AccuracySummary'
import { unlockAudio, playPing, playCompletion } from '../utils/sounds'
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
  const [rate, setRate] = useState(settings.speechRate)

  // --- Refs ---
  const lineRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const stopRef = useRef(false)
  const pauseRef = useRef(false)
  const pauseResolveRef = useRef<(() => void) | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const recAudioRef = useRef<HTMLAudioElement | null>(null)
  const recResolveRef = useRef<(() => void) | null>(null)
  const recMapRef = useRef<Map<number, Blob>>(new Map())

  // --- Audio helpers ---
  const playRecording = (blob: Blob): Promise<void> =>
    new Promise((resolve) => {
      recResolveRef.current = resolve
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      recAudioRef.current = audio
      const cleanup = () => {
        URL.revokeObjectURL(url)
        recAudioRef.current = null
        recResolveRef.current = null
        resolve()
      }
      audio.onended = cleanup
      audio.onerror = cleanup
      audio.play().catch(cleanup)
    })

  const cancelRecording = () => {
    recAudioRef.current?.pause()
    recAudioRef.current = null
    recResolveRef.current?.()
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
          if (rec) {
            await playRecording(rec)
          } else {
            await speak(groupText, { rate })
          }
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
            if (rec) await playRecording(rec)
            else await speak(groupText, { rate })
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
              if (rec) await playRecording(rec)
              else await speak(groupText, { rate })
            }
          } else {
            // gap-after: read the line, then wait for user to repeat
            setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
            setPhase('my-line-reading')
            const rec = recMapRef.current.get(lineIdx)
            if (rec) await playRecording(rec)
            else await speak(groupText, { rate })
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

      if (!stopRef.current) {
        await playCompletion()
        setPhase('done')
      } else {
        setPhase('idle')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, settings, speak, rate, accuracyEnabled, supported, listen, resetTranscript],
  )

  const interruptPlayback = (cb?: () => void) => {
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
    speechSynthesis.cancel()
    unlockAudio()
    if (phase === 'paused') {
      pauseRef.current = false
      pauseResolveRef.current?.()
    } else {
      runPlayback(currentIdx, blockEnd)
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

  const handleRestart = () =>
    interruptPlayback(() => {
      stopRef.current = false
      setCurrentIdx(blockStart)
      setRevealedLines({})
      setAccuracies({})
      setTranscripts({})
      setWordDiffs({})
      accuraciesRef.current = {}
      runPlayback(blockStart, blockEnd)
    })

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
    if (isPlaying || phase === 'paused') {
      interruptPlayback(() => { stopRef.current = false; setCurrentIdx(idx); runPlayback(idx, blockEnd) })
    } else {
      setCurrentIdx(idx)
    }
  }

  const handleSetBlockStart = () => {
    if (currentIdx <= blockEnd) setBlockStart(currentIdx)
  }

  const handleSetBlockEnd = () => {
    if (currentIdx >= blockStart) setBlockEnd(currentIdx)
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

      {/* Script area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {sceneGroups.map((group) => {
          const isCurrentGroup = group.startIdx <= currentIdx && currentIdx <= group.endIdx
          const isMyLine = group.character === settings.myCharacter
          const lineVisible = !isMyLine || showAllMyLines || revealedLines[group.startIdx] === true
          const acc = accuracies[group.startIdx] ?? null

          return (
            <LineRow
              key={group.startIdx}
              group={group}
              isCurrent={isCurrentGroup}
              phase={phase}
              isMyLine={isMyLine}
              lineVisible={lineVisible}
              accuracy={accuracyEnabled ? acc : null}
              transcript={transcripts[group.startIdx] ?? ''}
              wordDiff={wordDiffs[group.startIdx] ?? []}
              threshold={settings.accuracyWarningThreshold}
              isBlockStart={group.startIdx === blockStart}
              isBlockEnd={group.startIdx === blockEnd}
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
          <div className="flex items-center justify-center gap-3">
            <CtrlBtn
              onClick={handleSetBlockStart}
              disabled={currentIdx > blockEnd}
              title="Set block start to selected line"
            >
              ◀
            </CtrlBtn>
            <CtrlBtn onClick={handleRestart} title="Restart from block start">↺</CtrlBtn>
            <CtrlBtn onClick={handlePlay} large title="Play from selected line">▶</CtrlBtn>
            <CtrlBtn
              onClick={handleSetBlockEnd}
              disabled={currentIdx < blockStart}
              title="Set block end to selected line"
            >
              ▶
            </CtrlBtn>
          </div>
        )}
        <div className="text-center mt-2 text-xs text-[var(--color-stage-muted)] h-4">
          {phase === 'my-line-listening' && listening && '🎙 Listening…'}
          {phase === 'my-line-silence' && !listening && 'Your line…'}
          {phase === 'my-line-reading' && 'Reading your line…'}
          {phase === 'playing-other' && 'Playing…'}
          {phase === 'paused' && 'Paused — tap a line to jump'}
          {phase === 'done' && 'Scene complete'}
          {phase === 'idle' && 'Tap a line to select, then play'}
        </div>
      </div>
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
  onClick, disabled, title, large, children,
}: {
  onClick: () => void; disabled?: boolean; title?: string; large?: boolean; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed
        bg-[var(--color-stage-border)] text-[var(--color-stage-text)]
        hover:bg-[var(--color-stage-accent)] hover:text-white
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
  isBlockStart: boolean
  isBlockEnd: boolean
  onSelect: () => void
  onReveal?: () => void
  onRecord?: () => void
  isRecordingThis?: boolean
  anyRecording?: boolean
}

const LineRow = ({
  group, isCurrent, phase, isMyLine, lineVisible,
  accuracy, threshold, isBlockStart, isBlockEnd,
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
          ? 'bg-white/5 ring-1 ring-white/20'
          : isCurrent
          ? 'bg-[var(--color-stage-surface)]'
          : ''
      }`}
    >
      <div className="flex items-start gap-1.5">
        {/* Left column: reveal button (user lines) + block marker */}
        <div className="flex flex-col items-center gap-0.5 shrink-0 w-5 mt-0.5">
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
          <div className="text-[10px] leading-none flex items-center justify-center">
            {isBlockStart ? (
              <span className="text-[var(--color-stage-accent)] font-bold" title="Block start">▶</span>
            ) : isBlockEnd ? (
              <span className="text-[var(--color-stage-muted)]" title="Block end">■</span>
            ) : null}
          </div>
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
            <span className={`text-sm ${
              isActiveLine || isActiveMyLine ? 'text-white' : 'text-[var(--color-stage-text)]'
            }`}>
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
