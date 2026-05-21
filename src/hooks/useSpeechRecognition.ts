import { useState, useRef, useCallback, useEffect } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySR = any

export interface ListenOptions {
  /** Milliseconds of silence after the last word before auto-stopping (default 1000) */
  silenceMs?: number
  /** Estimated ms the line should take to say — drives the 75% threshold */
  estimatedMs?: number
  /** Silence wait used before 75% of estimatedMs has elapsed (default: silenceMs) */
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
      const rec: AnySR = new SR()
      recognitionRef.current = rec
      rec.lang = 'en-GB'
      rec.interimResults = true
      rec.continuous = true

      let finalTranscript = ''
      let liveTranscript = ''
      let silenceTimer: ReturnType<typeof setTimeout> | null = null
      let activityTimer: ReturnType<typeof setTimeout> | null = null
      let done = false
      let speechStartTime: number | null = null
      let speechActive = false

      // Fires onSpeechActivity only on transitions, not on every result
      const PAUSE_DETECT_MS = 300
      const notifyActivity = (active: boolean) => {
        if (active === speechActive) return
        speechActive = active
        onSpeechActivity?.(active)
      }

      const finish = () => {
        if (done) return
        done = true
        if (silenceTimer) clearTimeout(silenceTimer)
        if (activityTimer) clearTimeout(activityTimer)
        notifyActivity(false)  // finalize accumulated time in component before rec.onend
        // abort() rather than stop() to avoid triggering the iOS mic-off system sound
        rec.abort()
      }

      const scheduleSilenceStop = () => {
        if (silenceTimer) clearTimeout(silenceTimer)
        // Use maxPauseMs until accumulated speech time reaches the gap (countdownExpiredRef flips),
        // then switch to the shorter silenceMs. Never use wall-clock time — a natural breath mid-line
        // should never cut the actor off.
        const wait = (!switchToShortSilenceRef?.current && maxPauseMs !== undefined) ? maxPauseMs : silenceMs
        silenceTimer = setTimeout(finish, wait)
      }

      // Speech recognition typically lags ~500ms behind actual speech onset
      const DETECTION_LAG_MS = 500

      rec.onresult = (e: AnySR) => {
        if (speechStartTime === null) { speechStartTime = Date.now() - DETECTION_LAG_MS; onSpeechStart?.() }
        let combined = ''
        for (let i = 0; i < e.results.length; i++) {
          combined += e.results[i][0].transcript
          if (e.results[i].isFinal) finalTranscript = combined
        }
        liveTranscript = combined
        setTranscript(combined)

        // Track speech activity: fire true on resume, schedule false after silence
        notifyActivity(true)
        if (activityTimer) clearTimeout(activityTimer)
        activityTimer = setTimeout(() => notifyActivity(false), PAUSE_DETECT_MS)

        scheduleSilenceStop()
      }

      rec.onend = () => {
        if (silenceTimer) clearTimeout(silenceTimer)
        setListening(false)
        resolve(finalTranscript || liveTranscript)
        resolveRef.current = null
      }

      rec.onerror = () => {
        if (silenceTimer) clearTimeout(silenceTimer)
        setListening(false)
        resolve(finalTranscript || liveTranscript)
        resolveRef.current = null
      }

      rec.start()
      setListening(true)
      // Safety: give up if nothing ever happens, scaled to line length
      silenceTimer = setTimeout(finish, Math.max(10000, (estimatedMs ?? 0) * 2 + silenceMs))
    })
  }, [])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const abort = useCallback(() => {
    recognitionRef.current?.abort()
    setListening(false)
    resolveRef.current?.('')
    resolveRef.current = null
  }, [])

  const reset = useCallback(() => setTranscript(''), [])

  return { transcript, listening, supported, listen, stop, abort, reset }
}
