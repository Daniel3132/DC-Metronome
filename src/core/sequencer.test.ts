import { describe, expect, it } from 'vitest'
import {
  BEAT_WORDS,
  MAX_BEATS_PER_BAR,
  MAX_BPM,
  MIN_BPM,
  SUB_VOICE_GAIN,
  SUBDIVISIONS,
  getSubdivision,
} from './constants'
import { resizeBeats } from './meter'
import { createSequencer, type Sequencer } from './sequencer'
import { createDefaultSettings, createSection } from './settings'
import type {
  BeatLevel,
  PracticeAtTarget,
  PracticeSettings,
  PulseEvent,
  Section,
  Settings,
  SubdivisionId,
} from './types'

// --- Helpers ---

const TOLERANCE = 1e-9

let idCounter = 0

function section(partial: Partial<Section> = {}): Section {
  const { id, ...rest } = partial
  return { ...createSection(rest), id: id ?? `section-${idCounter++}` }
}

function makeSettings(patch: Partial<Settings> = {}): Settings {
  return { ...createDefaultSettings(), sections: [section({ id: 'main' })], ...patch }
}

/** Settings with section `index` patched; changing beatsPerBar re-fits beats like the UI does. */
function patchSection(settings: Settings, index: number, patch: Partial<Section>): Settings {
  return {
    ...settings,
    sections: settings.sections.map((s, i) => {
      if (i !== index) return s
      const beatsPerBar = patch.beatsPerBar ?? s.beatsPerBar
      return { ...s, ...patch, beats: patch.beats ?? resizeBeats(s.beats, beatsPerBar) }
    }),
  }
}

function practice(patch: Partial<PracticeSettings> = {}): PracticeSettings {
  return { enabled: true, startBpm: 100, targetBpm: 110, stepBpm: 5, everyBars: 2, atTarget: 'hold', ...patch }
}

function expectTime(actual: number, expected: number, tolerance = TOLERANCE) {
  if (!(Math.abs(actual - expected) < tolerance)) {
    throw new Error(`expected time ${expected}, got ${actual} (diff ${actual - expected})`)
  }
}

/** Takes `count` pulses, checking that peekTime() always predicts next(). */
function take(seq: Sequencer, settings: Settings, count: number): PulseEvent[] {
  const events: PulseEvent[] = []
  for (let i = 0; i < count; i++) {
    const peek = seq.peekTime(settings)
    const event = seq.next(settings)
    if (!event) throw new Error(`sequence ended after ${i} of ${count} pulses`)
    expect(event.time).toBe(peek)
    events.push(event)
  }
  return events
}

/** Pulses until the sequence ends (or `limit`), checking peek/next agreement. */
function takeAll(seq: Sequencer, settings: Settings, limit = 10000): PulseEvent[] {
  const events: PulseEvent[] = []
  for (let i = 0; i < limit; i++) {
    const peek = seq.peekTime(settings)
    const event = seq.next(settings)
    if (!event) {
      expect(peek).toBeNull()
      return events
    }
    expect(event.time).toBe(peek)
    events.push(event)
  }
  throw new Error('sequence did not end')
}

/** The first pulse of each of the next `bars` bars (fewer if the sequence ends). */
function barStarts(seq: Sequencer, settings: Settings, bars: number): PulseEvent[] {
  const starts: PulseEvent[] = []
  let guard = 0
  while (starts.length < bars && guard++ < 100000) {
    const event = seq.next(settings)
    if (!event) break
    if (event.beat === 0 && event.pulse === 0) starts.push(event)
  }
  return starts
}

/** Deterministic PRNG (mulberry32). */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random source that returns the given values in order (then repeats the last). */
function sequence(values: number[]): { random: () => number; calls: () => number } {
  let calls = 0
  return {
    random: () => values[Math.min(calls++, values.length - 1)],
    calls: () => calls,
  }
}

// --- Timing ---

describe('timing', () => {
  const tempos = [MIN_BPM, 97, 120, 137, MAX_BPM]

  for (const subdivision of SUBDIVISIONS) {
    it.each(tempos)(`places every ${subdivision.id} pulse exactly at %s BPM`, (bpm) => {
      const settings = makeSettings({ bpm, sections: [section({ subdivision: subdivision.id })] })
      const start = 3.25
      const seq = createSequencer(settings, start)
      const perBeat = subdivision.pulses.length
      const count = perBeat * 4 * 3
      const events = take(seq, settings, count)
      const spb = 60 / bpm
      events.forEach((event, i) => {
        const beatIndex = Math.floor(i / perBeat)
        const pulse = i % perBeat
        expectTime(event.time, start + (beatIndex + subdivision.pulses[pulse]) * spb)
        expect(event.pulse).toBe(pulse)
        expect(event.pulsesInBeat).toBe(perBeat)
        expect(event.beat).toBe(beatIndex % 4)
        expect(event.beatsPerBar).toBe(4)
        expect(event.totalBar).toBe(Math.floor(beatIndex / 4))
        expect(event.sectionBar).toBe(Math.floor(beatIndex / 4))
        expect(event.bpm).toBe(bpm)
        expect(event.baseBpm).toBe(bpm)
        expectTime(event.beatDuration, spb)
        expectTime(event.duration, ((subdivision.pulses[pulse + 1] ?? 1) - subdivision.pulses[pulse]) * spb)
        if (i + 1 < count) expectTime(event.duration, events[i + 1].time - event.time)
      })
    })
  }

  it('produces the first pulse exactly at startTime', () => {
    const settings = makeSettings()
    for (const start of [0, 0.1, 12345.678]) {
      const seq = createSequencer(settings, start)
      expect(seq.peekTime(settings)).toBe(start)
      expect(seq.next(settings)?.time).toBe(start)
    }
  })

  it('ignores the beat unit: the tempo always counts the denominator', () => {
    for (const beatUnit of [2, 4, 8, 16] as const) {
      const settings = makeSettings({ bpm: 120, sections: [section({ beatsPerBar: 3, beatUnit })] })
      const events = take(createSequencer(settings, 0), settings, 4)
      expect(events.map((e) => e.time)).toEqual([0, 0.5, 1, 1.5])
    }
  })

  it('applies the tempo percentage', () => {
    const settings = makeSettings({ bpm: 120, tempoPercent: 50, sections: [section({ subdivision: 'eighths' })] })
    const events = take(createSequencer(settings, 0), settings, 4)
    expect(events.map((e) => e.time)).toEqual([0, 0.5, 1, 1.5])
    expect(events[0].bpm).toBe(60)
    expect(events[0].baseBpm).toBe(120)
    expect(events[0].beatDuration).toBe(1)
  })

  it('clamps the effective tempo to MIN_BPM..MAX_BPM', () => {
    const fast = makeSettings({ bpm: 250, tempoPercent: 200 })
    const fastEvents = take(createSequencer(fast, 0), fast, 3)
    expect(fastEvents[0].bpm).toBe(MAX_BPM)
    expect(fastEvents[0].baseBpm).toBe(250)
    expectTime(fastEvents[1].time, 0.2)
    const slow = makeSettings({ bpm: 100, tempoPercent: 25 })
    const slowEvents = take(createSequencer(slow, 0), slow, 2)
    expect(slowEvents[0].bpm).toBe(MIN_BPM)
    expect(slowEvents[0].baseBpm).toBe(100)
    expectTime(slowEvents[1].time, 60 / MIN_BPM)
  })

  it('supports fractional effective tempos', () => {
    const settings = makeSettings({ bpm: 137, tempoPercent: 73 })
    const events = take(createSequencer(settings, 1), settings, 50)
    const spb = 60 / ((137 * 73) / 100)
    events.forEach((event, i) => expectTime(event.time, 1 + i * spb))
  })

  it('does not drift over 100k pulses at a constant tempo', () => {
    const cases: [SubdivisionId, number][] = [
      ['triplets', 137],
      ['swing', 97],
      ['sextuplets', MAX_BPM],
      ['quintuplets', MIN_BPM],
    ]
    for (const [subdivisionId, bpm] of cases) {
      const subdivision = getSubdivision(subdivisionId)
      const settings = makeSettings({ bpm, sections: [section({ beatsPerBar: 7, subdivision: subdivisionId })] })
      const start = 1.5
      const seq = createSequencer(settings, start)
      const perBeat = subdivision.pulses.length
      const spb = 60 / bpm
      let maxError = 0
      let previous = -Infinity
      let nonIncreasing = 0
      for (let i = 0; i < 100000; i++) {
        const event = seq.next(settings)
        if (!event) throw new Error('ended')
        const beatIndex = Math.floor(i / perBeat)
        const expected = start + beatIndex * spb + subdivision.pulses[i % perBeat] * spb
        maxError = Math.max(maxError, Math.abs(event.time - expected))
        if (!(event.time > previous)) nonIncreasing++
        previous = event.time
      }
      expect(maxError).toBeLessThan(1e-6)
      expect(nonIncreasing).toBe(0)
    }
  })
})

