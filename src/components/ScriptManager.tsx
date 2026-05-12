import { useRef } from 'react'
import { useAppStore } from '../store/useAppStore'
import { parseScript } from '../utils/scriptParser'
import type { Script } from '../types'

export function ScriptManager() {
  const { scripts, selectedScriptId, addScript, removeScript, selectScript } =
    useAppStore()
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target?.result as string
        const name = file.name.replace(/\.[^.]+$/, '')
        const script = parseScript(text, name)
        addScript(script)
        selectScript(script.id)
      }
      reader.readAsText(file)
    })
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="space-y-6">
      {/* Upload area */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-[var(--color-stage-border)] rounded-xl p-10 text-center cursor-pointer hover:border-[var(--color-stage-accent)] hover:bg-[var(--color-stage-accent)]/5 transition-colors"
      >
        <div className="text-4xl mb-3">📜</div>
        <p className="text-[var(--color-stage-text)] font-medium">
          Drop script files here or click to browse
        </p>
        <p className="text-[var(--color-stage-muted)] text-sm mt-1">
          Plain text files (.txt) — standard play format (CHARACTER NAME on its own line)
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".txt"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
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
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ScriptCard({
  script,
  selected,
  onSelect,
  onRemove,
}: {
  script: Script
  selected: boolean
  onSelect: () => void
  onRemove: () => void
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
  )
}
