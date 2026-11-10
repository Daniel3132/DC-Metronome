import { MIN_BPM } from './constants'
import { clampBpm } from './settings'

export interface TapTempoOptions {
  /** Taps remembered for averaging (default 8). */
  maxTaps?: number
  /** A pause longer than this starts a new tap sequence (default 2000 ms). */
  resetAfterMs?: number
}

/** Relative deviation from the running average that restarts the sequence from the previous tap. */
const TEMPO_CHANGE_RATIO = 0.4
/** A pause counts as "long" only when it is also this much longer than the expected interval. */
const PAUSE_RATIO = 1.25
/** Interval of the slowest supported tempo: a first interval up to (this × PAUSE_RATIO) is still a tap. */
const SLOWEST_INTERVAL_MS = 60000 / MIN_BPM

/**
 * Tap tempo detector. Feed it tap timestamps in milliseconds (performance.now()).
 * Works across the whole MIN_BPM..MAX_BPM range (taps 200 ms apart give 300 BPM, taps 1000 ms apart
 * give 60 BPM; the reset timeout is measured against the current average interval too, not only resetAfterMs, so a
 * short resetAfterMs never blocks the slowest tempos).
 */
export class TapTempo {
  private readonly maxTaps: number
  private readonly resetAfterMs: number
  private taps: number[] = []

  constructor(options: TapTempoOptions = {}) {
    const maxTaps = Math.round(options.maxTaps ?? 8)
    this.maxTaps = maxTaps >= 2 ? maxTaps : 2
    const resetAfterMs = options.resetAfterMs ?? 2000
    this.resetAfterMs = resetAfterMs >= 0 ? resetAfterMs : 2000
  }

  /**
   * Register a tap. Returns the detected BPM (integer, clamped to MIN_BPM..MAX_BPM) once at least two taps
   * are in the current sequence, otherwise null. An interval that differs from the running average by more
   * than 40 % restarts the sequence from the previous tap, so a changed tempo is picked up quickly.
   */
  tap(timeMs: number): number | null {
    const last = this.taps.at(-1)
    if (last === undefined) {
      if (Number.isFinite(timeMs)) this.taps = [timeMs]
      return null
    }
    const interval = timeMs - last
    // Same or out-of-order timestamp (e.g. a pointer and a key event for one tap): not a new beat.
    if (!(interval > 0) || !Number.isFinite(interval)) return this.bpm()

    const average = this.averageInterval()
    const expected = average ?? SLOWEST_INTERVAL_MS
    if (interval > Math.max(this.resetAfterMs, expected * PAUSE_RATIO)) {
      this.taps = [timeMs]
      return null
    }
    if (average !== null && Math.abs(interval - average) > average * TEMPO_CHANGE_RATIO) {
      this.taps = [last, timeMs]
    } else {
      this.taps = [...this.taps, timeMs].slice(-this.maxTaps)
    }
    return this.bpm()
  }

  /** Taps in the current sequence (for UI feedback). */
  get count(): number {
    return this.taps.length
  }

  reset(): void {
    this.taps = []
  }

  private averageInterval(): number | null {
    const n = this.taps.length
    if (n < 2) return null
    return (this.taps[n - 1] - this.taps[0]) / (n - 1)
  }

  private bpm(): number | null {
    const average = this.averageInterval()
    return average === null ? null : clampBpm(60000 / average)
  }
}
