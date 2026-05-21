import { useAppStore } from '../store/useAppStore'
import { THEMES } from '../utils/themes'
import { MicTest } from './MicTest'
import { useState, useRef } from 'react'
import type { MyLineMode, VoiceCommandWords } from '../types'
import { DEFAULT_VOICE_COMMANDS } from '../types'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { estimateDuration } from '../utils/speechDuration'

const HIGHLIGHTER_OPTIONS: { value: 'yellow' | 'pink' | 'green' | 'blue'; label: string; color: string }[] = [
  { value: 'yellow', label: 'Yellow', color: 'rgba(255, 255, 0, 0.85)' },
  { value: 'pink',   label: 'Pink',   color: 'rgba(255, 0, 200, 0.75)' },
  { value: 'green',  label: 'Green',  color: 'rgba(0, 255, 60, 0.8)' },
  { value: 'blue',   label: 'Blue',   color: 'rgba(0, 240, 255, 0.8)' },
]

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
    endLineSilenceMs: 500,
    errorPromptEnabled: false,
    errorPromptPhrase: 'The correct line is',
    voiceCommands: DEFAULT_VOICE_COMMANDS,
    highlighterColor: 'yellow' as const,
    handsFreeEnabled: true,
    linePingEnabled: false,
    scenePingEnabled: true,
    clipStartPingEnabled: true,
  }

  const cmdWords: VoiceCommandWords = { ...DEFAULT_VOICE_COMMANDS, ...(prefs.voiceCommands ?? {}) }

  const parseWords = (s: string) => s.split(',').map(w => w.trim().toLowerCase()).filter(Boolean)
  const fmtWords = (ws: string[]) => ws.join(', ')

  const updateCmd = (key: keyof VoiceCommandWords, raw: string) => {
    update('voiceCommands', { ...cmdWords, [key]: parseWords(raw) })
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
        <div className="flex-1 overflow-y-auto">

          {/* ── Your lines ── */}
          <SettingsSection title="Your lines">
            <div className="space-y-1.5">
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
                    type="radio" name="lineMode" value={m.value}
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
            <SettingsRow label="Hands-free mode">
              <ToggleSwitch checked={prefs.handsFreeEnabled ?? true} onChange={(v) => update('handsFreeEnabled', v)} />
            </SettingsRow>
          </SettingsSection>

          {/* ── Playback ── */}
          <SettingsSection title="Playback">
            <SettingsRow label="Speech rate">
              <Stepper value={prefs.speechRate} min={0.5} max={2} step={0.1}
                display={`${prefs.speechRate.toFixed(1)}×`}
                onChange={(v) => update('speechRate', Math.round(v * 10) / 10)} />
            </SettingsRow>
            <SettingsRow label="Stage directions aloud">
              <ToggleSwitch checked={prefs.readStageDirections} onChange={(v) => update('readStageDirections', v)} />
            </SettingsRow>
          </SettingsSection>

          {/* ── Accuracy & timing ── */}
          <SettingsSection title="Accuracy & timing">
            <SettingsRow label="Accuracy checking">
              <ToggleSwitch checked={prefs.accuracyEnabled} onChange={(v) => update('accuracyEnabled', v)} />
            </SettingsRow>
            {prefs.accuracyEnabled && (
              <>
                <SettingsRow label="Warning threshold" sub>
                  <Stepper value={prefs.accuracyWarningThreshold} min={0} max={100} step={5}
                    display={`${prefs.accuracyWarningThreshold}%`}
                    onChange={(v) => update('accuracyWarningThreshold', v)} />
                </SettingsRow>
                <SettingsRow label="Silence gap" sub>
                  <Stepper value={prefs.endLineSilenceMs} min={200} max={3000} step={100}
                    display={`${(prefs.endLineSilenceMs / 1000).toFixed(1)}s`}
                    onChange={(v) => update('endLineSilenceMs', v)} />
                </SettingsRow>
                <SettingsRow label="Max pause" sub>
                  <Stepper value={prefs.maxPauseMs ?? 2000} min={200} max={3000} step={200}
                    display={`${((prefs.maxPauseMs ?? 2000) / 1000).toFixed(1)}s`}
                    onChange={(v) => update('maxPauseMs', v)} />
                </SettingsRow>
              </>
            )}
          </SettingsSection>

          {/* ── Signals ── */}
          <SettingsSection title="Signals">
            <SettingsRow label="Cue before my lines">
              <ToggleSwitch checked={prefs.clipStartPingEnabled ?? true} onChange={(v) => update('clipStartPingEnabled', v)} />
            </SettingsRow>
            <SettingsRow label="Ping after each line">
              <ToggleSwitch checked={prefs.linePingEnabled ?? false} onChange={(v) => update('linePingEnabled', v)} />
            </SettingsRow>
            <SettingsRow label="Sound at end of scene">
              <ToggleSwitch checked={prefs.scenePingEnabled ?? true} onChange={(v) => update('scenePingEnabled', v)} />
            </SettingsRow>
          </SettingsSection>

          {/* ── Appearance ── */}
          <SettingsSection title="Appearance">
            <SettingsRow label="Theme" />
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((t) => (
                <button key={t.id} onClick={() => setTheme(t.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                    theme === t.id
                      ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/10 text-[var(--color-stage-accent-light)]'
                      : 'border-[var(--color-stage-border)] text-[var(--color-stage-text)] hover:border-[var(--color-stage-muted)]'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full shrink-0 border border-white/20" style={{ background: t.swatch }} />
                  {t.name}
                </button>
              ))}
            </div>
            <SettingsRow label="Script font size">
              <Stepper value={scriptFontSize} min={11} max={22} step={1}
                display={`${scriptFontSize}px`} onChange={setScriptFontSize} />
            </SettingsRow>
            <p className="text-[var(--color-stage-muted)]" style={{ fontSize: `${scriptFontSize}px` }}>
              All the world&apos;s a stage
            </p>
            <SettingsRow label="Highlighter colour" />
            <div className="flex gap-3">
              {HIGHLIGHTER_OPTIONS.map((opt) => {
                const selected = (prefs.highlighterColor ?? 'yellow') === opt.value
                return (
                  <button key={opt.value} onClick={() => update('highlighterColor', opt.value)} title={opt.label}
                    className={`w-9 h-9 rounded-full border-2 transition-all ${selected ? 'border-white scale-110 shadow-md' : 'border-transparent opacity-70 hover:opacity-100'}`}
                    style={{ background: opt.color }}
                  />
                )
              })}
            </div>
          </SettingsSection>

          {/* ── Voice commands ── */}
          <SettingsSection title="Voice commands">
            <p className="text-xs text-[var(--color-stage-muted)]">Comma-separated trigger words for each hands-free command.</p>
            {(
              [
                { key: 'play',   label: '▶ Start' },
                { key: 'stop',   label: '⏹ Stop' },
                { key: 'repeat', label: '↺ Repeat' },
                { key: 'loop',   label: '🔁 Loop on/off' },
                { key: 'back',   label: '⏮ Back' },
                { key: 'skip',   label: '⏭ Skip' },
              ] as { key: keyof VoiceCommandWords; label: string }[]
            ).map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <label className="text-xs text-[var(--color-stage-muted)]">{label}</label>
                <input type="text"
                  defaultValue={fmtWords(cmdWords[key])}
                  onBlur={(e) => updateCmd(key, e.target.value)}
                  className="w-full rounded-md border border-[var(--color-stage-border)] bg-[var(--color-stage-bg)] text-sm text-[var(--color-stage-text)] px-2 py-1.5 focus:outline-none focus:border-[var(--color-stage-accent)]"
                />
              </div>
            ))}
          </SettingsSection>

          {/* ── Voice calibration ── */}
          <SettingsSection title="Voice calibration">
            <p className="text-xs text-[var(--color-stage-muted)]">Read the phrase below at your natural acting pace to calibrate line timing.</p>
            <VoiceCalibration
              stored={prefs.voiceCalibration}
              onSave={(c) => update('voiceCalibration', c as number)}
              onReset={() => saveRehearsalSettings({ ...prefs, voiceCalibration: undefined })}
            />
          </SettingsSection>

          {/* ── Microphone ── */}
          <SettingsSection title="Microphone">
            <button onClick={() => setShowMicTest((v) => !v)}
              className="text-xs text-[var(--color-stage-accent-light)] hover:text-white transition-colors"
            >
              {showMicTest ? 'Hide mic test ▲' : 'Test microphone ▼'}
            </button>
            {showMicTest && <div className="mt-2"><MicTest /></div>}
          </SettingsSection>

        </div>
      </div>
    </>
  )
}

