import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis'
import { getRecording } from '../utils/recordingStore'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { wordAccuracy, buildWordDiff } from '../utils/textDiff'
import { estimateDuration } from '../utils/speechDuration'
import { AccuracyDisplay } from './AccuracyDisplay'
import { AccuracySummary } from './AccuracySummary'
import type { MarkedBlock, RepeatMode, WordDiff } from '../types'

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

// Consecutive dialogue lines from the same character merged into one beat
interface LineGroup {
  startIdx: number
  endIdx: number
  type: 'dialogue' | 'direction' | 'heading'
  character?: string
  text: string   // lines joined with \n for multi-line speeches
}

export function RehearsalMode({ onExit }: Props) {
  const { scripts, rehearsalSettings } = useAppStore()
  const { speak, cancel } = useSpeechSynthesis()
  const { listening, supported, listen, stop: stopListening, abort, reset: resetTranscript } = useSpeechRecognition()

  const settings = rehearsalSettings!
  const script = scripts.find((s) => s.id === settings.scriptId)!
  const lines = script.lines

  const activeScene = settings.sceneId
    ? script.scenes.find((s) => s.id === settings.sceneId) ?? null
    : null
  const firstLine = activeScene?.startLineIndex ?? 0
  const sceneEnd = activeScene?.endLineIndex ?? lines.length - 1

  // Group consecutive same-character dialogue lines into single beats
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

  // Last group in scene belonging to myCharacter
  const lastMyGroup = useMemo(() => {
    for (let i = sceneEnd; i >= firstLine; i--) {
      if (lines[i].type === 'dialogue' && lines[i].character === settings.myCharacter) {
        return allGroups.find((g) => g.startIdx <= i && i <= g.endIdx) ?? null
      }
    }
    return null
  }, [allGroups, firstLine, sceneEnd, lines, settings.myCharacter])

  const lastMyLine = lastMyGroup?.startIdx ?? sceneEnd
  const lastMyEnd = lastMyGroup?.endIdx ?? sceneEnd

  // Start one group before myCharacter's first group (their cue)
  const startLine = useMemo(() => {
    for (let i = firstLine; i <= sceneEnd; i++) {
      if (lines[i].type === 'dialogue' && lines[i].character === settings.myCharacter) {
        if (i === firstLine) return firstLine
        const firstUserGroup = allGroups.find((g) => g.startIdx <= i && i <= g.endIdx)
        if (!firstUserGroup) return Math.max(firstLine, i - 1)
        const gi = allGroups.indexOf(firstUserGroup)
        if (gi > 0 && allGroups[gi - 1].startIdx >= firstLine) return allGroups[gi - 1].startIdx
        return firstLine
      }
    }
    return firstLine
  }, [allGroups, firstLine, sceneEnd, lines, settings.myCharacter])

  const accuracyEnabled = settings.accuracyEnabled !== false

  const [currentIdx, setCurrentIdx] = useState(startLine)
  const [phase, setPhase] = useState<Phase>('idle')
  const [markedBlock, setMarkedBlock] = useState<MarkedBlock | null>(null)
  const [markStart, setMarkStart] = useState<number | null>(null)
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off')
  const [accuracies, setAccuracies] = useState<Record<number, number>>({})
  const [transcripts, setTranscripts] = useState<Record<number, string>>({})
  const [wordDiffs, setWordDiffs] = useState<Record<number, WordDiff[]>>({})
  const accuraciesRef = useRef<Record<number, number>>({})
  const [revealedLines, setRevealedLines] = useState<Record<number, true>>({})
  const [rate, setRate] = useState(settings.speechRate)

  const lineRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const stopRef = useRef(false)
  const pauseRef = useRef(false)
  const pauseResolveRef = useRef<(() => void) | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const recAudioRef = useRef<HTMLAudioElement | null>(null)
  const recResolveRef = useRef<(() => void) | null>(null)

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

  const runPlayback = useCallback(
    async (startIdx: number) => {
      stopRef.current = false
      let i = startIdx

      // Effective end: block end-group start (or last user group end)
      const endIdx = markedBlock ? markedBlock.endIndex : lastMyEnd

      while (i <= endIdx && !stopRef.current) {
        await waitWhilePaused()
        if (stopRef.current) break

        const lineIdx = i          // group start — const so closures capture the right value
        const line = lines[lineIdx]

        // Collect all consecutive same-character dialogue lines as one group
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
        const groupText = line.type === 'dialogue'
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

        if (!isMyLine) {
          setPhase('playing-other')
          const rec = await getRecording(script.id, lineIdx)
          if (rec) {
            await playRecording(rec)
          } else {
            await speak(groupText, { rate })
          }
        } else {
          const gap = estimateDuration(groupText, rate)
          const { myLineMode } = settings

          if (myLineMode === 'silence') {
            let lineAcc: number | undefined
            if (accuracyEnabled && supported) {
              setPhase('my-line-listening')
              resetTranscript()
              const heard = await listen({ expectedText: groupText, silenceMs: settings.endLineSilenceMs ?? 1000 })
              if (!stopRef.current && heard) {
                const acc = wordAccuracy(groupText, heard)
                const diff = buildWordDiff(groupText, heard)
                const next = { ...accuraciesRef.current, [lineIdx]: acc }
                accuraciesRef.current = next
                setAccuracies(next)
                setTranscripts((t) => ({ ...t, [lineIdx]: heard }))
                setWordDiffs((d) => ({ ...d, [lineIdx]: diff }))
                lineAcc = acc
              }
            } else {
              setPhase('my-line-silence')
              await delay(gap)
            }
            if (!stopRef.current) setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
            if (
              !stopRef.current &&
              (settings.errorPromptEnabled ?? false) &&
              lineAcc !== undefined &&
              lineAcc < settings.accuracyWarningThreshold
            ) {
              const phrase = settings.errorPromptPhrase ?? 'The correct line is'
              if (phrase) {
                setPhase('playing-other')
                await speak(phrase, { rate })
              }
              if (!stopRef.current) {
                setPhase('my-line-reading')
                await speak(groupText, { rate })
              }
            }
          } else if (myLineMode === 'read') {
            setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
            setPhase('my-line-reading')
            await speak(groupText, { rate })
          } else if (myLineMode === 'gap-before') {
            setPhase('my-line-silence')
            await delay(gap)
            if (!stopRef.current) {
              setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
              setPhase('my-line-reading')
              await speak(groupText, { rate })
            }
          } else {
            // gap-after
            setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
            setPhase('my-line-reading')
            await speak(groupText, { rate })
            if (!stopRef.current) {
              setPhase('my-line-silence')
              await delay(gap)
            }
          }
        }

        if (stopRef.current) break

        // Block repeat check — fires when we finish the group at the block's end marker
        if (markedBlock && lineIdx === markedBlock.endIndex) {
          const blockAccs = Object.entries(accuraciesRef.current)
            .filter(([k]) => { const n = Number(k); return n >= markedBlock.startIndex && n <= markedBlock.endIndex })
            .map(([, v]) => v)
          const shouldRepeat =
            repeatMode === 'always' ||
            (repeatMode === 'below-threshold' && blockAccs.some((a) => a < settings.accuracyWarningThreshold))
          if (shouldRepeat) {
            i = markedBlock.startIndex
            continue
          }
        }

        i = groupEnd + 1
      }

      setPhase(stopRef.current ? 'idle' : 'done')
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, lastMyEnd, settings, speak, rate, accuracyEnabled,
     supported, listen, resetTranscript, markedBlock, repeatMode],
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

  // Navigate to the start of the adjacent group
  const prevGroupStart = (idx: number) => {
    const gi = allGroups.findIndex((g) => g.startIdx <= idx && idx <= g.endIdx)
    return gi > 0 ? allGroups[gi - 1].startIdx : firstLine
  }
  const nextGroupStart = (idx: number) => {
    const gi = allGroups.findIndex((g) => g.startIdx <= idx && idx <= g.endIdx)
    return gi >= 0 && gi + 1 < allGroups.length ? allGroups[gi + 1].startIdx : lastMyLine
  }

  const handlePlay = () => {
    if (phase === 'paused') {
      pauseRef.current = false
      pauseResolveRef.current?.()
    } else {
      runPlayback(markedBlock?.startIndex ?? (phase === 'idle' ? startLine : currentIdx))
    }
  }
  const handlePause = () => { pauseRef.current = true; cancel(); cancelRecording(); stopListening(); setPhase('paused') }
  const handleStop = () => { interruptPlayback(); setPhase('idle') }
  const handleRestart = () =>
    interruptPlayback(() => {
      stopRef.current = false
      setRevealedLines({})
      setAccuracies({})
      setTranscripts({})
      setWordDiffs({})
      accuraciesRef.current = {}
      runPlayback(markedBlock?.startIndex ?? startLine)
    })
  const handleSkip = () =>
    interruptPlayback(() => {
      stopRef.current = false
      runPlayback(Math.min(nextGroupStart(currentIdx), lastMyLine))
    })
  const handleBack = () =>
    interruptPlayback(() => {
      stopRef.current = false
      runPlayback(Math.max(prevGroupStart(currentIdx), firstLine))
    })
  const jumpTo = (idx: number) =>
    interruptPlayback(() => { stopRef.current = false; setCurrentIdx(idx); runPlayback(idx) })
  const toggleMarkStart = (idx: number) => {
    if (markStart === null) {
      setMarkStart(idx)
    } else {
      setMarkedBlock({ startIndex: Math.min(markStart, idx), endIndex: Math.max(markStart, idx) })
      setMarkStart(null)
    }
  }

  useEffect(() => {
    return () => { stopRef.current = true; cancel(); abort() }
  }, [cancel, abort])

  const isPlaying = ['playing-other', 'my-line-reading', 'my-line-silence', 'my-line-listening'].includes(phase)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-stage-border)] shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onExit} className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] text-sm">
            ← Back
          </button>
          <span className="text-sm font-semibold text-[var(--color-stage-text)]">{script.name}</span>
          {activeScene && <span className="text-xs text-[var(--color-stage-gold)]">{activeScene.title}</span>}
          <span className="text-xs bg-[var(--color-stage-accent)]/20 text-[var(--color-stage-accent-light)] px-2 py-0.5 rounded-full">
            {settings.myCharacter}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-[var(--color-stage-muted)]">Rate</span>
          <input type="range" min={0.5} max={2} step={0.1} value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="w-20 accent-[var(--color-stage-accent)]" disabled={isPlaying} />
          <span className="text-xs text-[var(--color-stage-muted)] w-8">{rate.toFixed(1)}×</span>
        </div>
      </div>

      {/* Script area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {allGroups.map((group) => (
          <LineRow
            key={group.startIdx}
            group={group}
            isCurrent={group.startIdx <= currentIdx && currentIdx <= group.endIdx}
            phase={phase}
            isMyLine={group.character === settings.myCharacter}
            myLineMode={settings.myLineMode}
            textRevealed={revealedLines[group.startIdx] === true}
            accuracy={accuracyEnabled ? (accuracies[group.startIdx] ?? null) : null}
            transcript={transcripts[group.startIdx] ?? ''}
            wordDiff={wordDiffs[group.startIdx] ?? []}
            threshold={settings.accuracyWarningThreshold}
            inBlock={!!markedBlock && group.startIdx >= markedBlock.startIndex && group.startIdx <= markedBlock.endIndex}
            isMarkStart={group.startIdx === markStart}
            onJump={() => jumpTo(group.startIdx)}
            onToggleMark={() => toggleMarkStart(group.startIdx)}
            ref={(el) => { lineRefs.current[group.startIdx] = el }}
          />
        ))}

        {phase === 'done' && (
          <>
            <div className="text-center py-6 text-[var(--color-stage-gold)] text-lg font-semibold">
              🎭 End of scene
            </div>
            <AccuracySummary script={script} settings={settings} accuracies={accuracies} transcripts={transcripts} />
          </>
        )}
      </div>

      {/* Block controls */}
      {(markedBlock || markStart !== null) && (
        <div className="px-4 py-2 border-t border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] flex items-center gap-3 flex-wrap shrink-0">
          <span className="text-xs text-[var(--color-stage-gold)]">
            {markStart !== null
              ? 'Click a second line to set block end…'
              : `Block: lines ${markedBlock!.startIndex + 1}–${markedBlock!.endIndex + 1}`}
          </span>
          {markedBlock && (
            <>
              <select value={repeatMode} onChange={(e) => setRepeatMode(e.target.value as RepeatMode)}
                className="text-xs bg-[var(--color-stage-bg)] border border-[var(--color-stage-border)] rounded px-2 py-1 text-[var(--color-stage-text)]">
                <option value="off">No repeat</option>
                <option value="always">Always repeat</option>
                <option value="below-threshold">Repeat if low accuracy</option>
              </select>
              <button onClick={() => jumpTo(markedBlock.startIndex)}
                className="text-xs text-[var(--color-stage-accent-light)] hover:text-white transition-colors">
                ▶ Play block
              </button>
            </>
          )}
          <button onClick={() => { setMarkedBlock(null); setMarkStart(null); setRepeatMode('off') }}
            className="text-xs text-red-400 hover:text-red-300 ml-auto">
            Clear
          </button>
        </div>
      )}

      {/* Playback controls */}
      <div className="px-4 py-4 border-t border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] shrink-0">
        <div className="flex items-center justify-center gap-4">
          <CtrlBtn onClick={handleBack} disabled={!isPlaying} title="Previous beat">⏮</CtrlBtn>
          <CtrlBtn onClick={isPlaying ? handlePause : handlePlay} large title={isPlaying ? 'Pause' : 'Play'}>
            {phase === 'paused' ? '▶' : isPlaying ? '⏸' : '▶'}
          </CtrlBtn>
          <CtrlBtn onClick={handleStop} disabled={!isPlaying && phase !== 'paused'} title="Stop">⏹</CtrlBtn>
          <CtrlBtn onClick={handleSkip} disabled={!isPlaying} title="Skip beat">⏭</CtrlBtn>
          <div className="w-px h-6 bg-[var(--color-stage-border)] mx-1" />
          <CtrlBtn onClick={handleRestart} title="Restart from beginning">↺</CtrlBtn>
          <CtrlBtn onClick={() => setMarkStart(markStart === null ? currentIdx : null)}
            active={markStart !== null} title="Set block marker">✂</CtrlBtn>
        </div>
        <div className="text-center mt-2 text-xs text-[var(--color-stage-muted)] h-4">
          {phase === 'my-line-listening' && listening && '🎙 Listening…'}
          {phase === 'my-line-silence' && !listening && 'Your line…'}
          {phase === 'my-line-reading' && 'Reading your line…'}
          {phase === 'playing-other' && 'Playing…'}
          {phase === 'paused' && 'Paused'}
          {phase === 'done' && 'Finished — see summary above'}
        </div>
      </div>
    </div>
  )
}

