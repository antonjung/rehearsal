import { useState } from 'react'
import { ScriptManager } from './components/ScriptManager'
import { CharacterTable } from './components/CharacterTable'
import { VoiceAssignment } from './components/VoiceAssignment'
import { RehearsalSetup } from './components/RehearsalSetup'
import { RehearsalMode } from './components/RehearsalMode'

type Tab = 'scripts' | 'characters' | 'voices' | 'rehearse'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'scripts', label: 'Scripts', icon: '📜' },
  { id: 'characters', label: 'Characters', icon: '🎭' },
  { id: 'voices', label: 'Voices', icon: '🔊' },
  { id: 'rehearse', label: 'Rehearse', icon: '🎤' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('scripts')
  const [rehearsing, setRehearsing] = useState(false)

  if (rehearsing) {
    return (
      <div className="h-full flex flex-col">
        <RehearsalMode onExit={() => setRehearsing(false)} />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col max-w-2xl mx-auto">
      {/* App header */}
      <header className="px-4 pt-5 pb-3 shrink-0">
        <div className="flex items-baseline gap-2">
          <h1 className="text-2xl font-bold text-[var(--color-stage-text)]">
            <span className="text-[var(--color-stage-accent-light)]">🎭</span> Rehearsal
          </h1>
          <span className="text-xs text-[var(--color-stage-muted)]">v{__APP_VERSION__}</span>
        </div>
        <p className="text-xs text-[var(--color-stage-muted)] mt-0.5">Learn your lines</p>
      </header>

      {/* Tab bar */}
      <nav className="flex border-b border-[var(--color-stage-border)] px-4 shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-[var(--color-stage-accent)] text-[var(--color-stage-accent-light)]'
                : 'border-transparent text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)]'
            }`}
          >
            <span>{t.icon}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <main className="flex-1 overflow-y-auto px-4 py-5">
        {tab === 'scripts' && <ScriptManager />}
        {tab === 'characters' && <CharacterTable />}
        {tab === 'voices' && <VoiceAssignment />}
        {tab === 'rehearse' && (
          <RehearsalSetup onStart={() => setRehearsing(true)} />
        )}
      </main>
    </div>
  )
}