// --- peek / next ---

describe('peekTime', () => {
  it('does not advance', () => {
    const settings = makeSettings({ sections: [section({ subdivision: 'triplets' })] })
    const seq = createSequencer(settings, 0)
    seq.next(settings)
    const peeks = [seq.peekTime(settings), seq.peekTime(settings), seq.peekTime(settings)]
    expect(new Set(peeks).size).toBe(1)
    expect(seq.next(settings)?.time).toBe(peeks[0])
  })

  it('reflects the settings it is given, and next() uses its own', () => {
    const slow = makeSettings({ bpm: 60 })
    const fast = makeSettings({ bpm: 120 })
    const seq = createSequencer(slow, 0)
    seq.next(slow)
    expect(seq.peekTime(slow)).toBe(1)
    expect(seq.peekTime(fast)).toBe(0.5)
    expect(seq.next(slow)?.time).toBe(1)
  })

  it('does not draw random numbers', () => {
    const settings = makeSettings({ randomMute: { enabled: true, percent: 50 } })
    const source = sequence([0.9])
    const seq = createSequencer(settings, 0, source)
    for (let i = 0; i < 5; i++) seq.peekTime(settings)
    expect(source.calls()).toBe(0)
    seq.next(settings)
    expect(source.calls()).toBe(1)
  })
})

// --- Live edits ---

