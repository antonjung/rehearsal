import { useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { parseScript } from '../utils/scriptParser'
import { extractPdfText } from '../utils/pdfExtract'
import { ScriptEditor } from './ScriptEditor'
import type { Script } from '../types'

export function ScriptManager() {
  const { scripts, selectedScriptId, addScript, removeScript, selectScript } =
    useAppStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const [editingScript, setEditingScript] = useState<Script | null>(null)
  const [importing, setImporting] = useState(false)

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
