import { collection, addDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore/lite'
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

// Encodes a script (no recordings — those are personal and would bloat the link)
// into a compact, URL-safe string suitable for a share link fragment.
export async function encodeScriptForShare(script: Script): Promise<string> {
  const json = JSON.stringify({ v: 1, script } satisfies SharedScriptPayload)
  const bytes = new TextEncoder().encode(json)
  if (hasCompression) return 'g' + toBase64Url(await gzip(bytes))
  return 'r' + toBase64Url(bytes)
}

export async function decodeSharedScript(encoded: string): Promise<Script> {
  const flag = encoded[0]
  const bytes = fromBase64Url(encoded.slice(1))
  if (flag === 'g' && !hasCompression) throw new Error('This link needs a newer browser to open')
  const raw = flag === 'g' ? await gunzip(bytes) : bytes
  const payload = JSON.parse(new TextDecoder().decode(raw)) as SharedScriptPayload
  if (payload.v !== 1 || !payload.script || !Array.isArray(payload.script.lines)) {
    throw new Error('Invalid shared script data')
  }
  return payload.script
}

export function buildShareUrl(encoded: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}#script=${encoded}`
}

// --- Firebase-backed short links ------------------------------------------
// The script is gzip-compressed then AES-GCM encrypted client-side before it
// ever reaches Firestore, so the stored document is unusable without the key
// — and the key travels only in the URL fragment, never sent to Firebase.

async function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
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
  ciphertext: string
  iv: string
  v: 1
  compressed: boolean
}

interface SharedRecordingDoc {
  ciphertext: string
  iv: string
}

// A recording's encrypted+base64 form must stay well under Firestore's 1MiB
// per-document cap; anything larger is skipped rather than failing the whole share.
const MAX_RECORDING_DOC_CHARS = 900_000

async function uploadRecordingsForShare(scriptId: string, sharedId: string, key: CryptoKey): Promise<void> {
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
      console.warn(`Skipping recording for line ${lineIdx} — too large to share (${ciphertextB64.length} chars)`)
      continue
    }
    await setDoc(doc(db, 'sharedScripts', sharedId, 'recordings', lineIdx), {
      ciphertext: ciphertextB64,
      iv: toBase64Url(iv),
    } satisfies SharedRecordingDoc)
  }
}

async function downloadRecordingsForShare(sharedId: string, key: CryptoKey): Promise<Map<string, Blob>> {
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

// Encrypts and uploads a script plus its recordings, returning a short URL
// fragment (no leading #), e.g. "s=<docId>&k=<base64url key>".
export async function uploadScriptForShare(script: Script): Promise<string> {
  const json = JSON.stringify({ v: 1, script } satisfies SharedScriptPayload)
  const bytes = new TextEncoder().encode(json)
  const compressed = hasCompression ? await gzip(bytes) : bytes
  const key = await generateAesKey()
  const { iv, ciphertext } = await encryptBytes(compressed, key)
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key))

  const docRef = await addDoc(collection(db, 'sharedScripts'), {
    ciphertext: toBase64Url(ciphertext),
    iv: toBase64Url(iv),
    v: 1,
    compressed: hasCompression,
    createdAt: Date.now(),
  })

  await uploadRecordingsForShare(script.id, docRef.id, key)

  return `s=${docRef.id}&k=${toBase64Url(rawKey)}`
}

export interface SharedScriptDownload {
  script: Script
  // Keyed by original line index (as a string), audio/webm blobs.
  recordings: Map<string, Blob>
}

export async function downloadSharedScriptFromFirebase(id: string, keyB64: string): Promise<SharedScriptDownload> {
  const snap = await getDoc(doc(db, 'sharedScripts', id))
  if (!snap.exists()) throw new Error('This shared script link has expired or is invalid')
  const data = snap.data() as SharedScriptDoc
  if (data.v !== 1) throw new Error('Unsupported shared script version')
  if (data.compressed && !hasCompression) throw new Error('This link needs a newer browser to open')

  const rawKey = fromBase64Url(keyB64)
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt'])
  const ciphertext = fromBase64Url(data.ciphertext)
  const iv = fromBase64Url(data.iv)
  const plainCompressed = await decryptBytes(ciphertext, iv, key)
  const plain = data.compressed ? await gunzip(plainCompressed) : plainCompressed

  const payload = JSON.parse(new TextDecoder().decode(plain)) as SharedScriptPayload
  if (!payload.script || !Array.isArray(payload.script.lines)) throw new Error('Invalid shared script data')

  const recordings = await downloadRecordingsForShare(id, key)
  return { script: payload.script, recordings }
}

export function buildFirebaseShareUrl(fragment: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}#${fragment}`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Copies the link to the clipboard as a single HTML anchor (plus a plain-text
// fallback) so pasting into a rich-text target (email, Notes, Slack, docs)
// shows one clickable link with a friendly label instead of the raw encoded
// URL as a wall of text.
export async function copyShareLinkAsAnchor(url: string, label: string): Promise<void> {
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