describe('live edits', () => {
  it('applies a tempo change to the very next pulse', () => {
    const at120 = makeSettings({ bpm: 120, sections: [section({ id: 'm', subdivision: 'eighths' })] })
    const at60 = { ...at120, bpm: 60 }
    const seq = createSequencer(at120, 0)
    const before = take(seq, at120, 4)
    expect(before.map((e) => e.time)).toEqual([0, 0.25, 0.5, 0.75])
    const after = take(seq, at60, 4)
    expect(after.map((e) => e.time)).toEqual([1.25, 1.75, 2.25, 2.75])
    expect(after.map((e) => [e.beat, e.pulse])).toEqual([
      [2, 0],
      [2, 1],
      [3, 0],
      [3, 1],
    ])
    expect(after[0].bpm).toBe(60)
  })

  it('stretches the rest of a beat when the tempo changes mid-beat', () => {
    const at120 = makeSettings({ bpm: 120, sections: [section({ subdivision: 'triplets' })] })
    const at60 = { ...at120, bpm: 60 }
    const seq = createSequencer(at120, 0)
    take(seq, at120, 2) // 0 and 1/6
    const [last, nextBeat, nextTrip] = take(seq, at60, 3)
    expectTime(last.time, 1 / 6 + 1 / 3)
    expectTime(nextBeat.time, 1 / 6 + 2 / 3)
    expectTime(nextTrip.time, 1 / 6 + 2 / 3 + 1 / 3)
    expect(nextBeat.beat).toBe(1)
  })

  it('applies a tempo percentage change to the very next pulse', () => {
    const full = makeSettings({ bpm: 120 })
    const half = { ...full, tempoPercent: 50 }
    const seq = createSequencer(full, 0)
    take(seq, full, 2)
    expect(take(seq, half, 2).map((e) => e.time)).toEqual([1.5, 2.5])
  })

  it('keeps time exact after returning to a previous tempo', () => {
    const at120 = makeSettings({ bpm: 120 })
    const at90 = { ...at120, bpm: 90 }
    const seq = createSequencer(at120, 0)
    take(seq, at120, 3) // 0, .5, 1
    take(seq, at90, 2) // 1.666…, 2.333…
    const events = take(seq, at120, 2000)
    events.forEach((event, i) => expectTime(event.time, 1 + 2 * (60 / 90) + (i + 1) * 0.5))
  })

  describe('subdivision change mid-beat', () => {
    function switchAfter(from: SubdivisionId, pulses: number, to: SubdivisionId, count = 4) {
      const first = makeSettings({ bpm: 60, sections: [section({ id: 'm', subdivision: from })] })
      const second = patchSection(first, 0, { subdivision: to })
      const seq = createSequencer(first, 0)
      const before = take(seq, first, pulses)
      const after = take(seq, second, count)
      const all = [...before, ...after]
      for (let i = 1; i < all.length; i++) expect(all[i].time).toBeGreaterThan(all[i - 1].time)
      return after
    }

    it('continues with the first later pulse of the new pattern', () => {
      const after = switchAfter('sixteenths', 3, 'triplets') // last played: offset 0.5
      expectTime(after[0].time, 2 / 3)
      expect([after[0].beat, after[0].pulse, after[0].pulsesInBeat]).toEqual([0, 2, 3])
      expectTime(after[1].time, 1)
      expect([after[1].beat, after[1].pulse]).toEqual([1, 0])
      expectTime(after[2].time, 1 + 1 / 3)
    })

    it('skips offsets equal to the last one', () => {
      const after = switchAfter('eighths', 2, 'sixteenths') // last played: offset 0.5
      expectTime(after[0].time, 0.75)
      expect(after[0].pulse).toBe(3)
    })

    it('goes to the next beat when the new pattern has no later pulse', () => {
      const fromTriplets = switchAfter('triplets', 3, 'eighths') // last played: offset 2/3
      expect([fromTriplets[0].beat, fromTriplets[0].pulse]).toEqual([1, 0])
      expectTime(fromTriplets[0].time, 1)
      const toQuarter = switchAfter('sixteenths', 2, 'quarter')
      expect(toQuarter.map((e) => e.time)).toEqual([1, 2, 3, 4])
    })

    it('handles swing, gallops and dotted patterns', () => {
      const swing = switchAfter('eighths', 2, 'swing')
      expectTime(swing[0].time, 2 / 3)
      const gallop = switchAfter('reverse-gallop', 2, 'gallop') // last 0.25
      expectTime(gallop[0].time, 0.5)
      expectTime(gallop[1].time, 0.75)
      const dotted = switchAfter('sextuplets', 5, 'dotted') // last 4/6 ≈ 0.667
      expectTime(dotted[0].time, 0.75)
    })
  })

  describe('meter change mid-bar', () => {
    it('ends the bar at the next beat boundary when the current beat no longer exists', () => {
      const four = makeSettings({ bpm: 60, sections: [section({ id: 'm', subdivision: 'eighths' })] })
      const two = patchSection(four, 0, { beatsPerBar: 2 })
      const seq = createSequencer(four, 0)
      const before = take(seq, four, 5) // beats 0, 1 and the downbeat of beat 2
      expect(before.at(-1)?.beat).toBe(2)
      const after = take(seq, two, 3)
      // The rest of beat 2 is skipped; bar 1 starts at the beat boundary.
      expect(after.map((e) => [e.totalBar, e.beat, e.pulse])).toEqual([
        [1, 0, 0],
        [1, 0, 1],
        [1, 1, 0],
      ])
      expect(after.map((e) => e.time)).toEqual([3, 3.5, 4])
      expect(after[0].beatsPerBar).toBe(2)
    })

    it('ends the bar early when shrinking below the beats still to come', () => {
      const four = makeSettings({ bpm: 60 })
      const three = patchSection(four, 0, { beatsPerBar: 3 })
      const seq = createSequencer(four, 0)
      take(seq, four, 2) // beats 0 and 1
      const after = take(seq, three, 3)
      expect(after.map((e) => [e.totalBar, e.beat])).toEqual([
        [0, 2],
        [1, 0],
        [1, 1],
      ])
      expect(after.map((e) => e.time)).toEqual([2, 3, 4])
    })

    it('extends the bar when the meter grows', () => {
      const three = makeSettings({ bpm: 60, sections: [section({ id: 'm', beatsPerBar: 3 })] })
      const five = patchSection(three, 0, { beatsPerBar: 5 })
      const seq = createSequencer(three, 0)
      take(seq, three, 3)
      const after = take(seq, five, 3)
      expect(after.map((e) => [e.totalBar, e.beat, e.beatsPerBar])).toEqual([
        [0, 3, 5],
        [0, 4, 5],
        [1, 0, 5],
      ])
    })

    it('applies beat level edits to the next pulse', () => {
      const settings = makeSettings({ sections: [section({ id: 'm' })] })
      const edited = patchSection(settings, 0, { beats: ['accent', 'mute', 'medium', 'normal'] })
      const seq = createSequencer(settings, 0)
      take(seq, settings, 1)
      const [b1, b2] = take(seq, edited, 2)
      expect(b1.silentReason).toBe('level')
      expect(b2.level).toBe('medium')
    })
  })

  it('switches to a new activeSection at the next bar', () => {
    const a = section({ id: 'a', beatsPerBar: 4 })
    const b = section({ id: 'b', beatsPerBar: 3, subdivision: 'eighths' })
    const onA = makeSettings({ bpm: 60, sections: [a, b], activeSection: 0 })
    const onB = { ...onA, activeSection: 1 }
    const seq = createSequencer(onA, 0)
    take(seq, onA, 5) // bar 0 and the downbeat of bar 1
    const rest = take(seq, onB, 3)
    expect(rest.map((e) => [e.sectionIndex, e.totalBar, e.beat, e.beatsPerBar, e.sectionBar])).toEqual([
      [0, 1, 1, 4, 1],
      [0, 1, 2, 4, 1],
      [0, 1, 3, 4, 1],
    ])
    const next = take(seq, onB, 3)
    expect(next.map((e) => [e.sectionIndex, e.totalBar, e.beat, e.pulse, e.sectionBar])).toEqual([
      [1, 2, 0, 0, 0],
      [1, 2, 0, 1, 0],
      [1, 2, 1, 0, 0],
    ])
    expect(next[0].time).toBe(8)
    expect(next[0].sectionBars).toBeNull()
  })

  it('counts bars within the active section outside program mode', () => {
    const settings = makeSettings({ sections: [section({ id: 'a', bars: 2 })] })
    const starts = barStarts(createSequencer(settings, 0), settings, 5)
    expect(starts.map((e) => [e.sectionBar, e.totalBar, e.sectionBars])).toEqual([
      [0, 0, null],
      [1, 1, null],
      [2, 2, null],
      [3, 3, null],
      [4, 4, null],
    ])
  })

  it('starts at the active section outside program mode', () => {
    const settings = makeSettings({ sections: [section(), section({ beatsPerBar: 5 })], activeSection: 1 })
    const [first] = take(createSequencer(settings, 0), settings, 1)
    expect(first.sectionIndex).toBe(1)
    expect(first.beatsPerBar).toBe(5)
  })
})

// --- Gap trainer ---

