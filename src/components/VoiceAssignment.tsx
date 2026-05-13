import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis'
import { useAppStore } from '../store/useAppStore'
import { groupVoices } from '../utils/voiceUtils'
import type { GroupedVoices } from '../utils/voiceUtils'

const PREVIEW_TEXT = 'To be, or not to be, that is the question.'

function VoiceSelect({
  value, onChange, grouped,
}: {
  value: string
  onChange: (v: string) => void
  grouped: GroupedVoices
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-[var(--color-stage-bg)] border border-[var(--color-stage-border)] rounded-md px-3 py-1.5 text-sm text-[var(--color-stage-text)] focus:outline-none focus:border-[var(--color-stage-accent)]"
    >
      <option value="">— system default —</option>
      {grouped.female.length > 0 && (
        <optgroup label="Female">
          {grouped.female.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
          ))}
        </optgroup>
      )}
      {grouped.male.length > 0 && (
        <optgroup label="Male">
          {grouped.male.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
          ))}
        </optgroup>
      )}
      {grouped.unknown.length > 0 && (
        <optgroup label="Other">
          {grouped.unknown.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
          ))}
        </optgroup>
      )}
    </select>
  )
}

export function VoiceAssignment() {
  const { voices, speak } = useSpeechSynthesis()
  const { scripts, selectedScriptId, rehearsalSettings, updateVoiceMap, saveRehearsalSettings } = useAppStore()
  const script = scripts.find((s) => s.id === selectedScriptId)

  if (!script) {
    return (
      <div className="text-center text-[var(--color-stage-muted)] py-12">
        Select a script first.
      </div>
    )
  }

  if (voices.length === 0) {
    return (
      <div className="text-center text-[var(--color-stage-muted)] py-12">
        Loading voices…
      </div>
    )
  }

  const { label: voiceLabel, isFallback, ...grouped } = groupVoices(voices)

  const voiceMap = rehearsalSettings?.voiceMap ?? {}
  const defaultVoiceURI = rehearsalSettings?.defaultVoiceURI ?? ''
  const myCharacter = rehearsalSettings?.myCharacter ?? ''
  const rate = rehearsalSettings?.speechRate ?? 1

  const updateVoice = (character: string, voiceURI: string) =>
    updateVoiceMap({ ...voiceMap, [character]: voiceURI })

  const updateDefaultVoice = (voiceURI: string) => {
    if (!rehearsalSettings) return
    saveRehearsalSettings({ ...rehearsalSettings, defaultVoiceURI: voiceURI })
  }

  const preview = (voiceURI: string) =>
    speak(PREVIEW_TEXT, { voiceURI: voiceURI || defaultVoiceURI, rate })

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-stage-text)] mb-1">Voice Assignment</h2>
        <p className="text-sm text-[var(--color-stage-muted)]">
          {voiceLabel} — grouped by gender, British voices first. Set a default, then override per character.
        </p>
      </div>

      {/* Default voice */}
      <div className="rounded-lg border border-[var(--color-stage-accent)]/40 bg-[var(--color-stage-surface)] px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-semibold text-[var(--color-stage-accent-light)] text-sm flex-1">
            Default voice
          </span>
          <button
            onClick={() => preview(defaultVoiceURI)}
            className="text-xs text-[var(--color-stage-accent-light)] hover:text-white transition-colors"
          >
            ▶ Preview
          </button>
        </div>
        <VoiceSelect value={defaultVoiceURI} onChange={updateDefaultVoice} grouped={grouped} />
        {!rehearsalSettings && (
          <p className="text-xs text-[var(--color-stage-muted)] mt-1">
            Set up a rehearsal on the Rehearse tab to save this.
          </p>
        )}
      </div>

      {/* Per-character */}
      <div className="space-y-3">
        {script.characters.map((char) => (
          <div
            key={char}
            className="rounded-lg border border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] px-4 py-3"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="font-semibold text-[var(--color-stage-text)] text-sm flex-1">{char}</span>
              {char === myCharacter && (
                <span className="text-xs bg-[var(--color-stage-accent)] text-white px-2 py-0.5 rounded-full">
                  You
                </span>
              )}
              <button
                onClick={() => preview(voiceMap[char] ?? '')}
                className="text-xs text-[var(--color-stage-accent-light)] hover:text-white transition-colors"
              >
                ▶ Preview
              </button>
            </div>
            <VoiceSelect
              value={voiceMap[char] ?? ''}
              onChange={(v) => updateVoice(char, v)}
              grouped={grouped}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
