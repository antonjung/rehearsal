import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { IconPlay, IconPause, IconStop, IconSkipBack, IconSkipForward, IconRepeat, IconSummary, IconEye, IconEyeOff, IconArrowLeft, IconDismiss, IconMic, IconRecordStop, IconRecordDot } from './Icons'
import { useAppStore } from '../store/useAppStore'
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis'
import { getRecording, setRecording } from '../utils/recordingStore'
import { useMediaRecorder } from '../hooks/useMediaRecorder'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { wordAccuracy, buildWordDiff } from '../utils/textDiff'
import { estimateDuration } from '../utils/speechDuration'
import { AccuracySummary } from './AccuracySummary'
import { unlockAudio, playPing, playCompletion, playClipStart, getAudioContext } from '../utils/sounds'
import type { WordDiff, VoiceCommandWords } from '../types'
import { DEFAULT_VOICE_COMMANDS } from '../types'

interface Props {
  onExit: () => void
}

const HIGHLIGHTER_COLORS: Record<string, React.CSSProperties> = {
  yellow: { background: 'rgba(255, 255, 0, 0.65)',  color: '#111' },
  pink:   { background: 'rgba(255, 0, 200, 0.48)',  color: '#fff' },
  green:  { background: 'rgba(0, 255, 60, 0.5)',    color: '#fff' },
  blue:   { background: 'rgba(0, 240, 255, 0.52)',  color: '#fff' },
}

type HandsFreeCmd =
  | { type: 'stop' }
  | { type: 'back'; n: number }
  | { type: 'skip' }
  | { type: 'repeat' }
  | { type: 'loop' }

