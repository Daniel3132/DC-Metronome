import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_BEATS_PER_BAR,
  MAX_BPM,
  MAX_GAP_BARS,
  MAX_PRACTICE_EVERY_BARS,
  MAX_PRACTICE_STEP,
  MAX_SECTION_BARS,
  MAX_SECTION_PARTS,
  MAX_SECTION_REPEATS,
  MAX_SECTIONS,
  MAX_TEMPO_PERCENT,
  MIN_BPM,
  MIN_TEMPO_PERCENT,
} from './constants'
import { createSequencer } from './sequencer'
import {
  clampBpm,
  clampTempoPercent,
  createDefaultSettings,
  createPart,
  createSection,
  CURRENT_PART_ID,
  defaultBeats,
  editedPart,
  effectiveBpm,
  findPart,
  makeId,
  playbackSettings,
  sanitizeSettings,
  sectionBars,
  selectPart,
  selectSection,
  toCurrent,
  updateEditedPart,
  updatePart,
} from './settings'
import type { Part, PulseEvent, Settings } from './types'

/** Settings without the random section and part ids, for comparing two independently created settings. */
function withoutIds(settings: Settings) {
  return {
    ...settings,
    sections: settings.sections.map((section) => ({
      ...section,
      id: '',
      parts: section.parts.map((part) => ({ ...part, id: '' })),
    })),
  }
}