describe('gap trainer', () => {
  function silentBars(settings: Settings, bars: number): number[] {
    const events = take(createSequencer(settings, 0), settings, bars * 4 * 2)
    const silent = new Set<number>()
    for (const event of events) {
      const isGap = event.silentReason === 'gap'
      expect(event.gapBar).toBe(isGap)
      if (isGap) {
        expect(event.silent).toBe(true)
        expect(event.role).toBeNull()
        expect(event.click).toBe(false)
        expect(event.gain).toBe(0)
        expect(event.voice).toBeNull()
        expect(event.voiceGain).toBe(0)
        silent.add(event.totalBar)
      }
    }
    // Every pulse of a gap bar is silent.
    for (const event of events) expect(event.gapBar).toBe(silent.has(event.totalBar))
    return [...silent]
  }

  const base = makeSettings({
    sections: [section({ subdivision: 'eighths' })],
    voice: { enabled: true, pack: 'en-male', subdivisions: true, clicks: true },
  })

  it('plays 2 bars, then silences 1', () => {
    expect(silentBars({ ...base, gap: { enabled: true, playBars: 2, muteBars: 1 } }, 9)).toEqual([2, 5, 8])
  })

  it('alternates with 1 : 1', () => {
    expect(silentBars({ ...base, gap: { enabled: true, playBars: 1, muteBars: 1 } }, 8)).toEqual([1, 3, 5, 7])
  })

  it('supports long silences', () => {
    expect(silentBars({ ...base, gap: { enabled: true, playBars: 1, muteBars: 3 } }, 8)).toEqual([1, 2, 3, 5, 6, 7])
  })

  it('does nothing while disabled', () => {
    expect(silentBars({ ...base, gap: { enabled: false, playBars: 1, muteBars: 1 } }, 6)).toEqual([])
  })

  it('restarts the count when re-enabled', () => {
    const on = { ...base, gap: { enabled: true, playBars: 2, muteBars: 1 } }
    const off = { ...on, gap: { ...on.gap, enabled: false } }
    const seq = createSequencer(on, 0)
    const events = [
      ...take(seq, on, 8 * 1 + 3), // bar 0 and part of bar 1
      ...take(seq, off, 8 * 2), // rest of bar 1, bar 2 and the first pulses of bar 3 (would have been bar 2 = gap)
      ...take(seq, on, 8 * 5 - 3), // rest of bar 3 (started disabled, plays), then bars 4.. count from 0
    ]
    const gapBars = [...new Set(events.filter((e) => e.gapBar).map((e) => e.totalBar))]
    expect(gapBars).toEqual([6])
  })

  it('restarts the count when toggled off and on within one bar', () => {
    const on = { ...base, gap: { enabled: true, playBars: 2, muteBars: 1 } }
    const off = { ...on, gap: { ...on.gap, enabled: false } }
    const seq = createSequencer(on, 0)
    const events = [
      ...take(seq, on, 8 + 2), // bar 0 and the start of bar 1
      ...take(seq, off, 1),
      ...take(seq, on, 8 * 4 - 3), // rest of bar 1 (still counted), then bars 2.. count from 0
    ]
    const gapBars = [...new Set(events.filter((e) => e.gapBar).map((e) => e.totalBar))]
    expect(gapBars).toEqual([4])
  })

  it('un-silences immediately when disabled during a gap bar', () => {
    const on = { ...base, gap: { enabled: true, playBars: 1, muteBars: 1 } }
    const off = { ...on, gap: { ...on.gap, enabled: false } }
    const seq = createSequencer(on, 0)
    take(seq, on, 9) // bar 0 and the downbeat of bar 1 (gap)
    const [next] = take(seq, off, 1)
    expect(next.totalBar).toBe(1)
    expect(next.silent).toBe(false)
    expect(next.gapBar).toBe(false)
  })

  it('applies new ratios from the next bar', () => {
    const twoOne = { ...base, gap: { enabled: true, playBars: 2, muteBars: 1 } }
    const oneOne = { ...base, gap: { enabled: true, playBars: 1, muteBars: 1 } }
    const seq = createSequencer(twoOne, 0)
    const bar0 = take(seq, twoOne, 4)
    const later = take(seq, oneOne, 8 * 4 - 4)
    const gapBars = [...new Set([...bar0, ...later].filter((e) => e.gapBar).map((e) => e.totalBar))]
    // counter 0, 1, 2, 3 with 1 : 1 from bar 0's second half on.
    expect(gapBars).toEqual([1, 3])
  })

  it('counts across program sections', () => {
    const settings: Settings = {
      ...base,
      sections: [section({ bars: 1 }), section({ bars: 1, beatsPerBar: 3 })],
      program: { enabled: true, loop: true },
      gap: { enabled: true, playBars: 2, muteBars: 1 },
    }
    const starts = barStarts(createSequencer(settings, 0), settings, 6)
    expect(starts.map((e) => e.gapBar)).toEqual([false, false, true, false, false, true])
  })
})

// --- Random mute and beat levels ---

describe('random mute', () => {
  const settings = makeSettings({
    sections: [section({ subdivision: 'eighths' })],
    randomMute: { enabled: true, percent: 50 },
  })

  it('silences whole beats when random() < percent / 100', () => {
    const source = sequence([0.1, 0.9, 0.3, 0.6, 0.5, 0.49])
    const events = take(createSequencer(settings, 0, source), settings, 12)
    const silentBeats = events.filter((e) => e.silent).map((e) => `${e.totalBar}.${e.beat}.${e.pulse}`)
    expect(silentBeats).toEqual(['0.0.0', '0.0.1', '0.2.0', '0.2.1', '1.1.0', '1.1.1'])
    for (const event of events.filter((e) => e.silent)) {
      expect(event.silentReason).toBe('random')
      expect(event.role).toBeNull()
      expect(event.click).toBe(false)
      expect(event.gain).toBe(0)
      expect(event.gapBar).toBe(false)
    }
    // One draw per beat, never per subdivision pulse.
    expect(source.calls()).toBe(6)
  })

  it('never silences at 0 % and always at 100 %', () => {
    const never = { ...settings, randomMute: { enabled: true, percent: 0 } }
    expect(take(createSequencer(never, 0, { random: () => 0 }), never, 16).some((e) => e.silent)).toBe(false)
    const always = { ...settings, randomMute: { enabled: true, percent: 100 } }
    expect(take(createSequencer(always, 0, { random: () => 0.999999 }), always, 16).every((e) => e.silent)).toBe(true)
  })

  it('does not draw while disabled', () => {
    const disabled = { ...settings, randomMute: { enabled: false, percent: 50 } }
    const source = sequence([0])
    const events = take(createSequencer(disabled, 0, source), disabled, 16)
    expect(events.some((e) => e.silent)).toBe(false)
    expect(source.calls()).toBe(0)
  })

  it('takes effect from the next beat when enabled, and stops at once when disabled', () => {
    const disabled = { ...settings, randomMute: { enabled: false, percent: 50 } }
    const seq = createSequencer(disabled, 0, { random: () => 0 })
    take(seq, disabled, 1) // downbeat of beat 0
    const [offbeat, beat1] = take(seq, settings, 2)
    expect(offbeat.silent).toBe(false)
    expect(beat1.silentReason).toBe('random')
    const [beat1Offbeat] = take(seq, disabled, 1)
    expect(beat1Offbeat.silent).toBe(false)
  })

  it('yields to the gap trainer and overrides muted beats', () => {
    const combined: Settings = {
      ...settings,
      sections: [section({ beats: ['accent', 'mute', 'normal', 'normal'] })],
      gap: { enabled: true, playBars: 1, muteBars: 1 },
      randomMute: { enabled: true, percent: 50 },
    }
    const events = take(createSequencer(combined, 0, { random: () => 0 }), combined, 8)
    expect(events.map((e) => e.silentReason)).toEqual([
      'random',
      'random',
      'random',
      'random',
      'gap',
      'gap',
      'gap',
      'gap',
    ])
  })
})

describe('beat levels', () => {
  const settings = makeSettings({
    sections: [section({ beats: ['accent', 'mute', 'medium', 'normal'], subdivision: 'eighths' })],
  })
  const events = take(createSequencer(settings, 0), settings, 8)

  it('plays roles and gains per level', () => {
    const summary = events.map((e) => [e.level, e.pulse, e.role, e.gain, e.silent, e.silentReason])
    expect(summary).toEqual([
      ['accent', 0, 'accent', 1, false, null],
      ['accent', 1, 'sub', 1, false, null],
      ['mute', 0, null, 0, true, 'level'],
      ['mute', 1, null, 0, true, 'level'],
      ['medium', 0, 'medium', 1, false, null],
      ['medium', 1, 'sub', 1, false, null],
      ['normal', 0, 'beat', 1, false, null],
      ['normal', 1, 'sub', 1, false, null],
    ])
  })

  it('clicks every audible pulse when the voice is off', () => {
    expect(events.map((e) => e.click)).toEqual([true, true, false, false, true, true, true, true])
    expect(events.every((e) => e.voice === null && e.voiceGain === 0)).toBe(true)
    expect(events.every((e) => !e.gapBar)).toBe(true)
  })

  it('treats a missing level as normal', () => {
    const short = makeSettings({ sections: [{ ...section(), beats: ['medium'] }] })
    const shortEvents = take(createSequencer(short, 0), short, 4)
    expect(shortEvents.map((e) => e.level)).toEqual(['medium', 'normal', 'normal', 'normal'])
  })
})

