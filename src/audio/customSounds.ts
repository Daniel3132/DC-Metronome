// User-uploaded sounds, persisted in IndexedDB (database 'dcmetronome', object store 'sounds').

import { MAX_CUSTOM_SOUND_BYTES, MAX_CUSTOM_SOUND_SECONDS } from '../core/constants'
import { makeId } from '../core/settings'

export interface CustomSoundMeta {
  /** Bare id; the SoundId used in settings is `custom:${id}`. */
  id: string
  name: string
  /** File size in bytes. */
  size: number
  /** Decoded duration in seconds. */
  duration: number
  createdAt: number
}

interface StoredSound extends CustomSoundMeta {
  data: ArrayBuffer
}

const DB_NAME = 'dcmetronome'
const DB_VERSION = 1
const STORE = 'sounds'
const MAX_NAME_LENGTH = 60

const MESSAGES = {
  tooLarge: `File is larger than ${Math.round(MAX_CUSTOM_SOUND_BYTES / (1024 * 1024))} MB`,
  undecodable: 'This file could not be decoded as audio',
  tooLong: `Sound is longer than ${MAX_CUSTOM_SOUND_SECONDS} s`,
  unavailable: 'Custom sounds cannot be stored in this browser (storage is disabled, e.g. in private mode)',
  quota: 'There is not enough storage space left for this sound',
  failed: 'The sound library could not be updated',
  emptyName: 'Enter a name for the sound',
  missing: 'This sound no longer exists',
} as const

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    // Throws (or is missing) in some private modes and sandboxed iframes.
    if (typeof indexedDB === 'undefined') throw new Error(MESSAGES.unavailable)
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => {
      const db = request.result
      // Let a newer version in another tab upgrade; the next call reopens.
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      db.onclose = () => {
        dbPromise = null
      }
      resolve(db)
    }
    request.onerror = () => reject(new Error(MESSAGES.unavailable, { cause: request.error }))
  }).catch((error: unknown) => {
    // Allow a retry later instead of caching the failure forever.
    dbPromise = null
    throw error instanceof Error && error.message === MESSAGES.unavailable
      ? error
      : new Error(MESSAGES.unavailable, { cause: error })
  })
  return dbPromise
}

/** Run one transaction; `body` issues requests and returns a getter for the result, read once it has committed. */
async function withStore<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => () => T): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const result = body(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(result())
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'))
  })
}

function toMeta(record: StoredSound): CustomSoundMeta {
  return {
    id: String(record.id),
    name: String(record.name),
    size: Number(record.size) || 0,
    duration: Number(record.duration) || 0,
    createdAt: Number(record.createdAt) || 0,
  }
}

/** Storage failures as user-facing errors (our own messages pass through). */
function storageError(error: unknown): Error {
  if (error instanceof Error && (Object.values(MESSAGES) as string[]).includes(error.message)) return error
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return new Error(MESSAGES.quota, { cause: error })
  return new Error(MESSAGES.failed, { cause: error })
}

function nameFromFile(fileName: string): string {
  const name = fileName.replace(/\.[^./\\]*$/, '').trim().slice(0, MAX_NAME_LENGTH)
  return name || 'Sound'
}

/** Decoded duration in seconds; an OfflineAudioContext decodes without a user gesture or a running context. */
async function decodedDuration(bytes: ArrayBuffer): Promise<number> {
  let audio: AudioBuffer
  try {
    // decodeAudioData detaches the buffer it is given; keep `bytes` intact for storage.
    audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes.slice(0))
  } catch (error) {
    throw new Error(MESSAGES.undecodable, { cause: error })
  }
  if (!(audio.length > 0) || !Number.isFinite(audio.duration)) throw new Error(MESSAGES.undecodable)
  return audio.duration
}

/** All stored sounds, oldest first. Resolves to [] when IndexedDB is unavailable. */
export async function listCustomSounds(): Promise<CustomSoundMeta[]> {
  try {
    await openDb()
  } catch {
    return []
  }
  try {
    return await withStore('readonly', (store) => {
      const sounds: CustomSoundMeta[] = []
      // A cursor keeps at most one sound's bytes in memory at a time.
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        sounds.push(toMeta(cursor.value as StoredSound))
        cursor.continue()
      }
      return () => sounds.sort((a, b) => a.createdAt - b.createdAt)
    })
  } catch (error) {
    throw storageError(error)
  }
}

/**
 * Validate and store an uploaded audio file. Rejects (with an Error whose message is user-facing) when the file
 * is larger than MAX_CUSTOM_SOUND_BYTES, cannot be decoded as audio (checked with an OfflineAudioContext, so it
 * works before any user gesture), or is longer than MAX_CUSTOM_SOUND_SECONDS. The name defaults to the file
 * name without its extension.
 */
export async function addCustomSound(file: File): Promise<CustomSoundMeta> {
  if (file.size > MAX_CUSTOM_SOUND_BYTES) throw new Error(MESSAGES.tooLarge)
  if (file.size === 0) throw new Error(MESSAGES.undecodable)
  const data = await file.arrayBuffer()
  const duration = await decodedDuration(data)
  if (duration > MAX_CUSTOM_SOUND_SECONDS) throw new Error(MESSAGES.tooLong)
  const meta: CustomSoundMeta = {
    id: makeId(),
    name: nameFromFile(file.name),
    size: file.size,
    duration,
    createdAt: Date.now(),
  }
  try {
    await withStore('readwrite', (store) => {
      const record: StoredSound = { ...meta, data }
      store.add(record)
      return () => undefined
    })
  } catch (error) {
    throw storageError(error)
  }
  return meta
}

/** Raw file bytes of a stored sound, or null when it does not exist. */
export async function getCustomSoundData(id: string): Promise<ArrayBuffer | null> {
  try {
    await openDb()
  } catch {
    return null
  }
  return withStore('readonly', (store) => {
    const request = store.get(id)
    return () => (request.result as StoredSound | undefined)?.data ?? null
  })
}

export async function renameCustomSound(id: string, name: string): Promise<void> {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH)
  if (!trimmed) throw new Error(MESSAGES.emptyName)
  let found: boolean
  try {
    found = await withStore('readwrite', (store) => {
      let exists = false
      const request = store.get(id)
      request.onsuccess = () => {
        const record = request.result as StoredSound | undefined
        if (!record) return
        exists = true
        store.put({ ...record, name: trimmed })
      }
      return () => exists
    })
  } catch (error) {
    throw storageError(error)
  }
  if (!found) throw new Error(MESSAGES.missing)
}

export async function deleteCustomSound(id: string): Promise<void> {
  try {
    await withStore('readwrite', (store) => {
      store.delete(id)
      return () => undefined
    })
  } catch (error) {
    throw storageError(error)
  }
}
