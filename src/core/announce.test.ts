import { describe, expect, it } from 'vitest'
import { sectionAnnouncement } from './announce'
import { createSequencer } from './sequencer'
import { beatsFromGrouping } from './meter'
import { createDefaultSettings, createSection, playbackSettings } from './settings'
import type { Section, Settings } from './types'

function program(sections: Section[], patch: Partial<Settings> = {}): Settings {
  const d = createDefaultSettings()
  return {
    ...d,
    sections,
    program: { enabled: true, loop: false },
    voice: { ...d.voice, announceSections: true },
    ...patch,
  }
}

/** Each announcement with the 0-based bar (and beat) of playback it falls on. */
function announcements(settings: Settings, maxPulses = 400, withBeat = false): { bar: number; beat?: number; text: string }[] {
  const playback = playbackSettings(settings)
  const sequencer = createSequencer(playback, 0)
  const found: { bar: number; beat?: number; text: string }[] = []
  for (let i = 0; i < maxPulses; i++) {
    const pulse = sequencer.next(playback)
    if (!pulse) break
    const text = sectionAnnouncement(pulse, playback)
    if (text !== null) found.push(withBeat ? { bar: pulse.totalBar, beat: pulse.beat, text } : { bar: pulse.totalBar, text })
  }
  return found
}

const song = () => [
  createSection({ name: 'Intro', bars: 2 }),
  createSection({ name: 'Verse', bars: 3 }),
  createSection({ name: '  ', bars: 1 }),
]

describe('sectionAnnouncement', () => {
  it('announces the first section at the start, then each next section on the last bar before it', () => {
    expect(announcements(program(song()))).toEqual([
      { bar: 0, text: 'Intro' },
      { bar: 1, text: 'Verse' },
      { bar: 4, text: 'Section 3' },
    ])
  })

  it('wraps to the first section when the program loops', () => {
    const found = announcements(program(song(), { program: { enabled: true, loop: true } }), 4 * 4 * 8)
    expect(found.slice(0, 5)).toEqual([
      { bar: 0, text: 'Intro' },
      { bar: 1, text: 'Verse' },
      { bar: 4, text: 'Section 3' },
      { bar: 5, text: 'Intro' },
      { bar: 7, text: 'Verse' },
    ])
  })

  it('counts a section with several parts and repeats as one section', () => {
    const sections = [
      createSection({ name: 'A', parts: [{ bars: 1 }, { beatsPerBar: 3, bars: 1 }], repeats: 2 }),
      createSection({ name: 'B', bars: 1 }),
    ]
    expect(announcements(program(sections))).toEqual([
      { bar: 0, text: 'A' },
      { bar: 3, text: 'B' },
    ])
  })

  it('stays quiet when off, outside program mode, or for a single section', () => {
    const d = createDefaultSettings()
    expect(announcements(program(song(), { voice: d.voice }))).toEqual([])
    expect(announcements(program(song(), { program: { enabled: false, loop: false } }), 64)).toEqual([])
    const single = program([createSection({ name: 'Only', bars: 2 })], { program: { enabled: true, loop: true } })
    expect(announcements(single, 64)).toEqual([{ bar: 0, text: 'Only' }])
  })

  it('announces the next section one beat before it starts', () => {
    expect(announcements(program(song()), 400, true)).toEqual([
      { bar: 0, beat: 0, text: 'Intro' },
      { bar: 1, beat: 3, text: 'Verse' },
      { bar: 4, beat: 3, text: 'Section 3' },
    ])
  })

  it('announces on the last sub-accent of the bar when there is one', () => {
    const sections = [
      createSection({ name: 'Six', bars: 1, beatsPerBar: 6, beatUnit: 8, beats: beatsFromGrouping([3, 3]) }),
      createSection({ name: 'Seven', bars: 1, beatsPerBar: 7, beatUnit: 8, beats: beatsFromGrouping([2, 2, 3]) }),
      createSection({ name: 'End', bars: 1 }),
    ]
    expect(announcements(program(sections), 400, true)).toEqual([
      { bar: 0, beat: 0, text: 'Six' },
      { bar: 0, beat: 3, text: 'Seven' },
      { bar: 1, beat: 4, text: 'End' },
    ])
  })
})
