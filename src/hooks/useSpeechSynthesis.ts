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

  const load = useCallback(() => {
    const v = speechSynthesis.getVoices()
    voicesRef.current = v
    // spread so React sees a new array reference and always re-renders
    setVoices([...v])
  }, [])

  useEffect(() => {
    load()
    speechSynthesis.addEventListener('voiceschanged', load)
    // iOS often doesn't fire voiceschanged; poll across several seconds
    const delays = [100, 300, 600, 1200, 2500, 5000]
    const timers = delays.map((ms) => setTimeout(load, ms))
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', load)
      timers.forEach(clearTimeout)
    }
  }, [load])

  const speak = useCallback(
    (text: string, options: SpeakOptions = {}): Promise<void> => {
      return new Promise((resolve) => {
        resolveRef.current = resolve
        const utter = new SpeechSynthesisUtterance(text)
        utter.rate = options.rate ?? 1
        utter.pitch = options.pitch ?? 1
        utter.volume = options.volume ?? 1
        if (options.voiceURI) {
          const v = voicesRef.current.find((vv) => vv.voiceURI === options.voiceURI)
          if (v) utter.voice = v
        }
        utter.onstart = () => setSpeaking(true)
        utter.onend = () => { setSpeaking(false); resolve() }
        utter.onerror = () => { setSpeaking(false); resolve() }
        speechSynthesis.speak(utter)
      })
    },
    [],
  )

  const cancel = useCallback(() => {
    speechSynthesis.cancel()
    setSpeaking(false)
    resolveRef.current?.()
    resolveRef.current = null
  }, [])

  const pause = useCallback(() => speechSynthesis.pause(), [])
  const resume = useCallback(() => speechSynthesis.resume(), [])

  return { voices, speaking, speak, cancel, pause, resume, refreshVoices: load }
}
