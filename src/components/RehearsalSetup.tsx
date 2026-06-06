import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { RehearsalSettings } from '../types'

interface Props {
  onStart: () => void
}

export function RehearsalSetup({ onStart }: Props) {
  const { scripts, selectedScriptId, rehearsalSettings, saveRehearsalSettings } = useAppStore()
  const script = scripts.find((s) => s.id === selectedScriptId)

  const sameScript = rehearsalSettings?.scriptId === selectedScriptId

  // Inherit all prefs from rehearsalSettings (edited via global ☰), just override scene/char
  const prefs = rehearsalSettings ?? {
    myLineMode: 'silence' as const,
    readStageDirections: false,
    speechRate: 1,
    accuracyEnabled: true,
    accuracyWarningThreshold: 70,
    endLineSilenceMs: 400,
    errorPromptEnabled: false,
    errorPromptPhrase: 'The correct line is',
    handsFreeEnabled: false,
    linePingEnabled: true,
    scenePingEnabled: true,
    clipStartPingEnabled: true,
    maxPauseMs: 1000,
    highlighterColor: 'yellow' as const,
    voiceCalibration: 0.6,
    speechCoverageThreshold: 70,
  }

  const [sceneId, setSceneId] = useState<string | null>(
    sameScript ? (rehearsalSettings?.sceneId ?? script?.scenes[0]?.id ?? null)
               : (script?.scenes[0]?.id ?? null)
  )
  const [myCharacter, setMyCharacter] = useState(
    sameScript ? (rehearsalSettings?.myCharacter ?? '') : ''
  )

  if (!script) {
    return (
      <div className="text-center text-[var(--color-stage-muted)] py-12">
        Select a script on the Scripts tab first.
      </div>
    )
  }

  const sceneCharacters = sceneId
    ? (script.scenes.find((s) => s.id === sceneId)?.characters ?? script.characters)
    : script.characters

  const handleStart = () => {
    const settings: RehearsalSettings = {
      ...prefs,
      scriptId: script.id,
      sceneId,
      myCharacter,
    }
    saveRehearsalSettings(settings)
    onStart()
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-stage-text)]">Run through</h2>
        <p className="text-xs text-[var(--color-stage-muted)] mt-1">
          Adjust line mode and accuracy in ⚙️ Settings
        </p>
      </div>

      {/* Scene selector */}
      {script.scenes.length > 0 && (
        <Field label="Scene">
          <select
            value={sceneId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null
              const chars = id
                ? (script.scenes.find((s) => s.id === id)?.characters ?? script.characters)
                : script.characters
              setSceneId(id)
              if (myCharacter && !chars.includes(myCharacter)) setMyCharacter('')
            }}
            className="w-full select-field"
          >
            <option value="">Whole script</option>
            {script.scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
                {s.characters.length > 0
                  ? ` — ${s.characters.slice(0, 3).join(', ')}${s.characters.length > 3 ? '…' : ''}`
                  : ''}
              </option>
            ))}
          </select>
        </Field>
      )}

      {/* My character */}
      <Field label="Your character">
        <select
          value={myCharacter}
          onChange={(e) => setMyCharacter(e.target.value)}
          className="w-full select-field"
        >
          <option value="">— choose —</option>
          {sceneCharacters.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </Field>

<button
        onClick={handleStart}
        disabled={!myCharacter}
        className="w-full py-3 rounded-xl font-semibold text-white bg-[var(--color-stage-accent)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        Start run through
      </button>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-stage-muted)] mb-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-[var(--color-stage-muted)] mt-1.5">{hint}</p>}
    </div>
  )
}
