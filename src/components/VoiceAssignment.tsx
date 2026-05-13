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
  const total = grouped.female.length + grouped.male.length + grouped.unknown.length
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={total === 0}
      className="w-full bg-[var(--color-stage-bg)] border border-[var(--color-stage-border)] rounded-md px-3 py-1.5 text-sm text-[var(--color-stage-text)] focus:outline-none focus:border-[var(--color-stage-accent)] disabled:opacity-50"
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
  const { voices, speak, refreshVoices } = useSpeechSynthesis()
  const { scripts, selectedScriptId, rehearsalSettings, voicePrefs, saveVoicePrefs } = useAppStore()
  const script = scripts.find((s) => s.id === selectedScriptId)

  const { female, male, unknown } = groupVoices(voices)
  const grouped: GroupedVoices = { female, male, unknown }

  const { voiceMap, defaultVoiceURI } = voicePrefs
  const myCharacter = rehearsalSettings?.myCharacter ?? ''
  const rate = rehearsalSettings?.speechRate ?? 1

  const updateVoice = (character: string, voiceURI: string) =>
    saveVoicePrefs({ voiceMap: { ...voiceMap, [character]: voiceURI } })

  const updateDefaultVoice = (voiceURI: string) =>
    saveVoicePrefs({ defaultVoiceURI: voiceURI })

  const preview = (voiceURI: string) =>
    speak(PREVIEW_TEXT, { voiceURI: voiceURI || defaultVoiceURI, rate })

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-[var(--color-stage-text)]">Voice Assignment</h2>
          <button
            onClick={refreshVoices}
            className="text-xs text-[var(--color-stage-accent-light)] hover:text-white transition-colors flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] min-h-[44px]"
          >
            ↻ Refresh
            <span className="text-[var(--color-stage-muted)]">({voices.length})</span>
          </button>
        </div>
        <p className="text-sm text-[var(--color-stage-muted)]">
          {voices.length === 0
            ? 'No voices detected yet — tap Refresh, or wait a moment.'
            : `${voices.length} voice${voices.length === 1 ? '' : 's'} found, grouped by gender, British voices first.`}
        </p>
        {voices.length === 0 && (
          <p className="text-xs text-amber-400 mt-1.5">
            On iPhone: Settings → Accessibility → Spoken Content → Voices → English to download voices.
          </p>
        )}
      </div>

      {/* Default voice */}
      <div className="rounded-lg border border-[var(--color-stage-accent)]/40 bg-[var(--color-stage-surface)] px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-semibold text-[var(--color-stage-accent-light)] text-sm flex-1">
            Default voice
          </span>
          <button
            onClick={() => preview(defaultVoiceURI)}
            disabled={voices.length === 0}
            className="text-xs text-[var(--color-stage-accent-light)] hover:text-white transition-colors disabled:opacity-40"
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
      {script ? (
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
                  disabled={voices.length === 0}
                  className="text-xs text-[var(--color-stage-accent-light)] hover:text-white transition-colors disabled:opacity-40"
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
      ) : (
        <p className="text-sm text-[var(--color-stage-muted)] text-center py-4">
          Select a script on the Scripts tab to assign per-character voices.
        </p>
      )}
    </div>
  )
}
