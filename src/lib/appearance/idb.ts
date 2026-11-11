// ---------------------------------------------------------------------------
// IndexedDB store for the user's uploaded background image.
//
// Uploaded pictures are blobs — far too big for localStorage and not something
// to sync through the settings JSON. They live on this device only, keyed per
// account; the *choice* to use them syncs normally via appearance settings,
// and other devices gracefully fall back to no image.
// ---------------------------------------------------------------------------

const DB_NAME = 'momentum-appearance'
const DB_VERSION = 1
const STORE = 'images'

export interface StoredImage {
  blob: Blob
  type: string
  name: string
  savedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      }),
  )
}

/** The per-user slot key for the custom background image. */
export function imageKey(userId: string | null | undefined): string {
  return `custom-background:${userId ?? 'local'}`
}

export async function saveImage(userId: string, blob: Blob, name: string): Promise<void> {
  const record: StoredImage = { blob, type: blob.type, name, savedAt: Date.now() }
  await tx('readwrite', (s) => s.put(record, imageKey(userId)))
}

export async function loadImage(userId: string | null): Promise<StoredImage | null> {
  try {
    const rec = await tx<StoredImage | undefined>('readonly', (s) => s.get(imageKey(userId)))
    return rec && rec.blob instanceof Blob ? rec : null
  } catch {
    return null
  }
}

export async function deleteImage(userId: string | null): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(imageKey(userId)))
  } catch {
    /* nothing to remove — fine */
  }
}