// --- Voice ---

describe('voice counting', () => {
  const voice = (patch: Partial<Settings['voice']> = {}): Settings['voice'] => ({
    enabled: true,
    pack: 'en-male',
    subdivisions: false,
    clicks: true,
    ...patch,
  })

  it('speaks beat numbers with level-dependent gain', () => {
    const settings = makeSettings({
      sections: [section({ beats: ['accent', 'normal', 'medium', 'normal'], subdivision: 'eighths' })],
      voice: voice(),
    })
    const events = take(createSequencer(settings, 0), settings, 8)
    expect(events.map((e) => e.voice)).toEqual(['1', null, '2', null, '3', null, '4', null])
    expect(events.map((e) => e.voiceGain)).toEqual([1, 0, 0.8, 0, 0.9, 0, 0.8, 0])
    expect(events.every((e) => e.click)).toBe(true)
  })

  it('speaks subdivision syllables when asked', () => {
    const settings = makeSettings({ sections: [section({ subdivision: 'sixteenths' })], voice: voice({ subdivisions: true }) })
    const events = take(createSequencer(settings, 0), settings, 8)
    expect(events.map((e) => e.voice)).toEqual(['1', 'e', 'and', 'a', '2', 'e', 'and', 'a'])
    expect(events.map((e) => e.voiceGain)).toEqual([1, SUB_VOICE_GAIN, SUB_VOICE_GAIN, SUB_VOICE_GAIN, 0.8, 0.6, 0.6, 0.6])
  })

  it.each<[SubdivisionId, (string | null)[]]>([
    ['triplets', ['1', 'trip', 'let']],
    ['sextuplets', ['1', 'trip', 'let', 'and', 'trip', 'let']],
    ['quintuplets', ['1', null, null, null, null]],
    ['swing', ['1', 'and']],
    ['gallop', ['1', 'and', 'a']],
    ['reverse-gallop', ['1', 'e', 'and']],
    ['dotted', ['1', 'a']],
  ])('uses the %s syllables', (subdivision, words) => {
    const settings = makeSettings({ sections: [section({ subdivision })], voice: voice({ subdivisions: true }) })
    const events = take(createSequencer(settings, 0), settings, words.length)
    expect(events.map((e) => e.voice)).toEqual(words)
  })

  it('counts up to 16', () => {
    const settings = makeSettings({ sections: [section({ beatsPerBar: MAX_BEATS_PER_BAR })], voice: voice() })
    const events = take(createSequencer(settings, 0), settings, 17)
    expect(events.map((e) => e.voice)).toEqual([...BEAT_WORDS, '1'])
  })

  it('replaces the click where it speaks when clicks are off', () => {
    const settings = makeSettings({
      sections: [section({ subdivision: 'quintuplets' })],
      voice: voice({ subdivisions: true, clicks: false }),
    })
    const events = take(createSequencer(settings, 0), settings, 5)
    expect(events.map((e) => e.click)).toEqual([false, true, true, true, true])
    // The role still says which click would play.
    expect(events.map((e) => e.role)).toEqual(['accent', 'sub', 'sub', 'sub', 'sub'])
  })

  it('keeps subdivision clicks when only beats are spoken', () => {
    const settings = makeSettings({ sections: [section({ subdivision: 'eighths' })], voice: voice({ clicks: false }) })
    const events = take(createSequencer(settings, 0), settings, 4)
    expect(events.map((e) => [e.voice, e.click])).toEqual([
      ['1', false],
      [null, true],
      ['2', false],
      [null, true],
    ])
  })

  it('stays quiet when disabled', () => {
    const settings = makeSettings({
      sections: [section({ subdivision: 'sixteenths' })],
      voice: voice({ enabled: false, subdivisions: true, clicks: false }),
    })
    const events = take(createSequencer(settings, 0), settings, 8)
    expect(events.every((e) => e.voice === null && e.voiceGain === 0 && e.click)).toBe(true)
  })

  it('does not speak on silent pulses', () => {
    const settings = makeSettings({ sections: [section({ beats: ['mute', 'normal', 'normal', 'normal'] })], voice: voice() })
    const [muted, spoken] = take(createSequencer(settings, 0), settings, 2)
    expect([muted.voice, muted.voiceGain, muted.click]).toEqual([null, 0, false])
    expect(spoken.voice).toBe('2')
  })
})

// --- Program mode ---

