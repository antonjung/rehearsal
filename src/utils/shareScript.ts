import { collection, addDoc, doc, getDoc, getDocs, setDoc, query, orderBy, limit } from 'firebase/firestore/lite'
import { db } from './firebaseClient'
import { getAllRecordings } from './recordingStore'
import type { Script } from '../types'

interface SharedScriptPayload {
  v: 1
  script: Script
}

const hasCompression = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'

function toBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function readAll(stream: ReadableStream<Uint8Array<ArrayBuffer>>): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.length }
  return out
}

async function gzip(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  writer.write(data)
  writer.close()
  return readAll(cs.readable)
}

async function gunzip(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  writer.write(data)
  writer.close()
  return readAll(ds.readable)
}

// --- Shared library (Firestore) -------------------------------------------
// Uploaded scripts are gzip-compressed then AES-GCM encrypted with a single
// key built into the app (not stored in Firestore) — not readable directly by
// anyone browsing/scraping the database without the app, but any copy of the
// app can decrypt any listed entry. This trades per-recipient secrecy for a
// browsable "what's available" list, which a per-link unique key can't support.
const APP_SHARE_KEY_B64 = 'P789ZTh1b5xoKkdmlLUsVbVb6j-Bbt0lXt7WWqVwZMs'

let cachedKey: Promise<CryptoKey> | null = null
function getAppShareKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    cachedKey = crypto.subtle.importKey('raw', fromBase64Url(APP_SHARE_KEY_B64), 'AES-GCM', false, ['encrypt', 'decrypt'])
  }
  return cachedKey
}

async function encryptBytes(data: Uint8Array<ArrayBuffer>, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data))
  return { iv, ciphertext }
}

async function decryptBytes(ciphertext: Uint8Array<ArrayBuffer>, iv: Uint8Array<ArrayBuffer>, key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext))
}

interface SharedScriptDoc {
  name: string
  ciphertext: string
  iv: string
  v: 1
  compressed: boolean
  createdAt: number
}

interface SharedRecordingDoc {
  ciphertext: string
  iv: string
}

// A recording's encrypted+base64 form must stay well under Firestore's 1MiB
// per-document cap; anything larger is skipped rather than failing the whole upload.
const MAX_RECORDING_DOC_CHARS = 900_000

async function uploadRecordings(scriptId: string, sharedId: string, key: CryptoKey): Promise<void> {
  const allRecs = await getAllRecordings()
  const entries = Array.from(allRecs.entries()).filter(
    ([k, v]) => k.startsWith(`${scriptId}:`) && !k.endsWith(':dur') && v instanceof Blob,
  )
  for (const [k, blob] of entries) {
    const lineIdx = k.slice(scriptId.length + 1)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const { iv, ciphertext } = await encryptBytes(bytes, key)
    const ciphertextB64 = toBase64Url(ciphertext)
    if (ciphertextB64.length > MAX_RECORDING_DOC_CHARS) {
      console.warn(`Skipping recording for line ${lineIdx} — too large to upload (${ciphertextB64.length} chars)`)
      continue
    }
    await setDoc(doc(db, 'sharedScripts', sharedId, 'recordings', lineIdx), {
      ciphertext: ciphertextB64,
      iv: toBase64Url(iv),
    } satisfies SharedRecordingDoc)
  }
}

async function downloadRecordings(sharedId: string, key: CryptoKey): Promise<Map<string, Blob>> {
  const snap = await getDocs(collection(db, 'sharedScripts', sharedId, 'recordings'))
  const result = new Map<string, Blob>()
  for (const d of snap.docs) {
    const data = d.data() as SharedRecordingDoc
    const ciphertext = fromBase64Url(data.ciphertext)
    const iv = fromBase64Url(data.iv)
    const bytes = await decryptBytes(ciphertext, iv, key)
    result.set(d.id, new Blob([bytes], { type: 'audio/webm' }))
  }
  return result
}

// Encrypts and uploads a script plus its recordings to the shared library.
// Returns the new doc id.
export async function uploadScriptToLibrary(script: Script): Promise<string> {
  const key = await getAppShareKey()
  const json = JSON.stringify({ v: 1, script } satisfies SharedScriptPayload)
  const bytes = new TextEncoder().encode(json)
  const compressed = hasCompression ? await gzip(bytes) : bytes
  const { iv, ciphertext } = await encryptBytes(compressed, key)

  const docRef = await addDoc(collection(db, 'sharedScripts'), {
    name: script.name,
    ciphertext: toBase64Url(ciphertext),
    iv: toBase64Url(iv),
    v: 1,
    compressed: hasCompression,
    createdAt: Date.now(),
  } satisfies SharedScriptDoc)

  await uploadRecordings(script.id, docRef.id, key)

  return docRef.id
}

export interface SharedLibraryEntry {
  id: string
  name: string
  createdAt: number
}

// Lists what's in the shared library, newest first.
export async function listSharedScripts(): Promise<SharedLibraryEntry[]> {
  const q = query(collection(db, 'sharedScripts'), orderBy('createdAt', 'desc'), limit(200))
  const snap = await getDocs(q)
  return snap.docs.map((d) => {
    const data = d.data() as SharedScriptDoc
    return { id: d.id, name: data.name, createdAt: data.createdAt }
  })
}

export interface SharedScriptDownload {
  script: Script
  // Keyed by original line index (as a string), audio/webm blobs.
  recordings: Map<string, Blob>
}

export async function downloadScriptFromLibrary(id: string): Promise<SharedScriptDownload> {
  const key = await getAppShareKey()
  const snap = await getDoc(doc(db, 'sharedScripts', id))
  if (!snap.exists()) throw new Error('This script is no longer available')
  const data = snap.data() as SharedScriptDoc
  if (data.v !== 1) throw new Error('Unsupported shared script version')
  if (data.compressed && !hasCompression) throw new Error('This script needs a newer browser to open')

  const ciphertext = fromBase64Url(data.ciphertext)
  const iv = fromBase64Url(data.iv)
  const plainCompressed = await decryptBytes(ciphertext, iv, key)
  const plain = data.compressed ? await gunzip(plainCompressed) : plainCompressed

  const payload = JSON.parse(new TextDecoder().decode(plain)) as SharedScriptPayload
  if (!payload.script || !Array.isArray(payload.script.lines)) throw new Error('Invalid shared script data')

  const recordings = await downloadRecordings(id, key)
  return { script: payload.script, recordings }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Copies a link to the clipboard as a single HTML anchor (plus a plain-text
// fallback) so pasting into a rich-text target (email, Notes, Slack, docs)
// shows one clickable link with a friendly label instead of a raw URL.
export async function copyLinkAsAnchor(url: string, label: string): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
    try {
      const html = `<a href="${url}">${escapeHtml(label)}</a>`
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([url], { type: 'text/plain' }),
        }),
      ])
      return
    } catch {
      // Some browsers support ClipboardItem but reject multi-type writes — fall back below.
    }
  }
  await navigator.clipboard.writeText(url)
}
