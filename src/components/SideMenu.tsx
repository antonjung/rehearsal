import { useRef, useState, useEffect } from 'react'
import { IconDismiss, IconChevronUp, IconChevronDown, IconCheckmark } from './Icons'
import { useAppStore } from '../store/useAppStore'
import { parseScript } from '../utils/scriptParser'
import { extractPdfText } from '../utils/pdfExtract'
import { Notes } from './Notes'
import type { Script } from '../types'

interface ExampleMeta { name: string; file: string; description: string }

interface Props { onClose: () => void }

export function SideMenu({ onClose }: Props) {
  const { scripts, notes, addScript, removeScript, selectScript } = useAppStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [examples, setExamples] = useState<ExampleMeta[]>([])
  const [loadingExample, setLoadingExample] = useState<string | null>(null)
  const [examplesOpen, setExamplesOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

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
          <span className="offbook-title text-xl">OffBook</span>
          <button onClick={onClose} className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] text-xl leading-none px-1"><IconDismiss /></button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* Load script */}
          <div className="px-5 py-4 border-b border-[var(--color-stage-border)]">
            <button
              disabled={importing}
              onClick={() => inputRef.current?.click()}
              className="w-full py-2.5 rounded-xl bg-[var(--color-stage-accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {importing && !loadingExample ? 'Importing…' : 'Load script'}
            </button>
            <input ref={inputRef} type="file" accept=".txt,.pdf" multiple className="hidden"
              onChange={(e) => { void handleFiles(e.target.files) }} />
          </div>

          {/* Example scripts */}
          {examples.length > 0 && (
            <div className="px-5 py-4 border-b border-[var(--color-stage-border)]">
              <button
                onClick={() => setExamplesOpen((v) => !v)}
                className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors mb-1"
              >
                <span>Example scripts</span>
                {examplesOpen ? <IconChevronUp /> : <IconChevronDown />}
              </button>
              {examplesOpen && (
                <div className="mt-2 space-y-2">
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
            </div>
          )}

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
                <p className="offbook-title text-lg">OffBook</p>
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
    </>
  )
}
