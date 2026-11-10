import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_BEATS_PER_BAR,
  MAX_BPM,
  MAX_GAP_BARS,
  MAX_PRACTICE_EVERY_BARS,
  MAX_PRACTICE_STEP,
  MAX_SECTION_BARS,
  MAX_SECTIONS,
  MAX_TEMPO_PERCENT,
  MIN_BPM,
  MIN_TEMPO_PERCENT,
} from './constants'
import {
  clampBpm,
  clampTempoPercent,
  createDefaultSettings,
  createSection,
  CURRENT_SECTION_ID,
  defaultBeats,
  effectiveBpm,
  makeId,
  playbackSettings,
  rhythmDiffers,
  sanitizeSettings,
  saveCurrentToSection,
  selectSection,
  toCurrent,
  updateSectionById,
} from './settings'
import type { Section, Settings } from './types'

/** Settings without the random section ids, for comparing two independently created settings. */
function withoutIds(settings: Settings) {
  return { ...settings, sections: settings.sections.map((section) => ({ ...section, id: '' })) }
}

function expectValid(settings: Settings) {
  expect(settings.version).toBe(1)
  expect(Number.isInteger(settings.bpm)).toBe(true)
  expect(settings.bpm).toBeGreaterThanOrEqual(MIN_BPM)
  expect(settings.bpm).toBeLessThanOrEqual(MAX_BPM)
  expect(settings.tempoPercent).toBeGreaterThanOrEqual(MIN_TEMPO_PERCENT)
  expect(settings.tempoPercent).toBeLessThanOrEqual(MAX_TEMPO_PERCENT)
  expect(settings.sections.length).toBeGreaterThanOrEqual(1)
  expect(settings.sections.length).toBeLessThanOrEqual(MAX_SECTIONS)
  expect(settings.activeSection).toBeGreaterThanOrEqual(0)
  expect(settings.activeSection).toBeLessThan(settings.sections.length)
  const ids = new Set(settings.sections.map((section) => section.id))
  expect(ids.size).toBe(settings.sections.length)
  for (const section of settings.sections) {
    expect(typeof section.id).toBe('string')
    expect(section.id).not.toBe('')
    expect(section.beats).toHaveLength(section.beatsPerBar)
    expect(section.beatsPerBar).toBeGreaterThanOrEqual(1)
    expect(section.beatsPerBar).toBeLessThanOrEqual(MAX_BEATS_PER_BAR)
    expect(section.bars).toBeGreaterThanOrEqual(1)
    expect(section.bars).toBeLessThanOrEqual(MAX_SECTION_BARS)
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
  it('has sensible defaults', () => {
    const section = createSection()
    expect(section).toEqual({
      id: expect.any(String),
      name: 'Section',
      beatsPerBar: 4,
      beatUnit: 4,
      beats: ['accent', 'normal', 'normal', 'normal'],
      subdivision: 'quarter',
      bars: 4,
      tempo: null,
    })
    expect(section.id).not.toBe('')
  })

  it('gives every section a new id', () => {
    expect(createSection().id).not.toBe(createSection().id)
  })

  it('applies overrides', () => {
    const section = createSection({ name: 'Verse', subdivision: 'triplets', bars: 8, tempo: 90, beatUnit: 8 })
    expect(section.name).toBe('Verse')
    expect(section.subdivision).toBe('triplets')
    expect(section.bars).toBe(8)
    expect(section.tempo).toBe(90)
    expect(section.beatUnit).toBe(8)
  })

  it('derives default beats from the meter when none are given', () => {
    expect(createSection({ beatsPerBar: 6, beatUnit: 8 }).beats).toEqual(defaultBeats(6, 8))
    expect(createSection({ beatsPerBar: 5 }).beats).toEqual(['accent', 'normal', 'normal', 'medium', 'normal'])
  })

  it('re-fits given beats to beatsPerBar', () => {
    expect(createSection({ beatsPerBar: 3, beats: ['medium', 'mute', 'accent', 'accent', 'accent'] }).beats).toEqual([
      'medium',
      'mute',
      'accent',
    ])
    expect(createSection({ beatsPerBar: 4, beats: ['medium'] }).beats).toEqual(['medium', 'normal', 'normal', 'normal'])
    // beats without beatsPerBar: the default 4 wins.
    expect(createSection({ beats: ['mute', 'mute'] }).beats).toHaveLength(4)
  })

  it('does not share the beats array with the caller', () => {
    const beats: Section['beats'] = ['accent', 'normal', 'normal', 'normal']
    const section = createSection({ beats })
    expect(section.beats).not.toBe(beats)
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
          beatsPerBar: 4,
          beatUnit: 4,
          beats: ['accent', 'normal', 'normal', 'normal'],
          subdivision: 'quarter',
          bars: 4,
          tempo: null,
        },
      ],
      activeSection: 0,
      current: {
        id: CURRENT_SECTION_ID,
        name: 'Section',
        beatsPerBar: 4,
        beatUnit: 4,
        beats: ['accent', 'normal', 'normal', 'normal'],
        subdivision: 'quarter',
        bars: 4,
        tempo: null,
      },
      program: { enabled: false, loop: true },
      gap: { enabled: false, playBars: 2, muteBars: 1 },
      randomMute: { enabled: false, percent: 25 },
      practice: { enabled: false, startBpm: 80, targetBpm: 120, stepBpm: 5, everyBars: 4, atTarget: 'hold' },
      sounds: { accent: 'click', medium: 'click', beat: 'click', sub: 'click' },
      voice: { enabled: false, pack: 'en-male', subdivisions: false, clicks: true },
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
    a.sections[0].beats[0] = 'mute'
    expect(b.mixer.master).toBe(0.8)
    expect(b.sections[0].beats[0]).toBe('accent')
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

  it('sanitizes every section', () => {
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
      ],
    })
    const [a, b, c] = settings.sections
    expect(a).toEqual({
      id: 'a',
      name: 'Intro',
      beatsPerBar: 3,
      beatUnit: 8,
      beats: ['accent', 'normal', 'normal'],
      subdivision: 'triplets',
      bars: 1,
      tempo: MAX_BPM,
    })
    expect(b.id).toBe('b')
    expect(b.name).toBe('Section')
    expect(b.beatsPerBar).toBe(MAX_BEATS_PER_BAR)
    expect(b.beatUnit).toBe(4)
    expect(b.beats).toEqual(defaultBeats(MAX_BEATS_PER_BAR, 4))
    expect(b.subdivision).toBe('quarter')
    expect(b.bars).toBe(MAX_SECTION_BARS)
    expect(b.tempo).toBeNull()
    expect(c.beatsPerBar).toBe(3)
    expect(c.beats).toEqual(['accent', 'normal', 'normal'])
    expect(c.bars).toBe(8)
    expect(c.tempo).toBeNull()
    expect(typeof c.id).toBe('string')
    expect(c.id).not.toBe('')
    expectValid(settings)
  })

  it('re-fits beats that are too short, keeping the existing levels', () => {
    const settings = sanitizeSettings({ sections: [{ id: 'x', beatsPerBar: 5, beats: ['medium', 'mute'] }] })
    expect(settings.sections[0].beats).toEqual(['medium', 'mute', 'normal', 'normal', 'normal'])
  })

  it('keeps section ids unique', () => {
    const settings = sanitizeSettings({ sections: [{ id: 'same' }, { id: 'same' }, { id: '' }, { id: 5 }] })
    expect(settings.sections).toHaveLength(4)
    expect(settings.sections[0].id).toBe('same')
    expect(new Set(settings.sections.map((section) => section.id)).size).toBe(4)
  })

  it('drops section entries that are not objects', () => {
    const settings = sanitizeSettings({ sections: [null, 3, 'x', [], { id: 'ok', beatsPerBar: 2 }] })
    expect(settings.sections).toHaveLength(1)
    expect(settings.sections[0].id).toBe('ok')
  })

  it('turns an empty or missing section list into one default section', () => {
    for (const sections of [[], undefined, 'none', [null]]) {
      const settings = sanitizeSettings({ sections })
      expect(settings.sections).toHaveLength(1)
      expect({ ...settings.sections[0], id: '' }).toEqual(defaults.sections[0])
    }
  })

  it('limits the number of sections', () => {
    const sections = Array.from({ length: MAX_SECTIONS + 10 }, (_, i) => ({ id: `s${i}` }))
    expect(sanitizeSettings({ sections }).sections).toHaveLength(MAX_SECTIONS)
  })

  it('clamps activeSection into range', () => {
    const sections = [{ id: 'a' }, { id: 'b' }]
    expect(sanitizeSettings({ sections, activeSection: 5 }).activeSection).toBe(1)
    expect(sanitizeSettings({ sections, activeSection: -1 }).activeSection).toBe(0)
    expect(sanitizeSettings({ sections, activeSection: 0.6 }).activeSection).toBe(1)
    expect(sanitizeSettings({ sections, activeSection: 'b' }).activeSection).toBe(0)
    expect(sanitizeSettings({ activeSection: 3 }).activeSection).toBe(0)
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
    expect(settings.voice).toEqual({ enabled: true, pack: 'en-male', subdivisions: true, clicks: false })
    expect(settings.practice.atTarget).toBe('hold')
    expect(sanitizeSettings({ voice: { pack: 'es-female' }, practice: { atTarget: 'reverse' } })).toMatchObject({
      voice: { pack: 'es-female' },
      practice: { atTarget: 'reverse' },
    })
  })

  it('keeps every valid value', () => {
    const settings: Settings = {
      version: 1,
      bpm: 300,
      tempoPercent: 25,
      sections: [
        createSection({ beatsPerBar: 7, beatUnit: 8, subdivision: 'gallop', bars: 999, tempo: MIN_BPM }),
        createSection({ beatsPerBar: 16, beatUnit: 16, beats: Array(16).fill('medium'), subdivision: 'sextuplets' }),
      ],
      activeSection: 1,
      current: { ...createSection({ beatsPerBar: 5, beatUnit: 8, subdivision: 'swing', bars: 3, tempo: 90 }), id: CURRENT_SECTION_ID },
      program: { enabled: true, loop: false },
      gap: { enabled: true, playBars: 64, muteBars: 64 },
      randomMute: { enabled: true, percent: 100 },
      practice: { enabled: true, startBpm: 300, targetBpm: MIN_BPM, stepBpm: 50, everyBars: 64, atTarget: 'stop' },
      sounds: { accent: 'bell', medium: 'cowbell', beat: 'custom:x', sub: 'kick' },
      voice: { enabled: true, pack: 'en-female', subdivisions: true, clicks: false },
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
    expect(sanitized.sections[0].beats).not.toBe(settings.sections[0].beats)
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

describe('working rhythm (Settings.current)', () => {
  function program(): Settings {
    const settings = createDefaultSettings()
    const sections = [
      createSection({ name: 'A' }),
      createSection({ name: 'B', beatsPerBar: 6, beatUnit: 8, subdivision: 'triplets' }),
    ]
    return selectSection({ ...settings, sections }, 0)
  }

  it('selecting a section loads its rhythm, under the fixed id', () => {
    const settings = selectSection(program(), 1)
    expect(settings.activeSection).toBe(1)
    expect(settings.current).toMatchObject({ id: CURRENT_SECTION_ID, beatsPerBar: 6, beatUnit: 8, subdivision: 'triplets' })
    expect(settings.current.beats).not.toBe(settings.sections[1].beats)
    expect(selectSection(program(), 9).activeSection).toBe(1)
  })

  it('editing the working rhythm leaves the sections alone until it is saved', () => {
    const before = program()
    const edited = updateSectionById(before, CURRENT_SECTION_ID, (s) => ({ ...s, beatsPerBar: 3, beats: ['accent', 'normal', 'normal'] }))
    expect(edited.sections).toBe(before.sections)
    expect(edited.current.id).toBe(CURRENT_SECTION_ID)
    expect(rhythmDiffers(edited.current, edited.sections[0])).toBe(true)

    const saved = saveCurrentToSection(edited)
    expect(saved.sections[0]).toMatchObject({ name: 'A', beatsPerBar: 3, beats: ['accent', 'normal', 'normal'] })
    expect(saved.sections[0].id).toBe(before.sections[0].id)
    expect(saved.sections[1]).toBe(before.sections[1])
    expect(rhythmDiffers(saved.current, saved.sections[0])).toBe(false)
    expect(saveCurrentToSection(saved)).toBe(saved)
  })

  it('plays the working rhythm outside program mode and the sections in program mode', () => {
    const settings = program()
    const solo = playbackSettings(settings)
    expect(solo.sections).toEqual([settings.current])
    expect(solo.activeSection).toBe(0)
    const programmed = { ...settings, program: { enabled: true, loop: true } }
    expect(playbackSettings(programmed)).toBe(programmed)
  })

  it('derives the working rhythm from the selected section for older settings', () => {
    const sections = [createSection({ name: 'A' }), createSection({ name: 'B', beatsPerBar: 5 })]
    const settings = sanitizeSettings({ sections, activeSection: 1 })
    expect(settings.current).toEqual(toCurrent(settings.sections[1]))
    const kept = sanitizeSettings({ sections, current: { ...sections[0], id: 'x', beatsPerBar: 7 } })
    expect(kept.current).toMatchObject({ id: CURRENT_SECTION_ID, beatsPerBar: 7 })
  })
})