function expectValid(settings: Settings) {
  expect(settings.version).toBe(1)
  expect(Number.isInteger(settings.bpm)).toBe(true)
  expect(settings.bpm).toBeGreaterThanOrEqual(MIN_BPM)
  expect(settings.bpm).toBeLessThanOrEqual(MAX_BPM)
  expect(settings.tempoPercent).toBeGreaterThanOrEqual(MIN_TEMPO_PERCENT)
  expect(settings.tempoPercent).toBeLessThanOrEqual(MAX_TEMPO_PERCENT)
  expect(settings.sections.length).toBeLessThanOrEqual(MAX_SECTIONS)
  if (settings.selected !== null) expect(findPart(settings, settings.selected)).not.toBeNull()
  const ids = settings.sections.flatMap((section) => [section.id, ...section.parts.map((part) => part.id)])
  expect(new Set(ids).size).toBe(ids.length)
  expect(settings.current.id).toBe(CURRENT_PART_ID)
  for (const section of settings.sections) {
    expect(typeof section.id).toBe('string')
    expect(section.id).not.toBe('')
    expect(section.repeats).toBeGreaterThanOrEqual(1)
    expect(section.repeats).toBeLessThanOrEqual(MAX_SECTION_REPEATS)
    expect(section.parts.length).toBeGreaterThanOrEqual(1)
    expect(section.parts.length).toBeLessThanOrEqual(MAX_SECTION_PARTS)
    for (const part of [...section.parts, settings.current]) {
      expect(part.id).not.toBe('')
      expect(part.beats).toHaveLength(part.beatsPerBar)
      expect(part.beatsPerBar).toBeGreaterThanOrEqual(1)
      expect(part.beatsPerBar).toBeLessThanOrEqual(MAX_BEATS_PER_BAR)
      expect(part.bars).toBeGreaterThanOrEqual(1)
      expect(part.bars).toBeLessThanOrEqual(MAX_SECTION_BARS)
    }
  }
  for (const gain of [settings.mixer.master, settings.mixer.accent, settings.mixer.beat, settings.mixer.sub, settings.mixer.voice]) {
    expect(gain).toBeGreaterThanOrEqual(0)
    expect(gain).toBeLessThanOrEqual(1)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('makeId', () => {
  it('returns unique non-empty strings', () => {
    const ids = new Set(Array.from({ length: 200 }, () => makeId()))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id.length).toBeGreaterThan(8)
  })

  it('falls back when randomUUID is unavailable (insecure context)', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.map((_, i) => i * 7) })
    expect(makeId()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('falls back when crypto is missing entirely', () => {
    vi.stubGlobal('crypto', undefined)
    const a = makeId()
    const b = makeId()
    expect(a).not.toBe('')
    expect(a).not.toBe(b)
  })
})

describe('clampBpm', () => {
  it.each([
    [120, 120],
    [MIN_BPM, MIN_BPM],
    [MAX_BPM, MAX_BPM],
    [19, MIN_BPM],
    [0, MIN_BPM],
    [-50, MIN_BPM],
    [301, MAX_BPM],
    [1000, MAX_BPM],
    [120.4, 120],
    [120.5, 121],
    [Number.NaN, 120],
    [Number.POSITIVE_INFINITY, MAX_BPM],
    [Number.NEGATIVE_INFINITY, MIN_BPM],
  ])('clampBpm(%s) = %s', (input, expected) => {
    expect(clampBpm(input)).toBe(expected)
  })
})

describe('clampTempoPercent', () => {
  it.each([
    [100, 100],
    [MIN_TEMPO_PERCENT, MIN_TEMPO_PERCENT],
    [MAX_TEMPO_PERCENT, MAX_TEMPO_PERCENT],
    [10, MIN_TEMPO_PERCENT],
    [250, MAX_TEMPO_PERCENT],
    [33.3, 33],
    [66.6, 67],
    [Number.NaN, 100],
  ])('clampTempoPercent(%s) = %s', (input, expected) => {
    expect(clampTempoPercent(input)).toBe(expected)
  })
})

describe('effectiveBpm', () => {
  it('scales the base tempo by the percentage', () => {
    expect(effectiveBpm(120, 100)).toBe(120)
    expect(effectiveBpm(120, 50)).toBe(60)
    expect(effectiveBpm(100, 125)).toBe(125)
  })

  it('is not rounded', () => {
    expect(effectiveBpm(90, 77)).toBeCloseTo(69.3, 12)
    expect(effectiveBpm(137, 75)).toBeCloseTo(102.75, 12)
  })

  it('clamps to MIN_BPM..MAX_BPM', () => {
    expect(effectiveBpm(250, 200)).toBe(MAX_BPM)
    expect(effectiveBpm(300, 101)).toBe(MAX_BPM)
    expect(effectiveBpm(20, 25)).toBe(MIN_BPM)
    expect(effectiveBpm(60, 30)).toBe(MIN_BPM)
  })

  it('never returns NaN', () => {
    expect(effectiveBpm(Number.NaN, 100)).toBe(120)
    expect(effectiveBpm(120, Number.NaN)).toBe(120)
    expect(effectiveBpm(Number.POSITIVE_INFINITY, 0)).toBe(120)
  })
})

describe('defaultBeats', () => {
  it('accents only beat 1 of bars up to four beats', () => {
    expect(defaultBeats(4, 4)).toEqual(['accent', 'normal', 'normal', 'normal'])
    expect(defaultBeats(3, 4)).toEqual(['accent', 'normal', 'normal'])
    expect(defaultBeats(1, 4)).toEqual(['accent'])
    expect(defaultBeats(3, 8)).toEqual(['accent', 'normal', 'normal'])
  })

  it('puts a medium accent on every later group start', () => {
    expect(defaultBeats(6, 8)).toEqual(['accent', 'normal', 'normal', 'medium', 'normal', 'normal'])
    expect(defaultBeats(5, 4)).toEqual(['accent', 'normal', 'normal', 'medium', 'normal'])
    expect(defaultBeats(7, 8)).toEqual(['accent', 'normal', 'normal', 'normal', 'medium', 'normal', 'normal'])
    const mediums = (beats: string[]) => beats.flatMap((level, i) => (level === 'medium' ? [i] : []))
    expect(mediums(defaultBeats(9, 8))).toEqual([3, 6])
    expect(mediums(defaultBeats(12, 8))).toEqual([3, 6, 9])
    expect(mediums(defaultBeats(15, 8))).toEqual([3, 6, 9, 12])
    expect(mediums(defaultBeats(6, 16))).toEqual([3])
    expect(mediums(defaultBeats(8, 4))).toEqual([4])
    expect(defaultBeats(12, 8).filter((level) => level === 'normal')).toHaveLength(8)
  })

  it('keeps a single strong accent per bar', () => {
    for (let count = 1; count <= MAX_BEATS_PER_BAR; count++) {
      for (const unit of [2, 4, 8, 16] as const) {
        expect(defaultBeats(count, unit).filter((level) => level === 'accent')).toHaveLength(1)
      }
    }
  })

  it('clamps the beat count', () => {
    expect(defaultBeats(0, 4)).toEqual(['accent'])
    expect(defaultBeats(40, 4)).toHaveLength(MAX_BEATS_PER_BAR)
  })
})

describe('createSection', () => {
  it('has sensible defaults: one part of 4 bars of 4/4, played once', () => {
    const section = createSection()
    expect(section).toEqual({
      id: expect.any(String),
      name: 'Section',
      parts: [
        {
          id: expect.any(String),
          beatsPerBar: 4,
          beatUnit: 4,
          beats: ['accent', 'normal', 'normal', 'normal'],
          subdivision: 'quarter',
          bars: 4,
        },
      ],
      repeats: 1,
      tempo: null,
    })
    expect(section.id).not.toBe('')
    expect(section.parts[0].id).not.toBe(section.id)
  })

  it('gives every section and part a new id', () => {
    expect(createSection().id).not.toBe(createSection().id)
    expect(createPart().id).not.toBe(createPart().id)
  })

  it('applies overrides to the section and its single part', () => {
    const section = createSection({ name: 'Verse', subdivision: 'triplets', bars: 8, tempo: 90, beatUnit: 8, repeats: 2 })
    expect(section).toMatchObject({ name: 'Verse', tempo: 90, repeats: 2 })
    expect(section.parts).toHaveLength(1)
    expect(section.parts[0]).toMatchObject({ subdivision: 'triplets', bars: 8, beatUnit: 8 })
  })

  it('builds several parts, each one bar unless told otherwise', () => {
    const section = createSection({ parts: [{ beatsPerBar: 2 }, { beatsPerBar: 4, bars: 3 }], repeats: 4 })
    expect(section.parts.map((p) => [p.beatsPerBar, p.bars])).toEqual([
      [2, 1],
      [4, 3],
    ])
    expect(sectionBars(section)).toBe(16)
  })

  it('derives default beats from the meter when none are given', () => {
    expect(createSection({ beatsPerBar: 6, beatUnit: 8 }).parts[0].beats).toEqual(defaultBeats(6, 8))
    expect(createPart({ beatsPerBar: 5 }).beats).toEqual(['accent', 'normal', 'normal', 'medium', 'normal'])
  })

  it('re-fits given beats to beatsPerBar', () => {
    expect(createPart({ beatsPerBar: 3, beats: ['medium', 'mute', 'accent', 'accent', 'accent'] }).beats).toEqual([
      'medium',
      'mute',
      'accent',
    ])
    expect(createPart({ beatsPerBar: 4, beats: ['medium'] }).beats).toEqual(['medium', 'normal', 'normal', 'normal'])
    // beats without beatsPerBar: the default 4 wins.
    expect(createPart({ beats: ['mute', 'mute'] }).beats).toHaveLength(4)
  })

  it('does not share the beats array with the caller', () => {
    const beats: Part['beats'] = ['accent', 'normal', 'normal', 'normal']
    expect(createSection({ beats }).parts[0].beats).not.toBe(beats)
  })
})

describe('createDefaultSettings', () => {
  it('matches the factory defaults', () => {
    const settings = createDefaultSettings()
    expect(withoutIds(settings)).toEqual({
      version: 1,
      bpm: 120,
      tempoPercent: 100,
      sections: [
        {
          id: '',
          name: 'Section',
          parts: [
            {
              id: '',
              beatsPerBar: 4,
              beatUnit: 4,
              beats: ['accent', 'normal', 'normal', 'normal'],
              subdivision: 'quarter',
              bars: 4,
            },
          ],
          repeats: 1,
          tempo: null,
        },
      ],
      selected: null,
      current: {
        id: CURRENT_PART_ID,
        beatsPerBar: 4,
        beatUnit: 4,
        beats: ['accent', 'normal', 'normal', 'normal'],
        subdivision: 'quarter',
        bars: 1,
      },
      program: { enabled: false, loop: true },
      gap: { enabled: false, playBars: 2, muteBars: 1 },
      randomMute: { enabled: false, percent: 25 },
      practice: { enabled: false, startBpm: 80, targetBpm: 120, targetRatio: 1.5, stepBpm: 5, everyBars: 2, atTarget: 'hold' },
      sounds: { accent: 'click', medium: 'click', beat: 'click', sub: 'click' },
      voice: { enabled: false, pack: 'en-male', subdivisions: false, clicks: true, announceSections: false },
      mixer: { master: 0.8, accent: 1, medium: 0.8, beat: 0.85, sub: 0.6, voice: 1, muted: false },
      visual: { flash: false },
    })
  })

  it('is valid', () => {
    expectValid(createDefaultSettings())
  })

  it('is stable under sanitizeSettings', () => {
    const settings = createDefaultSettings()
    expect(sanitizeSettings(settings)).toEqual(settings)
  })

  it('returns independent objects', () => {
    const a = createDefaultSettings()
    const b = createDefaultSettings()
    expect(withoutIds(a)).toEqual(withoutIds(b))
    expect(a.sections[0].id).not.toBe(b.sections[0].id)
    a.mixer.master = 0
    a.sections[0].parts[0].beats[0] = 'mute'
    expect(b.mixer.master).toBe(0.8)
    expect(b.sections[0].parts[0].beats[0]).toBe('accent')
    expect(a.current.beats).not.toBe(a.sections[0].parts[0].beats)
  })
})

describe('sanitizeSettings', () => {
  const defaults = withoutIds(createDefaultSettings())

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['a string', 'settings'],
    ['an array', [1, 2, 3]],
    ['a boolean', true],
    ['an empty object', {}],
    ['a function', () => 1],
  ])('turns %s into the defaults', (_, raw) => {
    const settings = sanitizeSettings(raw)
    expectValid(settings)
    expect(withoutIds(settings)).toEqual(defaults)
  })

  it('fills in missing fields of partial settings', () => {
    const settings = sanitizeSettings({ bpm: 140, mixer: { master: 0.5 }, practice: { enabled: true } })
    expect(settings.bpm).toBe(140)
    expect(settings.mixer).toEqual({ ...defaults.mixer, master: 0.5 })
    expect(settings.practice).toEqual({ ...defaults.practice, enabled: true })
    expect(settings.gap).toEqual(defaults.gap)
    expect(settings.sections).toHaveLength(1)
  })

  it('replaces values of the wrong type with defaults', () => {
    const settings = sanitizeSettings({
      bpm: '140',
      tempoPercent: null,
      program: 'yes',
      gap: { enabled: 'true', playBars: '3', muteBars: [] },
      voice: { enabled: 1, clicks: 0 },
      visual: { flash: 'on' },
      mixer: { muted: 'false', master: '0.5' },
    })
    expect(withoutIds(settings)).toEqual(defaults)
  })

  it('clamps and rounds numbers', () => {
    const settings = sanitizeSettings({
      bpm: 1000,
      tempoPercent: 5,
      gap: { playBars: 0, muteBars: 2.4 },
      randomMute: { percent: 150 },
      practice: { startBpm: 10, targetBpm: 999, stepBpm: 0, everyBars: 100 },
      mixer: { master: 1.5, accent: -0.2, medium: 7, beat: 0.33, sub: 0.6, voice: 2 },
    })
    expect(settings.bpm).toBe(MAX_BPM)
    expect(settings.tempoPercent).toBe(MIN_TEMPO_PERCENT)
    expect(settings.gap.playBars).toBe(1)
    expect(settings.gap.muteBars).toBe(2)
    expect(settings.randomMute.percent).toBe(100)
    expect(settings.practice.startBpm).toBe(MIN_BPM)
    expect(settings.practice.targetBpm).toBe(MAX_BPM)
    expect(settings.practice.stepBpm).toBe(1)
    expect(settings.practice.everyBars).toBe(MAX_PRACTICE_EVERY_BARS)
    expect(settings.mixer).toEqual({ master: 1, accent: 0, medium: 1, beat: 0.33, sub: 0.6, voice: 1, muted: false })

    const high = sanitizeSettings({
      bpm: 99.6,
      tempoPercent: 999,
      gap: { playBars: 100, muteBars: -3 },
      randomMute: { percent: -5 },
      practice: { stepBpm: 80, everyBars: 0.2 },
    })
    expect(high.bpm).toBe(100)
    expect(high.tempoPercent).toBe(MAX_TEMPO_PERCENT)
    expect(high.gap.playBars).toBe(MAX_GAP_BARS)
    expect(high.gap.muteBars).toBe(1)
    expect(high.randomMute.percent).toBe(0)
    expect(high.practice.stepBpm).toBe(MAX_PRACTICE_STEP)
    expect(high.practice.everyBars).toBe(1)
  })

  it('turns sections from before parts existed into single-part sections', () => {
    const settings = sanitizeSettings({
      sections: [
        {
          id: 'a',
          name: 'Intro',
          beatsPerBar: 3,
          beatUnit: 8,
          // 'medium' is a level from older versions; it loads as 'normal'.
          beats: ['accent', 'bogus', 'soft', 'mute', 'mute'],
          subdivision: 'triplets',
          bars: 0,
          tempo: 500,
        },
        { id: 'b', name: 7, beatsPerBar: 40, beatUnit: 3, beats: 'xx', subdivision: 'polka', bars: 5000, tempo: 'fast' },
        { beatsPerBar: 2.6, beats: [], bars: 7.7, tempo: null },
        { id: 'd' },
      ],
    })
    const [a, b, c, d] = settings.sections
    expect(a).toEqual({
      id: 'a',
      name: 'Intro',
      parts: [
        {
          id: expect.any(String),
          beatsPerBar: 3,
          beatUnit: 8,
          beats: ['accent', 'normal', 'normal'],
          subdivision: 'triplets',
          bars: 1,
        },
      ],
      repeats: 1,
      tempo: MAX_BPM,
    })
    expect(a.parts[0].id).not.toBe('a')
    expect(b.id).toBe('b')
    expect(b.name).toBe('Section')
    expect(b.parts[0]).toMatchObject({
      beatsPerBar: MAX_BEATS_PER_BAR,
      beatUnit: 4,
      beats: defaultBeats(MAX_BEATS_PER_BAR, 4),
      subdivision: 'quarter',
      bars: MAX_SECTION_BARS,
    })
    expect(b.tempo).toBeNull()
    expect(c.parts[0]).toMatchObject({ beatsPerBar: 3, beats: ['accent', 'normal', 'normal'], bars: 8 })
    expect(c.tempo).toBeNull()
    expect(typeof c.id).toBe('string')
    expect(c.id).not.toBe('')
    // The old default: 4 bars.
    expect(d.parts[0].bars).toBe(4)
    expectValid(settings)
  })

  it('sanitizes parts and repeats', () => {
    const parts = Array.from({ length: MAX_SECTION_PARTS + 3 }, (_, i) => ({
      id: `p${i}`,
      beatsPerBar: 2,
      bars: i === 0 ? -1 : undefined,
    }))
    const settings = sanitizeSettings({
      sections: [
        { id: 'a', parts: [{ id: 'x', beatsPerBar: 7, beatUnit: 8 }, null, { id: 'x', beats: ['mute'] }], repeats: 3.4 },
        { id: 'b', parts, repeats: 1000 },
        { id: 'c', parts: [], repeats: 0, beatsPerBar: 5 },
      ],
    })
    const [a, b, c] = settings.sections
    expect(a.parts).toHaveLength(2)
    expect(a.parts[0]).toMatchObject({ id: 'x', beatsPerBar: 7, beatUnit: 8, bars: 1 })
    expect(a.parts[1].id).not.toBe('x')
    expect(a.parts[1].beats).toEqual(['mute', 'normal', 'normal', 'normal'])
    expect(a.repeats).toBe(3)
    expect(b.parts).toHaveLength(MAX_SECTION_PARTS)
    expect(b.parts[0].bars).toBe(1)
    expect(b.repeats).toBe(MAX_SECTION_REPEATS)
    // No parts: the section's own fields make its one part, as for older settings.
    expect(c.parts).toHaveLength(1)
    expect(c.parts[0].beatsPerBar).toBe(5)
    expect(c.repeats).toBe(1)
    expectValid(settings)
  })

  it('re-fits beats that are too short, keeping the existing levels', () => {
    const settings = sanitizeSettings({ sections: [{ id: 'x', beatsPerBar: 5, beats: ['medium', 'mute'] }] })
    expect(settings.sections[0].parts[0].beats).toEqual(['medium', 'mute', 'normal', 'normal', 'normal'])
  })

  it('keeps section and part ids unique', () => {
    const settings = sanitizeSettings({
      sections: [{ id: 'same' }, { id: 'same' }, { id: '' }, { id: 5 }, { id: 'e', parts: [{ id: 'same' }, { id: 'e' }] }],
    })
    expect(settings.sections).toHaveLength(5)
    expect(settings.sections[0].id).toBe('same')
    expectValid(settings)
  })

  it('drops section entries that are not objects', () => {
    const settings = sanitizeSettings({ sections: [null, 3, 'x', [], { id: 'ok', beatsPerBar: 2 }] })
    expect(settings.sections).toHaveLength(1)
    expect(settings.sections[0].id).toBe('ok')
  })

  it('turns a missing section list into one default section', () => {
    for (const sections of [undefined, 'none', { id: 'a' }]) {
      const settings = sanitizeSettings({ sections })
      expect(settings.sections).toHaveLength(1)
      expect(withoutIds(settings).sections[0]).toEqual(defaults.sections[0])
    }
  })

  it('keeps an emptied program empty', () => {
    for (const sections of [[], [null, 'x']]) {
      const settings = sanitizeSettings({ sections, selected: { section: 'a', part: 'b' }, activeSection: 2 })
      expect(settings.sections).toEqual([])
      expect(settings.selected).toBeNull()
      expectValid(settings)
    }
  })

  it('limits the number of sections', () => {
    const sections = Array.from({ length: MAX_SECTIONS + 10 }, (_, i) => ({ id: `s${i}` }))
    expect(sanitizeSettings({ sections }).sections).toHaveLength(MAX_SECTIONS)
  })

  it('keeps a selection that points at a part and drops any other', () => {
    const sections = [{ id: 'a', parts: [{ id: 'a1' }, { id: 'a2' }] }, { id: 'b' }]
    expect(sanitizeSettings({ sections, selected: { section: 'a', part: 'a2' } }).selected).toEqual({
      section: 'a',
      part: 'a2',
    })
    expect(sanitizeSettings({ sections, selected: { section: 'b', part: 'a2' } }).selected).toBeNull()
    expect(sanitizeSettings({ sections, selected: { section: 'a' } }).selected).toBeNull()
    expect(sanitizeSettings({ sections, selected: 'a' }).selected).toBeNull()
    expect(sanitizeSettings({ sections }).selected).toBeNull()
  })

  it('keeps built-in and custom sound ids and replaces unknown ones', () => {
    const settings = sanitizeSettings({ sounds: { accent: 'custom:abc-123', beat: 'woodblock', sub: 'laser' } })
    expect(settings.sounds).toEqual({ accent: 'custom:abc-123', medium: 'custom:abc-123', beat: 'woodblock', sub: 'click' })
    expect(sanitizeSettings({ sounds: { accent: 'custom:', beat: 42, sub: null } }).sounds).toEqual(defaults.sounds)
  })

  it('gives the sub-accent the accent sound when older settings have none', () => {
    expect(sanitizeSettings({ sounds: { accent: 'cowbell' } }).sounds.medium).toBe('cowbell')
    expect(sanitizeSettings({ sounds: { accent: 'cowbell', medium: 'bell' } }).sounds.medium).toBe('bell')
    expect(sanitizeSettings({ sounds: { medium: 'laser' } }).sounds.medium).toBe('click')
  })

  it('replaces unknown enum values', () => {
    const settings = sanitizeSettings({
      voice: { enabled: true, pack: 'klingon', subdivisions: true, clicks: false },
      practice: { atTarget: 'explode' },
    })
    expect(settings.voice).toEqual({ enabled: true, pack: 'en-male', subdivisions: true, clicks: false, announceSections: false })
    expect(settings.practice.atTarget).toBe('hold')
    expect(sanitizeSettings({ voice: { pack: 'es-female' }, practice: { atTarget: 'reverse' } })).toMatchObject({
      voice: { pack: 'es-female' },
      practice: { atTarget: 'reverse' },
    })
  })

  it('keeps every valid value', () => {
    const sections = [
      createSection({ beatsPerBar: 7, beatUnit: 8, subdivision: 'gallop', bars: 999, tempo: MIN_BPM, repeats: 99 }),
      createSection({
        parts: [
          { beatsPerBar: 16, beatUnit: 16, beats: Array(16).fill('medium'), subdivision: 'sextuplets' },
          { beatsPerBar: 1 },
        ],
      }),
    ]
    const settings: Settings = {
      version: 1,
      bpm: 300,
      tempoPercent: 25,
      sections,
      selected: { section: sections[1].id, part: sections[1].parts[1].id },
      current: toCurrent(createPart({ beatsPerBar: 5, beatUnit: 8, subdivision: 'swing' })),
      program: { enabled: true, loop: false },
      gap: { enabled: true, playBars: 64, muteBars: 64 },
      randomMute: { enabled: false, percent: 100 },
      practice: { enabled: true, startBpm: 300, targetBpm: MIN_BPM, targetRatio: MIN_BPM / 300, stepBpm: 50, everyBars: 64, atTarget: 'stop' },
      sounds: { accent: 'bell', medium: 'cowbell', beat: 'custom:x', sub: 'kick' },
      voice: { enabled: true, pack: 'en-female', subdivisions: true, clicks: false, announceSections: true },
      mixer: { master: 0, accent: 0.123, medium: 0.4, beat: 1, sub: 0, voice: 0.5, muted: true },
      visual: { flash: true },
    }
    expect(sanitizeSettings(settings)).toEqual(settings)
  })

  it('is idempotent and survives a JSON round trip', () => {
    const messy = {
      bpm: 333.3,
      sections: [{ id: 'a', beatsPerBar: 6, beatUnit: 8, beats: ['medium'] }, { id: 'a' }, {}],
      activeSection: 9,
      sounds: { accent: 'custom:k' },
      mixer: { voice: 3 },
    }
    const once = sanitizeSettings(messy)
    expect(sanitizeSettings(once)).toEqual(once)
    expect(sanitizeSettings(JSON.parse(JSON.stringify(once)))).toEqual(once)
  })

  it('does not mutate its input', () => {
    const raw = { bpm: 1000, sections: [{ id: 'a', beatsPerBar: 2, beats: ['accent', 'normal', 'medium'] }] }
    const copy = structuredClone(raw)
    sanitizeSettings(raw)
    expect(raw).toEqual(copy)
  })

  it('returns new section objects', () => {
    const settings = createDefaultSettings()
    const sanitized = sanitizeSettings(settings)
    expect(sanitized.sections[0]).not.toBe(settings.sections[0])
    expect(sanitized.sections[0].parts[0].beats).not.toBe(settings.sections[0].parts[0].beats)
  })

  it('never throws', () => {
    const throwing = Object.defineProperty({}, 'bpm', {
      get() {
        throw new Error('boom')
      },
      enumerable: true,
    })
    const proxy = new Proxy(
      {},
      {
        get() {
          throw new Error('trap')
        },
      },
    )
    const cyclic: Record<string, unknown> = { bpm: 90 }
    cyclic.self = cyclic
    cyclic.sections = [cyclic]
    for (const raw of [throwing, proxy, cyclic, Object.create(null), new Date(), new Map(), Symbol('x'), 10n]) {
      expect(() => sanitizeSettings(raw)).not.toThrow()
      expectValid(sanitizeSettings(raw))
    }
    expect(sanitizeSettings(cyclic).bpm).toBe(90)
  })
})

