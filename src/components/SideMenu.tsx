import { useRef, useState, useEffect } from 'react'
import { IconDismiss, IconChevronUp, IconChevronDown, IconCheckmark, IconImport, IconDownload, IconShare } from './Icons'
import { useAppStore } from '../store/useAppStore'
import { parseScript } from '../utils/scriptParser'
import { extractPdfText } from '../utils/pdfExtract'
import { parseImportFile, countRecordingConflicts, countTrackConflicts, importBundle } from '../utils/exportImport'
import { listSharedScripts, downloadScriptFromLibrary, copyLinkAsAnchor } from '../utils/shareScript'
import { getAllRecordings, setRecordingRaw } from '../utils/recordingStore'
import { OrgPinPrompt } from './OrgPinPrompt'
import type { Script } from '../types'
import type { SharedLibraryEntry } from '../utils/shareScript'

interface ExampleMeta { name: string; file: string; description: string }

interface Props { open: boolean; onClose: () => void }

function nextVersionedName(baseName: string, existingNames: string[]): string {
  if (!existingNames.includes(baseName)) return baseName
  let n = 2
  while (existingNames.includes(`${baseName} (${n})`)) n++
  return `${baseName} (${n})`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function SideMenu({ open, onClose }: Props) {
  const { scripts, addScript, removeScript, selectScript, updateScript, libraryOrg, libraryPin, setLibraryCredentials } = useAppStore()
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
  const [aboutOpen, setAboutOpen] = useState(false)

  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryEntries, setLibraryEntries] = useState<SharedLibraryEntry[] | null>(null)
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [pendingDownload, setPendingDownload] = useState<{
    script: Script
    recordings: Map<string, Blob>
    conflictWith: Script
  } | null>(null)
  const [appShareCopied, setAppShareCopied] = useState(false)
  const [showOrgPinPrompt, setShowOrgPinPrompt] = useState(false)
  const [downloadedName, setDownloadedName] = useState<string | null>(null)

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

  async function loadLibraryEntries(org: string) {
    setLibraryLoading(true)
    setLibraryError(null)
    try {
      setLibraryEntries(await listSharedScripts(org))
    } catch (err) {
      console.error('Failed to list shared library', err)
      setLibraryError('Could not load the shared library')
    } finally {
      setLibraryLoading(false)
    }
  }

  async function toggleLibrary() {
    if (!libraryOpen && (!libraryOrg || !libraryPin)) {
      setShowOrgPinPrompt(true)
      return
    }
    const next = !libraryOpen
    setLibraryOpen(next)
    if (next && libraryEntries === null) {
      await loadLibraryEntries(libraryOrg)
    }
  }

  // Writes a downloaded script's recordings, skipping any line that already has
  // a recording on the target script — downloaded recordings never clobber the
  // user's own takes.
  async function importRecordings(scriptId: string, recordings: Map<string, Blob>) {
    if (recordings.size === 0) return
    const existing = await getAllRecordings()
    for (const [lineIdx, blob] of recordings) {
      const key = `${scriptId}:${lineIdx}`
      if (existing.has(key)) continue
      await setRecordingRaw(key, blob)
    }
  }

  async function finalizeDownload(script: Script, recordings: Map<string, Blob>, overwriteId: string | null) {
    const targetId = overwriteId ?? crypto.randomUUID()
    const finalScript = { ...script, id: targetId }
    if (overwriteId) {
      const existing = scripts.find((s) => s.id === overwriteId)
      updateScript({ ...finalScript, tracks: existing?.tracks?.length ? existing.tracks : finalScript.tracks })
    } else {
      addScript(finalScript)
    }
    await importRecordings(targetId, recordings)
    selectScript(targetId)
    setDownloadedName(finalScript.name)
    setTimeout(() => { setDownloadedName(null); onClose() }, 900)
  }

  async function handleDownload(entry: SharedLibraryEntry) {
    setDownloadingId(entry.id)
    setLibraryError(null)
    try {
      const { script, recordings } = await downloadScriptFromLibrary(entry.id, libraryOrg, libraryPin)
      const conflictWith = scripts.find((s) => s.name === script.name)
      if (conflictWith) {
        setPendingDownload({ script, recordings, conflictWith })
      } else {
        await finalizeDownload(script, recordings, null)
      }
    } catch (err) {
      console.error('Download failed', err)
      setLibraryError('Could not download that script')
    } finally {
      setDownloadingId(null)
    }
  }

  async function resolvePendingDownload(mode: 'overwrite' | 'keep') {
    if (!pendingDownload) return
    const { script, recordings, conflictWith } = pendingDownload
    setPendingDownload(null)
    if (mode === 'overwrite') {
      await finalizeDownload(script, recordings, conflictWith.id)
    } else {
      const versionedName = nextVersionedName(script.name, scripts.map((s) => s.name))
      await finalizeDownload({ ...script, name: versionedName }, recordings, null)
    }
  }

  async function handleShareApp() {
    const url = `${window.location.origin}${import.meta.env.BASE_URL}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'CueLine', text: 'Learn your lines with CueLine', url })
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') console.error('Share failed', err)
      }
    } else if (typeof navigator.clipboard?.writeText === 'function') {
      await copyLinkAsAnchor(url, 'CueLine — learn your lines')
      setAppShareCopied(true)
      setTimeout(() => setAppShareCopied(false), 2000)
    } else {
      window.prompt('Copy this link to share:', url)
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
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] hover:border-[var(--color-stage-accent-light)] disabled:opacity-40 transition-colors"
            >
              {importing && !loadingExample ? 'Loading…' : 'Load from PDF'}
            </button>
            <input ref={inputRef} type="file" accept=".txt,.pdf" multiple className="hidden"
              onChange={(e) => { void handleFiles(e.target.files) }} />

            {/* Import */}
            <button
              onClick={() => importBundleRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] hover:border-[var(--color-stage-accent-light)] transition-colors"
            >
              <IconImport /> Import from .json file
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

            {/* Shared library */}
            <button
              onClick={() => void toggleLibrary()}
              className="w-full relative flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] hover:border-[var(--color-stage-accent-light)] transition-colors px-4"
            >
              <IconDownload /> <span>Download from shared library</span>
              <span className="absolute right-4">{libraryOpen ? <IconChevronUp /> : <IconChevronDown />}</span>
            </button>
            {libraryOrg && (
              <p className="text-xs text-[var(--color-stage-muted)] text-center">
                Organisation: <span className="text-[var(--color-stage-text)]">{libraryOrg}</span>{' '}
                <button onClick={() => setShowOrgPinPrompt(true)} className="text-[var(--color-stage-accent-light)] hover:text-white transition-colors">Change</button>
              </p>
            )}
            {downloadedName && <p className="text-xs text-[var(--color-stage-accent-light)] text-center py-1">Downloaded "{downloadedName}"</p>}
            {libraryOpen && (
              <div className="space-y-2">
                {libraryLoading && <p className="text-xs text-[var(--color-stage-muted)] text-center py-2">Loading…</p>}
                {libraryError && <p className="text-xs text-red-400 text-center py-1">{libraryError}</p>}
                {!libraryLoading && libraryEntries?.length === 0 && (
                  <p className="text-xs text-[var(--color-stage-muted)] text-center py-2">Nothing shared yet</p>
                )}
                {libraryEntries?.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between rounded-lg border border-[var(--color-stage-border)] bg-[var(--color-stage-bg)] px-3 py-2.5 gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-stage-text)] truncate">{entry.name}</p>
                      <p className="text-xs text-[var(--color-stage-muted)]">{formatDate(entry.createdAt)}</p>
                    </div>
                    <button
                      disabled={downloadingId === entry.id}
                      onClick={() => void handleDownload(entry)}
                      className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-[var(--color-stage-accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                    >
                      {downloadingId === entry.id ? '⏳' : 'Download'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Share the app */}
            <button
              onClick={() => void handleShareApp()}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium border border-[var(--color-stage-border)] text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] hover:border-[var(--color-stage-accent-light)] transition-colors"
            >
              <IconShare /> <span>{appShareCopied ? 'Link copied!' : 'Share CueLine app'}</span>
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
                  <p>Tap <span className="text-[var(--color-stage-accent-light)]">Load from PDF</span> in this menu to open a <span className="text-[var(--color-stage-accent-light)]">.txt</span> or <span className="text-[var(--color-stage-accent-light)]">.pdf</span> file. Multiple scripts can be loaded at once. Scripts are listed on the <span className="text-[var(--color-stage-accent-light)]">Home</span> tab where you can select, rename, edit, export, or delete them.</p>
                  <p>Use <span className="text-[var(--color-stage-accent-light)]">Import from .json file</span> to restore a previously exported CueLine bundle (scripts, recordings, and tracks), or <span className="text-[var(--color-stage-accent-light)]">Examples</span> to try a built-in script.</p>
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
                  <p><span className="text-[var(--color-stage-accent-light)]">Line modes</span> — set in ⚙️. The gap length matches the estimated speaking time for the line (or the actual recording duration if one exists), plus the minimum gap set in Settings.</p>
                  <ul className="list-disc pl-4 space-y-1 marker:text-[var(--color-stage-border)]">
                    <li><span className="text-[var(--color-stage-accent-light)]">Silence</span> — a timed gap plays while you say the line from memory.</li>
                    <li><span className="text-[var(--color-stage-accent-light)]">Read</span> — your line is read aloud for you.</li>
                    <li><span className="text-[var(--color-stage-accent-light)]">Gap before</span> — wait, then hear the line.</li>
                    <li><span className="text-[var(--color-stage-accent-light)]">Gap after</span> — hear the line, then a gap to repeat it.</li>
                    <li><span className="text-[var(--color-stage-accent-light)]">Gap · read · gap</span> — wait, hear it, wait again.</li>
                    <li><span className="text-[var(--color-stage-accent-light)]">Read · gap · read</span> — hear it, practice, hear it again.</li>
                  </ul>
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
                  <p>Scripts, recordings, and settings stay on this device — nothing is uploaded to a server, including PDF text extraction. Use Export/Import to back up a script or move it to another device.</p>
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

      {pendingDownload && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4">
          <div className="bg-[var(--color-stage-surface)] border border-[var(--color-stage-border)] rounded-xl p-5 w-full max-w-sm space-y-4">
            <p className="font-semibold text-[var(--color-stage-text)]">Already have this script</p>
            <p className="text-sm text-[var(--color-stage-muted)]">
              You already have a script named "{pendingDownload.conflictWith.name}". Overwrite it, or keep both?
            </p>
            <div className="flex flex-col gap-2">
              <button onClick={() => void resolvePendingDownload('overwrite')}
                className="py-2 rounded-lg text-sm font-medium bg-[var(--color-stage-accent)] text-white hover:opacity-90 transition-opacity">
                Overwrite
              </button>
              <button onClick={() => void resolvePendingDownload('keep')}
                className="py-2 rounded-lg text-sm font-medium border border-[var(--color-stage-border)] text-[var(--color-stage-text)] hover:border-[var(--color-stage-accent-light)] transition-colors">
                Keep both
              </button>
              <button onClick={() => setPendingDownload(null)}
                className="py-2 rounded-lg text-sm font-medium text-[var(--color-stage-muted)] hover:text-[var(--color-stage-text)] transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showOrgPinPrompt && (
        <OrgPinPrompt
          initialOrg={libraryOrg}
          onCancel={() => setShowOrgPinPrompt(false)}
          onSubmit={(org, pin) => {
            setLibraryCredentials(org, pin)
            setShowOrgPinPrompt(false)
            setLibraryEntries(null)
            setLibraryOpen(true)
            void loadLibraryEntries(org)
          }}
        />
      )}
    </>
  )
}
