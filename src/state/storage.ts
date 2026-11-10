import { STORAGE_KEYS } from '../core/constants'
import { createDefaultSettings, makeId, sanitizeSettings } from '../core/settings'
import type { Section, Settings } from '../core/types'

/** A saved program: its sections and whether it loops (no tempo, sounds or trainers, unlike a preset). */
export interface ProgramTemplate {
  id: string
  name: string
  sections: Section[]
  loop: boolean
  createdAt: number
}

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

function writeJson(key: string, value: unknown): void {
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

/** User presets saved under STORAGE_KEYS.presets, each preset's settings sanitized; [] when absent or unreadable. */
export function loadPresets(): Preset[] {
  const raw = readJson(STORAGE_KEYS.presets)
  if (!Array.isArray(raw)) return []
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

/** Program templates saved under STORAGE_KEYS.templates, sections sanitized; [] when absent or unreadable. */
export function loadTemplates(): ProgramTemplate[] {
  const raw = readJson(STORAGE_KEYS.templates)
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const templates: ProgramTemplate[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    let id = typeof item.id === 'string' && item.id !== '' ? item.id : makeId()
    if (seen.has(id)) id = makeId()
    seen.add(id)
    const name = typeof item.name === 'string' && item.name.trim() !== '' ? item.name.trim() : 'Template'
    const createdAt = typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : 0
    // The settings sanitizer already knows how to repair a section list.
    const { sections } = safeSanitize({ sections: item.sections })
    templates.push({ id, name, sections, loop: typeof item.loop === 'boolean' ? item.loop : true, createdAt })
  }
  return templates
}

/** Persist program templates. Swallows quota/availability errors. */
export function saveTemplates(templates: ProgramTemplate[]): void {
  writeJson(STORAGE_KEYS.templates, templates)
}
