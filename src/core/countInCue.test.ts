import { describe, expect, it } from 'vitest'
import { sectionAnnouncement } from './announce'
import { createSequencer } from './sequencer'
import { createDefaultSettings, createSection, playbackSettings } from './settings'
import type { PulseEvent, Settings } from './types'

/** A program of two sections: 2 bars of 3/4 ("A"), then 2 bars of 3/4 ("B"), the same signature. */
function program(patch: Partial<Settings> = {}): Settings {
  const d = createDefaultSettings()
  return {
    ...d,
    sections: [
      createSection({ name: 'A', beatsPerBar: 3, bars: 2 }),
      createSection({ name: 'B', beatsPerBar: 3, bars: 2 }),
    ],
    program: { enabled: true, loop: true, countIn: false },
    ...patch,
  }
}

/** The beat-1 pulses of the first `bars` bars. */
function downbeats(settings: Settings, bars: number): PulseEvent[] {
  const playback = playbackSettings(settings)
  const seq = createSequencer(playback, 0)
  const out: PulseEvent[] = []
  while (out.length < bars) {
    const pulse = seq.next(playback)
    if (pulse === null) break
    if (pulse.beat === 0 && pulse.pulse === 0) out.push(pulse)
  }
  return out
}

describe('count-in', () => {
  it('plays one bar of the start section before it, only once even when the program loops', () => {
    const bars = downbeats(program({ program: { enabled: true, loop: true, countIn: true } }), 6)
    expect(bars.map((p) => p.countIn)).toEqual([true, false, false, false, false, false])
    expect(bars[0].beatsPerBar).toBe(3)
    expect(bars[0].sectionIndex).toBe(0)
    // After the count-in: A bar 1, A bar 2, B bar 1, B bar 2, then the loop goes straight back to A.
    expect(bars.slice(1).map((p) => [p.sectionIndex, p.sectionBar])).toEqual([[0, 0], [0, 1], [1, 0], [1, 1], [0, 0]])
  })

  it('uses the meter of the selected section when playback starts there', () => {
    const base = program()
    const sections = [base.sections[0], createSection({ name: 'B', beatsPerBar: 5, beatUnit: 8, bars: 1 })]
    const settings = {
      ...base,
      sections,
      selected: { section: sections[1].id, part: sections[1].parts[0].id },
      program: { enabled: true, loop: false, countIn: true },
    }
    const bars = downbeats(settings, 3)
    expect(bars.map((p) => [p.countIn, p.sectionIndex, p.beatsPerBar])).toEqual([
      [true, 1, 5],
      [false, 1, 5],
    ])
  })

  it('is never silenced by the gap trainer, which starts counting after it', () => {
    const bars = downbeats(
      program({ program: { enabled: true, loop: true, countIn: true }, gap: { enabled: true, playBars: 1, muteBars: 1 } }),
      4,
    )
    expect(bars.map((p) => p.gapBar)).toEqual([false, false, true, false])
  })

  it('does nothing outside program mode', () => {
    const bars = downbeats(program({ program: { enabled: false, loop: true, countIn: true } }), 2)
    expect(bars.every((p) => !p.countIn)).toBe(true)
  })

  it('announces the first section on its first beat, and nothing else', () => {
    const settings = program({
      program: { enabled: true, loop: true, countIn: true },
      voice: { ...createDefaultSettings().voice, announceSections: true },
    })
    const playback = playbackSettings(settings)
    const seq = createSequencer(playback, 0)
    const said: [number, string][] = []
    for (let i = 0; i < 3 * 5; i++) {
      const pulse = seq.next(playback)
      if (!pulse) break
      const text = sectionAnnouncement(pulse, playback)
      if (text) said.push([pulse.totalBar, text])
    }
    // Bar 0 is the count-in; A's last bar (bar 2) announces B, B's last bar (bar 4) A again (the loop skips the count-in).
    expect(said).toEqual([[0, 'A'], [2, 'B'], [4, 'A']])
  })
})

describe('cue', () => {
  it('sounds on beat 1 of every section, even with the same signature', () => {
    const bars = downbeats(program({ cue: { sectionChange: true, every: false, everyBars: 4 } }), 5)
    expect(bars.map((p) => p.role)).toEqual(['cue', 'accent', 'cue', 'accent', 'cue'])
  })

  it('is not played in the count-in', () => {
    const bars = downbeats(
      program({ program: { enabled: true, loop: true, countIn: true }, cue: { sectionChange: true, every: false, everyBars: 4 } }),
      2,
    )
    expect(bars.map((p) => p.role)).toEqual(['accent', 'cue'])
  })

  it('sounds every N bars, counted from the start of each section', () => {
    const d = createDefaultSettings()
    const settings: Settings = {
      ...d,
      sections: [createSection({ name: 'A', bars: 3 }), createSection({ name: 'B', bars: 3 })],
      program: { enabled: true, loop: false, countIn: false },
      cue: { sectionChange: false, every: true, everyBars: 2 },
    }
    expect(downbeats(settings, 6).map((p) => p.role)).toEqual(['cue', 'accent', 'cue', 'cue', 'accent', 'cue'])
  })

  it('sounds every N bars on the free rhythm', () => {
    const settings: Settings = { ...createDefaultSettings(), cue: { sectionChange: false, every: true, everyBars: 3 } }
    expect(downbeats(settings, 7).map((p) => p.role === 'cue')).toEqual([true, false, false, true, false, false, true])
  })

  it('only replaces beat 1, and not when beat 1 is muted', () => {
    const d = createDefaultSettings()
    const settings: Settings = {
      ...d,
      current: { ...d.current, beats: ['mute', 'accent', 'normal', 'normal'] },
      cue: { sectionChange: false, every: true, everyBars: 1 },
    }
    const playback = playbackSettings(settings)
    const seq = createSequencer(playback, 0)
    const roles = Array.from({ length: 4 }, () => seq.next(playback)?.role)
    expect(roles).toEqual([null, 'accent', 'beat', 'beat'])
  })
})