const CALIBRATION_PHRASE = "All the world's a stage, and all the men and women merely players."
const CALIBRATION_SILENCE_MS = 800

function VoiceCalibration({
  stored,
  onSave,
  onReset,
}: {
  stored?: number
  onSave: (c: number) => void
  onReset: () => void
}) {
  const [status, setStatus] = useState<'idle' | 'waiting' | 'speaking' | 'done' | 'no-speech'>('idle')
  const { listen, abort, supported } = useSpeechRecognition()
  const speechStartRef = useRef<number | null>(null)

  const handleStart = async () => {
    speechStartRef.current = null
    setStatus('waiting')
    await listen({
      silenceMs: CALIBRATION_SILENCE_MS,
      onSpeechStart: () => { speechStartRef.current = Date.now(); setStatus('speaking') },
    })
    const speechStart = speechStartRef.current
    if (speechStart !== null) {
      const userMs = Date.now() - CALIBRATION_SILENCE_MS - speechStart
      if (userMs > 300) {
        // baseMs = raw word-timing only, no breathing margin
        const baseMs = estimateDuration(CALIBRATION_PHRASE, 1.0) - 500
        const coeff = Math.max(0.3, Math.min(3.0, userMs / baseMs))
        onSave(coeff)
        setStatus('done')
        return
      }
    }
    setStatus('no-speech')
  }

  const handleReset = () => { abort(); onReset(); setStatus('idle') }

  const pct = stored !== undefined ? Math.round(stored * 100) : null

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--color-stage-border)] px-3 py-2.5 text-sm italic text-[var(--color-stage-text)] leading-relaxed">
        "{CALIBRATION_PHRASE}"
      </div>

      {pct !== null && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-stage-muted)]">Calibration coefficient</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onSave(Math.max(0.3, (stored ?? 1) - 0.05))}
                className="w-6 h-6 rounded border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] hover:border-[var(--color-stage-accent)]/50 text-sm leading-none flex items-center justify-center transition-colors"
              >−</button>
              <span className={`font-mono font-bold text-sm w-10 text-center ${pct > 110 ? 'text-amber-400' : pct < 90 ? 'text-blue-400' : 'text-[var(--color-stage-accent-light)]'}`}>
                {pct}%
              </span>
              <button
                onClick={() => onSave(Math.min(3.0, (stored ?? 1) + 0.05))}
                className="w-6 h-6 rounded border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] hover:border-[var(--color-stage-accent)]/50 text-sm leading-none flex items-center justify-center transition-colors"
              >+</button>
            </div>
          </div>
        </div>
      )}

      {status === 'no-speech' && (
        <p className="text-xs text-red-400">No speech detected — try again.</p>
      )}

      <div className="flex gap-2">
        {status === 'idle' || status === 'done' || status === 'no-speech' ? (
          <button
            onClick={handleStart}
            disabled={!supported}
            className="flex-1 text-xs py-2 rounded-lg bg-[var(--color-stage-accent)]/20 border border-[var(--color-stage-accent)]/40 text-[var(--color-stage-accent-light)] hover:bg-[var(--color-stage-accent)]/30 transition-colors disabled:opacity-40"
          >
            {status === 'done' ? 'Recalibrate' : 'Read phrase aloud'}
          </button>
        ) : (
          <div className="flex-1 text-xs py-2 rounded-lg border border-[var(--color-stage-accent)]/40 text-center text-[var(--color-stage-muted)] animate-pulse">
            {status === 'waiting' ? 'Start speaking…' : 'Listening…'}
          </div>
        )}
        {pct !== null && (
          <button
            onClick={handleReset}
            className="text-xs px-3 py-2 rounded-lg border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  )
}

function SettingsSection({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--color-stage-text)]/20">
      <div className="bg-[var(--color-stage-text)]/10 px-4 py-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-stage-text)] text-center">{title}</h3>
      </div>
      {children && <div className="px-4 py-4 space-y-3">{children}</div>}
    </div>
  )
}

