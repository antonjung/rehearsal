import { useState, useEffect, useRef, useCallback } from 'react'

export interface SpeakOptions {
  voiceURI?: string
  rate?: number
  pitch?: number
  volume?: number
}

export function useSpeechSynthesis() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [speaking, setSpeaking] = useState(false)
  const resolveRef = useRef<(() => void) | null>(null)
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(() => {
    const v = speechSynthesis.getVoices()
    voicesRef.current = v
    setVoices([...v])
  }, [])

  const forceLoad = useCallback(() => {
    load()
    setTimeout(load, 200)
    setTimeout(load, 800)
    setTimeout(load, 2000)
  }, [load])

  useEffect(() => {
    load()
    speechSynthesis.addEventListener('voiceschanged', load)
    const delays = [100, 300, 600, 1200, 2500, 5000, 10000, 15000]
    const timers = delays.map((ms) => setTimeout(load, ms))
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', load)
      timers.forEach(clearTimeout)
    }
  }, [load])

  const clearWatchdog = () => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current)
      watchdogRef.current = null
    }
  }

  const speak = useCallback(
    (text: string, options: SpeakOptions = {}): Promise<void> => {
      return new Promise((resolve) => {
        resolveRef.current = resolve

        const attemptSpeak = (retriesLeft: number) => {
          // Guard: if cancel() was called while we were in a retry timeout
          if (resolveRef.current !== resolve) return

          const utter = new SpeechSynthesisUtterance(text)
          utter.rate = options.rate ?? 1
          utter.pitch = options.pitch ?? 1
          utter.volume = options.volume ?? 1
          if (options.voiceURI) {
            const v = voicesRef.current.find((vv) => vv.voiceURI === options.voiceURI)
            if (v) utter.voice = v
          }

          // Watchdog: resolve if iOS never fires onend/onerror.
          const rate = utter.rate || 1
          const estimatedMs = Math.max(5000, (text.length * 90) / rate + 4000)
          watchdogRef.current = setTimeout(() => {
            watchdogRef.current = null
            setSpeaking(false)
            resolveRef.current?.()
            resolveRef.current = null
          }, estimatedMs)

          const done = () => {
            clearWatchdog()
            setSpeaking(false)
            resolveRef.current = null
            resolve()
          }

          // Track whether the utterance actually started producing audio.
          // On iOS, onend can fire immediately without onstart when the audio
          // session is not ready — this is a silent (dropped) utterance.
          let started = false
          utter.onstart = () => { started = true; setSpeaking(true) }

          utter.onend = () => {
            if (!started && retriesLeft > 0 && resolveRef.current === resolve) {
              // Silent utterance: retry with increasing delay
              clearWatchdog()
              setSpeaking(false)
              const retryDelay = (3 - retriesLeft) * 300 + 300  // 300ms, 600ms
              setTimeout(() => attemptSpeak(retriesLeft - 1), retryDelay)
              return
            }
            done()
          }

          utter.onerror = (e) => {
            const err = (e as SpeechSynthesisErrorEvent)?.error ?? ''
            // 'audio-busy' fires on iOS when mic session hasn't released yet.
            if (err === 'audio-busy' && retriesLeft > 0 && resolveRef.current === resolve) {
              clearWatchdog()
              setSpeaking(false)
              const retryDelay = (3 - retriesLeft) * 400 + 400  // 400ms, 800ms
              setTimeout(() => attemptSpeak(retriesLeft - 1), retryDelay)
              return
            }
            done()
          }

          // 100ms pre-speak delay: helps iOS audio session settle between utterances.
          // Combined with the silent-utterance retry above, this covers both the
          // preventive and reactive cases.
          setTimeout(() => {
            if (resolveRef.current !== resolve) { clearWatchdog(); return }
            try {
              speechSynthesis.resume()
              speechSynthesis.speak(utter)
            } catch {
              done()
            }
          }, 100)
        }

        attemptSpeak(2)
      })
    },
    [],
  )

  const cancel = useCallback(() => {
    clearWatchdog()
    speechSynthesis.cancel()
    setSpeaking(false)
    resolveRef.current?.()
    resolveRef.current = null
  }, [])

  const pause = useCallback(() => speechSynthesis.pause(), [])
  const resume = useCallback(() => speechSynthesis.resume(), [])

  return { voices, speaking, speak, cancel, pause, resume, refreshVoices: forceLoad }
}
