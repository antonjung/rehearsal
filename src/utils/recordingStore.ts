const DB_NAME = 'rehearsal-recordings'
const STORE = 'recs'
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

function key(scriptId: string, lineIdx: number) {
  return `${scriptId}:${lineIdx}`
}

export async function getRecording(scriptId: string, lineIdx: number): Promise<Blob | null> {
  try {
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key(scriptId, lineIdx))
      req.onsuccess = () => resolve((req.result as Blob) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function setRecording(scriptId: string, lineIdx: number, blob: Blob): Promise<void> {
  const db = await getDb()
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, key(scriptId, lineIdx))
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
  // Stamp when this line was (re-)recorded, so voice-track upload can tell
  // whether anything has changed since the last upload.
  await setMeta(`${key(scriptId, lineIdx)}:recordedAt`, Date.now())
}

export async function deleteRecording(scriptId: string, lineIdx: number): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key(scriptId, lineIdx))
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function getAllRecordings(): Promise<Map<string, Blob>> {
  try {
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const map = new Map<string, Blob>()
      const req = db.transaction(STORE).objectStore(STORE).openCursor()
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result
        if (cursor) { map.set(cursor.key as string, cursor.value as Blob); cursor.continue() }
        else resolve(map)
      }
      req.onerror = () => reject(req.error)
    })
  } catch { return new Map() }
}

export async function getRecordingDuration(scriptId: string, lineIdx: number): Promise<number | null> {
  try {
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(`${key(scriptId, lineIdx)}:dur`)
      req.onsuccess = () => resolve(typeof req.result === 'number' ? req.result : null)
      req.onerror = () => reject(req.error)
    })
  } catch { return null }
}

export async function setRecordingDuration(scriptId: string, lineIdx: number, ms: number): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(ms, `${key(scriptId, lineIdx)}:dur`)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function setRecordingRaw(k: string, blob: Blob): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, k)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// --- Generic numeric metadata (timestamps) sharing the same store ----------

async function getMeta(k: string): Promise<number | null> {
  try {
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(k)
      req.onsuccess = () => resolve(typeof req.result === 'number' ? req.result : null)
      req.onerror = () => reject(req.error)
    })
  } catch { return null }
}

async function setMeta(k: string, value: number): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, k)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export function getRecordedAt(scriptId: string, lineIdx: number): Promise<number | null> {
  return getMeta(`${key(scriptId, lineIdx)}:recordedAt`)
}

// Per (script, character) voice-track sync bookkeeping — lets upload skip a
// character with nothing new to send, and download skip a track it already has.
export function getVoiceTrackUploadedAt(scriptId: string, character: string): Promise<number | null> {
  return getMeta(`${scriptId}:${character}:vtUploadedAt`)
}

export function setVoiceTrackUploadedAt(scriptId: string, character: string, ms: number): Promise<void> {
  return setMeta(`${scriptId}:${character}:vtUploadedAt`, ms)
}

export function getVoiceTrackDownloadedAt(scriptId: string, character: string): Promise<number | null> {
  return getMeta(`${scriptId}:${character}:vtDownloadedAt`)
}

export function setVoiceTrackDownloadedAt(scriptId: string, character: string, ms: number): Promise<void> {
  return setMeta(`${scriptId}:${character}:vtDownloadedAt`, ms)
}
