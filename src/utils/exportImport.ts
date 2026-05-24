import { getAllRecordings, setRecordingRaw } from './recordingStore'
import type { Script } from '../types'

export interface ExportBundle {
  version: 1
  exportedAt: number
  scripts: Script[]
  recordings: Record<string, string>  // "scriptId:lineIdx" → base64 audio
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function base64ToBlob(b64: string): Blob {
  const bytes = atob(b64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: 'audio/webm' })
}

export async function buildExportBundle(
  scripts: Script[],
  onProgress?: (done: number, total: number) => void,
): Promise<ExportBundle> {
  const allRecs = await getAllRecordings()
  const scriptIds = new Set(scripts.map(s => s.id))
  const entries = Array.from(allRecs.entries()).filter(
    ([k, v]) => scriptIds.has(k.split(':')[0]) && !k.endsWith(':dur') && v instanceof Blob,
  )
  const total = entries.length
  onProgress?.(0, total)
  const recordings: Record<string, string> = {}
  for (let i = 0; i < entries.length; i++) {
    const [k, blob] = entries[i]
    recordings[k] = await blobToBase64(blob)
    onProgress?.(i + 1, total)
  }
  return { version: 1, exportedAt: Date.now(), scripts, recordings }
}

export function downloadBundle(bundle: ExportBundle, scriptName?: string): void {
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const date = new Date().toISOString().split('T')[0]
  const safeName = scriptName
    ? scriptName.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
    : 'cueline'
  a.download = `${safeName}-${date}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function parseImportFile(file: File): Promise<ExportBundle> {
  const text = await file.text()
  const data = JSON.parse(text) as ExportBundle
  if (data.version !== 1 || !Array.isArray(data.scripts)) throw new Error('Invalid file')
  return data
}

export async function countRecordingConflicts(bundle: ExportBundle): Promise<number> {
  const existing = await getAllRecordings()
  return Object.keys(bundle.recordings).filter(k => existing.has(k)).length
}

export async function importBundle(
  bundle: ExportBundle,
  keepExistingRecordings: boolean,
  addScript: (s: Script) => void,
  updateScript: (s: Script) => void,
  existingScripts: Script[],
): Promise<{ scripts: number; recordings: number }> {
  const existingIds = new Set(existingScripts.map(s => s.id))
  for (const script of bundle.scripts) {
    if (existingIds.has(script.id)) updateScript(script)
    else addScript(script)
  }

  const existingRecs = keepExistingRecordings ? await getAllRecordings() : new Map<string, Blob>()
  let recCount = 0
  for (const [k, b64] of Object.entries(bundle.recordings)) {
    if (keepExistingRecordings && existingRecs.has(k)) continue
    await setRecordingRaw(k, base64ToBlob(b64))
    recCount++
  }

  return { scripts: bundle.scripts.length, recordings: recCount }
}
