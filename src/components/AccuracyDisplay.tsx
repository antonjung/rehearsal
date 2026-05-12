import type { WordDiff } from '../types'

interface Props {
  accuracy: number | null
  transcript: string
  wordDiff: WordDiff[]
  threshold: number
}

export function AccuracyDisplay({ accuracy, transcript, wordDiff, threshold }: Props) {
  if (accuracy === null) return null

  const isWarning = accuracy < threshold
  const colour = isWarning
    ? 'text-red-400'
    : accuracy >= 90
      ? 'text-green-400'
      : 'text-yellow-400'

  return (
    <div className="mt-3 rounded-lg border border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] p-3 space-y-2">
      <div className="flex items-center gap-3">
        <span className={`text-2xl font-bold tabular-nums ${colour}`}>
          {accuracy}%
        </span>
        <span className="text-xs text-[var(--color-stage-muted)]">accuracy</span>
        {isWarning && (
          <span className="text-xs bg-red-900/50 text-red-300 px-2 py-0.5 rounded-full">
            Below {threshold}%
          </span>
        )}
      </div>

      {wordDiff.length > 0 && (
        <div className="text-sm leading-relaxed flex flex-wrap gap-1">
          {wordDiff.map((w, i) => (
            <span
              key={i}
              className={w.match ? 'text-green-300' : 'text-red-400 line-through'}
            >
              {w.word}
            </span>
          ))}
        </div>
      )}

      {transcript && (
        <p className="text-xs text-[var(--color-stage-muted)] italic">
          You said: &ldquo;{transcript}&rdquo;
        </p>
      )}
    </div>
  )
}
