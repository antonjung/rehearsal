const DB_NAME = 'rehearsal-tts'
const STORE = 'audio'
const VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => { dbPromise = null; reject(req.error) }
    })
  }
  return dbPromise
}

async function cacheKey(text: string, voice: string, rate: number): Promise<string> {
  const raw = `${voice}||${rate}||${text}`
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function getAudio(text: string, voice: string, rate: number): Promise<ArrayBuffer | null> {
  try {
    const key = await cacheKey(text, voice, rate)
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as ArrayBuffer) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function putAudio(text: string, voice: string, rate: number, data: ArrayBuffer): Promise<void> {
  try {
    const key = await cacheKey(text, voice, rate)
    const db = await getDb()
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(data, key)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    // cache write failure is non-fatal
  }
}
