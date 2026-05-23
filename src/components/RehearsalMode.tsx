import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { IconPlay, IconPause, IconStop, IconSkipBack, IconSkipForward, IconRepeat, IconEye, IconEyeOff, IconDismiss, IconRecordStop, IconRecordDot, IconSearch, IconChevronUp, IconChevronDown, IconTextCollapse } from './Icons'
import { useAppStore } from '../store/useAppStore'
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis'
import { getRecording, setRecording, getRecordingDuration, setRecordingDuration, deleteRecording } from '../utils/recordingStore'
import { useMediaRecorder } from '../hooks/useMediaRecorder'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { estimateDuration } from '../utils/speechDuration'
import { unlockAudio, playCompletion, playClipStart, getAudioContext } from '../utils/sounds'
import type { VoiceCommandWords } from '../types'
import { DEFAULT_VOICE_COMMANDS } from '../types'

const DEFAULT_SETTINGS = {
  myLineMode: 'silence' as const,
  readStageDirections: false,
  speechRate: 1,
  accuracyEnabled: true,
  accuracyWarningThreshold: 70,
  endLineSilenceMs: 400,
  errorPromptEnabled: false,
  errorPromptPhrase: 'The correct line is',
  handsFreeEnabled: true,
  linePingEnabled: true,
  scenePingEnabled: true,
  clipStartPingEnabled: true,
  maxPauseMs: 1000,
  highlighterColor: 'yellow' as const,
  voiceCalibration: 0.6,
  speechCoverageThreshold: 70,
  voiceURI: undefined as string | undefined,
  voiceCommands: undefined as import('../types').VoiceCommandWords | undefined,
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
  | { type: 'line' }

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
  if (parts.some(w => words.line.includes(w)))   return { type: 'line' }
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
  | 'paused'
  | 'done'

interface LineGroup {
  startIdx: number
  endIdx: number
  type: 'dialogue' | 'direction' | 'heading'
  character?: string
  text: string
}

export function RehearsalMode() {
  const { scripts, rehearsalSettings, saveRehearsalSettings, selectedScriptId, scriptFontSize } = useAppStore()
  const { speak, cancel } = useSpeechSynthesis()
  const { transcript, listening, supported, listen, abort } = useSpeechRecognition()
  const { recording: micRecording, start: startMic, stop: stopMic } = useMediaRecorder()

  const script = scripts.find((s) => s.id === selectedScriptId) ?? null
  const lines = script?.lines ?? []
  const sameScript = rehearsalSettings?.scriptId === selectedScriptId
  const [sceneId, setSceneId] = useState<string | null>(sameScript ? (rehearsalSettings?.sceneId ?? null) : null)
  const [myCharacter, setMyCharacter] = useState(sameScript ? (rehearsalSettings?.myCharacter ?? '') : '')
  const settings = useMemo(() => ({
    ...(rehearsalSettings ?? DEFAULT_SETTINGS),
    scriptId: selectedScriptId ?? '',
    sceneId,
    myCharacter,
  }), [rehearsalSettings, selectedScriptId, sceneId, myCharacter])

  const activeScene = sceneId && script
    ? script.scenes.find((s) => s.id === sceneId) ?? null
    : null
  const firstLine = activeScene?.startLineIndex ?? 0
  const sceneEnd = activeScene?.endLineIndex ?? (lines.length > 0 ? lines.length - 1 : 0)

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

  // --- State ---
  const [currentIdx, setCurrentIdx] = useState(defaultBlockStart)
  const [blockStart, setBlockStart] = useState(defaultBlockStart)
  const [blockEnd, setBlockEnd] = useState(defaultBlockEnd)
  const [phase, setPhase] = useState<Phase>('idle')
  const [showAllMyLines, setShowAllMyLines] = useState(true)
  const [revealedLines, setRevealedLines] = useState<Record<number, true>>({})
  const [recordingLineIdx, setRecordingLineIdx] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [clipMenu, setClipMenu] = useState<{ startIdx: number; y: number } | null>(null)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [condensedLines, setCondensedLines] = useState(0)
  const [showCondensedMenu, setShowCondensedMenu] = useState(false)
  const [lineProgressMap, setLineProgressMap] = useState<Record<number, number>>({})
  const rate = settings.speechRate
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchCursor, setSearchCursor] = useState(0)
  const handsFreeEnabled = settings.handsFreeEnabled ?? true
  const loopRef = useRef(false)
  loopRef.current = loopEnabled
  const condensedLinesRef = useRef(condensedLines)
  condensedLinesRef.current = condensedLines
  const setLoopEnabledRef = useRef(setLoopEnabled)
  setLoopEnabledRef.current = setLoopEnabled
  const handsFreeRef = useRef(false)
  handsFreeRef.current = handsFreeEnabled
  const abortRef = useRef(abort)
  abortRef.current = abort
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // --- Search ---
  const searchQ = searchQuery.trim().toLowerCase()
  const searchMatches = useMemo(() => {
    if (!searchQ) return []
    return sceneGroups
      .map((g, gi) => ({ gi, g }))
      .filter(({ g }) => g.text.toLowerCase().includes(searchQ) || (g.character ?? '').toLowerCase().includes(searchQ))
      .map(({ gi }) => gi)
  }, [sceneGroups, searchQ])
  const safeSearchCursor = searchMatches.length > 0 ? Math.min(searchCursor, searchMatches.length - 1) : 0
  useEffect(() => { setSearchCursor(0) }, [searchQ])
  useEffect(() => {
    if (searchMatches.length === 0) return
    const gi = searchMatches[safeSearchCursor]
    const group = sceneGroups[gi]
    lineRefs.current[group.startIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [safeSearchCursor, searchMatches, sceneGroups])

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
  const myLineResolveRef = useRef<(() => void) | null>(null)
  const myLineResetRef = useRef<(() => void) | null>(null)
  const myLinePauseTimerRef = useRef<(() => void) | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const recSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const recResolveRef = useRef<((ok: boolean) => void) | null>(null)
  const recMapRef = useRef<Map<number, Blob>>(new Map())
  const recDurMapRef = useRef<Map<number, number>>(new Map())
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
  const getBlobDuration = (blob: Blob): Promise<number> =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      const cleanup = (ms: number) => { URL.revokeObjectURL(url); resolve(ms) }
      audio.onloadedmetadata = () => {
        // iOS MediaRecorder sometimes sets duration = Infinity — treat as unknown
        const dur = audio.duration
        cleanup(isFinite(dur) && dur > 0.1 ? Math.round(dur * 1000) : 0)
      }
      audio.onerror = () => cleanup(0)
      setTimeout(() => cleanup(0), 3000)
    })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!script) return
      const map = new Map<number, Blob>()
      const durMap = new Map<number, number>()
      for (let i = firstLine; i <= sceneEnd; i++) {
        if (lines[i]?.type === 'dialogue') {
          const blob = await getRecording(script.id, i)
          if (blob) {
            map.set(i, blob)
            const stored = await getRecordingDuration(script.id, i)
            if (stored && stored > 0) {
              durMap.set(i, stored)
            } else {
              const ms = await getBlobDuration(blob)
              if (ms > 0) durMap.set(i, ms)
            }
          }
        }
      }
      if (!cancelled) { recMapRef.current = map; recDurMapRef.current = durMap }
    }
    load()
    return () => { cancelled = true }
  }, [script?.id, firstLine, sceneEnd, lines])

  useEffect(() => {
    return () => { stopRef.current = true; cancel(); abort() }
  }, [cancel, abort])

  // Reset scene/character when selected script changes while on rehearse tab
  const prevScriptIdRef = useRef(selectedScriptId)
  useEffect(() => {
    if (prevScriptIdRef.current === selectedScriptId) return
    prevScriptIdRef.current = selectedScriptId
    setSceneId(null)
    setMyCharacter('')
    stopRef.current = true
    cancel()
    abort()
  }, [selectedScriptId, cancel, abort])

  // Reset clip markers and position when scene/character changes
  useEffect(() => {
    setBlockStart(defaultBlockStart)
    setBlockEnd(defaultBlockEnd)
    setCurrentIdx(defaultBlockStart)
    blockStartRef.current = defaultBlockStart
    blockEndRef.current = defaultBlockEnd
    setRevealedLines({})
    setLineProgressMap({})
    setPhase('idle')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myCharacter, sceneId])

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
        if (heardParts.length <= 3 && heardParts.some(w => voiceCmdWordsRef.current.loop.includes(w))) {
          setLoopEnabledRef.current(v => !v)
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
            await speak(groupText, { rate, voiceURI: settingsRef.current.voiceURI })
          } else {
            await delay(100)
          }
          i = groupEnd + 1
          continue
        }

        const isMyLine = line.character === settings.myCharacter
        const gap = estimateDuration(groupText, rate) * (settingsRef.current.voiceCalibration ?? 1)

        if (!isMyLine) {
          setPhase('playing-other')
          const rec = recMapRef.current.get(lineIdx)
          const speakOther = async () => {
            if (!rec || !(await playRecording(rec))) {
              if (!stopRef.current && !pauseRef.current && runIdRef.current === runId) await speak(groupText, { rate, voiceURI: settingsRef.current.voiceURI })
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

          if (settingsRef.current.clipStartPingEnabled ?? true) {
            await playClipStart()
          }

          // ELT: use actual recording duration when available, otherwise calibrated estimate
          const elt = recDurMapRef.current.get(lineIdx) ?? gap

          // Pure timer-based gap with rAF progress bar. Interruptible via myLineResolveRef; resettable via myLineResetRef.
          // startImmediately=false: timer only begins when myLineResetRef.current() is first called.
          const waitWithProgress = (startImmediately = true): Promise<void> => new Promise((resolve) => {
            let resolved = false
            let rafId: number | null = null
            let timer: ReturnType<typeof setTimeout> | null = null
            let startTime = Date.now()

            const clearTimers = () => {
              if (timer !== null) { clearTimeout(timer); timer = null }
              if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
            }

            const done = () => {
              if (resolved) return
              resolved = true
              clearTimers()
              myLineResolveRef.current = null
              myLineResetRef.current = null
              myLinePauseTimerRef.current = null
              setLineProgressMap(prev => ({
                ...prev,
                [lineIdx]: Math.min(100, Math.round(((Date.now() - startTime) / elt) * 100))
              }))
              resolve()
            }

            const startTimer = () => {
              clearTimers()
              startTime = Date.now()
              timer = setTimeout(done, elt)
              const tick = () => {
                if (resolved) return
                setLineProgressMap(prev => ({
                  ...prev,
                  [lineIdx]: Math.min(100, Math.round(((Date.now() - startTime) / elt) * 100))
                }))
                rafId = requestAnimationFrame(tick)
              }
              rafId = requestAnimationFrame(tick)
            }

            myLineResolveRef.current = done
            myLineResetRef.current = () => { if (!resolved) startTimer() }
            myLinePauseTimerRef.current = () => { if (!resolved) clearTimers() }
            if (startImmediately) startTimer()
          })

          if (myLineMode === 'silence') {
            setPhase('my-line-silence')

            if (handsFreeRef.current && supported) {
              let myLineDone = false
              let exitCmd: HandsFreeCmd | null = null
              // Timer starts only when actor's voice is first detected
              const waitPromise = waitWithProgress(false).then(() => { myLineDone = true })

              while (!myLineDone && !stopRef.current) {
                const heard = await Promise.race([
                  listen({ silenceMs: 1500, onSpeechStart: () => myLineResetRef.current?.() }),
                  waitPromise.then(() => ''),
                ])
                abort()
                if (myLineDone || stopRef.current) break

                if (heard) {
                  const cmd = matchHandsFreeCommand(heard, voiceCmdWordsRef.current)
                  if (cmd?.type === 'line') {
                    // Pause timer so it can't expire while TTS reads
                    myLinePauseTimerRef.current?.()
                    let actorSpoke = false
                    const speakPromise = speak(groupText, { rate, voiceURI: settingsRef.current.voiceURI })
                    await Promise.race([
                      speakPromise,
                      // onSpeechStart: actor interrupted → cancel TTS and start fresh gap from that moment
                      listen({ silenceMs: 500, onSpeechStart: () => { cancel(); actorSpoke = true; myLineResetRef.current?.() } }).then(() => {}),
                    ])
                    abort()
                    // TTS completed with no interruption → start gap now
                    if (!actorSpoke) myLineResetRef.current?.()
                  } else if (cmd) {
                    exitCmd = cmd
                    myLineResolveRef.current?.()
                    break
                  }
                  // non-command speech → timer was started by onSpeechStart; keep looping until it expires
                }
              }

              await waitPromise
              if (exitCmd && !stopRef.current) { execHandsFreeCommand(exitCmd, lineIdx); return }
            } else {
              await waitWithProgress()
            }

            if (!stopRef.current) setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
          } else if (myLineMode === 'read') {
            setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
            setPhase('my-line-reading')
            const rec = recMapRef.current.get(lineIdx)
            if (!rec || !(await playRecording(rec))) { if (!stopRef.current && !pauseRef.current && runIdRef.current === runId) await speak(groupText, { rate, voiceURI: settingsRef.current.voiceURI }) }
          } else if (myLineMode === 'gap-before') {
            setPhase('my-line-silence')
            await waitWithProgress()
            if (!stopRef.current) {
              setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
              setPhase('my-line-reading')
              const rec = recMapRef.current.get(lineIdx)
              if (!rec || !(await playRecording(rec))) { if (!stopRef.current && !pauseRef.current && runIdRef.current === runId) await speak(groupText, { rate, voiceURI: settingsRef.current.voiceURI }) }
            }
          } else {
            // gap-after: read the line, then wait for user to repeat
            setRevealedLines((r) => ({ ...r, [lineIdx]: true }))
            setPhase('my-line-reading')
            const rec = recMapRef.current.get(lineIdx)
            if (!rec || !(await playRecording(rec))) { if (!stopRef.current && !pauseRef.current && runIdRef.current === runId) await speak(groupText, { rate, voiceURI: settingsRef.current.voiceURI }) }
            if (!stopRef.current) {
              setPhase('my-line-silence')
              await waitWithProgress()
            }
          }
        }

        // Condensed mode: after user's line, skip large other-character sections
        if (isMyLine && !stopRef.current && !pauseRef.current) {
          const condensedThreshold = condensedLinesRef.current
          if (condensedThreshold > 0) {
            const groups = sceneGroupsRef.current
            const myGi = groups.findIndex((g) => g.startIdx <= lineIdx && lineIdx <= g.endIdx)
            let nextUserGi = -1
            for (let gi = myGi + 1; gi < groups.length; gi++) {
              if (groups[gi].type === 'dialogue' && groups[gi].character === settingsRef.current.myCharacter) {
                nextUserGi = gi
                break
              }
            }
            if (nextUserGi > myGi + 1) {
              const linesBetween = groups[nextUserGi].startIdx - (groupEnd + 1)
              if (linesBetween > condensedThreshold) {
                // Find the last dialogue group before the next user line (skip directions/headings)
                let precedingGi = nextUserGi - 1
                while (precedingGi > myGi && groups[precedingGi].type !== 'dialogue') {
                  precedingGi--
                }
                const precedingGroup = groups[precedingGi]
                // only skip if there's actually a gap (preceding group is after the current group)
                if (precedingGroup.type === 'dialogue' && precedingGroup.startIdx > groupEnd + 1) {
                  const skippedCount = precedingGroup.startIdx - (groupEnd + 1)
                  await playCompletion()
                  if (!stopRef.current && !pauseRef.current && runIdRef.current === runId) {
                    await speak(`${skippedCount} line${skippedCount !== 1 ? 's' : ''} skipped`, { rate, voiceURI: settingsRef.current.voiceURI })
                  }
                  if (!stopRef.current && !pauseRef.current && runIdRef.current === runId) {
                    await playCompletion()
                  }
                  if (!stopRef.current && runIdRef.current === runId) {
                    i = precedingGroup.startIdx
                    continue
                  }
                }
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
            setLineProgressMap({})
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
    [lines, settings, speak, rate, supported, listen],
  )

  const interruptPlayback = (cb?: () => void) => {
    runIdRef.current++
    stopRef.current = true
    pauseRef.current = false
    cancel()
    cancelRecording()
    abort()
    pauseResolveRef.current?.()
    myLineResolveRef.current?.()
    myLineResolveRef.current = null
    myLineResetRef.current = null
    myLinePauseTimerRef.current = null
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
    myLineResolveRef.current?.()
    myLineResolveRef.current = null
    myLineResetRef.current = null
    myLinePauseTimerRef.current = null
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
    if (isPlaying || phase === 'paused') {
      interruptPlayback(() => { stopRef.current = false; setCurrentIdx(idx); runPlayback(idx, blockEnd) })
    } else {
      setCurrentIdx(idx)
    }
  }

  const handleRecordLine = async (lineIdx: number) => {
    if (recordingLineIdx !== null) {
      const { blob, durationMs } = await stopMic()
      await setRecording(script!.id, recordingLineIdx, blob)
      recMapRef.current.set(recordingLineIdx, blob)
      if (durationMs > 0) {
        recDurMapRef.current.set(recordingLineIdx, durationMs)
        void setRecordingDuration(script!.id, recordingLineIdx, durationMs)
      }
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

  const handleDeleteRecording = (lineIdx: number) => {
    recMapRef.current.delete(lineIdx)
    recDurMapRef.current.delete(lineIdx)
    void deleteRecording(script!.id, lineIdx)
    setLineProgressMap((p) => { const n = { ...p }; delete n[lineIdx]; return n })
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

  const isPlaying = ['playing-other', 'my-line-reading', 'my-line-silence'].includes(phase)

  if (!script) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <p className="text-sm text-[var(--color-stage-muted)] text-center">Select a script on the Home tab first.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Sub-header: character | scene | search | show-lines toggle */}
      <div className="flex items-center px-4 py-2 border-b border-[var(--color-stage-border)] shrink-0 gap-2">
        <select
          value={myCharacter}
          onChange={(e) => {
            const c = e.target.value
            setMyCharacter(c)
            let newScene = sceneId
            if (sceneId && c) {
              const sc = script.scenes.find((s) => s.id === sceneId)
              if (sc && !sc.characters.includes(c)) { newScene = null; setSceneId(null) }
            }
            interruptPlayback()
            if (selectedScriptId) saveRehearsalSettings({ ...(rehearsalSettings ?? DEFAULT_SETTINGS), scriptId: selectedScriptId, myCharacter: c, sceneId: newScene })
          }}
          className="flex-1 min-w-0 select-field text-sm py-1"
        >
          <option value="">Select character…</option>
          {script.characters.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {script.scenes.length > 0 && (
          <select
            value={sceneId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null
              setSceneId(id)
              let newChar = myCharacter
              if (id && myCharacter) {
                const sc = script.scenes.find((s) => s.id === id)
                if (sc && !sc.characters.includes(myCharacter)) { newChar = ''; setMyCharacter('') }
              }
              interruptPlayback()
              if (selectedScriptId) saveRehearsalSettings({ ...(rehearsalSettings ?? DEFAULT_SETTINGS), scriptId: selectedScriptId, myCharacter: newChar, sceneId: id })
            }}
            className="flex-1 min-w-0 select-field text-sm py-1"
          >
            <option value="">Whole script</option>
            {(myCharacter
              ? script.scenes.filter((s) => s.characters.includes(myCharacter))
              : script.scenes
            ).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        )}
        <button
          onClick={() => { setShowSearch((v) => !v); setSearchQuery('') }}
          className={`shrink-0 transition-colors ${showSearch ? 'text-[var(--color-stage-accent-light)]' : 'text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)]'}`}
          title="Search lines"
        >
          <IconSearch className="text-base" />
        </button>
        <ToggleSwitch
          checked={showAllMyLines}
          onChange={(v) => { setShowAllMyLines(v); setRevealedLines({}) }}
        />
      </div>

      {/* Search bar — slides in below sub-header */}
      <div
        className="overflow-hidden shrink-0 transition-all duration-300"
        style={{ maxHeight: showSearch ? '56px' : '0px' }}
      >
        <div className="px-3 py-2 border-b border-[var(--color-stage-border)] bg-[var(--color-stage-surface)]">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--color-stage-bg)] border border-[var(--color-stage-border)] focus-within:border-[var(--color-stage-accent)]">
            <IconSearch className="text-[var(--color-stage-muted)] text-sm shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search lines…"
              className="flex-1 bg-transparent text-sm text-[var(--color-stage-text)] placeholder:text-[var(--color-stage-muted)] focus:outline-none"
            />
            {searchQ && (
              <>
                <span className="text-xs text-[var(--color-stage-muted)] shrink-0">
                  {searchMatches.length === 0 ? 'No matches' : `${safeSearchCursor + 1}/${searchMatches.length}`}
                </span>
                <button disabled={searchMatches.length === 0} onClick={() => setSearchCursor((c) => (c - 1 + searchMatches.length) % searchMatches.length)} className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] disabled:opacity-30 text-xs px-0.5"><IconChevronUp /></button>
                <button disabled={searchMatches.length === 0} onClick={() => setSearchCursor((c) => (c + 1) % searchMatches.length)} className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] disabled:opacity-30 text-xs px-0.5"><IconChevronDown /></button>
                <button onClick={() => setSearchQuery('')} className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] text-sm leading-none"><IconDismiss /></button>
              </>
            )}
          </div>
        </div>
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

          const isInClip = group.startIdx >= blockStart && group.startIdx <= blockEnd
          const searchMatchGi = searchQ ? searchMatches.indexOf(gi) : -1
          const isSearchMatch = searchMatchGi >= 0
          const isSearchActive = isSearchMatch && searchMatchGi === safeSearchCursor

          return (
            <div
              key={group.startIdx}
              data-gi={gi}
              className={isInClip ? '' : 'bg-gray-400/15 rounded'}
              style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
              onTouchStart={(e) => {
                longPressMenuFiredRef.current = false
                longPressTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
                const capturedY = e.touches[0].clientY
                longPressTimerRef.current = setTimeout(() => {
                  longPressMenuFiredRef.current = true
                  setClipMenu({ startIdx: group.startIdx, y: capturedY })
                  longPressTouchRef.current = null
                }, 600)
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
                highlightStyle={isMyLine ? HIGHLIGHTER_COLORS[settings.highlighterColor ?? 'yellow'] : undefined}
                onSelect={() => handleLineSelect(group.startIdx)}
                onReveal={isMyLine && !showAllMyLines ? () => toggleReveal(group.startIdx) : undefined}
                onRecord={
                  group.type === 'dialogue' && !isPlaying && phase !== 'paused'
                    ? () => handleRecordLine(group.startIdx)
                    : undefined
                }
                onDeleteRecording={
                  group.type === 'dialogue' && !isPlaying && phase !== 'paused'
                    ? () => handleDeleteRecording(group.startIdx)
                    : undefined
                }
                isRecordingThis={recordingLineIdx === group.startIdx}
                anyRecording={micRecording || recordingLineIdx !== null}
                hasRecording={recMapRef.current.has(group.startIdx)}
                lineProgress={isMyLine ? (lineProgressMap[group.startIdx] ?? null) : null}
                searchActive={isSearchActive}
                ref={(el) => { lineRefs.current[group.startIdx] = el }}
              />
              {group.startIdx === blockEnd && (
                <ClipMarker type="end" hidden={isDragging} onTouchStart={(e) => startDrag('end', gi, e.touches[0].clientY)} />
              )}
            </div>
          )
        })}

        {phase === 'done' && (
          <div className="py-4" />
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

      {/* SR transcript — shown during hands-free silence gap */}
      {phase === 'my-line-silence' && handsFreeEnabled && supported && (
        <div className="px-4 py-1 border-t border-[var(--color-stage-border)] bg-[var(--color-stage-surface)]/80 shrink-0">
          <div className="flex items-center gap-2 min-h-[18px]">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${listening ? 'bg-green-400 animate-pulse' : 'bg-[var(--color-stage-border)]'}`} />
            <span className="text-xs text-[var(--color-stage-muted)] truncate flex-1 italic">
              {transcript || (listening ? 'Listening…' : '')}
            </span>
          </div>
        </div>
      )}

      {/* Controls — single row */}
      <div className="px-4 py-1.5 border-t border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] shrink-0">
        <div className="flex items-center justify-between">
          {/* Repeat — left */}
          <CtrlBtn onClick={() => setLoopEnabled((v) => !v)} active={loopEnabled} title="Repeat"><IconRepeat /></CtrlBtn>

          {/* Transport */}
          <CtrlBtn onClick={handleBack} disabled={phase === 'idle' || phase === 'done'} title="Previous"><IconSkipBack /></CtrlBtn>
          <CtrlBtn onClick={isPlaying ? handlePause : handlePlay} disabled={!isPlaying && !myCharacter} title={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <IconPause /> : <IconPlay />}
          </CtrlBtn>
          <CtrlBtn onClick={handleStop} disabled={phase === 'idle' || phase === 'done'} title="Stop"><IconStop /></CtrlBtn>
          <CtrlBtn onClick={handleSkip} disabled={phase === 'idle' || phase === 'done'} title="Next"><IconSkipForward /></CtrlBtn>

          {/* Condensed — right, opens menu */}
          <div className="relative">
            <CtrlBtn onClick={() => setShowCondensedMenu((v) => !v)} active={condensedLines > 0} title="Skip lines">
              {condensedLines === 0 ? <IconTextCollapse /> : <span className="text-sm font-bold leading-none">{condensedLines}</span>}
            </CtrlBtn>
            {showCondensedMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowCondensedMenu(false)} />
                <div className="absolute bottom-full right-0 mb-2 z-50 bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] rounded-xl shadow-2xl overflow-hidden min-w-[140px]">
                  {([
                    { v: 0, label: 'Full' },
                    { v: 5, label: 'Skip >5' },
                    { v: 10, label: 'Skip >10' },
                    { v: 15, label: 'Skip >15' },
                    { v: 20, label: 'Skip >20' },
                  ] as { v: number; label: string }[]).map(({ v, label }) => (
                    <button
                      key={v}
                      onClick={() => { setCondensedLines(v); setShowCondensedMenu(false) }}
                      className={`w-full px-4 py-3 text-sm text-left flex items-center justify-between hover:bg-[var(--color-stage-accent)]/20 transition-colors ${
                        v === condensedLines ? 'text-[var(--color-stage-accent-light)] font-semibold' : 'text-[var(--color-stage-text)]'
                      }`}
                    >
                      {label}
                      {v === condensedLines && <span className="text-xs">✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
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

interface LineRowProps {
  group: LineGroup
  isCurrent: boolean
  phase: Phase
  isMyLine: boolean
  lineVisible: boolean
  highlightStyle?: React.CSSProperties
  onSelect: () => void
  onReveal?: () => void
  onRecord?: () => void
  onDeleteRecording?: () => void
  isRecordingThis?: boolean
  anyRecording?: boolean
  hasRecording?: boolean
  lineProgress?: number | null
  searchActive?: boolean
}

const LineRow = ({
  group, isCurrent, phase, isMyLine, lineVisible, highlightStyle,
  onSelect, onReveal, onRecord, onDeleteRecording, isRecordingThis, anyRecording, hasRecording,
  lineProgress, searchActive, ref,
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
    ['my-line-silence', 'my-line-reading'].includes(phase)
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
          : searchActive
          ? 'bg-blue-500/10 ring-1 ring-blue-400/60'
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
            {hasRecording && !isRecordingThis && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-400/70 shrink-0 self-center" title="Has recording" />
            )}
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
          {lineProgress != null && (
            <div className="mt-1.5 h-1 rounded-full bg-[var(--color-stage-border)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--color-stage-accent)]"
                style={{ width: `${lineProgress}%` }}
              />
            </div>
          )}
        </div>

        {/* Right column: delete + record buttons */}
        {onRecord ? (
          <div className="flex items-center shrink-0 gap-0.5">
            {hasRecording && !isRecordingThis && onDeleteRecording && (
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteRecording() }}
                disabled={!!anyRecording}
                title="Delete recording"
                className="shrink-0 transition-colors leading-none p-2 rounded-full text-base text-[var(--color-stage-muted)] opacity-50 hover:opacity-100 hover:text-red-400 disabled:opacity-10"
              >
                <IconDismiss />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onRecord() }}
              disabled={!!anyRecording && !isRecordingThis}
              title={isRecordingThis ? 'Stop recording' : 'Record this line'}
              className={`shrink-0 transition-colors leading-none p-2 rounded-full text-2xl ${
                isRecordingThis
                  ? 'text-red-400 animate-pulse'
                  : 'text-[var(--color-stage-muted)] opacity-50 hover:opacity-100 hover:text-red-400'
              } disabled:opacity-10`}
            >
              {isRecordingThis ? <IconRecordStop /> : <IconRecordDot />}
            </button>
          </div>
        ) : (
          <div className="w-10 shrink-0" />
        )}
      </div>
    </div>
  )
}
