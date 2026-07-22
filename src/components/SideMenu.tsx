import { useRef, useState, useEffect } from 'react'
import { IconDismiss, IconChevronUp, IconChevronDown, IconCheckmark, IconImport } from './Icons'
import { useAppStore } from '../store/useAppStore'
import { parseScript } from '../utils/scriptParser'
import { extractPdfText } from '../utils/pdfExtract'
import { parseImportFile, countRecordingConflicts, countTrackConflicts, importBundle } from '../utils/exportImport'
import { Notes } from './Notes'
import type { Script } from '../types'

interface ExampleMeta { name: string; file: string; description: string }

interface Props { open: boolean; onClose: () => void }

export function SideMenu({ open, onClose }: Props) {
  const { scripts, notes, addScript, removeScript, selectScript, updateScript } = useAppStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const importBundleRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [importState, setImportState] = useState<{
    bundle: Awaited<ReturnType<typeof parseImportFile>>
    recConflicts: number
    trackConflicts: number
  } | null>(null)
  const [keepRecordings, setKeepRecordings] = useState(true)
  const [keepTracks, setKeepTracks] = useState(true)
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
      const recConflicts = await countRecordingConflicts(bundle)
      const trackConflicts = countTrackConflicts(bundle, scripts)
      setKeepRecordings(true)
      setKeepTracks(true)
      setImportState({ bundle, recConflicts, trackConflicts })
      setImportError(null)
    } catch {
      setImportError('Invalid file — please choose a CueLine export (.json)')
    }
  }

  async function confirmImport() {
    if (!importState) return
    setImporting(true)
    try {
      await importBundle(importState.bundle, keepRecordings, keepTracks, addScript, updateScript, scripts)
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
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      <div className={`fixed inset-y-0 left-0 z-50 w-80 max-w-full bg-[var(--color-stage-surface)] border-r border-[var(--color-stage-border)] flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : '-translate-x-full'}`}>

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
                  className="w-full relative flex items-center justify-center py-2 rounded-xl text-sm font-medium border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] hover:border-[var(--color-stage-accent-light)] transition-colors px-4"
                >
                  <span>Examples</span>
                  <span className="absolute right-4">{examplesOpen ? <IconChevronUp /> : <IconChevronDown />}</span>
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
              <div className="mt-2 rounded-lg border border-[var(--color-stage-border)] bg-[var(--color-stage-bg)] px-3 py-3 space-y-4 text-xs text-[var(--color-stage-muted)]">
                <p className="cueline-title text-lg">CueLine</p>
                <p>Learn your lines for a play by running through your script with all other parts read aloud.</p>

                <div className="space-y-1.5">
                  <p className="font-semibold text-[var(--color-stage-text)]">Loading a script (Home tab)</p>
                  <p>Tap <span className="text-[var(--color-stage-accent-light)]">Load</span> in this menu to open a <span className="text-[var(--color-stage-accent-light)]">.txt</span> or <span className="text-[var(--color-stage-accent-light)]">.pdf</span> file. Multiple scripts can be loaded at once. Scripts are listed on the <span className="text-[var(--color-stage-accent-light)]">Home</span> tab where you can select, rename, edit, export, or delete them.</p>
                  <p>Use <span className="text-[var(--color-stage-accent-light)]">Import</span> to restore a previously exported CueLine bundle (scripts, recordings, and tracks), or <span className="text-[var(--color-stage-accent-light)]">Examples</span> to try a built-in script.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Edit</span> (pencil icon on a script) opens a line-by-line editor — change a line's text, character, or type, search the script, and bulk-reassign lines.</p>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-[var(--color-stage-text)]">Script tab</p>
                  <p>See every character with a line count, or switch to the scene breakdown to see characters per scene. Tap a character (or a <span className="text-[var(--color-stage-accent-light)]">track</span> — a named group of characters, e.g. for doubled-up roles) to browse their lines scene by scene, with their dialogue highlighted. Tap a scene to jump straight into a run-through of it.</p>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-[var(--color-stage-text)]">Record tab</p>
                  <p>Pre-record lines for other characters in your own voice (or someone else's). Recordings play back during the run-through instead of text-to-speech, giving each character a distinct, human voice. Tap the microphone icon next to any line to record, re-record, or delete.</p>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-[var(--color-stage-text)]">Run through tab</p>
                  <p>Choose a scene and your character, then tap <span className="text-[var(--color-stage-accent-light)]">Start run through</span>. All other characters are read aloud (recordings or TTS). Your lines are highlighted — speak them yourself.</p>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-[var(--color-stage-text)]">During a run-through</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Line modes</span> — set in ⚙️: <span className="text-[var(--color-stage-accent-light)]">Silence</span> leaves a timed gap; <span className="text-[var(--color-stage-accent-light)]">Read</span> speaks your line; <span className="text-[var(--color-stage-accent-light)]">Gap before / Gap after</span> combines both in one order; <span className="text-[var(--color-stage-accent-light)]">Gap · read · gap</span> and <span className="text-[var(--color-stage-accent-light)]">Read · gap · read</span> add a repeat. The gap length matches the estimated speaking time for the line (or the actual recording duration if one exists), plus the minimum gap set in Settings.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Progress bar</span> — a bar fills across your line as the gap counts down.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Clip markers</span> — two red lines define a practice region. Drag them to reposition. Playback always starts from the clip start. Long-press a line to set the clip start or end there.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Repeat</span> — loops the clip automatically when it ends.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Condensed mode</span> — when there are more lines between your cues than the threshold you set, the middle is skipped: a sound plays, the number of skipped lines is announced, and only the cue line immediately before your next line is read.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Record in rehearsal</span> — tap the ● button next to any line to record it on the spot without leaving the run-through.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Show / hide lines</span> — your lines can be blurred until you tap to reveal them, to test recall without prompts.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Search</span> — tap the magnifier to find any word or phrase in the script and jump to it.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Accuracy</span> — if enabled, CueLine listens to your lines, scores how closely they match the script, highlights the differences, and warns you if you drop below your chosen threshold. A summary appears at the end of the run.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Hands-free</span> — with hands-free mode on, say <span className="text-[var(--color-stage-accent-light)]">"start"</span> to begin. During playback say <span className="text-[var(--color-stage-accent-light)]">"stop"</span>, <span className="text-[var(--color-stage-accent-light)]">"back"</span>, <span className="text-[var(--color-stage-accent-light)]">"skip"</span>, <span className="text-[var(--color-stage-accent-light)]">"repeat"</span>, or <span className="text-[var(--color-stage-accent-light)]">"loop"</span> to control playback without touching the screen.</p>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-[var(--color-stage-text)]">Settings ⚙️</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Line mode</span> — silence / read / gap before / gap after / gap·read·gap / read·gap·read.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Minimum gap</span> — a floor added to every gap (default 1s) so short lines still leave a usable pause.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Speech rate</span> — speed up or slow down TTS.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Voice</span> — choose the TTS voice used for other characters.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Stage directions</span> — choose whether directions are read aloud.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Signals</span> — cue ping before your lines; completion sound at scene end.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Appearance</span> — theme, script font size, and highlighter colour.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Voice commands</span> — customise the trigger words for each hands-free command.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Voice calibration</span> — read a sample phrase at your natural pace so gap timing matches how you speak.</p>
                  <p><span className="text-[var(--color-stage-accent-light)]">Microphone</span> — test your mic input.</p>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-[var(--color-stage-text)]">Your data</p>
                  <p>Scripts, recordings, notes, and settings stay on this device — nothing is uploaded to a server, including PDF text extraction. Use Export/Import to back up a script or move it to another device.</p>
                </div>

                <div className="space-y-1.5">
                  <p className="font-semibold text-[var(--color-stage-text)]">iOS notes</p>
                  <p>Standard voices (e.g. Daniel) are available via the Web Speech API. Eloquence voices shown in iOS Settings are not accessible to browser apps. The first tap of Play in a session unlocks audio — this is a browser requirement.</p>
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
              {Object.keys(importState.bundle.recordings).filter(k => !k.endsWith(':dur')).length} recording{Object.keys(importState.bundle.recordings).filter(k => !k.endsWith(':dur')).length !== 1 ? 's' : ''}
            </p>

            {importState.recConflicts > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm text-amber-400">
                  {importState.recConflicts} recording{importState.recConflicts !== 1 ? 's' : ''} already exist locally.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setKeepRecordings(true)} disabled={importing}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${keepRecordings ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/10 text-[var(--color-stage-accent-light)]' : 'border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)]'}`}>
                    Keep mine
                  </button>
                  <button onClick={() => setKeepRecordings(false)} disabled={importing}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${!keepRecordings ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/10 text-[var(--color-stage-accent-light)]' : 'border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)]'}`}>
                    Use imported
                  </button>
                </div>
              </div>
            )}

            {importState.trackConflicts > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm text-amber-400">
                  {importState.trackConflicts} script{importState.trackConflicts !== 1 ? 's have' : ' has'} existing tracks.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setKeepTracks(true)} disabled={importing}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${keepTracks ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/10 text-[var(--color-stage-accent-light)]' : 'border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)]'}`}>
                    Keep mine
                  </button>
                  <button onClick={() => setKeepTracks(false)} disabled={importing}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${!keepTracks ? 'border-[var(--color-stage-accent)] bg-[var(--color-stage-accent)]/10 text-[var(--color-stage-accent-light)]' : 'border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)]'}`}>
                    Use imported
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button onClick={confirmImport} disabled={importing}
                className="py-2 rounded-lg text-sm font-medium bg-[var(--color-stage-accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
                {importing ? 'Importing…' : 'Import'}
              </button>
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
