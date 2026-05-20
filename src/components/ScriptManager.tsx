import { useRef, useState, useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { parseScript } from '../utils/scriptParser'
import { extractPdfText } from '../utils/pdfExtract'
import { importScriptFromUrl } from '../utils/importScript'
import { ScriptEditor } from './ScriptEditor'
import type { Script } from '../types'

interface ExampleMeta { name: string; file: string; description: string }

export function ScriptManager() {
  const { scripts, selectedScriptId, addScript, removeScript, selectScript } =
    useAppStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [editingScript, setEditingScript] = useState<Script | null>(null)
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

  const loadFromUrl = async (url: string, nameOverride?: string) => {
    setUrlError('')
    setImporting(true)
    try {
      const script = await importScriptFromUrl(url.trim(), nameOverride)
      addScript(script)
      selectScript(script.id)
      setUrlInput('')
    } catch (e) {
      setUrlError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setImporting(false)
      setLoadingExample(null)
    }
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setImporting(true)
    try {
      for (const file of Array.from(files)) {
        const name = file.name.replace(/\.[^.]+$/, '')
        let text: string
        if (file.name.toLowerCase().endsWith('.pdf')) {
          text = await extractPdfText(file)
        } else {
          text = await file.text()
        }
        const script = parseScript(text, name)
        addScript(script)
        selectScript(script.id)
      }
    } finally {
      setImporting(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    void handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="space-y-6">
      {/* Upload area */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !importing && inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
          importing
            ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/5 cursor-wait'
            : 'border-[var(--color-stage-border)] cursor-pointer hover:border-[var(--color-stage-accent)] hover:bg-[var(--color-stage-accent)]/5'
        }`}
      >
        <div className="text-4xl mb-3">{importing ? '⏳' : '📜'}</div>
        <p className="text-[var(--color-stage-text)] font-medium">
          {importing ? 'Importing…' : 'Drop script files here or click to browse'}
        </p>
        <p className="text-[var(--color-stage-muted)] text-sm mt-1">
          Plain text (.txt) or PDF (.pdf) — standard play format
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.pdf"
          multiple
          className="hidden"
          onChange={(e) => { void handleFiles(e.target.files) }}/>
      </div>

      {/* Example scripts */}
      {examples.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-stage-muted)]">
            Example Scripts
          </h2>
          {examples.map((ex) => (
            <div
              key={ex.file}
              className="rounded-lg border border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] px-4 py-3 flex items-center justify-between"
            >
              <div>
                <p className="text-sm font-medium text-[var(--color-stage-text)]">{ex.name}</p>
                <p className="text-xs text-[var(--color-stage-muted)] mt-0.5">{ex.description}</p>
              </div>
              <button
                disabled={importing}
                onClick={() => {
                  setLoadingExample(ex.file)
                  void loadFromUrl(`${import.meta.env.BASE_URL}examples/${ex.file}`, ex.name)
                }}
                className="shrink-0 ml-3 text-xs px-3 py-1.5 rounded-lg bg-[var(--color-stage-accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {loadingExample === ex.file ? '⏳' : 'Load'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Load from URL */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-stage-muted)]">
          Load from URL
        </h2>
        <p className="text-xs text-[var(--color-stage-muted)]">Paste a link to a .txt or .pdf script file.</p>
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
      </div>

      {/* Script list */}
      {scripts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-stage-muted)]">
            Loaded Scripts
          </h2>
          {scripts.map((script: Script) => (
            <ScriptCard
              key={script.id}
              script={script}
              selected={script.id === selectedScriptId}
              onSelect={() => selectScript(script.id)}
              onRemove={() => removeScript(script.id)}
              onEdit={() => setEditingScript(script)}
            />
          ))}
        </div>
      )}
      {editingScript && (
        <ScriptEditor script={editingScript} onClose={() => setEditingScript(null)} />
      )}
    </div>
  )
}

function ScriptCard({
  script,
  selected,
  onSelect,
  onRemove,
  onEdit,
}: {
  script: Script
  selected: boolean
  onSelect: () => void
  onRemove: () => void
  onEdit: () => void
}) {
  const dialogueCount = script.lines.filter((l) => l.type === 'dialogue').length

  return (
    <div
      className={`rounded-lg border px-4 py-3 flex items-center justify-between cursor-pointer transition-colors ${
        selected
          ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/10'
          : 'border-[var(--color-stage-border)] bg-[var(--color-stage-surface)] hover:border-[var(--color-stage-accent-light)]'
      }`}
      onClick={onSelect}
    >
      <div>
        <p className="font-semibold text-[var(--color-stage-text)]">{script.name}</p>
        <p className="text-xs text-[var(--color-stage-muted)] mt-0.5">
          {script.characters.length} characters · {dialogueCount} lines
        </p>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-accent-light)] transition-colors p-1 rounded text-sm"
          aria-label="Edit script"
          title="Edit script"
        >
          ✏️
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="text-[var(--color-stage-muted)] hover:text-red-400 transition-colors p-1 rounded"
          aria-label="Remove script"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
