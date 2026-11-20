import { beatsFromGrouping } from '../core/meter'
import { createDefaultSettings, createSection, toCurrent, type SectionInit } from '../core/settings'
import type { Section, Settings } from '../core/types'

export interface FactoryPreset {
  id: string
  name: string
  description: string
  /** Fresh settings every call (new section ids), so loading a preset twice never shares state. */
  build: () => Settings
}

/** Settings with this program; the free rhythm (what plays outside program mode) is the first section's first part. */
function withProgram(bpm: number, sections: Section[]): Settings {
  return { ...createDefaultSettings(), bpm, sections, current: toCurrent(sections[0].parts[0]) }
}

function withSection(bpm: number, section: SectionInit): Settings {
  return withProgram(bpm, [createSection(section)])
}

export const FACTORY_PRESETS: readonly FactoryPreset[] = [
  {
    id: 'basic-4-4',
    name: 'Basic 4/4',
    description: 'Quarter notes at 120 BPM, accent on 1.',
    build: () => withSection(120, { name: '4/4' }),
  },
  {
    id: 'gap-2-1',
    name: 'Gap trainer 2:1',
    description: 'Two bars of clicks, then one silent bar. Keep time through the gap.',
    build: () => ({
      ...withSection(100, { name: '4/4' }),
      gap: { enabled: true, playBars: 2, muteBars: 1 },
    }),
  },
  {
    id: 'speed-60-120',
    name: 'Speed builder 60 → 120',
    description: 'Starts at 60 and adds 5 BPM every 4 bars, then holds 120.',
    build: () => ({
      ...withSection(120, { name: '4/4' }),
      practice: { enabled: true, startBpm: 60, targetBpm: 120, targetRatio: 2, stepBpm: 5, everyBars: 4, atTarget: 'hold' },
    }),
  },
  {
    id: 'song-form',
    name: 'Song form',
    description: 'Intro, verse, a 7/8 bridge and a chorus in eighths, played once at 120.',
    build: () => ({
      ...withProgram(120, [
        createSection({ name: 'Intro', bars: 4 }),
        createSection({ name: 'Verse', bars: 8 }),
        // BPM counts the denominator, so 240 eighths keeps the eighth note of the 4/4 sections at 120.
        createSection({ name: 'Bridge', bars: 4, beatsPerBar: 7, beatUnit: 8, beats: beatsFromGrouping([2, 2, 3]), tempo: 240 }),
        createSection({ name: 'Chorus', bars: 8, subdivision: 'eighths' }),
      ]),
      program: { enabled: true, loop: false },
    }),
  },
]