// Short utterance → command detection (≤3 words so dialogue doesn't false-trigger).
// "back N" (digit or word) goes back N line groups; bare "back" defaults to 1.
// "repeat" / "top" / "restart" jumps to clip start.
function matchHandsFreeCommand(text: string, words: VoiceCommandWords): HandsFreeCmd | null {
  const parts = text.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean)
  if (parts.length === 0 || parts.length > 3) return null
  if (parts.some(w => words.stop.includes(w)))   return { type: 'stop' }
  if (parts.some(w => words.repeat.includes(w))) return { type: 'repeat' }
  if (parts.some(w => words.loop.includes(w)))   return { type: 'loop' }
  if (parts.some(w => words.skip.includes(w)))   return { type: 'skip' }
  const backIdx = parts.findIndex(w => words.back.includes(w))
  if (backIdx >= 0) {
    const rest = parts.filter((_, i) => i !== backIdx)
    let n = 1
    if (rest.length > 0) {
      const WORD_NUMS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
      const digit = parseInt(rest[0], 10)
      if (!isNaN(digit) && digit >= 1) n = Math.min(digit, 10)
      else if (WORD_NUMS[rest[0]]) n = WORD_NUMS[rest[0]]
    }
    return { type: 'back', n }
  }
  return null
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
  const { scripts, rehearsalSettings, scriptFontSize } = useAppStore()
  const { speak, cancel } = useSpeechSynthesis()
  const { transcript, listening, supported, listen, abort, reset: resetTranscript } = useSpeechRecognition()
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
  const [clipMenu, setClipMenu] = useState<{ startIdx: number; y: number } | null>(null)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const rate = settings.speechRate
  const [countdownMs, setCountdownMs] = useState<number | null>(null)
  const countdownGapRef = useRef<number>(0)
  const countdownExpiredRef = useRef(false)
  const speechAccumMsRef = useRef(0)          // total ms of speaking accumulated this line
  const speechBoutStartRef = useRef<number | null>(null)  // start of current speaking bout
  const handsFreeEnabled = settings.handsFreeEnabled ?? true
  const loopRef = useRef(false)
  loopRef.current = loopEnabled
  const setLoopEnabledRef = useRef(setLoopEnabled)
  setLoopEnabledRef.current = setLoopEnabled
  const handsFreeRef = useRef(false)
  handsFreeRef.current = handsFreeEnabled
  const abortRef = useRef(abort)
  abortRef.current = abort
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // --- Refs ---
  const lineRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const stopRef = useRef(false)
  const runIdRef = useRef(0)
  const pauseRef = useRef(false)
  const draggingRef = useRef<'start' | 'end' | null>(null)
  const dragLastGiRef = useRef(-1)
  const dragTouchYRef = useRef(0)
  const dragScrollRafRef = useRef<number | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTouchRef = useRef<{ x: number; y: number } | null>(null)
  const longPressMenuFiredRef = useRef(false)
  const dragOverlayRef = useRef<HTMLDivElement>(null)
  const dragLabelRef = useRef<HTMLSpanElement>(null)
  const blockStartRef = useRef(defaultBlockStart)
  const blockEndRef = useRef(defaultBlockEnd)
  const pauseResolveRef = useRef<(() => void) | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const recSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const recResolveRef = useRef<((ok: boolean) => void) | null>(null)
  const recMapRef = useRef<Map<number, Blob>>(new Map())
  const sceneGroupsRef = useRef(sceneGroups)
  const handlePlayRef = useRef<() => void>(() => {})
  const runPlaybackRef = useRef<(start: number, end: number) => void>(() => {})
  // Tracks whether the idle hands-free command loop is active.
  // handlePlay sets this false + calls abort() synchronously, stopping the loop
  // before runPlayback starts its own listen() — avoiding competing SR sessions.
  const idleListeningRef = useRef(false)
  const voiceCmdWordsRef = useRef<VoiceCommandWords>({ ...DEFAULT_VOICE_COMMANDS, ...(settings.voiceCommands ?? {}) })
  voiceCmdWordsRef.current = { ...DEFAULT_VOICE_COMMANDS, ...(settings.voiceCommands ?? {}) }

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

  const cancelLongPress = () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
    longPressTouchRef.current = null
  }

  // Scroll to clip start on mount
  useEffect(() => {
    const t = setTimeout(() => {
      lineRefs.current[blockStart]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 100)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Clear countdown when leaving silence/listening phase
  useEffect(() => {
    if (phase !== 'my-line-silence' && phase !== 'my-line-listening') {
      speechAccumMsRef.current = 0
      speechBoutStartRef.current = null
      setCountdownMs(null)
    }
  }, [phase])

  // Tick at 100ms: accumulate speaking time, pause when actor is silent
  useEffect(() => {
    const id = setInterval(() => {
      const gap = countdownGapRef.current
      const accum = speechAccumMsRef.current
      const boutStart = speechBoutStartRef.current
      // Show nothing until speech starts
      if (accum === 0 && boutStart === null) { setCountdownMs(null); return }
      const totalSpoken = accum + (boutStart !== null ? Date.now() - boutStart : 0)
      const rem = Math.max(0, gap - totalSpoken)
      setCountdownMs(rem)
      if (rem <= 0 && !countdownExpiredRef.current) countdownExpiredRef.current = true
    }, 100)
    return () => clearInterval(id)
  }, [])

  // Idle hands-free command listener — waits for "start"/"play"/"go" when not playing.
  // Uses idleListeningRef rather than a local `active` flag so handlePlay() can stop
  // the loop synchronously (before runPlayback starts its own listen() session).
  useEffect(() => {
    if (!handsFreeEnabled || !supported) return
    if (phase !== 'idle' && phase !== 'done') return
    idleListeningRef.current = true
    ;(async () => {
      while (idleListeningRef.current) {
        const heard = await listen({ silenceMs: 2500 })
        if (!idleListeningRef.current) break
        const heardParts = heard.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean)
        if (heardParts.some(w => voiceCmdWordsRef.current.play.includes(w))) {
          idleListeningRef.current = false
          handlePlayRef.current()
          break
        }
      }
    })()
    return () => { idleListeningRef.current = false }
  }, [handsFreeEnabled, phase, supported, listen])

  // Instant hands-free play: fires as soon as a command word appears in the interim transcript,
  // without waiting for the 2.5s silence timer to expire.
  useEffect(() => {
    if (!handsFreeEnabled) return
    if (phase !== 'idle' && phase !== 'done') return
    if (!transcript) return
    const parts = transcript.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean)
    if (parts.some(w => voiceCmdWordsRef.current.play.includes(w))) {
      idleListeningRef.current = false
      abortRef.current()
      handlePlayRef.current()
    }
  }, [transcript, handsFreeEnabled, phase])

  // Executes a hands-free command detected during a listen() window inside runPlayback.
  // Uses only refs so it's safe to call from within the async loop without stale-closure issues.
  const execHandsFreeCommand = (cmd: HandsFreeCmd, lineIdx: number) => {
    if (cmd.type === 'stop') { interruptPlayback(); setPhase('idle'); return }
    if (cmd.type === 'repeat') {
      interruptPlayback(() => { stopRef.current = false; runPlaybackRef.current(blockStartRef.current, blockEndRef.current) })
      return
    }
    if (cmd.type === 'loop') { setLoopEnabledRef.current(v => !v); return }
    const gs = sceneGroupsRef.current
    const gi = gs.findIndex(g => g.startIdx <= lineIdx && lineIdx <= g.endIdx)
    if (cmd.type === 'back') {
      const targetGi = gi - cmd.n
      const prev = targetGi >= 0
        ? Math.max(gs[targetGi].startIdx, blockStartRef.current)
        : blockStartRef.current
      interruptPlayback(() => { stopRef.current = false; runPlaybackRef.current(prev, blockEndRef.current) })
    } else {
      const next = gi >= 0 && gi + 1 < gs.length ? Math.min(gs[gi + 1].startIdx, blockEndRef.current) : blockEndRef.current
      interruptPlayback(() => { stopRef.current = false; runPlaybackRef.current(next, blockEndRef.current) })
    }
  }

  // --- Playback loop ---
  const runPlayback = useCallback(
    async (startIdx: number, endIdx: number) => {
      const runId = ++runIdRef.current
      stopRef.current = false
      let i = startIdx

      // Callback passed to listen(): accumulates only time when actor is speaking.
      // Called with true when onresult fires (speech active), false after 300ms quiet.
      // finish() in the hook always fires false before resolving, finalising the tally.
      const onSpeechActivity = (active: boolean) => {
        if (active) {
          if (speechBoutStartRef.current === null) speechBoutStartRef.current = Date.now() - 300
        } else {
          if (speechBoutStartRef.current !== null) {
            speechAccumMsRef.current += Date.now() - speechBoutStartRef.current
            speechBoutStartRef.current = null
          }
        }
      }

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
        const gap = estimateDuration(groupText, rate) * (settingsRef.current.voiceCalibration ?? 1)
        const silenceMs = settings.endLineSilenceMs ?? 500

        if (!isMyLine) {
          setPhase('playing-other')
          const rec = recMapRef.current.get(lineIdx)
          const speakOther = async () => {
            if (!rec || !(await playRecording(rec))) {
              if (!stopRef.current && !pauseRef.current && runIdRef.current === runId) await speak(groupText, { rate })
            }
          }
          if (handsFreeRef.current && supported) {
            let otherCmd: HandsFreeCmd | null = null
            let speakDone = false
            const speakPromise = speakOther().then(() => { speakDone = true })
            while (!speakDone && !stopRef.current) {
              const heard = await Promise.race([
                listen({ silenceMs: 1500 }),
                speakPromise.then(() => ''),
              ])
              abort()
              if (stopRef.current) break
              if (heard) {
                const cmd = matchHandsFreeCommand(heard, voiceCmdWordsRef.current)
                if (cmd) { otherCmd = cmd; cancel(); cancelRecording(); break }
              }
            }
            if (otherCmd && !stopRef.current) { execHandsFreeCommand(otherCmd, lineIdx); return }
          } else {
            await speakOther()
          }
        } else {
          const { myLineMode } = settings

          // Cue sound when the very first line in the clip is the user's
          if (lineIdx === startIdx && (settingsRef.current.clipStartPingEnabled ?? true)) {
            await playClipStart()
          }

          if (myLineMode === 'silence') {
            if (accuracyEnabled && supported) {
              countdownGapRef.current = gap; speechAccumMsRef.current = 0; speechBoutStartRef.current = null
              countdownExpiredRef.current = false
              setPhase('my-line-listening')
              resetTranscript()
              const heard = await listen({ silenceMs, estimatedMs: gap, maxPauseMs: settings.maxPauseMs ?? 2000, switchToShortSilenceRef: countdownExpiredRef, onSpeechActivity })
              speechAccumMsRef.current = 0; speechBoutStartRef.current = null
              // iOS needs a moment to hand the audio session back from mic to speaker
              await delay(600)
              if (handsFreeRef.current && heard) { const _c = matchHandsFreeCommand(heard, voiceCmdWordsRef.current); if (_c) { execHandsFreeCommand(_c, lineIdx); return } }
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
                  if (settingsRef.current.linePingEnabled === true) await playPing(acc, settingsRef.current.accuracyWarningThreshold)
                }
              }
            } else {
              // No speech recognition: listen for voice activity or fall back to fixed gap
              countdownGapRef.current = gap; speechAccumMsRef.current = 0; speechBoutStartRef.current = null
              countdownExpiredRef.current = false
              setPhase('my-line-silence')
              if (supported) {
                const _heard = await listen({ silenceMs, estimatedMs: gap, maxPauseMs: settings.maxPauseMs ?? 2000, switchToShortSilenceRef: countdownExpiredRef, onSpeechActivity })
                speechAccumMsRef.current = 0; speechBoutStartRef.current = null
                await delay(600)
                if (handsFreeRef.current && _heard) { const _c = matchHandsFreeCommand(_heard, voiceCmdWordsRef.current); if (_c) { execHandsFreeCommand(_c, lineIdx); return } }
              } else {
                await delay(gap)
              }
              if (!stopRef.current) setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
            }
          } else if (myLineMode === 'read') {
            setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
            setPhase('my-line-reading')
            const rec = recMapRef.current.get(lineIdx)
            if (!rec || !(await playRecording(rec))) { if (!stopRef.current && !pauseRef.current && runIdRef.current === runId) await speak(groupText, { rate }) }
          } else if (myLineMode === 'gap-before') {
            // Wait for user to finish attempting the line, then read it
            countdownGapRef.current = gap; speechAccumMsRef.current = 0; speechBoutStartRef.current = null
            countdownExpiredRef.current = false
            setPhase('my-line-silence')
            if (supported) {
              const _heard = await listen({ silenceMs, estimatedMs: gap, maxPauseMs: settings.maxPauseMs ?? 2000, switchToShortSilenceRef: countdownExpiredRef, onSpeechActivity })
              speechAccumMsRef.current = 0; speechBoutStartRef.current = null
              await delay(600)
              if (handsFreeRef.current && _heard) { const _c = matchHandsFreeCommand(_heard, voiceCmdWordsRef.current); if (_c) { execHandsFreeCommand(_c, lineIdx); return } }
            } else {
              await delay(gap)
            }
            if (!stopRef.current) {
              setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
              setPhase('my-line-reading')
              const rec = recMapRef.current.get(lineIdx)
              if (!rec || !(await playRecording(rec))) { if (!stopRef.current && !pauseRef.current && runIdRef.current === runId) await speak(groupText, { rate }) }
            }
          } else {
            // gap-after: read the line, then wait for user to repeat
            setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
            setPhase('my-line-reading')
            const rec = recMapRef.current.get(lineIdx)
            if (!rec || !(await playRecording(rec))) { if (!stopRef.current && !pauseRef.current && runIdRef.current === runId) await speak(groupText, { rate }) }
            if (!stopRef.current) {
              countdownGapRef.current = gap; speechAccumMsRef.current = 0; speechBoutStartRef.current = null
              countdownExpiredRef.current = false
              setPhase('my-line-listening')
              if (supported) {
                const heard = await listen({ silenceMs, estimatedMs: gap, maxPauseMs: settings.maxPauseMs ?? 2000, switchToShortSilenceRef: countdownExpiredRef, onSpeechActivity })
                speechAccumMsRef.current = 0; speechBoutStartRef.current = null
                await delay(600)
                if (handsFreeRef.current && heard) { const _c = matchHandsFreeCommand(heard, voiceCmdWordsRef.current); if (_c) { execHandsFreeCommand(_c, lineIdx); return } }
                if (!stopRef.current && heard && accuracyEnabled) {
                  const acc = wordAccuracy(groupText, heard)
                  const diff = buildWordDiff(groupText, heard)
                  const next = { ...accuraciesRef.current, [lineIdx]: acc }
                  accuraciesRef.current = next
                  setAccuracies(next)
                  setTranscripts((t) => ({ ...t, [lineIdx]: heard }))
                  setWordDiffs((d) => ({ ...d, [lineIdx]: diff }))
                  if (settingsRef.current.linePingEnabled === true) await playPing(acc, settingsRef.current.accuracyWarningThreshold)
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
        if (settingsRef.current.scenePingEnabled === true) await playCompletion()
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
    setShowSummary(false)
    // Stop the idle command listener immediately so its pending listen() doesn't
    // compete with runPlayback's own listen() calls (would block user-line detection).
    idleListeningRef.current = false
    abort()

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

  handlePlayRef.current = handlePlay

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
  sceneGroupsRef.current = sceneGroups
  runPlaybackRef.current = runPlayback

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
    cancelLongPress()
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
      {/* Sub-header: back | scene/character label | show-lines toggle */}
      <div className="flex items-center px-4 py-2 border-b border-[var(--color-stage-border)] shrink-0 gap-3">
        <button onClick={onExit} className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] shrink-0 flex items-center gap-1 text-sm">
          <IconArrowLeft className="text-base" /> Back
        </button>
        <span className="flex-1 text-sm font-semibold text-[var(--color-stage-text)] truncate text-center">
          {activeScene ? activeScene.sceneTitle || activeScene.title : settings.myCharacter}
        </span>
        <ToggleSwitch
          checked={showAllMyLines}
          onChange={(v) => { setShowAllMyLines(v); setRevealedLines({}) }}
        />
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
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5" style={{ '--script-font-size': `${scriptFontSize}px` } as React.CSSProperties}>
        {sceneGroups.map((group, gi) => {
          const isCurrentGroup = group.startIdx <= currentIdx && currentIdx <= group.endIdx
          const isMyLine = group.character === settings.myCharacter
          const lineVisible = !isMyLine || showAllMyLines || revealedLines[group.startIdx] === true
          const acc = accuracies[group.startIdx] ?? null

          const isInClip = group.startIdx >= blockStart && group.startIdx <= blockEnd

          return (
            <div
              key={group.startIdx}
              data-gi={gi}
              className={isInClip ? 'bg-amber-400/10 rounded' : ''}
              style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
              onTouchStart={(e) => {
                longPressMenuFiredRef.current = false
                longPressTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
                const capturedY = e.touches[0].clientY
                longPressTimerRef.current = setTimeout(() => {
                  longPressMenuFiredRef.current = true
                  setClipMenu({ startIdx: group.startIdx, y: capturedY })
                  longPressTouchRef.current = null
                }, 2000)
              }}
              onTouchMove={(e) => {
                if (longPressTouchRef.current) {
                  const dx = Math.abs(e.touches[0].clientX - longPressTouchRef.current.x)
                  const dy = Math.abs(e.touches[0].clientY - longPressTouchRef.current.y)
                  if (dx > 8 || dy > 8) cancelLongPress()
                }
              }}
              onTouchEnd={cancelLongPress}
              onTouchCancel={cancelLongPress}
            >
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
                highlightStyle={isMyLine ? HIGHLIGHTER_COLORS[settings.highlighterColor ?? 'yellow'] : undefined}
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
          <div className="text-center py-6 text-[var(--color-stage-gold)] text-lg font-semibold">
            🎭 End of scene
          </div>
        )}

      </div>

      {/* Long-press clip menu */}
      {clipMenu && (clipMenu.startIdx < blockEnd || clipMenu.startIdx > blockStart) && (
        <>
          <div className="fixed inset-0 z-40" onTouchStart={() => setClipMenu(null)} onClick={() => setClipMenu(null)} />
          <div
            className="fixed z-50 bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] rounded-xl shadow-2xl overflow-hidden min-w-[180px]"
            style={{ left: '50%', transform: 'translateX(-50%)', top: Math.max(60, Math.min(clipMenu.y - 20, window.innerHeight - 130)) }}
          >
            {clipMenu.startIdx < blockEnd && (
              <button
                className={`w-full px-5 py-3.5 text-sm text-left text-[var(--color-stage-text)] hover:bg-[var(--color-stage-accent)]/20 flex items-center gap-2 ${clipMenu.startIdx > blockStart ? 'border-b border-[var(--color-stage-border)]' : ''}`}
                onClick={() => { setBlockStart(clipMenu.startIdx); blockStartRef.current = clipMenu.startIdx; setClipMenu(null) }}
              >
                <span className="text-red-400 text-xs">▲</span> Start clip here
              </button>
            )}
            {clipMenu.startIdx > blockStart && (
              <button
                className="w-full px-5 py-3.5 text-sm text-left text-[var(--color-stage-text)] hover:bg-[var(--color-stage-accent)]/20 flex items-center gap-2"
                onClick={() => { setBlockEnd(clipMenu.startIdx); blockEndRef.current = clipMenu.startIdx; setClipMenu(null) }}
              >
                <span className="text-red-400 text-xs">▼</span> End clip here
              </button>
            )}
          </div>
        </>
      )}

      {/* Summary modal */}
      {showSummary && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setShowSummary(false)} />
          <div className="fixed inset-x-4 top-16 bottom-16 z-50 flex flex-col rounded-2xl bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-stage-border)] shrink-0">
              <span className="font-semibold text-[var(--color-stage-text)]">Summary</span>
              <button onClick={() => setShowSummary(false)} className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] text-xl leading-none"><IconDismiss /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <AccuracySummary script={script} settings={settings} accuracies={accuracies} transcripts={transcripts} />
            </div>
          </div>
        </>
      )}

      {/* Controls */}
      <div className="px-4 pt-3 pb-4 border-t border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] shrink-0">

        {/* Your-line status banner — prominently visible during silence/listening */}
        {(phase === 'my-line-silence' || phase === 'my-line-listening') && (
          <div className={`flex items-center justify-between rounded-lg px-4 py-2.5 mb-3 ${
            phase === 'my-line-listening'
              ? 'bg-[var(--color-stage-accent)]/20 border border-[var(--color-stage-accent)]/40'
              : 'bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)]'
          }`}>
            <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-stage-accent-light)]">
              {phase === 'my-line-listening'
                ? <><IconMic /> Listening…</>
                : <span className="text-[var(--color-stage-text)]">Your line</span>
              }
            </span>
            {countdownMs !== null && (
              <span className={`font-mono tabular-nums text-2xl font-bold transition-colors ${
                countdownMs <= countdownGapRef.current * 0.25
                  ? 'text-amber-400'
                  : 'text-[var(--color-stage-accent-light)]'
              }`}>
                {Math.max(0, countdownMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        )}

        {/* Transport row — always visible, all same large size */}
        <div className="flex items-center justify-center gap-3 mb-2">
          <CtrlBtn onClick={handleBack} disabled={phase === 'idle' || phase === 'done'} large title="Previous beat"><IconSkipBack /></CtrlBtn>
          <CtrlBtn onClick={isPlaying ? handlePause : handlePlay} large title={isPlaying ? 'Pause' : phase === 'paused' ? 'Resume' : 'Play'}>
            {isPlaying ? <IconPause /> : <IconPlay />}
          </CtrlBtn>
          <CtrlBtn onClick={handleStop} disabled={phase === 'idle' || phase === 'done'} large title="Stop"><IconStop /></CtrlBtn>
          <CtrlBtn onClick={handleSkip} disabled={phase === 'idle' || phase === 'done'} large title="Skip beat"><IconSkipForward /></CtrlBtn>
        </div>

        {/* Repeat + Summary pills */}
        <div className="flex justify-center gap-2 mb-1">
          <button
            onClick={() => setLoopEnabled((v) => !v)}
            className={`flex items-center gap-1 text-xs px-4 py-1 rounded-full font-semibold transition-colors ${
              loopEnabled
                ? 'bg-[var(--color-stage-accent)] text-white'
                : 'bg-[var(--color-stage-border)] text-[var(--color-stage-muted)]'
            }`}
          >
            <IconRepeat /> Repeat
          </button>
          {Object.keys(accuracies).length > 0 && (
            <button
              onClick={() => setShowSummary((v) => !v)}
              className={`flex items-center gap-1 text-xs px-4 py-1 rounded-full font-semibold transition-colors ${
                showSummary
                  ? 'bg-[var(--color-stage-accent)] text-white'
                  : 'bg-[var(--color-stage-border)] text-[var(--color-stage-muted)]'
              }`}
            >
              <IconSummary /> Summary
            </button>
          )}
        </div>

        {/* Status line */}
        <div className="text-center text-xs text-[var(--color-stage-muted)] min-h-4 flex items-center justify-center">
          {phase === 'my-line-reading' && 'Reading your line…'}
          {phase === 'playing-other' && 'Playing…'}
          {phase === 'paused' && 'Paused — tap a line to restart from it'}
          {phase === 'done' && 'Scene complete'}
          {phase === 'idle' && !handsFreeEnabled && 'Tap ▶ to play · tap a line to select · drag red lines to set clip'}
          {phase === 'idle' && handsFreeEnabled && (listening ? <span className="flex items-center gap-1"><IconMic className="text-sm" /> Listening for command…</span> : <span className="flex items-center gap-1"><IconMic className="text-sm" /> Say "start" to begin</span>)}
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
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-11 h-6 rounded-full transition-colors shrink-0 focus:outline-none ${
        checked ? 'bg-[var(--color-stage-accent)]' : 'bg-[var(--color-stage-border)]'
      }`}
    >
      <span className={`absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-5' : 'translate-x-0'
      }`} />
    </button>
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
  highlightStyle?: React.CSSProperties
  onSelect: () => void
  onReveal?: () => void
  onRecord?: () => void
  isRecordingThis?: boolean
  anyRecording?: boolean
}

const LineRow = ({
  group, isCurrent, phase, isMyLine, lineVisible,
  accuracy, threshold, highlightStyle,
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
          ? 'ring-1 ring-[var(--color-stage-accent)]'
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
              {lineVisible ? <IconEye /> : <IconEyeOff />}
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
            <span className="text-[var(--color-stage-text)]" style={{ fontSize: 'var(--script-font-size, 14px)' }}>
              {group.text.split('\n').map((t, idx) => (
                <span key={idx} className="block" style={highlightStyle ? { ...highlightStyle, borderRadius: '3px', padding: '1px 3px', marginBottom: '2px' } : {}}>{t}</span>
              ))}
            </span>
          ) : (
            <span
              className="text-[var(--color-stage-text)] select-none"
              style={{ fontSize: 'var(--script-font-size, 14px)', filter: 'blur(5px)', pointerEvents: 'none', userSelect: 'none' }}
            >
              {group.text.split('\n').map((t, idx) => (
                <span key={idx} className="block" style={highlightStyle ? { ...highlightStyle, borderRadius: '3px', padding: '1px 3px', marginBottom: '2px' } : {}}>{t}</span>
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
            {isRecordingThis ? <IconRecordStop /> : <IconRecordDot />}
          </button>
        ) : (
          <div className="w-5 shrink-0" />
        )}
      </div>
    </div>
  )
}
