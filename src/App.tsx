import { useState, useEffect } from 'react'
import { ScriptManager } from './components/ScriptManager'
import { CharacterTable } from './components/CharacterTable'
import { RecordingStudio } from './components/RecordingStudio'
import { RehearsalMode } from './components/RehearsalMode'
import { GlobalSettings } from './components/GlobalSettings'
import { SideMenu } from './components/SideMenu'
import { useAppStore } from './store/useAppStore'
import { applyTheme } from './utils/themes'
import { IconMenu, IconSettings, IconHome, IconCharacters, IconMic, IconRunThrough } from './components/Icons'

type Tab = 'scripts' | 'characters' | 'record' | 'rehearse'

const TAB_ICONS: Record<string, React.ReactNode> = {
  scripts:    <IconHome className="text-[1.4rem]" />,
  characters: <IconCharacters className="text-[1.4rem]" />,
  record:     <IconMic className="text-[1.4rem]" />,
  rehearse:   <IconRunThrough className="text-[1.4rem]" />,
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'scripts',    label: 'Home' },
  { id: 'characters', label: 'Script' },
  { id: 'record',     label: 'Record' },
  { id: 'rehearse',   label: 'Run through' },
]

function scriptTitleClass(name: string) {
  if (name.length <= 14) return 'text-2xl'
  if (name.length <= 22) return 'text-xl'
  if (name.length <= 30) return 'text-lg'
  return 'text-base'
}

export default function App() {
  const [tab, setTab] = useState<Tab>('scripts')
  const [showSettings, setShowSettings] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const { theme, scripts, selectedScriptId } = useAppStore()
  const selectedScript = scripts.find((s) => s.id === selectedScriptId)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    const handler = () => setUpdateReady(true)
    sw.addEventListener('controllerchange', handler)
    return () => sw.removeEventListener('controllerchange', handler)
  }, [])

  return (
    <div className="h-full flex flex-col max-w-2xl mx-auto">
      {updateReady && (
        <button
          onClick={() => window.location.reload()}
          className="w-full py-2 text-xs font-semibold bg-[var(--color-stage-accent)] text-white text-center shrink-0 hover:opacity-90 transition-opacity"
        >
          Update available — tap to reload
        </button>
      )}
      {/* App header — always visible */}
      <header className="relative flex items-center px-4 pt-4 pb-3 shrink-0">
        <button
          onClick={() => setShowMenu(true)}
          className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors px-1 shrink-0"
          title="Menu"
        >
          <IconMenu className="text-[1.6rem]" />
        </button>

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-14">
          {tab === 'scripts' || !selectedScript ? (
            <h1 className="cueline-title text-3xl">CueLine</h1>
          ) : (
            <h1 className={`font-bold text-[var(--color-stage-accent-light)] truncate text-center ${scriptTitleClass(selectedScript.name)}`}>
              {selectedScript.name}
            </h1>
          )}
        </div>

        <button
          onClick={() => setShowSettings(true)}
          className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors px-1 shrink-0 ml-auto"
          title="Settings"
        >
          <IconSettings className="text-[1.6rem]" />
        </button>
      </header>

      {/* Content */}
      {tab === 'rehearse' ? (
        <div className="flex-1 overflow-hidden flex flex-col">
          <RehearsalMode />
        </div>
      ) : (
        <main className="flex-1 overflow-y-auto px-4 py-5">
          {tab === 'scripts' && <ScriptManager />}
          {tab === 'characters' && <CharacterTable />}
          {tab === 'record' && <RecordingStudio />}
        </main>
      )}

      {/* Footer nav — always visible */}
      <nav className="flex border-t border-[var(--color-stage-border)] shrink-0 relative">
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
            {TAB_ICONS[t.id]}
            <span className="text-[10px] font-medium">{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="text-center py-1 shrink-0">
        <span className="text-[10px] text-[var(--color-stage-muted)]">v{__APP_VERSION__}</span>
      </div>

      {/* Global settings panel */}
      {showSettings && <GlobalSettings onClose={() => setShowSettings(false)} />}

      {/* Side menu */}
      <SideMenu open={showMenu} onClose={() => setShowMenu(false)} />
    </div>
  )
}
