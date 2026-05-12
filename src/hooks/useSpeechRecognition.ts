import { useState, useRef, useCallback, useEffect } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySR = any

export interface ListenOptions {
  /** If provided, recognition stops as soon as ~80% of these words are detected */
  expectedText?: string
  /** Milliseconds of silence after the last word before auto-stopping (default 1000) */
  silenceMs?: number
}

// Fraction of expected words found in spoken text — used for early line-end detection
function wordCoverage(expected: string, spoken: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '')
  const expWords = norm(expected).split(/\s+/).filter(Boolean)
  if (expWords.length === 0) return 0
  const spokenSet = new Set(norm(spoken).split(/\s+/).filter(Boolean))
  return expWords.filter(w => spokenSet.has(w)).length / expWords.length
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
    const { expectedText, silenceMs = 1000 } = options
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
      let done = false

      const finish = () => {
        if (done) return
        done = true
        if (silenceTimer) clearTimeout(silenceTimer)
        rec.stop()
      }

      const scheduleSilenceStop = () => {
        if (silenceTimer) clearTimeout(silenceTimer)
        silenceTimer = setTimeout(finish, silenceMs)
      }

      rec.onresult = (e: AnySR) => {
        let combined = ''
        let hasFinal = false
        for (let i = 0; i < e.results.length; i++) {
          combined += e.results[i][0].transcript
          if (e.results[i].isFinal) {
            finalTranscript = combined
            hasFinal = true
          }
        }
        liveTranscript = combined
        setTranscript(combined)

        // Stop immediately if enough of the expected line has been spoken
        if (expectedText && hasFinal && wordCoverage(expectedText, combined) >= 0.8) {
          finish()
          return
        }

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
        resolve(finalTranscript || '')
        resolveRef.current = null
      }

      rec.start()
      setListening(true)
      // Safety: if user never speaks, give up after 10 s
      silenceTimer = setTimeout(finish, 10000)
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
