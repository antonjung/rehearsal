import { useState, useRef, useCallback } from 'react'

function bestMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', '']
  return candidates.find((t) => !t || MediaRecorder.isTypeSupported(t)) ?? ''
}

export function useMediaRecorder() {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsPermissionPrompt, setNeedsPermissionPrompt] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const resolveRef = useRef<((result: { blob: Blob; durationMs: number }) => void) | null>(null)
  const startTimeRef = useRef<number>(0)
  const permResolveRef = useRef<((allowed: boolean) => void) | null>(null)

  const resolvePermissionPrompt = useCallback((allowed: boolean) => {
    setNeedsPermissionPrompt(false)
    permResolveRef.current?.(allowed)
    permResolveRef.current = null
  }, [])

  const start = useCallback(async (): Promise<boolean> => {
    try {
      if (navigator.permissions) {
        try {
          const result = await navigator.permissions.query({ name: 'microphone' as PermissionName })
          if (result.state === 'prompt') {
            const allowed = await new Promise<boolean>((resolve) => {
              permResolveRef.current = resolve
              setNeedsPermissionPrompt(true)
            })
            if (!allowed) return false
          }
        } catch { /* permissions API unavailable */ }
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = bestMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
        const durationMs = Math.round(Date.now() - startTimeRef.current)
        resolveRef.current?.({ blob, durationMs })
        resolveRef.current = null
      }
      recorderRef.current = recorder
      startTimeRef.current = Date.now()
      recorder.start()
      setRecording(true)
      setError(null)
      return true
    } catch {
      setError('Microphone access denied')
      return false
    }
  }, [])

  const stop = useCallback((): Promise<{ blob: Blob; durationMs: number }> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      recorderRef.current?.stop()
      recorderRef.current = null
      setRecording(false)
    })
  }, [])

  return { recording, error, start, stop, needsPermissionPrompt, resolvePermissionPrompt }
}