describe('selection and editing', () => {
  function program(): Settings {
    const sections = [
      createSection({ name: 'A' }),
      createSection({ name: 'B', parts: [{ beatsPerBar: 2 }, { beatsPerBar: 6, beatUnit: 8, subdivision: 'triplets' }] }),
    ]
    return { ...createDefaultSettings(), sections }
  }

  it('edits the free rhythm while nothing is selected', () => {
    const before = program()
    expect(editedPart(before)).toBe(before.current)
    const edited = updateEditedPart(before, (p) => ({
      ...p,
      beatsPerBar: 3,
      beats: ['accent', 'normal', 'normal'],
      bars: 9,
      id: 'x',
    }))
    expect(edited.sections).toBe(before.sections)
    expect(edited.current).toMatchObject({ id: CURRENT_PART_ID, beatsPerBar: 3, bars: 1 })
  })

  it('selecting a section selects its first part, or keeps the part already selected in it', () => {
    const base = program()
    const b = base.sections[1]
    const settings = selectSection(base, 1)
    expect(settings.selected).toEqual({ section: b.id, part: b.parts[0].id })
    const second = selectPart(settings, { section: b.id, part: b.parts[1].id })
    expect(selectSection(second, 1)).toBe(second)
    expect(selectSection(second, 9).selected).toBeNull()
    expect(selectSection(second, null).selected).toBeNull()
    expect(selectPart(second, { section: b.id, part: 'nope' }).selected).toBeNull()
    expect(selectPart(second, second.selected)).toBe(second)
  })

  it('edits the selected part directly, leaving the rest alone', () => {
    const base = program()
    const b = base.sections[1]
    const settings = selectPart(base, { section: b.id, part: b.parts[1].id })
    expect(editedPart(settings)).toBe(b.parts[1])
    const edited = updateEditedPart(settings, (p) => ({ ...p, beatsPerBar: 7, beats: defaultBeats(7, 8) }))
    expect(edited.sections[1].parts[1]).toMatchObject({ id: b.parts[1].id, beatsPerBar: 7 })
    expect(edited.sections[1].parts[0]).toBe(b.parts[0])
    expect(edited.sections[0]).toBe(base.sections[0])
    expect(edited.current).toBe(base.current)
    // A ref to nothing changes nothing.
    expect(updatePart(edited, { section: 'gone', part: 'gone' }, (p) => ({ ...p, bars: 2 }))).toBe(edited)
  })

  it('derives the free rhythm from the selected section of older settings', () => {
    const sections = [{ name: 'A' }, { name: 'B', beatsPerBar: 5 }]
    const settings = sanitizeSettings({ sections, activeSection: 1 })
    expect(settings.current).toEqual(toCurrent(settings.sections[1].parts[0]))
    expect(settings.selected).toBeNull()
    const kept = sanitizeSettings({ sections, current: { id: 'x', beatsPerBar: 7, bars: 5 } })
    expect(kept.current).toMatchObject({ id: CURRENT_PART_ID, beatsPerBar: 7, bars: 1 })
  })
})

