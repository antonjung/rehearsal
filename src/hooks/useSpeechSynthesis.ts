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
  // Keep a ref so speak() always sees latest voices without being recreated
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    const load = () => {
      const v = speechSynthesis.getVoices()
      voicesRef.current = v
      setVoices(v)
    }
    load()
    speechSynthesis.addEventListener('voiceschanged', load)
    // iOS sometimes doesn't fire voiceschanged; poll a couple of times as fallback
    const t1 = setTimeout(load, 200)
    const t2 = setTimeout(load, 1000)
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', load)
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

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
        utter.onend = () => {
          setSpeaking(false)
          resolve()
        }
        utter.onerror = () => {
          setSpeaking(false)
          resolve()
        }
        speechSynthesis.speak(utter)
      })
    },
    [],  // stable — reads voices via ref, never recreated
  )

  const cancel = useCallback(() => {
    speechSynthesis.cancel()
    setSpeaking(false)
    resolveRef.current?.()
    resolveRef.current = null
  }, [])

  const pause = useCallback(() => speechSynthesis.pause(), [])
  const resume = useCallback(() => speechSynthesis.resume(), [])

  return { voices, speaking, speak, cancel, pause, resume }
}
