import { useRef, useState, useEffect } from 'react'
import { IconDismiss, IconChevronUp, IconChevronDown, IconCheckmark, IconImport } from './Icons'
import { useAppStore } from '../store/useAppStore'
import { parseScript } from '../utils/scriptParser'
import { extractPdfText } from '../utils/pdfExtract'
import { parseImportFile, countRecordingConflicts, importBundle } from '../utils/exportImport'
import { Notes } from './Notes'
import type { Script } from '../types'

interface ExampleMeta { name: string; file: string; description: string }

interface Props { onClose: () => void }

export function SideMenu({ onClose }: Props) {
  const { scripts, notes, addScript, removeScript, selectScript, updateScript } = useAppStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const importBundleRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [importState, setImportState] = useState<{
    bundle: Awaited<ReturnType<typeof parseImportFile>>
    conflicts: number
  } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [examples, setExamples] = useState<ExampleMeta[]>([])
  const [loadingExample, setLoadingExample] = useState<string | null>(null)
  const [examplesOpen, setExamplesOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  async function handleBundleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      const bundle = await parseImportFile(file)
      const conflicts = await countRecordingConflicts(bundle)
      setImportState({ bundle, conflicts })
      setImportError(null)
    } catch {
      setImportError('Invalid file — please choose a CueLine export (.json)')
    }
  }

  async function confirmImport(keepExisting: boolean) {
    if (!importState) return
    setImporting(true)
    try {
      await importBundle(importState.bundle, keepExisting, addScript, updateScript, scripts)
    } finally {
      setImporting(false)
      setImportState(null)
    }
  }

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}examples/index.json`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: ExampleMeta[]) => setExamples(data))
      .catch(() => {})
  }, [])

  const confirmAndAdd = (script: Script) => {
    const existing = scripts.find((s) => s.name === script.name)
    if (existing) {
      if (!window.confirm(`"${script.name}" is already loaded. Replace it?`)) return
      removeScript(existing.id)
    }
    addScript(script)
    selectScript(script.id)
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setImporting(true)
    try {
      for (const file of Array.from(files)) {
        const name = file.name.replace(/\.[^.]+$/, '')
        const text = file.name.toLowerCase().endsWith('.pdf')
          ? await extractPdfText(file)
          : await file.text()
        confirmAndAdd(parseScript(text, name))
      }
    } finally {
      setImporting(false)
    }
  }

  const loadExample = async (ex: ExampleMeta) => {
    setLoadingExample(ex.file)
    setImporting(true)
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}examples/${ex.file}`)
      if (!res.ok) throw new Error('Failed to load')
      const text = ex.file.endsWith('.pdf')
        ? await extractPdfText(await res.blob() as File)
        : await res.text()
      confirmAndAdd(parseScript(text, ex.name))
    } catch {
      // silently ignore
    } finally {
      setImporting(false)
      setLoadingExample(null)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      <div className="fixed inset-y-0 left-0 z-50 w-80 max-w-full bg-[var(--color-stage-surface)] border-r border-[var(--color-stage-border)] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-stage-border)] shrink-0">
          <span className="cueline-title text-xl">CueLine</span>
          <button onClick={onClose} className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] text-xl leading-none px-1"><IconDismiss /></button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* Scripts section */}
          <div className="px-5 py-4 border-b border-[var(--color-stage-border)] space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-stage-muted)] mb-3">Scripts</p>

            {/* Load */}
            <button
              disabled={importing}
              onClick={() => inputRef.current?.click()}
              className="w-full py-2.5 rounded-xl bg-[var(--color-stage-accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {importing && !loadingExample ? 'Loading…' : 'Load'}
            </button>
            <input ref={inputRef} type="file" accept=".txt,.pdf" multiple className="hidden"
              onChange={(e) => { void handleFiles(e.target.files) }} />

            {/* Import */}
            <button
              onClick={() => importBundleRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] hover:border-[var(--color-stage-accent-light)] transition-colors"
            >
              <IconImport /> Import
            </button>
            <input ref={importBundleRef} type="file" accept=".json,application/json" className="hidden"
              onChange={handleBundleFile} />
            {importError && <p className="text-xs text-red-400 text-center">{importError}</p>}

            {/* Examples */}
            {examples.length > 0 && (
              <>
                <button
                  onClick={() => setExamplesOpen((v) => !v)}
                  className="w-full flex items-center justify-between py-2 rounded-xl text-sm font-medium border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] hover:border-[var(--color-stage-accent-light)] transition-colors px-4"
                >
                  <span>Examples</span>
                  {examplesOpen ? <IconChevronUp /> : <IconChevronDown />}
                </button>
                {examplesOpen && (
                  <div className="space-y-2">
                    {examples.map((ex) => {
                      const loaded = scripts.some((s) => s.name === ex.name)
                      return (
                        <div key={ex.file} className="flex items-center justify-between rounded-lg border border-[var(--color-stage-border)] bg-[var(--color-stage-bg)] px-3 py-2.5 gap-3">
                          <div className="min-w-0 flex items-start gap-1.5">
                            <span className={`mt-0.5 text-sm shrink-0 ${loaded ? 'text-[var(--color-stage-accent-light)]' : 'invisible'}`}><IconCheckmark /></span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-[var(--color-stage-text)] truncate">{ex.name}</p>
                              <p className="text-xs text-[var(--color-stage-muted)]">{ex.description}</p>
                            </div>
                          </div>
                          <button
                            disabled={importing}
                            onClick={() => void loadExample(ex)}
                            className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-[var(--color-stage-accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                          >
                            {loadingExample === ex.file ? '⏳' : 'Load'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Notes */}
          <div className="px-5 py-4 border-b border-[var(--color-stage-border)]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-stage-muted)]">Notes</span>
              {notes.length > 0 && (
                <button
                  onClick={() => setNotesOpen((v) => !v)}
                  className="flex items-center gap-1 text-xs text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors"
                >
                  <span>{notes.length}</span>
                  {notesOpen ? <IconChevronUp /> : <IconChevronDown />}
                </button>
              )}
            </div>
            <Notes listOpen={notesOpen} />
          </div>

          {/* Reload */}
          <div className="px-5 py-3 border-b border-[var(--color-stage-border)]">
            <button
              onClick={() => window.location.reload()}
              className="w-full py-2 rounded-xl text-sm font-medium border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] hover:border-[var(--color-stage-accent-light)] transition-colors"
            >
              Reload app
            </button>
          </div>

          {/* About */}
          <div className="px-5 py-4">
            <button
              onClick={() => setAboutOpen((v) => !v)}
              className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors mb-1"
            >
              <span>About</span>
              {aboutOpen ? <IconChevronUp /> : <IconChevronDown />}
            </button>
            {aboutOpen && (
              <div className="mt-2 rounded-lg border border-[var(--color-stage-border)] bg-[var(--color-stage-bg)] px-3 py-3 space-y-3 text-xs text-[var(--color-stage-muted)]">
                <p className="cueline-title text-lg">CueLine</p>
                <p>Learn your lines for a play by rehearsing with a full read-through of your script.</p>
                <div className="space-y-1.5">
                  <p className="font-semibold text-[var(--color-stage-text)]">Getting started</p>
                  <p>1. Tap <span className="text-[var(--color-stage-text)]">☰</span> and load your script as a .txt or .pdf file.</p>
                  <p>2. Go to <span className="text-[var(--color-stage-text)]">Characters</span> to see who's in your script and view their lines by scene.</p>
                  <p>3. Go to <span className="text-[var(--color-stage-text)]">Record</span> to pre-record lines for other characters so they play back in their own voice.</p>
                  <p>4. Go to <span className="text-[var(--color-stage-text)]">Run through</span>, choose your character, and tap Start.</p>
                </div>
                <div className="space-y-1.5">
                  <p className="font-semibold text-[var(--color-stage-text)]">In rehearsal</p>
                  <p>Other characters are read aloud (or played from your recordings). Your lines are shown highlighted — speak them yourself, or choose to have them read with a gap before or after.</p>
                  <p>Drag the red markers to set a clip region and use <span className="text-[var(--color-stage-text)]">↺</span> to loop it until you have the lines.</p>
                  <p>Your accuracy is measured as you speak — a warning sounds if it drops below your set threshold.</p>
                </div>
                <div className="space-y-1.5">
                  <p className="font-semibold text-[var(--color-stage-text)]">Settings <span className="font-normal">(⚙️)</span></p>
                  <p>Choose your line mode, set speech rate, pick voices per character, adjust accuracy warning threshold, and select a highlighter colour.</p>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {importState && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4">
          <div className="bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] rounded-xl p-5 w-full max-w-sm space-y-4">
            <p className="font-semibold text-[var(--color-stage-text)]">Import</p>
            <p className="text-sm text-[var(--color-stage-muted)]">
              {importState.bundle.scripts.length} script{importState.bundle.scripts.length !== 1 ? 's' : ''} ·{' '}
              {Object.keys(importState.bundle.recordings).length} recording{Object.keys(importState.bundle.recordings).length !== 1 ? 's' : ''}
            </p>
            {importState.conflicts > 0 && (
              <p className="text-sm text-amber-400">
                {importState.conflicts} recording{importState.conflicts !== 1 ? 's' : ''} already exist locally.
              </p>
            )}
            <p className="text-sm text-[var(--color-stage-text)]">
              {importState.conflicts > 0 ? 'What should happen to conflicting recordings?' : 'Import these scripts and recordings?'}
            </p>
            <div className="flex flex-col gap-2">
              <button onClick={() => confirmImport(true)} disabled={importing}
                className="py-2 rounded-lg text-sm font-medium bg-[var(--color-stage-accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
                {importState.conflicts > 0 ? 'Keep my recordings' : 'Import'}
              </button>
              {importState.conflicts > 0 && (
                <button onClick={() => confirmImport(false)} disabled={importing}
                  className="py-2 rounded-lg text-sm font-medium border border-[var(--color-stage-border)] text-[var(--color-stage-text)] hover:border-[var(--color-stage-accent-light)] disabled:opacity-50 transition-colors">
                  Overwrite with imported
                </button>
              )}
              <button onClick={() => setImportState(null)} disabled={importing}
                className="py-2 rounded-lg text-sm font-medium text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] disabled:opacity-50 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
