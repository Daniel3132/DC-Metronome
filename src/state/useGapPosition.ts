import { useState } from 'react'
import type { GapSettings, PulseEvent } from '../core/types'

/**
 * Follows the sequencer's gap counter from the bars the UI sees, since the snapshot only exposes `gapBar`.
 * It mirrors the counter rules (reset when the trainer is switched on, +1 per bar) and re-synchronises on every
 * sounding/silent transition; when it joins mid-playback it waits for a transition before claiming a position.
 */
interface GapTracker {
  /** totalBar of the last bar seen; null when not playing. */
  bar: number | null
  /** Bars counted since the trainer started its cycle (only meaningful while `synced`). */
  count: number
  synced: boolean
  /** The gap trainer was on, and the bar was silent, at the last bar seen. */
  enabled: boolean
  silent: boolean
}

const IDLE: GapTracker = { bar: null, count: 0, synced: false, enabled: false, silent: false }

function trackGap(prev: GapTracker, bar: number | null, silent: boolean, gap: GapSettings): GapTracker {
  if (bar === null) return IDLE
  if (!gap.enabled) return { bar, count: 0, synced: false, enabled: false, silent: false }
  const cycle = gap.playBars + gap.muteBars
  const firstSeen = prev.bar === null || bar < prev.bar

  if (firstSeen) {
    // Bar 0 means we saw playback start, where the sequencer's counter is 0 too.
    return { bar, count: silent ? gap.playBars : 0, synced: bar === 0 && !silent, enabled: true, silent }
  }
  if (!prev.enabled) return { bar, count: 0, synced: !silent, enabled: true, silent }
  if (silent && !prev.silent) return { bar, count: gap.playBars, synced: true, enabled: true, silent }
  if (!silent && prev.silent) return { bar, count: 0, synced: true, enabled: true, silent }

  const count = prev.count + (bar - (prev.bar ?? bar))
  const predictedSilent = count % cycle >= gap.playBars
  return { bar, count, synced: prev.synced && predictedSilent === silent, enabled: true, silent }
}

export interface GapPosition {
  /** The gap trainer is on and playback is running. */
  live: boolean
  /** The current bar is a gap (silent) bar. */
  silentNow: boolean
  /** 0-based bar within the play + mute cycle; null when unknown (stopped, or not yet synchronised). */
  position: number | null
}

/** Where playback is inside the gap trainer's play/mute cycle. */
export function useGapPosition(pulse: PulseEvent | null, gap: GapSettings): GapPosition {
  const bar = pulse ? pulse.totalBar : null
  const barSilent = pulse?.gapBar ?? false

  // "Storing information from previous renders": only recomputed when a new bar (or stop) is seen.
  const [tracker, setTracker] = useState<GapTracker>(IDLE)
  const current = bar === tracker.bar ? tracker : trackGap(tracker, bar, barSilent, gap)
  if (current !== tracker) setTracker(current)

  const live = gap.enabled && pulse !== null
  return {
    live,
    silentNow: live && barSilent,
    position: live && current.synced ? current.count % (gap.playBars + gap.muteBars) : null,
  }
}
