import { beatsFromGrouping } from '../core/meter'
import { createDefaultSettings, createSection, selectSection } from '../core/settings'
import type { Settings } from '../core/types'

export interface FactoryPreset {
  id: string
  name: string
  description: string
  /** Fresh settings every call (new section ids), so loading a preset twice never shares state. */
  build: () => Settings
}

function withSection(bpm: number, section: Parameters<typeof createSection>[0]): Settings {
  return selectSection({ ...createDefaultSettings(), bpm, sections: [createSection(section)] }, 0)
}

export const FACTORY_PRESETS: readonly FactoryPreset[] = [
  {
    id: 'basic-4-4',
    name: 'Basic 4/4',
    description: 'Quarter notes at 120 BPM, accent on 1.',
    build: () => withSection(120, { name: '4/4' }),
  },
  {
    id: 'waltz-3-4',
    name: 'Waltz 3/4',
    description: 'Three beats at 90 BPM, accent on 1.',
    build: () => withSection(90, { name: 'Waltz', beatsPerBar: 3, beatUnit: 4 }),
  },
  {
    id: 'compound-6-8',
    name: '6/8 compound',
    description: 'Six eighths at 180, felt in two (dotted quarter = 60).',
    build: () => withSection(180, { name: '6/8', beatsPerBar: 6, beatUnit: 8, beats: beatsFromGrouping([3, 3]) }),
  },
  {
    id: 'odd-7-8',
    name: '7/8 (2+2+3)',
    description: 'Seven eighths at 200, grouped 2+2+3.',
    build: () => withSection(200, { name: '7/8', beatsPerBar: 7, beatUnit: 8, beats: beatsFromGrouping([2, 2, 3]) }),
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
      ...withSection(60, { name: '4/4' }),
      practice: { enabled: true, startBpm: 60, targetBpm: 120, stepBpm: 5, everyBars: 4, atTarget: 'hold' },
    }),
  },
  {
    id: 'ramp-160-100',
    name: 'Ramp down 160 → 100',
    description: 'Starts at 160 and drops 5 BPM every 4 bars, then holds 100.',
    build: () => ({
      ...withSection(160, { name: '4/4' }),
      practice: { enabled: true, startBpm: 160, targetBpm: 100, stepBpm: 5, everyBars: 4, atTarget: 'hold' },
    }),
  },
  {
    id: 'song-form',
    name: 'Song form',
    description: 'Intro, verse, a 7/8 bridge and a chorus in eighths, played once at 120.',
    build: () =>
      selectSection(
        {
          ...createDefaultSettings(),
          bpm: 120,
          program: { enabled: true, loop: false },
          sections: [
        createSection({ name: 'Intro', bars: 4 }),
        createSection({ name: 'Verse', bars: 8 }),
        // BPM counts the denominator, so 240 eighths keeps the eighth note of the 4/4 sections at 120.
        createSection({ name: 'Bridge', bars: 4, beatsPerBar: 7, beatUnit: 8, beats: beatsFromGrouping([2, 2, 3]), tempo: 240 }),
        createSection({ name: 'Chorus', bars: 8, subdivision: 'eighths' }),
          ],
        },
        0,
      ),
  },
  {
    id: 'voice-4-4',
    name: 'Voice count 4/4',
    description: 'Counts "one, two, three, four" over the click at 100 BPM.',
    build: () => {
      const settings = withSection(100, { name: '4/4' })
      return { ...settings, voice: { ...settings.voice, enabled: true } }
    },
  },
  {
    id: 'triplet-12-8',
    name: '12/8 triplet feel',
    description: 'Twelve eighths at 180, felt in four (dotted quarter = 60).',
    build: () => withSection(180, { name: '12/8', beatsPerBar: 12, beatUnit: 8, beats: beatsFromGrouping([3, 3, 3, 3]) }),
  },
]
