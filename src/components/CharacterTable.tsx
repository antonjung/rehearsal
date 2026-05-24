import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { ScriptLine, Track } from '../types'
import { IconTrack } from './Icons'

const HIGHLIGHTER_COLORS: Record<string, { background: string; color: string }> = {
  yellow: { background: 'rgba(255,255,0,0.65)',  color: '#111' },
  pink:   { background: 'rgba(255,0,200,0.48)',  color: '#fff' },
  green:  { background: 'rgba(0,255,60,0.5)',    color: '#fff' },
  blue:   { background: 'rgba(0,240,255,0.52)',  color: '#fff' },
}

interface LineGroup {
  type: 'dialogue' | 'direction' | 'heading'
  character?: string
  lines: ScriptLine[]
}

function groupSceneLines(lines: ScriptLine[]): LineGroup[] {
  const groups: LineGroup[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.type === 'dialogue') {
      const g: LineGroup = { type: 'dialogue', character: line.character, lines: [line] }
      while (
        i + 1 < lines.length &&
        lines[i + 1].type === 'dialogue' &&
        lines[i + 1].character === line.character
      ) {
        i++
        g.lines.push(lines[i])
      }
      groups.push(g)
    } else {
      groups.push({ type: line.type, character: line.character, lines: [line] })
    }
    i++
  }
  return groups
}

interface TrackForm {
  id: string | null  // null = new
  name: string
  characters: string[]
}