describe('program mode', () => {
  const a = section({ id: 'a', beatsPerBar: 4, bars: 2, tempo: 120 })
  const b = section({ id: 'b', beatsPerBar: 3, beatUnit: 8, bars: 1, tempo: 60 })
  const c = section({ id: 'c', beatsPerBar: 7, beatUnit: 8, bars: 1, tempo: null })
  const looping = makeSettings({ bpm: 180, sections: [a, b, c], program: { enabled: true, loop: true } })

  it('plays the sections in order with their meters and tempos, then loops', () => {
    const starts = barStarts(createSequencer(looping, 0), looping, 8)
    expect(starts.map((e) => [e.sectionIndex, e.sectionBar, e.sectionBars, e.beatsPerBar, e.bpm, e.totalBar])).toEqual([
      [0, 0, 2, 4, 120, 0],
      [0, 1, 2, 4, 120, 1],
      [1, 0, 1, 3, 60, 2],
      [2, 0, 1, 7, 180, 3],
      [0, 0, 2, 4, 120, 4],
      [0, 1, 2, 4, 120, 5],
      [1, 0, 1, 3, 60, 6],
      [2, 0, 1, 7, 180, 7],
    ])
    const cycle = 2 + 2 + 3 + 7 / 3
    const expected = [0, 2, 4, 7, cycle, cycle + 2, cycle + 4, cycle + 7]
    starts.forEach((event, i) => expectTime(event.time, expected[i]))
  })

  it('ends after the last section when not looping', () => {
    const once = { ...looping, program: { enabled: true, loop: false } }
    const seq = createSequencer(once, 0)
    const events = takeAll(seq, once)
    expect(events).toHaveLength(4 + 4 + 3 + 7)
    expect(events.at(-1)).toMatchObject({ sectionIndex: 2, beat: 6, totalBar: 3 })
    expect(seq.next(once)).toBeNull()
    expect(seq.peekTime(once)).toBeNull()
    // Ended is final, even if the program is switched to loop.
    expect(seq.next(looping)).toBeNull()
    expect(seq.peekTime(looping)).toBeNull()
  })

  it('starts at section 0 even when another section is active', () => {
    const settings = { ...looping, activeSection: 2 }
    expect(take(createSequencer(settings, 0), settings, 1)[0].sectionIndex).toBe(0)
  })

  it('uses the section tempo only in program mode, scaled by the percentage', () => {
    const scaled = { ...looping, tempoPercent: 50 }
    const starts = barStarts(createSequencer(scaled, 0), scaled, 4)
    expect(starts.map((e) => [e.baseBpm, e.bpm])).toEqual([
      [120, 60],
      [120, 60],
      [60, MIN_BPM], // 60 × 50 % is below the slowest tempo
      [180, 90],
    ])
  })

  it('switches tempo exactly at the section boundary', () => {
    const settings = makeSettings({
      sections: [
        section({ beatsPerBar: 4, bars: 1, tempo: 120, subdivision: 'eighths' }),
        section({ beatsPerBar: 2, bars: 1, tempo: 60, subdivision: 'eighths' }),
      ],
      program: { enabled: true, loop: false },
    })
    const events = takeAll(createSequencer(settings, 0), settings)
    expect(events.map((e) => e.time)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5])
    expect(events[7].duration).toBe(0.25)
    expect(events.at(-1)?.duration).toBe(0.5)
  })

  it('loops a single section', () => {
    const settings = makeSettings({ sections: [section({ bars: 2 })], program: { enabled: true, loop: true } })
    const starts = barStarts(createSequencer(settings, 0), settings, 5)
    expect(starts.map((e) => [e.sectionIndex, e.sectionBar])).toEqual([
      [0, 0],
      [0, 1],
      [0, 0],
      [0, 1],
      [0, 0],
    ])
  })

  it('continues from the current section and its bar count when switched on during playback', () => {
    const simple = { ...looping, program: { enabled: false, loop: true }, activeSection: 1 }
    const program = { ...looping, activeSection: 1 }
    const seq = createSequencer(simple, 0)
    barStarts(seq, simple, 3) // section b, bars 0..2 (sectionBar 2 ≥ b.bars)
    take(seq, simple, 1)
    const starts = barStarts(seq, program, 3)
    expect(starts.map((e) => [e.sectionIndex, e.sectionBar, e.sectionBars])).toEqual([
      [2, 0, 1],
      [0, 0, 2],
      [0, 1, 2],
    ])
  })

  it('keeps counting the current section when switched on before it is finished', () => {
    const simple = { ...looping, program: { enabled: false, loop: true }, activeSection: 0 }
    const seq = createSequencer(simple, 0)
    take(seq, simple, 1)
    const starts = barStarts(seq, looping, 3)
    expect(starts.map((e) => [e.sectionIndex, e.sectionBar])).toEqual([
      [0, 1],
      [1, 0],
      [2, 0],
    ])
  })

  it('returns to the active section when switched off', () => {
    const seq = createSequencer(looping, 0)
    barStarts(seq, looping, 3) // a, a, b
    const simple = { ...looping, program: { enabled: false, loop: true }, activeSection: 0 }
    const rest = take(seq, simple, 2)
    // Bar 2 stays on b until it ends, at the global tempo now.
    expect(rest.map((e) => [e.sectionIndex, e.bpm, e.sectionBars])).toEqual([
      [1, 180, null],
      [1, 180, null],
    ])
    expect(barStarts(seq, simple, 1)[0]).toMatchObject({ sectionIndex: 0, sectionBar: 0, totalBar: 3 })
  })

  it('survives removing sections during playback', () => {
    const seq = createSequencer(looping, 0)
    barStarts(seq, looping, 3) // now in b (index 1)
    // Removing an earlier section: b keeps playing, now at index 0, and c follows.
    const withoutA = { ...looping, sections: [b, c] }
    const [inB] = take(seq, withoutA, 1)
    expect([inB.sectionIndex, inB.beatsPerBar, inB.totalBar]).toEqual([0, 3, 2])
    const next = barStarts(seq, withoutA, 3)
    expect(next.map((e) => [e.sectionIndex, e.beatsPerBar])).toEqual([
      [1, 7],
      [0, 3],
      [1, 7],
    ])
  })

  it('continues from the clamped section when the playing one is removed', () => {
    const seq = createSequencer(looping, 0)
    barStarts(seq, looping, 4) // now in c (index 2)
    const onlyAB = { ...looping, sections: [a, b] }
    const [clamped] = take(seq, onlyAB, 1)
    expect(clamped.sectionIndex).toBe(1)
    expect(clamped.beatsPerBar).toBe(3)
    // Bar 3 finishes as b (3 beats) with c's bar count, then the program wraps to a.
    const starts = barStarts(seq, onlyAB, 2)
    expect(starts.map((e) => [e.sectionIndex, e.totalBar])).toEqual([
      [0, 4],
      [0, 5],
    ])
  })

  it('clamps when every section after the first is removed in simple mode', () => {
    const settings = makeSettings({ sections: [a, b, c], activeSection: 2 })
    const seq = createSequencer(settings, 0)
    take(seq, settings, 2)
    const onlyA = { ...settings, sections: [a], activeSection: 0 }
    const events = take(seq, onlyA, 12)
    expect(events.every((e) => e.sectionIndex === 0)).toBe(true)
    for (let i = 1; i < events.length; i++) expect(events[i].time).toBeGreaterThan(events[i - 1].time)
  })

  it('follows a section that was moved', () => {
    const seq = createSequencer(looping, 0)
    barStarts(seq, looping, 3) // in b
    const reordered = { ...looping, sections: [b, a, c] }
    const starts = barStarts(seq, reordered, 2)
    // After b (now index 0) comes a (index 1).
    expect(starts.map((e) => [e.sectionIndex, e.beatsPerBar])).toEqual([
      [1, 4],
      [1, 4],
    ])
  })
})

// --- Practice mode ---

