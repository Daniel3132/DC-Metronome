import { describe, expect, it } from 'vitest'
import { MAX_BPM, MIN_BPM } from './constants'
import { TapTempo } from './tapTempo'

/** Taps `count` times `intervalMs` apart starting at `startMs`; returns every result. */
function tapSteady(tapper: TapTempo, intervalMs: number, count: number, startMs = 1000): (number | null)[] {
  return Array.from({ length: count }, (_, i) => tapper.tap(startMs + i * intervalMs))
}

/** Taps at the given intervals after a first tap at `startMs`; returns every result. */
function tapIntervals(tapper: TapTempo, intervals: number[], startMs = 1000): (number | null)[] {
  let time = startMs
  const results = [tapper.tap(time)]
  for (const interval of intervals) {
    time += interval
    results.push(tapper.tap(time))
  }
  return results
}

describe('TapTempo', () => {
  it('returns null for a single tap', () => {
    const tapper = new TapTempo()
    expect(tapper.tap(1234)).toBeNull()
    expect(tapper.count).toBe(1)
  })

  it('starts with no taps', () => {
    expect(new TapTempo().count).toBe(0)
  })

  it.each([
    [60, 1000],
    [80, 750],
    [100, 600],
    [120, 500],
    [240, 250],
    [300, 200],
  ])('detects a steady %s BPM from the second tap on', (bpm, interval) => {
    const tapper = new TapTempo()
    const results = tapSteady(tapper, interval, 12)
    expect(results[0]).toBeNull()
    expect(results.slice(1)).toEqual(Array(11).fill(bpm))
  })

  it('returns integers clamped to MIN_BPM..MAX_BPM', () => {
    expect(tapSteady(new TapTempo(), 100, 3).at(-1)).toBe(MAX_BPM)
    // 1900 ms is ~32 BPM: still a tap (under resetAfterMs), clamped up to the slowest tempo.
    expect(tapIntervals(new TapTempo(), [1900]).at(-1)).toBe(MIN_BPM)
    const odd = tapSteady(new TapTempo(), 437, 5).at(-1)
    expect(odd).toBe(Math.round(60000 / 437))
    expect(Number.isInteger(odd)).toBe(true)
  })

  it('averages out human jitter', () => {
    const jitter = [12, -18, 7, -9, 15, -4, -14, 10, 3, -6, 16, -11]
    const tapper = new TapTempo()
    const results = tapIntervals(
      tapper,
      jitter.map((j) => 500 + j),
    )
    for (const bpm of results.slice(4)) {
      expect(bpm).toBeGreaterThanOrEqual(119)
      expect(bpm).toBeLessThanOrEqual(121)
    }
  })

  it('remembers at most maxTaps taps', () => {
    const tapper = new TapTempo({ maxTaps: 4 })
    tapSteady(tapper, 500, 10)
    expect(tapper.count).toBe(4)
    expect(new TapTempo().count).toBe(0)
    const standard = new TapTempo()
    tapSteady(standard, 500, 20)
    expect(standard.count).toBe(8)
  })

  it('only averages the most recent taps', () => {
    const tapper = new TapTempo({ maxTaps: 3 })
    // Gradual changes (each within 40 %) are averaged; once the window holds only new taps it is exact.
    const results = tapIntervals(tapper, [500, 500, 500, 600, 600])
    expect(results.at(-1)).toBe(100)
  })

  it('picks up a big tempo change on the first new interval', () => {
    const tapper = new TapTempo()
    tapSteady(tapper, 500, 6, 0)
    // 120 → 60 BPM: the sequence restarts from the previous tap.
    expect(tapper.tap(2500 + 1000)).toBe(60)
    expect(tapper.count).toBe(2)
    expect(tapper.tap(3500 + 1000)).toBe(60)
  })

  it('picks up a speed-up the same way', () => {
    const tapper = new TapTempo()
    tapSteady(tapper, 1000, 5, 0)
    expect(tapper.tap(4000 + 500)).toBe(120)
    expect(tapper.tap(4500 + 500)).toBe(120)
  })

  it('adapts quickly to a 120 → 80 BPM change', () => {
    const tapper = new TapTempo()
    tapSteady(tapper, 500, 8, 0)
    expect(tapper.tap(3500 + 750)).toBe(80)
  })

  it('converges to a moderate tempo change within maxTaps taps', () => {
    const tapper = new TapTempo()
    const results = tapIntervals(tapper, [...Array(7).fill(500), ...Array(8).fill(600)])
    expect(results.at(-1)).toBe(100)
    // ...and is already moving toward it after a few taps.
    expect(results[10]).toBeLessThan(120)
  })

  it('starts a new sequence after a long pause', () => {
    const tapper = new TapTempo()
    tapSteady(tapper, 500, 4, 0)
    expect(tapper.tap(1500 + 2500)).toBeNull()
    expect(tapper.count).toBe(1)
    expect(tapper.tap(4000 + 500)).toBe(120)
  })

  it('measures the pause against the slowest tempo too, so MIN_BPM is reachable with a short resetAfterMs', () => {
    const tapper = new TapTempo({ resetAfterMs: 500 })
    // 1000 ms (60 BPM) is longer than resetAfterMs, but it is a valid interval.
    expect(tapIntervals(tapper, [1000, 1000, 1050, 980])).toEqual([null, MIN_BPM, MIN_BPM, MIN_BPM, MIN_BPM])
    // A pause far longer than the established interval still resets.
    expect(tapper.tap(1000 + 4030 + 3000)).toBeNull()
    expect(tapper.count).toBe(1)
  })

  it('treats a very long first interval as a new sequence', () => {
    const tapper = new TapTempo()
    expect(tapIntervals(tapper, [10000])).toEqual([null, null])
    expect(tapper.count).toBe(1)
  })

  it('honours a custom resetAfterMs', () => {
    const tapper = new TapTempo({ resetAfterMs: 1000 })
    tapSteady(tapper, 250, 4, 0)
    expect(tapper.tap(750 + 1200)).toBeNull()
    const lenient = new TapTempo({ resetAfterMs: 5000 })
    tapSteady(lenient, 500, 4, 0)
    // Not a reset, but a > 40 % change: restart from the previous tap.
    expect(lenient.tap(1500 + 4000)).toBe(MIN_BPM)
    expect(lenient.count).toBe(2)
  })

  it('ignores duplicate and out-of-order timestamps', () => {
    const tapper = new TapTempo()
    tapSteady(tapper, 500, 3, 0)
    expect(tapper.tap(1000)).toBe(120)
    expect(tapper.tap(900)).toBe(120)
    expect(tapper.tap(Number.NaN)).toBe(120)
    expect(tapper.count).toBe(3)
    expect(tapper.tap(1500)).toBe(120)
    expect(tapper.count).toBe(4)
  })

  it('ignores a non-finite first tap', () => {
    const tapper = new TapTempo()
    expect(tapper.tap(Number.NaN)).toBeNull()
    expect(tapper.count).toBe(0)
  })

  it('reset() forgets every tap', () => {
    const tapper = new TapTempo()
    tapSteady(tapper, 500, 5)
    tapper.reset()
    expect(tapper.count).toBe(0)
    expect(tapper.tap(99999)).toBeNull()
    expect(tapper.tap(99999 + 250)).toBe(240)
  })

  it('sanitizes options', () => {
    const tapper = new TapTempo({ maxTaps: 0, resetAfterMs: -1 })
    tapSteady(tapper, 500, 5)
    expect(tapper.count).toBe(2)
    // resetAfterMs falls back to 2000, so a 1500 ms interval (40 BPM, clamped to MIN_BPM) is still a tap.
    expect(tapIntervals(new TapTempo({ resetAfterMs: -1 }), [1500]).at(-1)).toBe(MIN_BPM)
  })
})
