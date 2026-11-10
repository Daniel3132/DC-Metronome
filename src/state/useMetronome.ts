import { useEffect, useRef, useSyncExternalStore } from 'react'
import { getEngine } from '../audio/engine'
import { playbackSettings } from '../core/settings'
import type { PlaybackSnapshot, PulseEvent, Settings, SoundId, SoundRole, VoiceWord } from '../core/types'

export interface MetronomeControls {
  playback: PlaybackSnapshot
  start: () => Promise<void>
  stop: () => void
  toggle: () => Promise<void>
  previewSound: (id: SoundId, role: SoundRole) => Promise<void>
  previewVoice: (word: VoiceWord) => Promise<void>
  invalidateCustomSound: (id: string) => void
  /** Output peak level 0..1; poll from requestAnimationFrame. */
  getLevel: () => number
}

/**
 * Connects React to the shared engine (getEngine()): pushes `settings` (as playbackSettings: outside program mode only
 * the working rhythm) to engine.setSettings whenever they change
 * and exposes the playback snapshot through useSyncExternalStore.
 */
export function useMetronome(settings: Settings): MetronomeControls {
  const engine = getEngine()
  const latest = useRef(settings)

  useEffect(() => {
    latest.current = settings
    engine.setSettings(playbackSettings(settings))
  }, [engine, settings])

  const playback = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot)

  // Re-push right before starting so a start in the same tick as a settings change never plays stale settings.
  const start = () => {
    engine.setSettings(playbackSettings(latest.current))
    return engine.start()
  }

  const toggle = () => {
    if (engine.getSnapshot().status === 'stopped') engine.setSettings(playbackSettings(latest.current))
    return engine.toggle()
  }

  return {
    playback,
    start,
    stop: engine.stop,
    toggle,
    previewSound: engine.previewSound,
    previewVoice: engine.previewVoice,
    invalidateCustomSound: engine.invalidateCustomSound,
    getLevel: engine.getLevel,
  }
}

/**
 * The pulse sounding now (null unless playing), read straight from the engine. For small live readouts inside
 * components whose other props change slowly, so their parent does not have to re-render on every pulse.
 */
export function usePulse(): PulseEvent | null {
  const engine = getEngine()
  const playback = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot)
  return playback.status === 'playing' ? playback.pulse : null
}
