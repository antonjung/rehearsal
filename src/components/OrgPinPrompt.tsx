import { useState } from 'react'

interface Props {
  initialOrg?: string
  onSubmit: (org: string, pin: string) => void
  onCancel: () => void
}

export function OrgPinPrompt({ initialOrg = '', onSubmit, onCancel }: Props) {
  const [org, setOrg] = useState(initialOrg)
  const [pin, setPin] = useState('')

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4">
      <div className="bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] rounded-xl p-5 w-full max-w-sm space-y-4">
        <p className="font-semibold text-[var(--color-stage-text)]">Organisation &amp; PIN</p>
        <p className="text-sm text-[var(--color-stage-muted)]">
          Only people using the same organisation name and PIN can download scripts you upload — agree on both with your group. Stored on this device so you won't be asked again.
        </p>
        <div className="space-y-2">
          <input
            type="text"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="Organisation name"
            className="w-full text-sm px-3 py-2 rounded-lg bg-[var(--color-stage-bg)] border border-[var(--color-stage-border)] text-[var(--color-stage-text)] placeholder:text-[var(--color-stage-muted)]"
            autoFocus
          />
          <input
            type="text"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            className="w-full text-sm px-3 py-2 rounded-lg bg-[var(--color-stage-bg)] border border-[var(--color-stage-border)] text-[var(--color-stage-text)] placeholder:text-[var(--color-stage-muted)]"
          />
        </div>
        <div className="flex flex-col gap-2">
          <button
            disabled={!org.trim() || !pin.trim()}
            onClick={() => onSubmit(org.trim(), pin.trim())}
            className="py-2 rounded-lg text-sm font-medium bg-[var(--color-stage-accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            Save
          </button>
          <button
            onClick={onCancel}
            className="py-2 rounded-lg text-sm font-medium text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