describe('playbackSettings', () => {
  function mixed(): Settings {
    const sections = [
      createSection({ name: 'Mixed', parts: [{ beatsPerBar: 2 }, { beatsPerBar: 4, bars: 2 }], repeats: 2, tempo: 90 }),
      createSection({ name: 'Out', beatsPerBar: 3, bars: 1 }),
    ]
    return { ...createDefaultSettings(), bpm: 120, sections, program: { enabled: true, loop: false } }
  }

  it('plays only the free rhythm outside program mode with nothing selected', () => {
    const settings = { ...mixed(), program: { enabled: false, loop: true } }
    const solo = playbackSettings(settings)
    expect(solo.sections).toEqual([{ ...settings.current, name: '', tempo: null }])
    expect(solo.activeSection).toBe(0)
    expect(solo.program.enabled).toBe(false)
  })

  it('expands every part of every repetition in program mode, with its origin', () => {
    const settings = mixed()
    const steps = playbackSettings(settings).sections
    expect(
      steps.map((s) => [s.beatsPerBar, s.bars, s.tempo, s.origin?.section, s.origin?.part, s.origin?.barOffset]),
    ).toEqual([
      [2, 1, 90, 0, 0, 0],
      [4, 2, 90, 0, 1, 1],
      [2, 1, 90, 0, 0, 3],
      [4, 2, 90, 0, 1, 4],
      [3, 1, null, 1, 0, 0],
    ])
    expect(steps[0].origin?.sectionBars).toBe(6)
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length)
    // Unchanged sections reuse the same steps.
    expect(playbackSettings({ ...settings, bpm: 100 }).sections).toBe(steps)
  })

  it('plays the free rhythm when the program is empty, even in program mode', () => {
    const settings = { ...mixed(), sections: [] }
    const played = playbackSettings(settings)
    expect(played.sections).toEqual([{ ...settings.current, name: '', tempo: null }])
    expect(played.program.enabled).toBe(false)
  })

  it('loops the selected section outside program mode, at the main tempo', () => {
    const base = mixed()
    const settings = selectSection({ ...base, program: { enabled: false, loop: false } }, 0)
    const played = playbackSettings(settings)
    expect(played.program).toEqual({ enabled: true, loop: true })
    expect(played.sections.map((s) => [s.beatsPerBar, s.tempo])).toEqual([
      [2, null],
      [4, null],
    ])
  })

  it('makes the sequencer report sections, parts and bars of the program', () => {
    const played = playbackSettings(mixed())
    const seq = createSequencer(played, 0)
    const bars: PulseEvent[] = []
    for (let pulse = seq.next(played); pulse; pulse = seq.next(played)) if (pulse.beat === 0) bars.push(pulse)
    expect(bars.map((p) => `${p.sectionIndex}.${p.partIndex} ${p.sectionBar + 1}/${p.sectionBars} ${p.beatsPerBar}`)).toEqual([
      '0.0 1/6 2',
      '0.1 2/6 4',
      '0.1 3/6 4',
      '0.0 4/6 2',
      '0.1 5/6 4',
      '0.1 6/6 4',
      '1.0 1/1 3',
    ])
    expect(bars[0].baseBpm).toBe(90)
    expect(bars[6].baseBpm).toBe(120)
  })
})
