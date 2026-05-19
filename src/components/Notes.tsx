import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'

export function Notes() {
  const { notes, addNote, toggleNote, updateNote, deleteNote, clearDoneNotes } = useAppStore()
  const [text, setText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const handleAdd = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    addNote(trimmed)
    setText('')
  }

  const startEdit = (id: string, current: string) => {
    setEditingId(id)
    setEditText(current)
  }

  const commitEdit = () => {
    if (editingId) {
      const trimmed = editText.trim()
      if (trimmed) updateNote(editingId, trimmed)
    }
    setEditingId(null)
  }

  const hasDone = notes.some((n) => n.done)

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-[var(--color-stage-text)]">Notes</h2>
        {hasDone && (
          <button
            onClick={clearDoneNotes}
            className="text-xs text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors"
          >
            Clear done
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="Add a note…"
          className="flex-1 px-3 py-2 rounded-lg text-sm bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] text-[var(--color-stage-text)] placeholder:text-[var(--color-stage-muted)] focus:outline-none focus:border-[var(--color-stage-accent)]"
        />
        <button
          onClick={handleAdd}
          disabled={!text.trim()}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[var(--color-stage-accent)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          Add
        </button>
      </div>

      {notes.length === 0 ? (
        <p className="text-sm text-[var(--color-stage-muted)] text-center py-8">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li
              key={note.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)]"
            >
              <button
                onClick={() => toggleNote(note.id)}
                className={`mt-0.5 w-5 h-5 flex-shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
                  note.done
                    ? 'bg-[var(--color-stage-accent)] border-[var(--color-stage-accent)]'
                    : 'border-[var(--color-stage-muted)] hover:border-[var(--color-stage-accent)]'
                }`}
              >
                {note.done && (
                  <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>

              <div className="flex-1 min-w-0">
                {editingId === note.id ? (
                  <div className="space-y-1.5">
                    <input
                      autoFocus
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="w-full text-sm px-2 py-1 rounded bg-[var(--color-stage-bg)] border border-[var(--color-stage-accent)] text-[var(--color-stage-text)] focus:outline-none"
                    />
                    <div className="flex gap-3">
                      <button onClick={commitEdit} className="text-xs text-[var(--color-stage-accent-light)]">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-[var(--color-stage-muted)]">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <span
                    className={`text-sm leading-snug ${note.done ? 'line-through text-[var(--color-stage-muted)]' : 'text-[var(--color-stage-text)]'}`}
                  >
                    {note.text}
                  </span>
                )}
              </div>

              {editingId !== note.id && (
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => startEdit(note.id, note.text)}
                    className="text-xs text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors"
                    title="Edit"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => deleteNote(note.id)}
                    className="text-xs text-[var(--color-stage-muted)] hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
