import { STORAGE_KEYS } from '../core/constants'

/** Accent colors the theme picker offers; the CSS for each lives in index.css under [data-accent]. */
export const ACCENTS = [
  { id: 'cyan', label: 'Cyan', swatch: '#36d6e7' },
  { id: 'blue', label: 'Blue', swatch: '#60a5fa' },
  { id: 'violet', label: 'Violet', swatch: '#a78bfa' },
  { id: 'pink', label: 'Pink', swatch: '#f472b6' },
  { id: 'green', label: 'Green', swatch: '#34d399' },
  { id: 'orange', label: 'Orange', swatch: '#fb923c' },
] as const

export type AccentId = (typeof ACCENTS)[number]['id']

export const DEFAULT_ACCENT: AccentId = 'cyan'

function isAccent(value: unknown): value is AccentId {
  return ACCENTS.some((a) => a.id === value)
}

/** The saved accent (a display preference of this browser, not part of the settings or presets). */
export function loadAccent(): AccentId {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEYS.accent)
    return isAccent(value) ? value : DEFAULT_ACCENT
  } catch {
    return DEFAULT_ACCENT
  }
}

/** Show the accent on the page (the default has no attribute: index.css :root holds it). */
export function applyAccent(accent: AccentId): void {
  const root = document.documentElement
  if (accent === DEFAULT_ACCENT) root.removeAttribute('data-accent')
  else root.dataset.accent = accent
}

export function saveAccent(accent: AccentId): void {
  applyAccent(accent)
  try {
    globalThis.localStorage?.setItem(STORAGE_KEYS.accent, accent)
  } catch {
    // Storage unavailable: the choice lasts until the page is reloaded.
  }
}