function SettingsRow({ label, sub, children }: { label: string; sub?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className={sub ? 'text-xs text-[var(--color-stage-muted)] pl-2' : 'text-sm text-[var(--color-stage-text)]'}>{label}</span>
      {children}
    </div>
  )
}

function Stepper({ value, min, max, step, display, onChange }: {
  value: number; min: number; max: number; step: number; display: string
  onChange: (v: number) => void
}) {
  const decrement = () => { if (value > min) onChange(Math.max(min, Math.round((value - step) / step) * step)) }
  const increment = () => { if (value < max) onChange(Math.min(max, Math.round((value + step) / step) * step)) }
  return (
    <div className="flex items-center gap-1">
      <button onClick={decrement} disabled={value <= min}
        className="w-9 h-9 rounded-lg border border-[var(--color-stage-border)] text-[var(--color-stage-text)] text-xl leading-none flex items-center justify-center transition-colors hover:border-[var(--color-stage-accent)] disabled:opacity-30 disabled:cursor-not-allowed"
      >−</button>
      <span className="text-sm font-mono tabular-nums text-[var(--color-stage-text)] w-14 text-center">{display}</span>
      <button onClick={increment} disabled={value >= max}
        className="w-9 h-9 rounded-lg border border-[var(--color-stage-border)] text-[var(--color-stage-text)] text-xl leading-none flex items-center justify-center transition-colors hover:border-[var(--color-stage-accent)] disabled:opacity-30 disabled:cursor-not-allowed"
      >+</button>
    </div>
  )
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-11 h-6 rounded-full transition-colors shrink-0 focus:outline-none ${
        checked ? 'bg-[var(--color-stage-accent)]' : 'bg-[var(--color-stage-border)]'
      }`}
    >
      <span className={`absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-5' : 'translate-x-0'
      }`} />
    </button>
  )
}
