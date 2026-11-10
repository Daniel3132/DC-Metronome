import { useSyncExternalStore } from 'react'
import {
  addCustomSound,
  deleteCustomSound,
  listCustomSounds,
  renameCustomSound,
  type CustomSoundMeta,
} from '../audio/customSounds'
import { getEngine } from '../audio/engine'

export interface CustomSoundsState {
  sounds: CustomSoundMeta[]
  /** True until the first list from IndexedDB has arrived. */
  loading: boolean
  /** True while an add, rename or delete is running (e.g. to disable the upload button). */
  busy: boolean
  /** Last user-facing error from add/rename/delete; null when fine. */
  error: string | null
  /** Store an uploaded file; resolves to the new sound, or null when it was rejected (see `error`). */
  add: (file: File) => Promise<CustomSoundMeta | null>
  rename: (id: string, name: string) => Promise<void>
  /** Delete the sound and call `onDeleted(id)` so callers can reset settings that used it. */
  remove: (id: string) => Promise<void>
  clearError: () => void
}

interface StoreSnapshot {
  sounds: CustomSoundMeta[]
  loading: boolean
  pending: number
  error: string | null
}

let snapshot: StoreSnapshot = { sounds: [], loading: true, pending: 0, error: null }
const listeners = new Set<() => void>()
let loadStarted = false
let listRequest = 0

function setSnapshot(patch: Partial<StoreSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message !== '' ? err.message : fallback
}

async function refresh(): Promise<void> {
  // Only the newest list may land, so an older, slower request cannot resurrect a deleted sound.
  const request = ++listRequest
  try {
    const sounds = await listCustomSounds()
    if (request === listRequest) setSnapshot({ sounds, loading: false })
  } catch (err) {
    if (request === listRequest) setSnapshot({ loading: false, error: errorMessage(err, 'Could not load your sounds.') })
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!loadStarted) {
    loadStarted = true
    void refresh()
  }
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): StoreSnapshot {
  return snapshot
}

async function runOperation<T>(operation: () => Promise<T>, fallbackError: string): Promise<T | null> {
  setSnapshot({ pending: snapshot.pending + 1, error: null })
  try {
    return await operation()
  } catch (err) {
    setSnapshot({ error: errorMessage(err, fallbackError) })
    return null
  } finally {
    setSnapshot({ pending: snapshot.pending - 1 })
  }
}

function add(file: File): Promise<CustomSoundMeta | null> {
  return runOperation(async () => {
    const meta = await addCustomSound(file)
    await refresh()
    return meta
  }, 'Could not add this sound.')
}

async function rename(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (trimmed === '') return
  await runOperation(async () => {
    await renameCustomSound(id, trimmed)
    await refresh()
  }, 'Could not rename this sound.')
}

async function remove(id: string, onDeleted?: (id: string) => void): Promise<void> {
  await runOperation(async () => {
    await deleteCustomSound(id)
    setSnapshot({ sounds: snapshot.sounds.filter((s) => s.id !== id) })
    try {
      getEngine().invalidateCustomSound(id)
    } catch {
      // A stale cached buffer is harmless once no setting references the sound.
    }
    onDeleted?.(id)
    await refresh()
  }, 'Could not delete this sound.')
}

function clearError(): void {
  if (snapshot.error !== null) setSnapshot({ error: null })
}

/**
 * List and manage uploaded sounds (wraps src/audio/customSounds.ts). The list is shared by every component
 * using the hook (module-level store + useSyncExternalStore) and refreshed after each change.
 * `onDeleted` is called after a successful delete.
 */
export function useCustomSounds(onDeleted?: (id: string) => void): CustomSoundsState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    sounds: state.sounds,
    loading: state.loading,
    busy: state.pending > 0,
    error: state.error,
    add,
    rename,
    remove: (id: string) => remove(id, onDeleted),
    clearError,
  }
}
