import { useState } from 'react'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'

export function MicTest() {
  const { transcript, listening, supported, listen, stop, reset } = useSpeechRecognition()
  const [done, setDone] = useState(false)

  const handleStart = async () => {
    setDone(false)
    reset()
    await listen()
    setDone(true)
  }

  const handleStop = () => {
    stop()
  }

  if (!supported) {
    return (
      <div className="rounded-lg border border-red-800/50 bg-red-900/20 px-4 py-3 text-sm text-red-300">
        Speech recognition is not supported in this browser. Use Chrome or Edge for mic features.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--color-stage-text)]">Microphone test</span>
        <div className="flex items-center gap-2">
          {listening && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Listening…
            </span>
          )}
          {listening ? (
            <button
              onClick={handleStop}
              className="text-xs px-3 py-1 rounded-full bg-red-800/50 text-red-300 hover:bg-red-700/50 transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleStart}
              className="text-xs px-3 py-1 rounded-full bg-[var(--color-stage-accent)] text-white hover:opacity-90 transition-opacity"
            >
              Start test
            </button>
          )}
        </div>
      </div>

      <div className="min-h-[2.5rem] rounded-md bg-[var(--color-stage-bg)] border border-[var(--color-stage-border)] px-3 py-2 text-sm italic">
        {transcript ? (
          <span className="text-[var(--color-stage-text)]">{transcript}</span>
        ) : (
          <span className="text-[var(--color-stage-muted)]">
            {listening ? 'Say something…' : done ? 'Nothing heard — check mic permissions.' : 'Press Start test and speak.'}
          </span>
        )}
      </div>

      {done && transcript && (
        <p className="text-xs text-green-400">Microphone is working.</p>
      )}
    </div>
  )
}
