interface Props {
  onAllow: () => void
  onDeny: () => void
}

export function MicPermissionModal({ onAllow, onDeny }: Props) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4">
      <div className="bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] rounded-xl p-5 w-full max-w-xs space-y-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl mt-0.5">🎙</span>
          <div>
            <p className="font-semibold text-[var(--color-stage-text)]">CueLine would like to use your microphone</p>
            <p className="text-sm text-[var(--color-stage-muted)] mt-1">Required for recording lines and voice commands.</p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={onAllow}
            className="py-2 rounded-lg text-sm font-semibold bg-[var(--color-stage-accent)] text-white hover:opacity-90 transition-opacity"
          >
            Allow
          </button>
          <button
            onClick={onDeny}
            className="py-2 rounded-lg text-sm font-medium text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