export function CharacterTable() {
  const { scripts, selectedScriptId, rehearsalSettings, updateScript } = useAppStore()
  const script = scripts.find((s) => s.id === selectedScriptId)
  const [sceneMode, setSceneMode] = useState<string>('')
  const [charHighlight, setCharHighlight] = useState<{ char: string; sceneId: string } | null>(null)
  const [charHighlightGroupIdx, setCharHighlightGroupIdx] = useState(0)
  const [firstVisibleIdx, setFirstVisibleIdx] = useState(0)
  const [lastVisibleIdx, setLastVisibleIdx] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelScrollRef = useRef<HTMLDivElement>(null)

  // Track management
  const [showTrackPanel, setShowTrackPanel] = useState(false)
  const [trackForm, setTrackForm] = useState<TrackForm | null>(null)
  const tracks = script?.tracks ?? []

  // Clear panel when scene mode changes
  useEffect(() => { setCharHighlight(null) }, [sceneMode])

  // Reset indices when highlight changes
  useEffect(() => { setCharHighlightGroupIdx(0); setFirstVisibleIdx(0); setLastVisibleIdx(0) }, [charHighlight])

  // Scroll to target group
  useEffect(() => {
    if (!charHighlight) return
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const t = setTimeout(() => {
      const els = panelScrollRef.current?.querySelectorAll<HTMLElement>('[data-char-highlight]')
      els?.[charHighlightGroupIdx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 200)
    return () => clearTimeout(t)
  }, [charHighlight, charHighlightGroupIdx])

  // Track which highlighted group is visible in the scroll window
  useEffect(() => {
    const container = panelScrollRef.current
    if (!container || !charHighlight) return
    const update = () => {
      const els = Array.from(container.querySelectorAll<HTMLElement>('[data-char-highlight]'))
      const cr = container.getBoundingClientRect()
      let first = -1, last = -1
      for (let i = 0; i < els.length; i++) {
        const er = els[i].getBoundingClientRect()
        if (er.bottom > cr.top && er.top < cr.bottom) {
          if (first === -1) first = i
          last = i
        }
      }
      if (first !== -1) { setFirstVisibleIdx(first); setLastVisibleIdx(last) }
    }
    container.addEventListener('scroll', update, { passive: true })
    const t = setTimeout(update, 250)
    return () => { container.removeEventListener('scroll', update); clearTimeout(t) }
  }, [charHighlight])

  if (!script) {
    return (
      <div className="text-center text-[var(--color-stage-muted)] py-12">
        Select a script on the Scripts tab to see its characters.
      </div>
    )
  }

  const hasScenes = script.scenes.length > 0
  const specificScene = sceneMode !== '' && sceneMode !== 'all'
    ? script.scenes.find((s) => s.id === sceneMode) ?? null
    : null

  const relevantLines = specificScene
    ? script.lines.slice(specificScene.startLineIndex, specificScene.endLineIndex + 1)
    : script.lines

  const lineCounts: Record<string, number> = {}
  relevantLines.forEach((l) => {
    if (l.type === 'dialogue' && l.character)
      lineCounts[l.character] = (lineCounts[l.character] ?? 0) + 1
  })

  const characters = specificScene ? specificScene.characters : script.characters
  const sorted = characters.slice().sort((a, b) => (lineCounts[b] ?? 0) - (lineCounts[a] ?? 0))

  const panelScene = charHighlight
    ? charHighlight.sceneId === '__all__'
      ? { startLineIndex: 0, endLineIndex: script.lines.length - 1, title: 'All lines' }
      : script.scenes.find((s) => s.id === charHighlight.sceneId) ?? null
    : null
  const panelGroups = panelScene
    ? groupSceneLines(script.lines.slice(panelScene.startLineIndex, panelScene.endLineIndex + 1))
    : []
  const highlightedGroupCount = charHighlight
    ? panelGroups.filter((g) => g.character === charHighlight.char).length
    : 0

  const highlightStyle = HIGHLIGHTER_COLORS[rehearsalSettings?.highlighterColor ?? 'yellow']

  const toggleChip = (char: string, sceneId: string) =>
    setCharHighlight((prev) =>
      prev?.char === char && prev?.sceneId === sceneId ? null : { char, sceneId },
    )

  // Track management handlers
  const isTrackNameValid = (name: string, excludeId?: string | null) => {
    const t = name.trim()
    if (!t) return false
    if (script.characters.includes(t)) return false
    if (tracks.some(tr => tr.id !== excludeId && tr.name.toLowerCase() === t.toLowerCase())) return false
    return true
  }

  const openNewTrack = () => setTrackForm({ id: null, name: '', characters: [] })

  const openEditTrack = (t: Track) => setTrackForm({ id: t.id, name: t.name, characters: [...t.characters] })

  const saveTrack = () => {
    if (!trackForm || !isTrackNameValid(trackForm.name, trackForm.id)) return
    const updated: Track = {
      id: trackForm.id ?? crypto.randomUUID(),
      name: trackForm.name.trim(),
      characters: trackForm.characters,
    }
    const newTracks = trackForm.id
      ? tracks.map(t => t.id === updated.id ? updated : t)
      : [...tracks, updated]
    updateScript({ ...script, tracks: newTracks })
    setTrackForm(null)
  }

  const deleteTrack = (id: string) =>
    updateScript({ ...script, tracks: tracks.filter(t => t.id !== id) })

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--color-stage-text)]">Script</h2>
          <button
            onClick={() => { setShowTrackPanel(v => !v); setTrackForm(null) }}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
              showTrackPanel
                ? 'border-[var(--color-stage-accent)] text-[var(--color-stage-accent-light)] bg-[var(--color-stage-accent)]/10'
                : 'border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)]'
            }`}
          >
            <IconTrack className="text-sm" />
            <span>Tracks</span>
          </button>
        </div>
        {hasScenes && (
          <select
            value={sceneMode}
            onChange={(e) => setSceneMode(e.target.value)}
            className="w-full text-xs bg-[var(--color-stage-bg)] border border-[var(--color-stage-border)] rounded-md px-2 py-1.5 text-[var(--color-stage-text)] focus:outline-none focus:border-[var(--color-stage-accent)]"
          >
            <option value="">Full script</option>
            <option value="all">Scene breakdown</option>
            {script.scenes.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        )}
      </div>

      {/* Track management panel */}
      {showTrackPanel && (
        <div className="rounded-xl border border-[var(--color-stage-border)] overflow-hidden">
          {trackForm ? (
            <div className="p-4 space-y-3">
              <h3 className="text-sm font-semibold text-[var(--color-stage-text)]">
                {trackForm.id ? 'Edit track' : 'New track'}
              </h3>
              <input
                type="text"
                value={trackForm.name}
                onChange={(e) => setTrackForm(f => f && ({ ...f, name: e.target.value }))}
                placeholder="Track name"
                className="w-full rounded-md border border-[var(--color-stage-border)] bg-[var(--color-stage-bg)] text-sm text-[var(--color-stage-text)] px-3 py-2 focus:outline-none focus:border-[var(--color-stage-accent)]"
                autoFocus
              />
              {trackForm.name.trim() && !isTrackNameValid(trackForm.name, trackForm.id) && (
                <p className="text-xs text-red-400">Name matches an existing character or track</p>
              )}
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {script.characters.map(c => (
                  <label key={c} className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={trackForm.characters.includes(c)}
                      onChange={(e) => setTrackForm(f => f && ({
                        ...f,
                        characters: e.target.checked
                          ? [...f.characters, c]
                          : f.characters.filter(x => x !== c),
                      }))}
                      className="rounded"
                    />
                    <span className="text-sm text-[var(--color-stage-text)]">{c}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveTrack}
                  disabled={!isTrackNameValid(trackForm.name, trackForm.id) || trackForm.characters.length === 0}
                  className="flex-1 py-2 rounded-lg text-sm font-medium bg-[var(--color-stage-accent)] text-white disabled:opacity-30 hover:opacity-90 transition-opacity"
                >
                  Save
                </button>
                <button
                  onClick={() => setTrackForm(null)}
                  className="px-4 py-2 rounded-lg text-sm border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-stage-border)]">
              {tracks.length === 0 && (
                <p className="px-4 py-3 text-sm text-[var(--color-stage-muted)]">No tracks yet.</p>
              )}
              {tracks.map(t => (
                <div key={t.id} className="flex items-center gap-2 px-4 py-2.5">
                  <IconTrack className="text-sm text-[var(--color-stage-accent-light)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-[var(--color-stage-text)]">{t.name}</span>
                    <span className="text-xs text-[var(--color-stage-muted)] ml-2 truncate">{t.characters.join(', ')}</span>
                  </div>
                  <button
                    onClick={() => openEditTrack(t)}
                    className="text-xs px-2 py-1 rounded border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors shrink-0"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteTrack(t.id)}
                    className="text-xs px-2 py-1 rounded border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-red-400 transition-colors shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={openNewTrack}
                className="w-full px-4 py-2.5 text-sm text-[var(--color-stage-accent-light)] hover:bg-[var(--color-stage-accent)]/10 transition-colors text-left"
              >
                + Add track
              </button>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl overflow-hidden border border-[var(--color-stage-border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-stage-surface)] text-[var(--color-stage-muted)] uppercase text-xs tracking-wider">
              <th className="text-left px-4 py-3">Character</th>
              <th className="text-right px-4 py-3">Lines</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((char, i) => {
              const isActive = charHighlight?.char === char
              const clickable = sceneMode !== 'all'
              return (
                <tr
                  key={char}
                  onClick={clickable ? () => toggleChip(char, sceneMode === '' ? '__all__' : sceneMode) : undefined}
                  className={`border-t border-[var(--color-stage-border)] transition-colors ${
                    i % 2 === 0 ? 'bg-[var(--color-stage-bg)]' : 'bg-[var(--color-stage-surface)]'
                  } ${clickable ? 'cursor-pointer hover:bg-[var(--color-stage-accent)]/10' : ''}`}
                >
                  <td className="px-4 py-2.5">
                    {sceneMode === 'all' ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-[var(--color-stage-text)] shrink-0">{char}</span>
                        <select
                          value={charHighlight?.char === char ? (charHighlight.sceneId ?? '') : ''}
                          onChange={(e) => {
                            if (e.target.value) setCharHighlight({ char, sceneId: e.target.value })
                            else setCharHighlight(null)
                          }}
                          className="w-28 shrink-0 text-xs bg-[var(--color-stage-bg)] border border-[var(--color-stage-border)] rounded-md px-2 py-1 text-[var(--color-stage-text)] focus:outline-none focus:border-[var(--color-stage-accent)]"
                        >
                          <option value="">—</option>
                          {script.scenes.filter((s) => s.characters.includes(char)).map((s) => (
                            <option key={s.id} value={s.id}>{s.title}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <span className={`font-medium transition-colors ${
                        isActive ? 'text-[var(--color-stage-accent-light)]' : 'text-[var(--color-stage-text)]'
                      }`}>
                        {char}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-stage-muted)] align-top">
                    {lineCounts[char] ?? 0}
                  </td>
                </tr>
              )
            })}
            {/* Track rows */}
            {tracks.map(t => {
              const trackLineCount = t.characters.reduce((sum, c) => sum + (lineCounts[c] ?? 0), 0)
              return (
                <tr key={t.id} className="border-t border-[var(--color-stage-border)] bg-[var(--color-stage-surface)]/50">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <IconTrack className="text-xs text-[var(--color-stage-accent-light)] shrink-0" />
                      <span className="font-medium text-[var(--color-stage-accent-light)]">{t.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--color-stage-muted)]">{trackLineCount}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {panelScene && charHighlight && (
        <div ref={panelRef} className="rounded-xl border border-[var(--color-stage-accent)]/40 bg-[var(--color-stage-surface)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-stage-border)] sticky top-0 bg-[var(--color-stage-surface)]">
            <div className="text-sm min-w-0 mr-2">
              <span className="font-semibold text-[var(--color-stage-accent-light)]">{charHighlight.char}</span>
              <span className="text-[var(--color-stage-muted)]"> in </span>
              <span className="text-[var(--color-stage-gold)]">{panelScene.title}</span>
            </div>
            {highlightedGroupCount > 1 && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setCharHighlightGroupIdx(Math.max(0, firstVisibleIdx - 1))}
                  disabled={firstVisibleIdx === 0}
                  className="w-7 h-7 flex items-center justify-center rounded text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] disabled:opacity-30 transition-colors"
                >
                  ‹
                </button>
                <span className="text-xs text-[var(--color-stage-muted)] tabular-nums">
                  {firstVisibleIdx + 1}/{highlightedGroupCount}
                </span>
                <button
                  onClick={() => setCharHighlightGroupIdx(Math.min(highlightedGroupCount - 1, lastVisibleIdx + 1))}
                  disabled={lastVisibleIdx === highlightedGroupCount - 1}
                  className="w-7 h-7 flex items-center justify-center rounded text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] disabled:opacity-30 transition-colors"
                >
                  ›
                </button>
              </div>
            )}
            <button
              onClick={() => setCharHighlight(null)}
              className="text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] text-sm px-1 shrink-0"
            >
              ✕
            </button>
          </div>
          <div ref={panelScrollRef} className="px-4 py-3 space-y-0.5 max-h-[28rem] overflow-y-auto">
            {panelGroups.map((group, idx) => (
              <SceneLineGroup key={idx} group={group} highlightChar={charHighlight.char} highlightStyle={highlightStyle} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SceneLineGroup({
  group,
  highlightChar,
  highlightStyle,
}: {
  group: LineGroup
  highlightChar: string
  highlightStyle: { background: string; color: string }
}) {
  if (group.type === 'heading') {
    return (
      <div className="py-2 text-center text-[var(--color-stage-gold)] font-semibold text-xs uppercase tracking-widest">
        {group.lines[0].text}
      </div>
    )
  }
  if (group.type === 'direction') {
    return (
      <div className="text-xs italic text-[var(--color-stage-muted)] px-2 py-0.5">
        {group.lines[0].text}
      </div>
    )
  }

  const isHighlighted = group.character === highlightChar

  return (
    <div className="rounded px-2 py-1.5" data-char-highlight={isHighlighted ? '' : undefined}>
      <span className={`block text-[10px] font-bold uppercase tracking-wider mb-0.5 ${
        isHighlighted ? 'text-[var(--color-stage-accent-light)]' : 'text-[var(--color-stage-gold)]'
      }`}>
        {group.character}
      </span>
      {group.lines.map((line, i) => (
        <span
          key={i}
          className="block text-sm"
          style={isHighlighted
            ? { ...highlightStyle, borderRadius: '3px', padding: '1px 3px', marginBottom: '2px', display: 'inline-block' }
            : {}}
        >
          {line.text}
        </span>
      ))}
    </div>
  )
}