function CtrlBtn({ onClick, disabled, title, large, active, children }: {
  onClick: () => void; disabled?: boolean; title?: string
  large?: boolean; active?: boolean; children: React.ReactNode
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        large ? 'w-14 h-14 text-2xl' : 'w-10 h-10 text-lg'
      } ${
        active
          ? 'bg-[var(--color-stage-gold)] text-black'
          : 'bg-[var(--color-stage-border)] text-[var(--color-stage-text)] hover:bg-[var(--color-stage-accent)] hover:text-white'
      }`}>
      {children}
    </button>
  )
}

interface LineRowProps {
  group: LineGroup
  isCurrent: boolean
  phase: Phase
  isMyLine: boolean
  myLineMode: string
  textRevealed: boolean
  accuracy: number | null
  transcript: string
  wordDiff: WordDiff[]
  threshold: number
  inBlock: boolean
  isMarkStart: boolean
  onJump: () => void
  onToggleMark: () => void
}

const LineRow = ({
  group, isCurrent, phase, isMyLine, myLineMode, textRevealed,
  accuracy, transcript, wordDiff, threshold, inBlock, isMarkStart,
  onJump, onToggleMark, ref,
}: LineRowProps & { ref: React.Ref<HTMLDivElement> }) => {

  if (group.type === 'heading') {
    return (
      <div ref={ref} className="py-3 text-center text-[var(--color-stage-gold)] font-semibold text-sm uppercase tracking-widest">
        {group.text}
      </div>
    )
  }

  if (group.type === 'direction') {
    return (
      <div ref={ref} className={`text-xs italic text-[var(--color-stage-muted)] px-2 py-1 rounded ${isCurrent ? 'bg-[var(--color-stage-accent)]/10' : ''}`}>
        {group.text}
      </div>
    )
  }

  const isActiveMyLine = isCurrent && isMyLine &&
    ['my-line-silence', 'my-line-listening', 'my-line-reading'].includes(phase)
  const isActiveLine = isCurrent && !isMyLine && phase === 'playing-other'
  const hideText = isMyLine && !textRevealed && myLineMode === 'silence'
  const dimText = isMyLine && !textRevealed && myLineMode !== 'silence'

  return (
    <div
      ref={ref}
      className={`rounded-lg px-3 py-2 transition-colors group ${inBlock ? 'ring-1 ring-[var(--color-stage-gold)]/30' : ''} ${
        isActiveMyLine ? 'bg-[var(--color-stage-accent)]/20 ring-1 ring-[var(--color-stage-accent)]'
          : isActiveLine ? 'bg-white/5 ring-1 ring-white/20'
          : isCurrent ? 'bg-[var(--color-stage-surface)]' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <button onClick={onJump} title="Jump here"
          className="text-[10px] text-[var(--color-stage-muted)] opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 w-6 shrink-0 text-right tabular-nums">
          {group.startIdx + 1}
        </button>
        <button onClick={onToggleMark} title="Set block marker"
          className={`text-xs mt-0.5 shrink-0 w-4 transition-opacity ${isMarkStart ? 'text-[var(--color-stage-gold)]' : 'text-[var(--color-stage-muted)] opacity-0 group-hover:opacity-100'}`}>
          ✂
        </button>
        <div className="flex-1 min-w-0">
          <span className={`text-[10px] font-bold uppercase tracking-wider mr-2 ${isMyLine ? 'text-[var(--color-stage-accent-light)]' : 'text-[var(--color-stage-gold)]'}`}>
            {group.character}
          </span>
          {hideText ? (
            <span className="text-sm text-[var(--color-stage-muted)] tracking-widest select-none">— — —</span>
          ) : (
            <span className={`text-sm ${
              isActiveLine || isActiveMyLine ? 'text-white'
                : dimText ? 'text-[var(--color-stage-muted)]'
                : 'text-[var(--color-stage-text)]'
            }`}>
              {group.text.split('\n').map((t, idx) => (
                <span key={idx} className="block">{t}</span>
              ))}
            </span>
          )}
        </div>
      </div>
      {accuracy !== null && isMyLine && (
        <div className="mt-1 pl-9">
          <AccuracyDisplay accuracy={accuracy} transcript={transcript} wordDiff={wordDiff} threshold={threshold} />
        </div>
      )}
    </div>
  )
}
