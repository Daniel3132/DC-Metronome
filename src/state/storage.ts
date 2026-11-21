import { deleteCustomSoundsDb } from '../audio/customSounds'
import { STORAGE_KEYS } from '../core/constants'
import { createDefaultSettings, makeId, sanitizeSettings } from '../core/settings'
import type { Settings } from '../core/types'

export interface Preset {
  id: string
  name: string
  settings: Settings
  createdAt: number
}

// Every access is guarded: localStorage can be missing (tests, SSR), blocked (privacy settings) or full.
function readJson(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw == null ? null : (JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

/** Every localStorage key of the app starts with this (settings, presets, UI conveniences). */
const KEY_PREFIX = 'dcmetronome.'

/** Set once the stored data was cleared: later writes (e.g. the save on page hide) must not bring it back. */
let cleared = false

function writeJson(key: string, value: unknown): void {
  if (cleared) return
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded or storage unavailable: the app keeps working with in-memory state.
  }
}

function safeSanitize(raw: unknown): Settings {
  try {
    return sanitizeSettings(raw)
  } catch {
    return createDefaultSettings()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Settings saved under STORAGE_KEYS.settings, sanitized; factory defaults when absent, unreadable or storage is unavailable. */
export function loadSettings(): Settings {
  const raw = readJson(STORAGE_KEYS.settings)
  return raw == null ? createDefaultSettings() : safeSanitize(raw)
}

/** Persist settings (JSON in localStorage). Swallows quota/availability errors. */
export function saveSettings(settings: Settings): void {
  writeJson(STORAGE_KEYS.settings, settings)
}

/**
 * Older versions saved programs apart from presets, as "program templates" (sections and loop only). A preset holds
 * everything, so each template becomes a preset with the default setup, its sections, and program mode on. Runs once:
 * the templates are removed afterwards.
 */
function migrateTemplates(presets: unknown[]): unknown[] {
  const raw = readJson(STORAGE_KEYS.templates)
  if (raw === null) return presets
  const converted = (Array.isArray(raw) ? raw : []).filter(isRecord).map((item) => ({
    id: item.id,
    name: typeof item.name === 'string' && item.name.trim() !== '' ? item.name : 'Program',
    createdAt: item.createdAt,
    settings: {
      ...createDefaultSettings(),
      sections: item.sections,
      program: { enabled: true, loop: typeof item.loop === 'boolean' ? item.loop : true },
    },
  }))
  const merged = [...presets, ...converted]
  writeJson(STORAGE_KEYS.presets, merged)
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEYS.templates)
  } catch {
    // Storage unavailable: nothing to remove.
  }
  return merged
}

/** User presets saved under STORAGE_KEYS.presets, each preset's settings sanitized; [] when absent or unreadable. */
export function loadPresets(): Preset[] {
  const stored = readJson(STORAGE_KEYS.presets)
  const raw = migrateTemplates(Array.isArray(stored) ? stored : [])
  const seen = new Set<string>()
  const presets: Preset[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    let id = typeof item.id === 'string' && item.id !== '' ? item.id : makeId()
    // Duplicate ids would break React keys and delete-by-id.
    if (seen.has(id)) id = makeId()
    seen.add(id)
    const name = typeof item.name === 'string' && item.name.trim() !== '' ? item.name.trim() : 'Preset'
    const createdAt = typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : 0
    presets.push({ id, name, settings: safeSanitize(item.settings), createdAt })
  }
  return presets
}

/** Persist user presets. Swallows quota/availability errors. */
export function savePresets(presets: Preset[]): void {
  writeJson(STORAGE_KEYS.presets, presets)
}

/** The id of the saved preset loaded last; null when none. Older versions stored { kind, id }. */
export function loadActivePreset(): string | null {
  const raw = readJson(STORAGE_KEYS.activePreset)
  if (typeof raw === 'string') return raw
  return isRecord(raw) && raw.kind === 'saved' && typeof raw.id === 'string' ? raw.id : null
}

export function saveActivePreset(id: string | null): void {
  writeJson(STORAGE_KEYS.activePreset, id)
}

/**
 * Erase everything the app stored in this browser: settings, presets, UI preferences
 * (localStorage keys starting with "dcmetronome.") and uploaded sounds (IndexedDB). Settings changes made after
 * this are no longer saved, so reload the page right after it to start from factory defaults.
 */
export async function clearStoredData(): Promise<void> {
  cleared = true
  try {
    const storage = globalThis.localStorage
    if (storage) {
      const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
        (key): key is string => key?.startsWith(KEY_PREFIX) ?? false,
      )
      for (const key of keys) storage.removeItem(key)
    }
  } catch {
    // Storage unavailable: nothing was stored there either.
  }
  await deleteCustomSoundsDb()
}