describe('practice mode', () => {
  function practiceBars(patch: Partial<PracticeSettings>, bars: number, extra: Partial<Settings> = {}) {
    const settings = makeSettings({ practice: practice(patch), ...extra })
    return barStarts(createSequencer(settings, 0), settings, bars)
  }

  const bpms = (starts: PulseEvent[]) => starts.map((e) => e.baseBpm)

  it('steps up and holds at the target', () => {
    const starts = practiceBars({ atTarget: 'hold' }, 12)
    expect(bpms(starts)).toEqual([100, 100, 105, 105, 110, 110, 110, 110, 110, 110, 110, 110])
    expect(starts.map((e) => e.practice?.direction)).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(starts.slice(0, 6).map((e) => e.practice?.barsAtTempo)).toEqual([0, 1, 0, 1, 0, 1])
    expect(starts.every((e) => e.practice?.everyBars === 2)).toBe(true)
  })

  it('restarts from the start tempo', () => {
    expect(bpms(practiceBars({ atTarget: 'restart' }, 14))).toEqual([
      100, 100, 105, 105, 110, 110, 100, 100, 105, 105, 110, 110, 100, 100,
    ])
  })

  it('ping-pongs between start and target', () => {
    const starts = practiceBars({ atTarget: 'reverse' }, 18)
    expect(bpms(starts)).toEqual([
      100, 100, 105, 105, 110, 110, 105, 105, 100, 100, 105, 105, 110, 110, 105, 105, 100, 100,
    ])
    expect(starts.map((e) => e.practice?.direction)).toEqual([
      1, 1, 1, 1, 1, 1, -1, -1, -1, -1, 1, 1, 1, 1, -1, -1, -1, -1,
    ])
  })

  it('stops after everyBars bars at the target', () => {
    const settings = makeSettings({ practice: practice({ atTarget: 'stop' }) })
    const seq = createSequencer(settings, 0)
    const events = takeAll(seq, settings)
    expect(events).toHaveLength(6 * 4)
    expect(events.at(-1)).toMatchObject({ totalBar: 5, beat: 3, baseBpm: 110 })
    expect(seq.next(settings)).toBeNull()
  })

  it('decreases when the target is below the start', () => {
    const starts = practiceBars({ startBpm: 120, targetBpm: 100, stepBpm: 10, everyBars: 1, atTarget: 'reverse' }, 9)
    expect(bpms(starts)).toEqual([120, 110, 100, 110, 120, 110, 100, 110, 120])
    expect(starts.map((e) => e.practice?.direction)).toEqual([-1, -1, -1, 1, 1, -1, -1, 1, 1])
    const hold = practiceBars({ startBpm: 120, targetBpm: 100, stepBpm: 10, everyBars: 1 }, 5)
    expect(bpms(hold)).toEqual([120, 110, 100, 100, 100])
    const restart = practiceBars({ startBpm: 90, targetBpm: 80, stepBpm: 10, everyBars: 1, atTarget: 'restart' }, 5)
    expect(bpms(restart)).toEqual([90, 80, 90, 80, 90])
  })

  it('lands exactly on the target when a step would pass it', () => {
    expect(bpms(practiceBars({ startBpm: 100, targetBpm: 112, stepBpm: 5, everyBars: 1 }, 5))).toEqual([
      100, 105, 110, 112, 112,
    ])
    expect(
      bpms(practiceBars({ startBpm: 100, targetBpm: 112, stepBpm: 5, everyBars: 1, atTarget: 'reverse' }, 8)),
    ).toEqual([100, 105, 110, 112, 107, 102, 100, 105])
    expect(bpms(practiceBars({ startBpm: 100, targetBpm: 103, stepBpm: 50, everyBars: 1 }, 3))).toEqual([
      100, 103, 103,
    ])
  })

  it('holds forever when start equals target, whatever atTarget says', () => {
    for (const atTarget of ['hold', 'restart', 'reverse', 'stop'] as PracticeAtTarget[]) {
      const starts = practiceBars({ startBpm: 100, targetBpm: 100, everyBars: 1, atTarget }, 10)
      expect(starts).toHaveLength(10)
      expect(bpms(starts).every((bpm) => bpm === 100)).toBe(true)
      expect(starts.every((e) => e.practice?.direction === 0)).toBe(true)
    }
  })

  it('clamps practice tempos to MIN_BPM..MAX_BPM', () => {
    expect(bpms(practiceBars({ startBpm: 290, targetBpm: 400, stepBpm: 4, everyBars: 1 }, 6))).toEqual([
      290, 294, 298, 300, 300, 300,
    ])
    expect(bpms(practiceBars({ startBpm: 40, targetBpm: 75, stepBpm: 5, everyBars: 1 }, 5))).toEqual([
      MIN_BPM, 65, 70, 75, 75,
    ])
    const fast = practiceBars({ startBpm: 280, targetBpm: 300, stepBpm: 10, everyBars: 1 }, 3, { tempoPercent: 150 })
    expect(fast.map((e) => e.bpm)).toEqual([MAX_BPM, MAX_BPM, MAX_BPM])
    expect(bpms(fast)).toEqual([280, 290, 300])
  })

  it('overrides the global and section tempos, under the tempo percentage', () => {
    const starts = practiceBars({}, 3, {
      bpm: 200,
      tempoPercent: 75,
      sections: [section({ tempo: 90, bars: 1 })],
      program: { enabled: true, loop: true },
    })
    expect(starts.map((e) => [e.baseBpm, e.bpm])).toEqual([
      [100, 75],
      [100, 75],
      [105, 78.75],
    ])
  })

  it('applies a new practice tempo from the bar start', () => {
    const settings = makeSettings({ practice: practice(), sections: [section({ subdivision: 'eighths' })] })
    const events = take(createSequencer(settings, 0), settings, 8 * 4)
    const bar2 = 8 * 0.6
    expectTime(events[16].time, bar2)
    expectTime(events[15].time, bar2 - 0.3)
    expect(events[15].bpm).toBe(100)
    events.slice(16).forEach((event, i) => {
      expect(event.bpm).toBe(105)
      expectTime(event.time, bar2 + (i * 0.5 * 60) / 105)
    })
  })

  it('reports null practice state while disabled', () => {
    const settings = makeSettings()
    expect(take(createSequencer(settings, 0), settings, 4).every((e) => e.practice === null)).toBe(true)
  })

  it('restarts when the practice settings change', () => {
    const original = makeSettings({ practice: practice() })
    const changed = { ...original, practice: practice({ stepBpm: 2 }) }
    const seq = createSequencer(original, 0)
    barStarts(seq, original, 3) // bar 2 at 105 has started
    // The change takes effect at the next bar start; until then bar 2 continues at 105.
    const [inBar2] = take(seq, changed, 1)
    expect(inBar2.baseBpm).toBe(105)
    const starts = barStarts(seq, changed, 6)
    expect(bpms(starts)).toEqual([100, 100, 102, 102, 104, 104])
    expect(starts[0].practice).toEqual({ bpm: 100, barsAtTempo: 0, everyBars: 2, direction: 1 })
  })

  it('restarts when re-enabled, from the next bar', () => {
    const on = makeSettings({ bpm: 120, practice: practice() })
    const off = { ...on, practice: { ...on.practice, enabled: false } }
    const seq = createSequencer(on, 0)
    barStarts(seq, on, 3) // bar 2 at 105
    // Disabling applies at once: the global tempo is back.
    const [disabled] = take(seq, off, 1)
    expect([disabled.baseBpm, disabled.practice]).toEqual([120, null])
    // Re-enabled mid-bar: the bar finishes at the global tempo, the next starts over.
    const [stillOff] = take(seq, on, 1)
    expect([stillOff.baseBpm, stillOff.practice]).toEqual([120, null])
    const starts = barStarts(seq, on, 3)
    expect(bpms(starts)).toEqual([100, 100, 105])
    expect(starts[0].practice).toEqual({ bpm: 100, barsAtTempo: 0, everyBars: 2, direction: 1 })
  })

  it('starts at the next bar when enabled during playback', () => {
    const off = makeSettings({ bpm: 120 })
    const on = { ...off, practice: practice() }
    const seq = createSequencer(off, 0)
    take(seq, off, 2)
    const rest = take(seq, on, 2)
    expect(rest.map((e) => [e.baseBpm, e.practice])).toEqual([
      [120, null],
      [120, null],
    ])
    expect(bpms(barStarts(seq, on, 3))).toEqual([100, 100, 105])
  })

  it('stops at bar granularity with program sections', () => {
    const settings = makeSettings({
      sections: [section({ beatsPerBar: 3, bars: 1 }), section({ beatsPerBar: 5, bars: 1 })],
      program: { enabled: true, loop: true },
      practice: practice({ everyBars: 1, atTarget: 'stop' }),
    })
    const events = takeAll(createSequencer(settings, 0), settings)
    // 100, 105, 110 then stop after one bar at 110: bars of 3, 5, 3 beats.
    expect(events).toHaveLength(3 + 5 + 3)
  })
})

// --- Robustness ---

