import { useCallback, useEffect, useRef, useState } from 'react'
import { sanitizeSettings } from '../core/settings'
import type { Settings } from '../core/types'
import { loadSettings, saveSettings } from './storage'

/** Immutable update: receives the latest settings, returns the next ones (never mutate `prev`). */
export type SettingsUpdater = (update: (prev: Settings) => Settings) => void

const SAVE_DELAY_MS = 300

/**
 * App settings state, initialised from loadSettings() and persisted with saveSettings() (debounced ~300 ms).
 * Every update result is passed through sanitizeSettings() so components can never store invalid state.
 */
export function useSettings(): [Settings, SettingsUpdater] {
  const [settings, setSettings] = useState(loadSettings)
  // Settings changed since the last save; flushed when the page is hidden or the hook unmounts.
  const pending = useRef<Settings | null>(null)

  // Stable identity is part of the contract (panels may pass it to effects), not a perf memo.
  const update = useCallback<SettingsUpdater>((fn) => {
    setSettings((prev) => sanitizeSettings(fn(prev)))
  }, [])

  useEffect(() => {
    pending.current = settings
    const timer = setTimeout(() => {
      pending.current = null
      saveSettings(settings)
    }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [settings])

  useEffect(() => {
    const flush = () => {
      if (pending.current === null) return
      saveSettings(pending.current)
      pending.current = null
    }
    // pagehide is the reliable unload signal; mobile browsers may kill a backgrounded tab without one.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [])

  return [settings, update]
}
