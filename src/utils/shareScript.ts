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