describe('robustness', () => {
  it('falls back to a 4/4 bar when there are no sections at all', () => {
    const settings = { ...makeSettings(), sections: [] }
    const events = take(createSequencer(settings, 0), settings, 5)
    expect(events.map((e) => [e.beat, e.totalBar])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [0, 1],
    ])
  })

  it('tolerates unsanitized numbers', () => {
    const settings = makeSettings({
      bpm: Number.NaN,
      tempoPercent: Number.NaN,
      activeSection: 7,
      sections: [{ ...section(), beatsPerBar: 0, bars: Number.NaN, beats: ['bogus' as BeatLevel] }],
      gap: { enabled: true, playBars: Number.NaN, muteBars: -1 },
      practice: practice({ stepBpm: 0, everyBars: Number.NaN }),
    })
    const events = take(createSequencer(settings, 0), settings, 20)
    for (const event of events) {
      expect(Number.isFinite(event.time)).toBe(true)
      expect(event.beatsPerBar).toBe(1)
      expect(event.level).toBe('normal')
      expect(event.silent).toBe(false)
    }
    // One-beat bars, step 1 every bar: 100, 101, … 110, then hold.
    expect(events.map((e) => e.baseBpm)).toEqual([
      100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 110, 110, 110, 110, 110, 110, 110, 110, 110,
    ])
  })

  it('stays monotonic and consistent under random live edits', () => {
    const subdivisionIds = SUBDIVISIONS.map((s) => s.id)
    const levels: BeatLevel[] = ['accent', 'normal', 'medium', 'mute']
    const atTargets: PracticeAtTarget[] = ['hold', 'restart', 'reverse', 'stop']

    for (const seed of [1, 42, 2024, 31337]) {
      const rand = prng(seed)
      const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))
      const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]
      const randomSection = () =>
        section({
          beatsPerBar: int(1, MAX_BEATS_PER_BAR),
          beats: Array.from({ length: MAX_BEATS_PER_BAR }, () => pick(levels)),
          beatUnit: pick([2, 4, 8, 16] as const),
          subdivision: pick(subdivisionIds),
          bars: int(1, 4),
          tempo: rand() < 0.5 ? null : int(MIN_BPM, MAX_BPM),
        })
      const fixBeats = (s: Section): Section => ({ ...s, beats: resizeBeats(s.beats, s.beatsPerBar) })

      let settings = makeSettings({ sections: [fixBeats(randomSection())] })
      let seq = createSequencer(settings, 0, { random: rand })
      let previous: PulseEvent | null = null
      let previousOffset = 0
      let edited = false
      let produced = 0
      let restarts = 0

      for (let step = 0; step < 6000; step++) {
        if (rand() < 0.15) {
          edited = true
          const sections = settings.sections
          switch (int(0, 13)) {
            case 0:
              settings = { ...settings, bpm: int(MIN_BPM, MAX_BPM) }
              break
            case 1:
              settings = { ...settings, tempoPercent: int(25, 200) }
              break
            case 2:
              settings = patchSection(settings, int(0, sections.length - 1), { subdivision: pick(subdivisionIds) })
              break
            case 3:
              settings = patchSection(settings, int(0, sections.length - 1), { beatsPerBar: int(1, MAX_BEATS_PER_BAR) })
              break
            case 4:
              if (sections.length < 6) settings = { ...settings, sections: [...sections, fixBeats(randomSection())] }
              break
            case 5:
              if (sections.length > 1) {
                const removed = int(0, sections.length - 1)
                const rest = sections.filter((_, i) => i !== removed)
                settings = { ...settings, sections: rest, activeSection: Math.min(settings.activeSection, rest.length - 1) }
              }
              break
            case 6:
              settings = { ...settings, activeSection: int(0, sections.length - 1) }
              break
            case 7:
              settings = { ...settings, program: { enabled: rand() < 0.5, loop: rand() < 0.8 } }
              break
            case 8:
              settings = { ...settings, gap: { enabled: rand() < 0.5, playBars: int(1, 3), muteBars: int(1, 3) } }
              break
            case 9:
              settings = { ...settings, randomMute: { enabled: rand() < 0.5, percent: int(0, 100) } }
              break
            case 10:
              settings = {
                ...settings,
                practice: {
                  enabled: rand() < 0.5,
                  startBpm: int(MIN_BPM, MAX_BPM),
                  targetBpm: int(MIN_BPM, MAX_BPM),
                  stepBpm: int(1, 50),
                  everyBars: int(1, 3),
                  atTarget: pick(atTargets),
                },
              }
              break
            case 11:
              settings = { ...settings, voice: { ...settings.voice, enabled: rand() < 0.5, subdivisions: rand() < 0.5, clicks: rand() < 0.5 } }
              break
            case 12:
              settings = patchSection(settings, int(0, sections.length - 1), {
                tempo: rand() < 0.5 ? null : int(MIN_BPM, MAX_BPM),
              })
              break
            default:
              settings = patchSection(settings, int(0, sections.length - 1), {
                beats: Array.from({ length: MAX_BEATS_PER_BAR }, () => pick(levels)),
              })
              settings = { ...settings, sections: settings.sections.map(fixBeats) }
          }
        }

        const peek = seq.peekTime(settings)
        const event = seq.next(settings)
        if (!event) {
          expect(peek).toBeNull()
          expect(seq.next(settings)).toBeNull()
          // Ended (program without loop, or practice 'stop'): start again right after the last pulse.
          restarts++
          const resume = (previous?.time ?? 0) + 1
          seq = createSequencer(settings, resume, { random: rand })
          previous = null
          edited = false
          continue
        }
        produced++
        expect(event.time).toBe(peek)

        expect(Number.isFinite(event.time)).toBe(true)
        expect(event.duration).toBeGreaterThan(0)
        expect(event.bpm).toBeGreaterThanOrEqual(MIN_BPM)
        expect(event.bpm).toBeLessThanOrEqual(MAX_BPM)
        expectTime(event.beatDuration, 60 / event.bpm)
        expect(event.beat).toBeGreaterThanOrEqual(0)
        expect(event.beat).toBeLessThan(event.beatsPerBar)
        expect(event.pulse).toBeLessThan(event.pulsesInBeat)
        expect(event.sectionIndex).toBeLessThan(settings.sections.length)
        expect(event.beatsPerBar).toBe(settings.sections[event.sectionIndex].beatsPerBar)
        if (event.silent) {
          expect([event.role, event.click, event.gain, event.voice, event.voiceGain]).toEqual([null, false, 0, null, 0])
        } else {
          expect(event.role).not.toBeNull()
          expect(event.silentReason).toBeNull()
        }
        if (event.practice) {
          expect(settings.practice.enabled).toBe(true)
          expect(event.practice.bpm).toBe(event.baseBpm)
        }

        const offset = getSubdivision(settings.sections[event.sectionIndex].subdivision).pulses[event.pulse]
        if (previous) {
          const gap = event.time - previous.time
          expect(gap).toBeGreaterThan(1e-3)
          // At most one beat at the slowest tempo.
          expect(gap).toBeLessThanOrEqual(60 / MIN_BPM + TOLERANCE)
          if (event.totalBar === previous.totalBar) {
            // Position within the bar only moves forward.
            expect(event.beat > previous.beat || (event.beat === previous.beat && offset > previousOffset)).toBe(true)
          } else {
            expect(event.totalBar).toBe(previous.totalBar + 1)
            expect([event.beat, event.pulse]).toEqual([0, 0])
          }
          // Without edits, each pulse lands exactly where the previous one said it would.
          if (!edited) expectTime(gap, previous.duration)
        }
        previous = event
        previousOffset = offset
        edited = false
      }
      expect(produced).toBeGreaterThan(5000)
      expect(restarts).toBeLessThan(200)
    }
  })
})
