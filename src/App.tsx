import { useState, useEffect, useRef } from 'react'
import { ScriptManager } from './components/ScriptManager'
import { CharacterTable } from './components/CharacterTable'
import { RecordingStudio } from './components/RecordingStudio'
import { RehearsalMode } from './components/RehearsalMode'
import { GlobalSettings } from './components/GlobalSettings'
import { SideMenu } from './components/SideMenu'
import { useAppStore } from './store/useAppStore'
import { applyTheme } from './utils/themes'
import { decodeSharedScript, downloadSharedScriptFromFirebase } from './utils/shareScript'
import { getAllRecordings, setRecordingRaw } from './utils/recordingStore'
import type { Script } from './types'
import { IconMenu, IconSettings, IconHome, IconCharacters, IconMic, IconRunThrough } from './components/Icons'

function nextVersionedName(baseName: string, existingNames: string[]): string {
  if (!existingNames.includes(baseName)) return baseName
  let n = 2
  while (existingNames.includes(`${baseName} (${n})`)) n++
  return `${baseName} (${n})`
}

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
  const [sharedImport, setSharedImport] = useState<{ name: string } | { error: true } | null>(null)
  const [pendingSharedImport, setPendingSharedImport] = useState<{
    script: Script
    recordings: Map<string, Blob>
    conflictWith: Script
  } | null>(null)
  const { theme, scripts, selectedScriptId, addScript, updateScript, selectScript } = useAppStore()
  const selectedScript = scripts.find((s) => s.id === selectedScriptId)
  const importedSharedScript = useRef(false)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Writes an imported script's recordings, skipping any line that already has
  // a recording on the target script — imported recordings never clobber the
  // user's own takes.
  async function importRecordings(scriptId: string, recordings: Map<string, Blob>) {
    if (recordings.size === 0) return
    const existing = await getAllRecordings()
    for (const [lineIdx, blob] of recordings) {
      const key = `${scriptId}:${lineIdx}`
      if (existing.has(key)) continue
      await setRecordingRaw(key, blob)
    }
  }

  async function finalizeSharedImport(script: Script, recordings: Map<string, Blob>, overwriteId: string | null) {
    const targetId = overwriteId ?? crypto.randomUUID()
    const finalScript = { ...script, id: targetId }
    if (overwriteId) {
      const existing = scripts.find((s) => s.id === overwriteId)
      updateScript({ ...finalScript, tracks: existing?.tracks?.length ? existing.tracks : finalScript.tracks })
    } else {
      addScript(finalScript)
    }
    await importRecordings(targetId, recordings)
    selectScript(targetId)
    setSharedImport({ name: finalScript.name })
  }

  async function resolvePendingImport(mode: 'overwrite' | 'keep') {
    if (!pendingSharedImport) return
    const { script, recordings, conflictWith } = pendingSharedImport
    setPendingSharedImport(null)
    if (mode === 'overwrite') {
      await finalizeSharedImport(script, recordings, conflictWith.id)
    } else {
      const versionedName = nextVersionedName(script.name, scripts.map((s) => s.name))
      await finalizeSharedImport({ ...script, name: versionedName }, recordings, null)
    }
  }

  // Auto-import a script from a shared link — either the short Firebase-backed
  // form .../#s=<docId>&k=<key> or the older self-contained .../#script=<encoded>
  useEffect(() => {
    if (importedSharedScript.current) return
    const hash = window.location.hash
    const shortMatch = hash.match(/^#s=([^&]+)&k=([^&]+)$/)
    const legacyMatch = hash.match(/^#script=(.+)$/)
    if (!shortMatch && !legacyMatch) return
    importedSharedScript.current = true
    history.replaceState(null, '', window.location.pathname + window.location.search)
    const load = shortMatch
      ? downloadSharedScriptFromFirebase(shortMatch[1], shortMatch[2])
      : decodeSharedScript(legacyMatch![1]).then((script) => ({ script, recordings: new Map<string, Blob>() }))
    load
      .then(({ script, recordings }) => {
        const conflictWith = scripts.find((s) => s.name === script.name)
        if (conflictWith) {
          setPendingSharedImport({ script, recordings, conflictWith })
        } else {
          void finalizeSharedImport(script, recordings, null)
        }
      })
      .catch((err) => {
        console.error('Failed to import shared script', err)
        setSharedImport({ error: true })
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      {sharedImport && (
        <div className="w-full py-2 px-4 text-xs font-medium bg-[var(--color-stage-accent)]/15 text-[var(--color-stage-accent-light)] text-center shrink-0 flex items-center justify-center gap-2">
          <span>
            {'error' in sharedImport
              ? "Couldn't open the shared script link"
              : `Added shared script "${sharedImport.name}"`}
          </span>
          <button onClick={() => setSharedImport(null)} className="opacity-70 hover:opacity-100">✕</button>
        </div>
      )}
      {pendingSharedImport && (
        <div className="w-full py-2.5 px-4 text-xs bg-[var(--color-stage-accent)]/15 text-[var(--color-stage-text)] shrink-0 flex flex-col items-center gap-2">
          <span className="text-center">
            You already have a script named "{pendingSharedImport.conflictWith.name}". Overwrite it, or keep both?
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => void resolvePendingImport('overwrite')}
              className="px-3 py-1 rounded-md bg-[var(--color-stage-accent)] text-white font-semibold"
            >
              Overwrite
            </button>
            <button
              onClick={() => void resolvePendingImport('keep')}
              className="px-3 py-1 rounded-md border border-[var(--color-stage-border)] text-[var(--color-stage-text)]"
            >
              Keep both
            </button>
            <button
              onClick={() => setPendingSharedImport(null)}
              className="px-3 py-1 text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)]"
            >
              Cancel
            </button>
          </div>
        </div>
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
