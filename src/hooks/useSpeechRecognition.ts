import { useState, useRef, useCallback, useEffect } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySR = any

export interface ListenOptions {
  /** Milliseconds of silence after the last word before auto-stopping (default 1000) */
  silenceMs?: number
  /** Estimated ms the line should take to say — drives the safety timeout */
  estimatedMs?: number
  /** Silence wait used until switchToShortSilenceRef flips */
  maxPauseMs?: number
  /** When set true externally, switch to silenceMs */
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
  const [srError, setSrError] = useState<string | null>(null)
  const recognitionRef = useRef<AnySR>(null)
  const resolveRef = useRef<((t: string) => void) | null>(null)
  const sessionActiveRef = useRef(false)
  const lastResultCountRef = useRef(0)

  useEffect(() => {
    const SR = (window as AnySR).SpeechRecognition ?? (window as AnySR).webkitSpeechRecognition
    setSupported(!!SR)
  }, [])

  const listen = useCallback((options: ListenOptions = {}): Promise<string> => {
    const { silenceMs = 1000, estimatedMs, maxPauseMs, switchToShortSilenceRef, onSpeechStart, onSpeechActivity } = options
    const SR = (window as AnySR).SpeechRecognition ?? (window as AnySR).webkitSpeechRecognition
    if (!SR) return Promise.resolve('')

    setSrError(null)
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
      const DETECTION_LAG_MS = 500

      const finish = () => {
        if (done) return
        done = true
        if (silenceTimer) clearTimeout(silenceTimer)
        if (activityTimer) clearTimeout(activityTimer)
        if (speechActive) { speechActive = false; onSpeechActivity?.(false) }
        // Stop the session so iOS properly releases the audio route back to TTS.
        // This means every listen() call creates a fresh session (no session reuse),
        // but avoids the audio-session stall that causes SR to hear nothing.
        sessionActiveRef.current = false
        setListening(false)
        try { recognitionRef.current?.stop() } catch { /* ignore */ }
        resolve(finalTranscript || liveTranscript)
        if (resolveRef.current === resolve) resolveRef.current = null
      }

      // Two-mode silence detection:
      //
      // BEFORE threshold (switchToShortSilenceRef false):
      //   scheduleSilenceStop fires maxPauseMs after each onresult.
      //   Keeps getting reset while speech comes in → fires only on genuine silence.
      //
      // AFTER threshold (switchToShortSilenceRef true):
      //   scheduleSilenceStop is a no-op. notifyActivity(false) fires after
      //   PAUSE_DETECT_MS of no results, then starts the short silenceMs timer.
      //   This means: last word → SR quiet → 300ms → silenceMs → finish.
      //   The line can never be cut while onresult events are still arriving.
      const scheduleSilenceStop = () => {
        if (switchToShortSilenceRef?.current) return  // handled by notifyActivity
        if (silenceTimer) clearTimeout(silenceTimer)
        const wait = maxPauseMs !== undefined ? maxPauseMs : silenceMs
        silenceTimer = setTimeout(finish, wait)
      }

      const notifyActivity = (active: boolean) => {
        if (active === speechActive) return
        speechActive = active
        onSpeechActivity?.(active)
        if (!active && switchToShortSilenceRef?.current) {
          // Speech stopped after threshold — start short silence countdown
          if (silenceTimer) clearTimeout(silenceTimer)
          silenceTimer = setTimeout(finish, silenceMs)
        } else if (active && switchToShortSilenceRef?.current) {
          // Speech resumed after threshold — cancel any pending short silence
          if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null }
        }
      }

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

      const handleUnexpectedEnd = () => {
        if (!sessionActiveRef.current) return
        sessionActiveRef.current = false
        setListening(false)
        if (!done) {
          done = true
          if (silenceTimer) clearTimeout(silenceTimer)
          if (activityTimer) clearTimeout(activityTimer)
          if (speechActive) { speechActive = false; onSpeechActivity?.(false) }
          resolve(finalTranscript || liveTranscript)
          if (resolveRef.current === resolve) resolveRef.current = null
        }
      }

      // Safety: advances if actor never speaks at all
      const safetyMs = Math.max(10000, (estimatedMs ?? 0) * 2.5 + (maxPauseMs ?? silenceMs))

      if (recognitionRef.current && sessionActiveRef.current) {
        // Reuse the existing session — capture the current instance so the onend
        // guard below can reject events fired by a stale (already-aborted) session.
        const sessionRec = recognitionRef.current
        setTranscript('')
        recognitionRef.current.onresult = onresult
        recognitionRef.current.onend = () => {
          if (recognitionRef.current !== sessionRec) return
          handleUnexpectedEnd()
        }
        silenceTimer = setTimeout(finish, safetyMs)
        return
      }

      lastResultCountRef.current = 0
      const rec: AnySR = new SR()
      recognitionRef.current = rec
      rec.lang = 'en-GB'
      rec.interimResults = true
      rec.continuous = true

      rec.onresult = onresult
      // Guard: if a newer session has already started (recognitionRef replaced),
      // ignore onend from this stale instance — it would otherwise kill the new session.
      rec.onend = () => {
        if (recognitionRef.current !== rec) return
        handleUnexpectedEnd()
      }
      rec.onerror = (e: AnySR) => {
        const err: string = e?.error ?? 'unknown'
        if (err === 'no-speech' || err === 'aborted') return
        if (recognitionRef.current !== rec) return
        setSrError(err)
        handleUnexpectedEnd()
      }

      rec.start()
      sessionActiveRef.current = true
      setListening(true)
      silenceTimer = setTimeout(finish, safetyMs)
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

  return { transcript, listening, supported, srError, listen, stop, abort, reset }
}
