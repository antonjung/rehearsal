import type { Script, RehearsalSettings, WordDiff } from '../types'
import { buildWordDiff } from '../utils/textDiff'

interface Props {
  script: Script
  settings: RehearsalSettings
  accuracies: Record<number, number>
  transcripts: Record<number, string>
}

export function AccuracySummary({ script, settings, accuracies, transcripts }: Props) {
  const myLines = script.lines.filter(
    (l) => l.type === 'dialogue' && l.character === settings.myCharacter,
  )
  const attempted = myLines.filter((l) => accuracies[l.lineIndex] !== undefined)

  const accuracyEnabled = settings.accuracyEnabled !== false

  if (!accuracyEnabled || attempted.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] p-5 mt-2">
        <h3 className="font-semibold text-[var(--color-stage-text)] mb-1">Run through complete</h3>
        <p className="text-sm text-[var(--color-stage-muted)]">
          {!accuracyEnabled ? 'Accuracy checking was off.' : 'No lines were analysed — check mic permissions.'}
        </p>
      </div>
    )
  }

  const avg = Math.round(
    attempted.reduce((s, l) => s + accuracies[l.lineIndex], 0) / attempted.length,
  )
  const below = attempted.filter((l) => accuracies[l.lineIndex] < settings.accuracyWarningThreshold)
  const avgColour = avg >= 90 ? 'text-green-400' : avg >= 70 ? 'text-yellow-400' : 'text-red-400'

  return (
    <div className="rounded-xl border border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] p-5 mt-6 space-y-4">
      <div className="flex items-baseline gap-3">
        <h3 className="font-semibold text-[var(--color-stage-text)]">Run through summary</h3>
        <span className={`text-2xl font-bold tabular-nums ${avgColour}`}>{avg}%</span>
        <span className="text-xs text-[var(--color-stage-muted)]">
          avg · {attempted.length} line{attempted.length !== 1 ? 's' : ''} checked
        </span>
      </div>

      {below.length === 0 ? (
        <p className="text-sm text-green-400">All lines above {settings.accuracyWarningThreshold}% — great work!</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-stage-muted)]">
            {below.length} line{below.length !== 1 ? 's' : ''} below {settings.accuracyWarningThreshold}%:
          </p>
          {below.map((line) => {
            const acc = accuracies[line.lineIndex]
            const heard = transcripts[line.lineIndex] ?? ''
            const diff: WordDiff[] = buildWordDiff(line.text, heard)
            const colour = acc >= 50 ? 'text-yellow-400' : 'text-red-400'
            return (
              <div
                key={line.lineIndex}
                className="rounded-lg bg-[var(--color-stage-bg)] border border-[var(--color-stage-border)] px-3 py-2 space-y-1"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-lg font-bold tabular-nums ${colour}`}>{acc}%</span>
                  <span className="text-xs text-[var(--color-stage-muted)] italic flex-1 truncate">
                    Expected: {line.text}
                  </span>
                </div>
                {diff.length > 0 && (
                  <div className="text-sm flex flex-wrap gap-1">
                    {diff.map((w, i) => (
                      <span
                        key={i}
                        className={w.match ? 'text-green-300' : 'text-red-400 line-through'}
                      >
                        {w.word}
                      </span>
                    ))}
                  </div>
                )}
                {heard && (
                  <p className="text-xs text-[var(--color-stage-muted)]">You said: &ldquo;{heard}&rdquo;</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
