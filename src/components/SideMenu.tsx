import { useRef, useState, useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { parseScript } from '../utils/scriptParser'
import { extractPdfText } from '../utils/pdfExtract'
import { importScriptFromUrl } from '../utils/importScript'
import { Notes } from './Notes'
import type { Script } from '../types'

interface ExampleMeta { name: string; file: string; description: string }

interface Props { onClose: () => void }

export function SideMenu({ onClose }: Props) {
  const { scripts, addScript, removeScript, selectScript } = useAppStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [urlError, setUrlError] = useState('')
  const [examples, setExamples] = useState<ExampleMeta[]>([])
  const [loadingExample, setLoadingExample] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}examples/index.json`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: ExampleMeta[]) => setExamples(data))
      .catch(() => {})
  }, [])

  const confirmAndAdd = (script: Script): boolean => {
    const existing = scripts.find((s) => s.name === script.name)
    if (existing) {
      if (!window.confirm(`"${script.name}" is already loaded. Replace it?`)) return false
      removeScript(existing.id)
    }
    addScript(script)
    selectScript(script.id)
    return true
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
        const script = parseScript(text, name)
        confirmAndAdd(script)
      }
    } finally {
      setImporting(false)
    }
  }

  const loadFromUrl = async (url: string, nameOverride?: string) => {
    setUrlError('')
    setImporting(true)
    try {
      const script = await importScriptFromUrl(url.trim(), nameOverride)
      confirmAndAdd(script)
      setUrlInput('')
    } catch (e) {
      setUrlError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setImporting(false)
      setLoadingExample(null)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 left-0 z-50 w-80 max-w-full bg-[var(--color-stage-surface)] border-r border-[var(--color-stage-border)] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--color-stage-border)] shrink-0">
          <h2 className="font-semibold text-[var(--color-stage-text)]">Menu</h2>
          <button onClick={onClose} className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">

          {/* Load scripts */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-stage-muted)]">Load scripts</h3>
            <button
              disabled={importing}
              onClick={() => inputRef.current?.click()}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:border-[var(--color-stage-accent)] hover:text-[var(--color-stage-text)] transition-colors disabled:opacity-40"
            >
              <span className="text-2xl">{importing && !loadingExample ? '⏳' : '📂'}</span>
              <span className="text-sm">{importing && !loadingExample ? 'Importing…' : 'Browse for .txt or .pdf'}</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".txt,.pdf"
              multiple
              className="hidden"
              onChange={(e) => { void handleFiles(e.target.files) }}
            />
          </section>

          {/* Example scripts */}
          {examples.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-stage-muted)]">Example scripts</h3>
              {examples.map((ex) => (
                <div
                  key={ex.file}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-stage-border)] bg-[var(--color-stage-bg)] px-3 py-2.5"
                >
                  <div className="min-w-0 mr-3">
                    <p className="text-sm font-medium text-[var(--color-stage-text)] truncate">{ex.name}</p>
                    <p className="text-xs text-[var(--color-stage-muted)]">{ex.description}</p>
                  </div>
                  <button
                    disabled={importing}
                    onClick={() => {
                      setLoadingExample(ex.file)
                      void loadFromUrl(`${import.meta.env.BASE_URL}examples/${ex.file}`, ex.name)
                    }}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-[var(--color-stage-accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >
                    {loadingExample === ex.file ? '⏳' : 'Load'}
                  </button>
                </div>
              ))}
            </section>
          )}

          {/* Load from URL */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-stage-muted)]">Load from URL</h3>
            <p className="text-xs text-[var(--color-stage-muted)]">Paste a link to a .txt or .pdf script.</p>
            <div className="flex gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => { setUrlInput(e.target.value); setUrlError('') }}
                onKeyDown={(e) => e.key === 'Enter' && urlInput.trim() && void loadFromUrl(urlInput)}
                placeholder="https://…"
                className="flex-1 rounded-lg border border-[var(--color-stage-border)] bg-[var(--color-stage-bg)] text-sm text-[var(--color-stage-text)] px-3 py-2 focus:outline-none focus:border-[var(--color-stage-accent)]"
              />
              <button
                disabled={!urlInput.trim() || importing}
                onClick={() => void loadFromUrl(urlInput)}
                className="shrink-0 text-sm px-4 py-2 rounded-lg bg-[var(--color-stage-accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {importing && !loadingExample ? '⏳' : 'Load'}
              </button>
            </div>
            {urlError && <p className="text-xs text-red-400">{urlError}</p>}
          </section>

          {/* Notes */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-stage-muted)]">Notes</h3>
            <Notes />
          </section>

        </div>
      </div>
    </>
  )
}
