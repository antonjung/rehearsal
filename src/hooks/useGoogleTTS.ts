import { useState, useCallback, useRef } from 'react'
import { getAudio, putAudio } from '../utils/ttsCache'
import { NEURAL2_VOICES, DEFAULT_VOICE, VALID_VOICE_NAMES } from '../utils/googleTtsVoices'

export interface SpeakOptions {
  voiceURI?: string
  rate?: number
  pitch?: number
  volume?: number
}

const API_KEY = import.meta.env.VITE_GOOGLE_TTS_API_KEY as string | undefined

async function synthesize(text: string, voiceName: string, rate: number): Promise<ArrayBuffer> {
  const cached = await getAudio(text, voiceName, rate)
  if (cached) return cached

  if (!API_KEY) throw new Error('VITE_GOOGLE_TTS_API_KEY is not configured')

  const langCode = voiceName.split('-').slice(0, 2).join('-')
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: langCode, name: voiceName },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: Math.min(4, Math.max(0.25, rate)),
        },
      }),
    },
  )
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText)
    throw new Error(`Google TTS ${res.status}: ${msg}`)
  }
  const { audioContent } = (await res.json()) as { audioContent: string }

  const binary = atob(audioContent)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  await putAudio(text, voiceName, rate, bytes.buffer)
  return bytes.buffer
}

export function useGoogleTTS() {
  const [speaking, setSpeaking] = useState(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const resolveRef = useRef<(() => void) | null>(null)

  const getCtx = () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    return audioCtxRef.current
  }

  const speak = useCallback(async (text: string, options: SpeakOptions = {}): Promise<void> => {
    const voiceName =
      options.voiceURI && VALID_VOICE_NAMES.has(options.voiceURI)
        ? options.voiceURI
        : DEFAULT_VOICE
    const rate = options.rate ?? 1

    try {
      const arrayBuf = await synthesize(text, voiceName, rate)
      const ctx = getCtx()
      if (ctx.state === 'suspended') await ctx.resume()
      // slice(0) so decodeAudioData cannot detach the cached buffer
      const audioBuffer = await ctx.decodeAudioData(arrayBuf.slice(0))

      return new Promise((resolve) => {
        resolveRef.current = resolve
        const source = ctx.createBufferSource()
        source.buffer = audioBuffer
        source.connect(ctx.destination)
        sourceRef.current = source
        setSpeaking(true)
        source.onended = () => {
          setSpeaking(false)
          sourceRef.current = null
          resolveRef.current = null
          resolve()
        }
        source.start()
      })
    } catch (e) {
      console.error('TTS error:', e)
    }
  }, [])

  const cancel = useCallback(() => {
    try { sourceRef.current?.stop() } catch { /* already stopped */ }
    sourceRef.current = null
    setSpeaking(false)
    resolveRef.current?.()
    resolveRef.current = null
  }, [])

  const pause = useCallback(() => { audioCtxRef.current?.suspend() }, [])
  const resume = useCallback(() => { audioCtxRef.current?.resume() }, [])

  return {
    voices: NEURAL2_VOICES,
    speaking,
    speak,
    cancel,
    pause,
    resume,
    refreshVoices: () => {},
  }
}
