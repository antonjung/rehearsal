import { useAppStore } from '../store/useAppStore'
import { THEMES } from '../utils/themes'
import { MicTest } from './MicTest'
import { useState } from 'react'
import type { MyLineMode } from '../types'

interface Props {
  onClose: () => void
}

const LINE_MODES: { value: MyLineMode; label: string; desc: string }[] = [
  { value: 'silence', label: 'A — Silence', desc: 'Practice from memory' },
  { value: 'read', label: 'B — Read', desc: 'Line is read aloud for you' },
  { value: 'gap-before', label: 'C — Gap then read', desc: 'Wait, then reads your line' },
  { value: 'gap-after', label: 'D — Read then gap', desc: 'Reads line, then you repeat' },
]

export function GlobalSettings({ onClose }: Props) {
  const { theme, setTheme, rehearsalSettings, saveRehearsalSettings, scriptFontSize, setScriptFontSize } = useAppStore()
  const [showMicTest, setShowMicTest] = useState(false)

  // Default prefs when no rehearsal has been configured yet
  const prefs = rehearsalSettings ?? {
    scriptId: '',
    myCharacter: '',
    sceneId: null,
    myLineMode: 'silence' as MyLineMode,
    readStageDirections: false,
    speechRate: 1,
    accuracyEnabled: true,
    accuracyWarningThreshold: 70,
    endLineSilenceMs: 1000,
    errorPromptEnabled: false,
    errorPromptPhrase: 'The correct line is',
  }

  const update = <K extends keyof typeof prefs>(k: K, v: (typeof prefs)[K]) => {
    saveRehearsalSettings({ ...prefs, [k]: v })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-80 max-w-full bg-[var(--color-stage-surface)] border-l border-[var(--color-stage-border)] flex flex-col shadow-2xl">
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--color-stage-border)] shrink-0">
          <h2 className="font-semibold text-[var(--color-stage-text)]">Settings</h2>
          <button
            onClick={onClose}
            className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">

          {/* Theme */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-stage-muted)]">Theme</h3>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                    theme === t.id
                      ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/10 text-[var(--color-stage-accent-light)]'
                      : 'border-[var(--color-stage-border)] text-[var(--color-stage-text)] hover:border-[var(--color-stage-muted)]'
                  }`}
                >
                  <span
                    className="w-4 h-4 rounded-full shrink-0 border border-white/20"
                    style={{ background: t.swatch }}
                  />
                  {t.name}
                </button>
              ))}
            </div>
          </section>

          {/* Display */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-stage-muted)]">Display</h3>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-[var(--color-stage-text)]">Script font size</span>
                <span className="text-xs text-[var(--color-stage-muted)]">{scriptFontSize}px</span>
              </div>
              <input
                type="range" min={11} max={22} step={1}
                value={scriptFontSize}
                onChange={(e) => setScriptFontSize(Number(e.target.value))}
                className="w-full accent-[var(--color-stage-accent)]"
              />
            </div>
          </section>

          {/* Rehearsal */}
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-stage-muted)]">Rehearsal</h3>

            {/* Line mode */}
            <div className="space-y-1.5">
              <p className="text-xs text-[var(--color-stage-muted)]">Your lines</p>
              {LINE_MODES.map((m) => (
                <label
                  key={m.value}
                  className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                    prefs.myLineMode === m.value
                      ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/10'
                      : 'border-[var(--color-stage-border)] hover:border-[var(--color-stage-muted)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="lineMode"
                    value={m.value}
                    checked={prefs.myLineMode === m.value}
                    onChange={() => update('myLineMode', m.value)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium text-[var(--color-stage-text)]">{m.label}</div>
                    <div className="text-xs text-[var(--color-stage-muted)]">{m.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            {/* Stage directions */}
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-[var(--color-stage-text)]">Stage directions aloud</span>
              <ToggleSwitch
                checked={prefs.readStageDirections}
                onChange={(v) => update('readStageDirections', v)}
              />
            </label>

            {/* Speech rate */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-[var(--color-stage-text)]">Speech rate</span>
                <span className="text-xs text-[var(--color-stage-muted)]">{prefs.speechRate.toFixed(1)}×</span>
              </div>
              <input
                type="range" min={0.5} max={2} step={0.1}
                value={prefs.speechRate}
                onChange={(e) => update('speechRate', Number(e.target.value))}
                className="w-full accent-[var(--color-stage-accent)]"
              />
            </div>

            {/* Accuracy */}
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-[var(--color-stage-text)]">Accuracy checking</span>
              <ToggleSwitch
                checked={prefs.accuracyEnabled}
                onChange={(v) => update('accuracyEnabled', v)}
              />
            </label>

            {prefs.accuracyEnabled && (
              <>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-[var(--color-stage-muted)]">Warning threshold</span>
                    <span className="text-xs text-[var(--color-stage-muted)]">{prefs.accuracyWarningThreshold}%</span>
                  </div>
                  <input
                    type="range" min={0} max={100} step={5}
                    value={prefs.accuracyWarningThreshold}
                    onChange={(e) => update('accuracyWarningThreshold', Number(e.target.value))}
                    className="w-full accent-[var(--color-stage-accent)]"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-[var(--color-stage-muted)]">Silence gap</span>
                    <span className="text-xs text-[var(--color-stage-muted)]">{(prefs.endLineSilenceMs / 1000).toFixed(1)}s</span>
                  </div>
                  <input
                    type="range" min={200} max={3000} step={100}
                    value={prefs.endLineSilenceMs}
                    onChange={(e) => update('endLineSilenceMs', Number(e.target.value))}
                    className="w-full accent-[var(--color-stage-accent)]"
                  />
                </div>

                <div>
                  <button
                    onClick={() => setShowMicTest((v) => !v)}
                    className="text-xs text-[var(--color-stage-accent-light)] hover:text-white transition-colors"
                  >
                    {showMicTest ? 'Hide mic test ▲' : 'Test microphone ▼'}
                  </button>
                  {showMicTest && <div className="mt-2"><MicTest /></div>}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  )
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer shrink-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div className={`w-11 h-6 rounded-full transition-colors peer-focus:outline-none relative
        ${checked ? 'bg-[var(--color-stage-accent)]' : 'bg-[var(--color-stage-border)]'}`}>
        <div className={`absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-white shadow transition-transform
          ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </div>
    </label>
  )
}
