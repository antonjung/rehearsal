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
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, key(scriptId, lineIdx))
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function deleteRecording(scriptId: string, lineIdx: number): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key(scriptId, lineIdx))
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}
