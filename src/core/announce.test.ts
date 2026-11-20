import { describe, expect, it } from 'vitest'
import { sectionAnnouncement } from './announce'
import { createSequencer } from './sequencer'
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

/** Each announcement with the 0-based bar of playback it falls on. */
function announcements(settings: Settings, maxPulses = 400): { bar: number; text: string }[] {
  const playback = playbackSettings(settings)
  const sequencer = createSequencer(playback, 0)
  const found: { bar: number; text: string }[] = []
  for (let i = 0; i < maxPulses; i++) {
    const pulse = sequencer.next(playback)
    if (!pulse) break
    const text = sectionAnnouncement(pulse, playback)
    if (text !== null) found.push({ bar: pulse.totalBar, text })
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
})
