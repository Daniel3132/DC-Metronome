import { useSyncExternalStore } from 'react'
import { STORAGE_KEYS } from '../core/constants'
import type { Settings } from '../core/types'
import { loadActivePreset, loadPresets, saveActivePreset, savePresets, type Preset } from './storage'

export interface PresetsState {
  /** Saved presets, in display order. */
  presets: Preset[]
  /** Id of the preset loaded last; null once it is unselected or deleted. */
  active: string | null
  /** Its name, for display. */
  activeName: string | null
  /** The preset deleted last, while it can still be undone (UNDO_MS); null otherwise. */
  deleted: DeletedPreset | null
}

export interface DeletedPreset {
  preset: Preset
  /** Where it was in the list. */
  index: number
  wasActive: boolean
}

/** How long a deleted preset can be brought back. */
export const UNDO_MS = 5000

/*
 * One store for the Quick tab cards, the Presets tab and the tab bar, so a preset saved, renamed, reordered or deleted
 * in one shows everywhere at once. Saved presets also follow other windows (storage events); the active preset
 * belongs to this window's settings, so it does not.
 */
let state: PresetsState | null = null
const listeners = new Set<() => void>()

function build(presets: Preset[], active: string | null, deleted: DeletedPreset | null = null): PresetsState {
  const found = active === null ? undefined : presets.find((p) => p.id === active)
  return { presets, active: found ? active : null, activeName: found?.name ?? null, deleted }
}

let undoTimer: ReturnType<typeof setTimeout> | null = null

function clearUndoTimer() {
  if (undoTimer !== null) clearTimeout(undoTimer)
  undoTimer = null
}

function current(): PresetsState {
  state ??= build(loadPresets(), loadActivePreset())
  return state
}

function emit() {
  for (const listener of listeners) listener()
}

interface Patch {
  presets?: Preset[]
  active?: string | null
  deleted?: DeletedPreset | null
}

function update(patch: Patch) {
  const prev = current()
  const next = build(
    patch.presets ?? prev.presets,
    patch.active !== undefined ? patch.active : prev.active,
    patch.deleted !== undefined ? patch.deleted : prev.deleted,
  )
  if (patch.presets) savePresets(next.presets)
  if (patch.active !== undefined || next.active !== prev.active) saveActivePreset(next.active)
  state = next
  emit()
}

function onStorage(e: StorageEvent) {
  if (e.key !== null && e.key !== STORAGE_KEYS.presets) return
  state = build(loadPresets(), current().active, current().deleted)
  emit()
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

export function usePresets(): PresetsState {
  return useSyncExternalStore(subscribe, current, current)
}

function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  if (item !== undefined) next.splice(to, 0, item)
  return next
}

export const presetActions = {
  /** Adds a preset at the top and makes it the active one. */
  add(preset: Preset) {
    update({ presets: [preset, ...current().presets], active: preset.id })
  },

  /** Adds imported presets at the top. */
  addMany(presets: Preset[]) {
    update({ presets: [...presets, ...current().presets] })
  },

  rename(id: string, name: string) {
    update({ presets: current().presets.map((p) => (p.id === id ? { ...p, name } : p)) })
  },

  replace(id: string, patch: Partial<Omit<Preset, 'id'>>) {
    update({ presets: current().presets.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
  },

  /** Overwrites a preset with these settings and stamps it as new. */
  overwrite(id: string, settings: Settings) {
    presetActions.replace(id, { settings, createdAt: Date.now() })
  },

  /** Overwrites the active preset with these settings; false when no preset is active. */
  saveActive(settings: Settings): boolean {
    const { active } = current()
    if (active === null) return false
    presetActions.replace(active, { settings })
    return true
  },

  /** Deletes a preset; undoRemove brings it back for UNDO_MS. */
  remove(id: string) {
    const { presets, active } = current()
    const index = presets.findIndex((p) => p.id === id)
    if (index < 0) return
    clearUndoTimer()
    update({
      presets: presets.filter((p) => p.id !== id),
      deleted: { preset: presets[index], index, wasActive: active === id },
    })
    undoTimer = setTimeout(() => {
      undoTimer = null
      update({ deleted: null })
    }, UNDO_MS)
  },

  /** Puts the preset deleted last back where it was (and active again if it was). */
  undoRemove() {
    const { presets, deleted, active } = current()
    if (deleted === null) return
    clearUndoTimer()
    const at = Math.min(deleted.index, presets.length)
    update({
      presets: presets.toSpliced(at, 0, deleted.preset),
      active: deleted.wasActive ? deleted.preset.id : active,
      deleted: null,
    })
  },

  dismissUndo() {
    clearUndoTimer()
    update({ deleted: null })
  },

  /** Moves a saved preset from one display position to another. */
  move(from: number, to: number) {
    update({ presets: moved(current().presets, from, to) })
  },

  setActive(id: string | null) {
    update({ active: id })
  },
}
