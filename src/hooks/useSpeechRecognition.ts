import { useState, useRef, useCallback, useEffect } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySR = any

export interface ListenOptions {
  /** Milliseconds of silence after the last word before auto-stopping (default 1000) */
  silenceMs?: number
  /** Estimated ms the line should take to say — drives the safety timeout */
  estimatedMs?: number
  /** Silence wait used until accumulated speaking time has reached the gap */
  maxPauseMs?: number
  /** When set true externally, always use silenceMs regardless of elapsed time */
  switchToShortSilenceRef?: { current: boolean }
  /** Called once when the first speech result arrives */
  onSpeechStart?: () => void
  /** Called with true when speech activity starts/resumes, false when it pauses/ends */
  onSpeechActivity?: (active: boolean) => void
}


export function useSpeechRecognition() {
  const [transcript, setTranscript] = useState('')
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(false)
  const recognitionRef = useRef<AnySR>(null)
  const resolveRef = useRef<((t: string) => void) | null>(null)
  // true while the SR session is alive (between rec.start() and rec.abort()/rec.stop())
  const sessionActiveRef = useRef(false)
  // e.results.length at the end of the last listen() window — used as baseIdx for next window
  const lastResultCountRef = useRef(0)

  useEffect(() => {
    const SR = (window as AnySR).SpeechRecognition ?? (window as AnySR).webkitSpeechRecognition
    setSupported(!!SR)
  }, [])

  const listen = useCallback((options: ListenOptions = {}): Promise<string> => {
    const { silenceMs = 1000, estimatedMs, maxPauseMs, switchToShortSilenceRef, onSpeechStart, onSpeechActivity } = options
    const SR = (window as AnySR).SpeechRecognition ?? (window as AnySR).webkitSpeechRecognition
    if (!SR) return Promise.resolve('')

    return new Promise((resolve) => {
      resolveRef.current = resolve

      let finalTranscript = ''
      let liveTranscript = ''
      let silenceTimer: ReturnType<typeof setTimeout> | null = null
      let activityTimer: ReturnType<typeof setTimeout> | null = null
      let done = false
      let speechStartTime: number | null = null
      let speechActive = false

      const PAUSE_DETECT_MS = 300
      // Speech recognition typically lags ~500ms behind actual speech onset
      const DETECTION_LAG_MS = 500

      const notifyActivity = (active: boolean) => {
        if (active === speechActive) return
        speechActive = active
        onSpeechActivity?.(active)
      }

      // Resolve this window WITHOUT stopping the session.
      // The mic stays open; the next listen() call installs fresh handlers.
      const finish = () => {
        if (done) return
        done = true
        if (silenceTimer) clearTimeout(silenceTimer)
        if (activityTimer) clearTimeout(activityTimer)
        notifyActivity(false)
        resolve(finalTranscript || liveTranscript)
        if (resolveRef.current === resolve) resolveRef.current = null
      }

      const scheduleSilenceStop = () => {
        if (silenceTimer) clearTimeout(silenceTimer)
        // Use maxPauseMs until accumulated speech time reaches the gap (switchToShortSilenceRef
        // flips in the component), then switch to the shorter silenceMs.
        const wait = (!switchToShortSilenceRef?.current && maxPauseMs !== undefined) ? maxPauseMs : silenceMs
        silenceTimer = setTimeout(finish, wait)
      }

      // Results from earlier windows remain in e.results — skip them by starting at baseIdx.
      const baseIdx = lastResultCountRef.current

      const onresult = (e: AnySR) => {
        if (speechStartTime === null) { speechStartTime = Date.now() - DETECTION_LAG_MS; onSpeechStart?.() }
        lastResultCountRef.current = e.results.length
        let combined = ''
        for (let i = baseIdx; i < e.results.length; i++) {
          combined += e.results[i][0].transcript
          if (e.results[i].isFinal) finalTranscript = combined
        }
        liveTranscript = combined
        setTranscript(combined)
        notifyActivity(true)
        if (activityTimer) clearTimeout(activityTimer)
        activityTimer = setTimeout(() => notifyActivity(false), PAUSE_DETECT_MS)
        scheduleSilenceStop()
      }

      // Fires when the session ends. If sessionActiveRef is still true, the end was
      // unexpected (iOS ~60s limit). Finish the current window and let the next
      // listen() call start a fresh session.
      // If sessionActiveRef is false, abort()/stop() already handled cleanup — do nothing.
      const handleUnexpectedEnd = () => {
        if (!sessionActiveRef.current) return
        sessionActiveRef.current = false
        setListening(false)
        if (!done) {
          done = true
          if (silenceTimer) clearTimeout(silenceTimer)
          if (activityTimer) clearTimeout(activityTimer)
          notifyActivity(false)
          resolve(finalTranscript || liveTranscript)
          if (resolveRef.current === resolve) resolveRef.current = null
        }
      }

      // If a session is already live, reuse it — just swap in new per-window handlers.
      // No rec.start(), so no iOS mic-activation sound.
      if (recognitionRef.current && sessionActiveRef.current) {
        setTranscript('')
        recognitionRef.current.onresult = onresult
        recognitionRef.current.onend = handleUnexpectedEnd
        silenceTimer = setTimeout(finish, Math.max(10000, (estimatedMs ?? 0) * 2 + silenceMs))
        return
      }

      // No live session — start a fresh one.
      lastResultCountRef.current = 0
      const rec: AnySR = new SR()
      recognitionRef.current = rec
      rec.lang = 'en-GB'
      rec.interimResults = true
      rec.continuous = true

      rec.onresult = onresult
      rec.onend = handleUnexpectedEnd
      rec.onerror = (e: AnySR) => {
        // 'no-speech' is expected on continuous recognition — ignore
        // Other errors: onend fires next and handleUnexpectedEnd cleans up
        if (e?.error === 'no-speech') return
      }

      rec.start()
      sessionActiveRef.current = true
      setListening(true)
      silenceTimer = setTimeout(finish, Math.max(10000, (estimatedMs ?? 0) * 2 + silenceMs))
    })
  }, [])

  const stop = useCallback(() => {
    sessionActiveRef.current = false
    resolveRef.current?.('')
    resolveRef.current = null
    recognitionRef.current?.stop()
  }, [])

  const abort = useCallback(() => {
    sessionActiveRef.current = false
    recognitionRef.current?.abort()
    setListening(false)
    resolveRef.current?.('')
    resolveRef.current = null
  }, [])

  const reset = useCallback(() => setTranscript(''), [])

  return { transcript, listening, supported, listen, stop, abort, reset }
}
