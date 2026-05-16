import { useState, useEffect } from 'react'
import { ScriptManager } from './components/ScriptManager'
import { CharacterTable } from './components/CharacterTable'
import { RecordingStudio } from './components/RecordingStudio'
import { RehearsalSetup } from './components/RehearsalSetup'
import { RehearsalMode } from './components/RehearsalMode'
import { SplashScreen } from './components/SplashScreen'
import { GlobalSettings } from './components/GlobalSettings'
import { useAppStore } from './store/useAppStore'
import { applyTheme } from './utils/themes'

type Tab = 'scripts' | 'characters' | 'record' | 'rehearse'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'scripts', label: 'Scripts', icon: '📜' },
  { id: 'characters', label: 'Characters', icon: '🎭' },
  { id: 'record', label: 'Record', icon: '🎙' },
  { id: 'rehearse', label: 'Rehearse', icon: '🎤' },
]

export default function App() {
  const [splashDone, setSplashDone] = useState(false)
  const [tab, setTab] = useState<Tab>('scripts')
  const [rehearsing, setRehearsing] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const { theme } = useAppStore()

  // Apply theme whenever it changes
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  if (!splashDone) return <SplashScreen onDone={() => setSplashDone(true)} />

  return (
    <div className="h-full flex flex-col max-w-2xl mx-auto">
      {/* App header — always visible */}
      <header className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
        <div className="flex items-baseline gap-2">
          <h1 className="text-2xl font-bold text-[var(--color-stage-text)]">
            <span className="text-[var(--color-stage-accent-light)]">🎭</span> Rehearsal
          </h1>
          <span className="text-xs text-[var(--color-stage-muted)]">v{__APP_VERSION__}</span>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="text-2xl text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors px-1"
          title="Settings"
        >
          ☰
        </button>
      </header>

      {/* Content */}
      {rehearsing ? (
        <div className="flex-1 overflow-hidden flex flex-col">
          <RehearsalMode onExit={() => setRehearsing(false)} />
        </div>
      ) : (
        <>
          <main className="flex-1 overflow-y-auto px-4 py-5">
            {tab === 'scripts' && <ScriptManager />}
            {tab === 'characters' && <CharacterTable />}
            {tab === 'record' && <RecordingStudio />}
            {tab === 'rehearse' && (
              <RehearsalSetup onStart={() => setRehearsing(true)} />
            )}
          </main>

          {/* Footer nav */}
          <nav className="flex border-t border-[var(--color-stage-border)] shrink-0">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-3 transition-colors ${
                  tab === t.id
                    ? 'text-[var(--color-stage-accent-light)]'
                    : 'text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)]'
                }`}
              >
                <span className="text-xl leading-none">{t.icon}</span>
                <span className="text-[10px] font-medium">{t.label}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      {/* Global settings panel */}
      {showSettings && <GlobalSettings onClose={() => setShowSettings(false)} />}
    </div>
  )
}
