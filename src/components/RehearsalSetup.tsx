import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { MicTest } from './MicTest'
import type { RehearsalSettings, MyLineMode } from '../types'

interface Props {
  onStart: () => void
}

const LINE_MODES: { value: MyLineMode; label: string; desc: string }[] = [
  { value: 'silence', label: 'A — Silence', desc: 'Your lines are silent — practice from memory' },
  { value: 'read', label: 'B — Read', desc: 'Your lines are read aloud for you' },
  { value: 'gap-before', label: 'C — Gap then read', desc: 'Silence for your line length, then it is read' },
  { value: 'gap-after', label: 'D — Read then gap', desc: 'Your line is read, then silence for its length' },
]

export function RehearsalSetup({ onStart }: Props) {
  const { scripts, selectedScriptId, rehearsalSettings, saveRehearsalSettings } = useAppStore()
  const script = scripts.find((s) => s.id === selectedScriptId)

  const sameScript = rehearsalSettings?.scriptId === selectedScriptId
  const defaults: RehearsalSettings = {
    scriptId: selectedScriptId ?? '',
    myCharacter: sameScript ? (rehearsalSettings?.myCharacter ?? '') : '',
    readStageDirections: rehearsalSettings?.readStageDirections ?? false,
    myLineMode: rehearsalSettings?.myLineMode ?? 'silence',
    speechRate: rehearsalSettings?.speechRate ?? 1,
    accuracyWarningThreshold: rehearsalSettings?.accuracyWarningThreshold ?? 70,
    voiceMap: sameScript ? (rehearsalSettings?.voiceMap ?? {}) : {},
    defaultVoiceURI: rehearsalSettings?.defaultVoiceURI ?? '',
    accuracyEnabled: rehearsalSettings?.accuracyEnabled ?? true,
    endLineSilenceMs: rehearsalSettings?.endLineSilenceMs ?? 1000,
    errorPromptEnabled: rehearsalSettings?.errorPromptEnabled ?? false,
    errorPromptPhrase: rehearsalSettings?.errorPromptPhrase ?? 'The correct line is',
    sceneId: sameScript
      ? (rehearsalSettings?.sceneId ?? script?.scenes[0]?.id ?? null)
      : (script?.scenes[0]?.id ?? null),
  }

  const [form, setForm] = useState<RehearsalSettings>(defaults)
  const [showMicTest, setShowMicTest] = useState(false)

  if (!script) {
    return (
      <div className="text-center text-[var(--color-stage-muted)] py-12">
        Select a script on the Scripts tab first.
      </div>
    )
  }

  const set = <K extends keyof RehearsalSettings>(k: K, v: RehearsalSettings[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const handleStart = () => {
    saveRehearsalSettings({ ...form, scriptId: script.id })
    onStart()
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h2 className="text-xl font-bold text-[var(--color-stage-text)]">
        Set up rehearsal
        <span className="text-[var(--color-stage-accent-light)] ml-2 font-normal text-base">
          {script.name}
        </span>
      </h2>

      {/* Scene selector */}
      {script.scenes.length > 0 && (
        <Field label="Scene">
          <select
            value={form.sceneId ?? ''}
            onChange={(e) => {
              const newSceneId = e.target.value || null
              const newChars = newSceneId
                ? (script.scenes.find(s => s.id === newSceneId)?.characters ?? script.characters)
                : script.characters
              setForm(f => ({
                ...f,
                sceneId: newSceneId,
                myCharacter: newChars.includes(f.myCharacter) ? f.myCharacter : '',
              }))
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
          value={form.myCharacter}
          onChange={(e) => set('myCharacter', e.target.value)}
          className="w-full select-field"
        >
          <option value="">— choose —</option>
          {(form.sceneId
            ? (script.scenes.find(s => s.id === form.sceneId)?.characters ?? script.characters)
            : script.characters
          ).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </Field>

      {/* My line mode */}
      <Field label="How to handle your lines">
        <div className="space-y-2">
          {LINE_MODES.map((m) => (
            <label
              key={m.value}
              className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                form.myLineMode === m.value
                  ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/10'
                  : 'border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] hover:border-[var(--color-stage-muted)]'
              }`}
            >
              <input
                type="radio"
                name="myLineMode"
                value={m.value}
                checked={form.myLineMode === m.value}
                onChange={() => set('myLineMode', m.value)}
                className="mt-0.5"
              />
              <div>
                <div className="font-medium text-sm text-[var(--color-stage-text)]">{m.label}</div>
                <div className="text-xs text-[var(--color-stage-muted)]">{m.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </Field>

      {/* Stage directions */}
      <Field label="Stage directions">
        <Toggle
          checked={form.readStageDirections}
          onChange={(v) => set('readStageDirections', v)}
          label="Read stage directions aloud"
        />
      </Field>

      {/* Speech rate */}
      <Field label={`Speech rate: ${form.speechRate.toFixed(1)}×`}>
        <input
          type="range" min={0.5} max={2} step={0.1}
          value={form.speechRate}
          onChange={(e) => set('speechRate', Number(e.target.value))}
          className="w-full accent-[var(--color-stage-accent)]"
        />
      </Field>

      {/* Accuracy */}
      <Field label="Accuracy checking">
        <div className="space-y-3">
          <Toggle
            checked={form.accuracyEnabled}
            onChange={(v) => set('accuracyEnabled', v)}
            label="Analyse my lines and show accuracy"
          />
          {form.accuracyEnabled && (
            <div>
              <label className="block text-xs text-[var(--color-stage-muted)] mb-1">
                Warn in summary below: {form.accuracyWarningThreshold}%
              </label>
              <input
                type="range" min={0} max={100} step={5}
                value={form.accuracyWarningThreshold}
                onChange={(e) => set('accuracyWarningThreshold', Number(e.target.value))}
                className="w-full accent-[var(--color-stage-accent)]"
              />
            </div>
          )}

          {form.accuracyEnabled && (
            <div>
              <label className="block text-xs text-[var(--color-stage-muted)] mb-1">
                Silence gap: {(form.endLineSilenceMs / 1000).toFixed(1)} s
              </label>
              <input
                type="range" min={200} max={3000} step={100}
                value={form.endLineSilenceMs}
                onChange={(e) => set('endLineSilenceMs', Number(e.target.value))}
                className="w-full accent-[var(--color-stage-accent)]"
              />
              <p className="text-xs text-[var(--color-stage-muted)] mt-1">
                Time after your last word before moving on (if line not yet detected)
              </p>
            </div>
          )}

          {form.accuracyEnabled && (
            <div className="space-y-2">
              <Toggle
                checked={form.errorPromptEnabled}
                onChange={(v) => set('errorPromptEnabled', v)}
                label="Read line aloud if accuracy is too low"
              />
              {form.errorPromptEnabled && (
                <div>
                  <label className="block text-xs text-[var(--color-stage-muted)] mb-1">
                    Prompt phrase
                  </label>
                  <input
                    type="text"
                    value={form.errorPromptPhrase}
                    onChange={(e) => set('errorPromptPhrase', e.target.value)}
                    placeholder="The correct line is"
                    className="w-full bg-[var(--color-stage-bg)] border border-[var(--color-stage-border)] rounded-md px-3 py-2 text-sm text-[var(--color-stage-text)] focus:outline-none focus:border-[var(--color-stage-accent)]"
                  />
                  <p className="text-xs text-[var(--color-stage-muted)] mt-1">
                    Spoken before reading back the correct line
                  </p>
                </div>
              )}
            </div>
          )}

          {form.accuracyEnabled && (
            <div>
              <button
                type="button"
                onClick={() => setShowMicTest((v) => !v)}
                className="text-xs text-[var(--color-stage-accent-light)] hover:text-white transition-colors"
              >
                {showMicTest ? 'Hide mic test ▲' : 'Test microphone ▼'}
              </button>
              {showMicTest && <div className="mt-2"><MicTest /></div>}
            </div>
          )}
        </div>
      </Field>

      <button
        onClick={handleStart}
        disabled={!form.myCharacter}
        className="w-full py-3 rounded-xl font-semibold text-white bg-[var(--color-stage-accent)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        Start Rehearsal
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-stage-muted)] mb-2">
        {label}
      </label>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded accent-[var(--color-stage-accent)]"
      />
      <span className="text-sm text-[var(--color-stage-text)]">{label}</span>
    </label>
  )
}
