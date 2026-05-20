import { useState, useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { rebuildScript } from '../utils/rebuildScript'
import type { Script, ScriptLine, LineType } from '../types'

interface Props {
  script: Script
  onClose: () => void
}

interface EditableLine {
  id: string
  type: LineType
  character: string
  text: string
  lineIndex: number
}

function toEditable(lines: ScriptLine[]): EditableLine[] {
  return lines.map((l) => ({
    id: l.id,
    type: l.type,
    character: l.character ?? '',
    text: l.text,
    lineIndex: l.lineIndex,
  }))
}

const TYPE_ICONS: Record<LineType, string> = {
  dialogue: '💬',
  direction: '📐',
  heading: '🎬',
}

export function ScriptEditor({ script, onClose }: Props) {
  const { updateScript } = useAppStore()
  const [lines, setLines] = useState<EditableLine[]>(() => toEditable(script.lines))
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [matchCursor, setMatchCursor] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 300)
    return () => clearTimeout(t)
  }, [query])

  const q = debouncedQuery
  const matchesLine = (line: EditableLine) =>
    line.text.toLowerCase().includes(q) ||
    line.character.toLowerCase().includes(q) ||
    line.type.toLowerCase().includes(q)

  const allLines: Array<{ line: EditableLine; idx: number }> = lines.map((line, idx) => ({ line, idx }))
  const matchIndices: number[] = q ? lines.flatMap((line, idx) => (matchesLine(line) ? [idx] : [])) : []

  const safeMatchCursor = matchIndices.length > 0 ? Math.min(matchCursor, matchIndices.length - 1) : 0
  const activeLineIdx = q && matchIndices.length > 0 ? matchIndices[safeMatchCursor] : null

  useEffect(() => { setMatchCursor(0) }, [q])

  useEffect(() => {
    if (activeLineIdx === null) return
    setTimeout(() => {
      document.getElementById(`editor-line-${activeLineIdx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 10)
  }, [activeLineIdx])

  const update = (idx: number, patch: Partial<EditableLine>) => {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, ...patch } : l))
    setDirty(true)
  }

  const addLineAfter = (idx: number) => {
    const ref = lines[idx]
    const newLine: EditableLine = {
      id: `new-${Date.now()}`,
      type: ref?.type === 'dialogue' ? 'dialogue' : 'direction',
      character: ref?.type === 'dialogue' ? ref.character : '',
      text: '',
      lineIndex: idx + 1,
    }
    setLines((prev) => [...prev.slice(0, idx + 1), newLine, ...prev.slice(idx + 1)])
    setEditingIdx(idx + 1)
    setDirty(true)
  }

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx))
    if (editingIdx === idx) setEditingIdx(null)
    setDirty(true)
  }

  const handleSave = () => {
    const scriptLines: ScriptLine[] = lines
      .filter((l) => l.text.trim())
      .map((l, i) => ({
        id: `line-${i}`,
        type: l.type,
        character: l.character || undefined,
        text: l.text.trim(),
        lineIndex: i,
      }))
    const rebuilt = rebuildScript(script, scriptLines)
    updateScript(rebuilt)
    setDirty(false)
    onClose()
  }

  const allCharacters = [...new Set(
    lines.filter((l) => l.type === 'dialogue' && l.character).map((l) => l.character)
  )].sort()

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60" onClick={() => !dirty && onClose()} />

      {/* Panel */}
      <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-stage-bg)] max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-stage-border)] shrink-0">
          <button
            onClick={onClose}
            className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors"
          >
            ← Cancel
          </button>
          <h2 className="flex-1 font-semibold text-[var(--color-stage-text)] truncate">{script.name}</h2>
          <button
            onClick={handleSave}
            disabled={!dirty}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white bg-[var(--color-stage-accent)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            Save
          </button>
        </div>

        {/* Search bar */}
        <div className="px-3 py-2 border-b border-[var(--color-stage-border)] shrink-0">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] focus-within:border-[var(--color-stage-accent)]">
            <span className="text-[var(--color-stage-muted)] text-sm">🔍</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (!q || matchIndices.length === 0) return
                if (e.key === 'Enter') { e.preventDefault(); setMatchCursor((c) => (c + 1) % matchIndices.length) }
                if (e.key === 'F3') { e.preventDefault(); setMatchCursor((c) => (c + 1) % matchIndices.length) }
              }}
              placeholder="Search text, character, type…"
              className="flex-1 bg-transparent text-sm text-[var(--color-stage-text)] placeholder:text-[var(--color-stage-muted)] focus:outline-none"
            />
            {q && (
              <>
                <span className="text-xs text-[var(--color-stage-muted)] shrink-0">
                  {matchIndices.length === 0 ? 'No matches' : `${safeMatchCursor + 1} of ${matchIndices.length}`}
                </span>
                <button
                  disabled={matchIndices.length === 0}
                  onClick={() => setMatchCursor((c) => (c - 1 + matchIndices.length) % matchIndices.length)}
                  className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] disabled:opacity-30 text-xs leading-none px-0.5"
                  title="Previous match"
                >▲</button>
                <button
                  disabled={matchIndices.length === 0}
                  onClick={() => setMatchCursor((c) => (c + 1) % matchIndices.length)}
                  className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] disabled:opacity-30 text-xs leading-none px-0.5"
                  title="Next match"
                >▼</button>
                <button
                  onClick={() => { setQuery(''); setDebouncedQuery('') }}
                  className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] text-sm leading-none"
                >
                  ×
                </button>
              </>
            )}
          </div>
        </div>

        {/* Lines list */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {allLines.map(({ line, idx }) => {
            const isEditing = editingIdx === idx
            const isActiveMatch = idx === activeLineIdx
            const isAnyMatch = q && matchIndices.includes(idx)
            return (
              <div
                key={line.id + idx}
                id={`editor-line-${idx}`}
                className={`rounded-lg border transition-colors ${
                  isEditing
                    ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/5'
                    : isActiveMatch
                    ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/10'
                    : isAnyMatch
                    ? 'border-[var(--color-stage-border)] bg-amber-400/5'
                    : 'border-transparent hover:border-[var(--color-stage-border)]'
                }`}
              >
                {isEditing ? (
                  <EditRow
                    line={line}
                    allCharacters={allCharacters}
                    onChange={(patch) => update(idx, patch)}
                    onDone={() => setEditingIdx(null)}
                    onAddAfter={() => addLineAfter(idx)}
                    onRemove={() => removeLine(idx)}
                  />
                ) : (
                  <ViewRow line={line} highlight={q} onEdit={() => setEditingIdx(idx)} />
                )}
              </div>
            )
          })}

          <button
            onClick={() => addLineAfter(lines.length - 1)}
            className="w-full py-2 text-sm text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] border border-dashed border-[var(--color-stage-border)] rounded-lg transition-colors"
          >
            + Add line at end
          </button>
        </div>
      </div>
    </>
  )
}

function hl(text: string, query: string) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query)
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-400/40 text-inherit rounded-sm">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

function ViewRow({ line, highlight = '', onEdit }: { line: EditableLine; highlight?: string; onEdit: () => void }) {
  return (
    <div
      onClick={onEdit}
      className="flex items-start gap-2 px-2 py-1.5 cursor-pointer"
    >
      <span className="text-xs shrink-0 mt-0.5 opacity-50">{TYPE_ICONS[line.type]}</span>
      <div className="flex-1 min-w-0">
        {line.type === 'dialogue' && line.character && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-stage-gold)] mr-1.5">
            {hl(line.character, highlight)}
          </span>
        )}
        <span className={`text-sm ${
          line.type === 'heading'
            ? 'font-semibold text-[var(--color-stage-gold)]'
            : line.type === 'direction'
            ? 'italic text-[var(--color-stage-muted)]'
            : 'text-[var(--color-stage-text)]'
        }`}>
          {line.text ? hl(line.text, highlight) : <span className="opacity-30">empty</span>}
        </span>
      </div>
    </div>
  )
}

function EditRow({
  line,
  allCharacters,
  onChange,
  onDone,
  onAddAfter,
  onRemove,
}: {
  line: EditableLine
  allCharacters: string[]
  onChange: (patch: Partial<EditableLine>) => void
  onDone: () => void
  onAddAfter: () => void
  onRemove: () => void
}) {
  return (
    <div className="px-2 py-2 space-y-2">
      {/* Type selector */}
      <div className="flex gap-1">
        {(['dialogue', 'direction', 'heading'] as LineType[]).map((t) => (
          <button
            key={t}
            onClick={() => onChange({ type: t, character: t === 'dialogue' ? line.character : '' })}
            className={`px-2 py-1 text-xs rounded-md transition-colors ${
              line.type === t
                ? 'bg-[var(--color-stage-accent)] text-white'
                : 'bg-[var(--color-stage-surface)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)]'
            }`}
          >
            {TYPE_ICONS[t]} {t}
          </button>
        ))}
      </div>

      {/* Character (dialogue only) */}
      {line.type === 'dialogue' && (
        <div className="flex gap-1">
          <select
            value={line.character}
            onChange={(e) => onChange({ character: e.target.value })}
            className="flex-1 text-xs px-2 py-1 rounded-md bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] text-[var(--color-stage-text)]"
          >
            <option value="">— character —</option>
            {allCharacters.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            type="text"
            value={line.character}
            onChange={(e) => onChange({ character: e.target.value.toUpperCase() })}
            placeholder="or type new name"
            className="flex-1 text-xs px-2 py-1 rounded-md bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] text-[var(--color-stage-text)] placeholder:text-[var(--color-stage-muted)]"
          />
        </div>
      )}

      {/* Text */}
      <textarea
        value={line.text}
        onChange={(e) => onChange({ text: e.target.value })}
        rows={Math.max(2, line.text.split('\n').length)}
        className="w-full text-sm px-2 py-1.5 rounded-md bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] text-[var(--color-stage-text)] resize-none focus:outline-none focus:border-[var(--color-stage-accent)]"
        autoFocus
      />

      {/* Actions */}
      <div className="flex gap-2 justify-between">
        <button
          onClick={onRemove}
          className="text-xs text-red-400 hover:text-red-300 transition-colors"
        >
          Delete line
        </button>
        <div className="flex gap-2">
          <button
            onClick={onAddAfter}
            className="text-xs text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors"
          >
            + Add after
          </button>
          <button
            onClick={onDone}
            className="text-xs text-[var(--color-stage-accent-light)] hover:text-white transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
