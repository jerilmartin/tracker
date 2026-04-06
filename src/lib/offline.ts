
export interface QueuedPhoto {
  id: string
  userId: string
  sessionId: string
  file: Blob
  fileName: string
  timestamp: number
  location?: { lat: number, lng: number, accuracy?: number }
}

const DB_NAME = 'fieldTrackerOffline'
const STORE_NAME = 'photoQueue'

export const getDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export const queuePhoto = async (photo: QueuedPhoto) => {
  const db = await getDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.add(photo)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export const getQueuedPhotos = async (): Promise<QueuedPhoto[]> => {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export const removeQueuedPhoto = async (id: string) => {
  const db = await getDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}
