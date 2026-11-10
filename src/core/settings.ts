import {
  BEAT_LEVELS,
  BEAT_UNITS,
  BUILT_IN_SOUNDS,
  CUSTOM_SOUND_PREFIX,
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
  SUBDIVISIONS,
  VOICE_PACKS,
} from './constants'
import { beatsFromGrouping, defaultGrouping, resizeBeats } from './meter'
import type {
  BeatLevel,
  BeatUnit,
  MixerSettings,
  PracticeAtTarget,
  Section,
  Settings,
  SoundId,
  SubdivisionId,
  VoicePackId,
} from './types'

export const DEFAULT_BPM = 120
/** Id of Settings.current, the working rhythm. Never used by a program section (those are random ids). */
export const CURRENT_SECTION_ID = 'current'
export const DEFAULT_TEMPO_PERCENT = 100

const PRACTICE_AT_TARGET: readonly PracticeAtTarget[] = ['hold', 'restart', 'reverse', 'stop']
const SUBDIVISION_IDS: readonly SubdivisionId[] = SUBDIVISIONS.map((s) => s.id)
const VOICE_PACK_IDS: readonly VoicePackId[] = VOICE_PACKS.map((p) => p.id)
const BUILT_IN_SOUND_IDS: readonly SoundId[] = BUILT_IN_SOUNDS.map((s) => s.id)

/** Random id for sections, presets and custom sounds (crypto.randomUUID with a fallback). */
export function makeId(): string {
  const crypto = globalThis.crypto as Crypto | undefined
  // randomUUID only exists in secure contexts (not on plain-http LAN addresses); getRandomValues works everywhere.
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  if (typeof crypto?.getRandomValues === 'function') {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Clamp and round a tempo to an integer in MIN_BPM..MAX_BPM (NaN → 120). */
export function clampBpm(bpm: number): number {
  if (Number.isNaN(bpm)) return DEFAULT_BPM
  return clamp(Math.round(bpm), MIN_BPM, MAX_BPM)
}

/** Clamp and round a tempo percentage to an integer in MIN_TEMPO_PERCENT..MAX_TEMPO_PERCENT (NaN → 100). */
export function clampTempoPercent(percent: number): number {
  if (Number.isNaN(percent)) return DEFAULT_TEMPO_PERCENT
  return clamp(Math.round(percent), MIN_TEMPO_PERCENT, MAX_TEMPO_PERCENT)
}

/** base × percent / 100, clamped to MIN_BPM..MAX_BPM. Not rounded (may be fractional). */
export function effectiveBpm(baseBpm: number, tempoPercent: number): number {
  const base = Number.isNaN(baseBpm) ? DEFAULT_BPM : baseBpm
  const percent = Number.isNaN(tempoPercent) ? DEFAULT_TEMPO_PERCENT : tempoPercent
  const bpm = (base * percent) / 100
  // Infinity × 0 is the only way to still get NaN here.
  return Number.isNaN(bpm) ? DEFAULT_BPM : clamp(bpm, MIN_BPM, MAX_BPM)
}

/** A new section with sensible defaults (4/4, accent on 1, quarter subdivision, 4 bars, tempo null, name 'Section'), overridden by `partial`. `beats` is re-fitted to `beatsPerBar`. */
export function createSection(partial: Partial<Omit<Section, 'id'>> = {}): Section {
  const beatsPerBar = intIn(partial.beatsPerBar, 4, 1, MAX_BEATS_PER_BAR)
  const beatUnit = partial.beatUnit ?? 4
  return {
    id: makeId(),
    name: partial.name ?? 'Section',
    beatsPerBar,
    beatUnit,
    beats: partial.beats ? resizeBeats(partial.beats, beatsPerBar) : defaultBeats(beatsPerBar, beatUnit),
    subdivision: partial.subdivision ?? 'quarter',
    bars: partial.bars ?? 4,
    tempo: partial.tempo ?? null,
  }
}

/** Factory defaults: 120 BPM, 100 %, one 4/4 section, gap trainer 2 played : 1 silent (disabled), random mute 25 % (disabled), practice 80→120 +5 every 4 bars 'hold' (disabled), all sounds 'click', voice en-male beats only with clicks (disabled), mixer master 0.8 / accent 1 / sub-accent 0.8 / beat 0.85 / sub 0.6 / voice 1, flash off. */
export function createDefaultSettings(): Settings {
  const section = createSection()
  return {
    version: 1,
    bpm: DEFAULT_BPM,
    tempoPercent: DEFAULT_TEMPO_PERCENT,
    sections: [section],
    activeSection: 0,
    current: toCurrent(section),
    program: { enabled: false, loop: true },
    gap: { enabled: false, playBars: 2, muteBars: 1 },
    randomMute: { enabled: false, percent: 25 },
    practice: { enabled: false, startBpm: 80, targetBpm: 120, stepBpm: 5, everyBars: 4, atTarget: 'hold' },
    sounds: { accent: 'click', medium: 'click', beat: 'click', sub: 'click' },
    voice: { enabled: false, pack: 'en-male', subdivisions: false, clicks: true },
    mixer: { master: 0.8, accent: 1, medium: 0.8, beat: 0.85, sub: 0.6, voice: 1, muted: false },
    visual: { flash: false },
  }
}

type Fields = Record<string, unknown>

function fields(value: unknown): Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : {}
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value)
}

function intIn(value: unknown, fallback: number, min: number, max: number): number {
  return isNumber(value) ? clamp(Math.round(value), min, max) : fallback
}

function numberIn(value: unknown, fallback: number, min: number, max: number): number {
  return isNumber(value) ? clamp(value, min, max) : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function soundId(value: unknown, fallback: SoundId): SoundId {
  if (typeof value !== 'string') return fallback
  if (BUILT_IN_SOUND_IDS.includes(value as SoundId)) return value as SoundId
  if (value.startsWith(CUSTOM_SOUND_PREFIX) && value.length > CUSTOM_SOUND_PREFIX.length) return value as SoundId
  return fallback
}

function sanitizeSection(raw: Fields, usedIds: Set<string>): Section {
  const beatsPerBar = intIn(raw.beatsPerBar, 4, 1, MAX_BEATS_PER_BAR)
  const beatUnit = oneOf<BeatUnit>(raw.beatUnit, BEAT_UNITS, 4)
  const beats = Array.isArray(raw.beats)
    ? resizeBeats(raw.beats.map((level) => oneOf<BeatLevel>(level, BEAT_LEVELS, 'normal')), beatsPerBar)
    : defaultBeats(beatsPerBar, beatUnit)
  // Ids key React lists and track the playing section, so they must be unique.
  const id = typeof raw.id === 'string' && raw.id !== '' && !usedIds.has(raw.id) ? raw.id : makeId()
  usedIds.add(id)
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : 'Section',
    beatsPerBar,
    beatUnit,
    beats,
    subdivision: oneOf<SubdivisionId>(raw.subdivision, SUBDIVISION_IDS, 'quarter'),
    bars: intIn(raw.bars, 4, 1, MAX_SECTION_BARS),
    tempo: isNumber(raw.tempo) ? clampBpm(raw.tempo) : null,
  }
}

function sanitizeMixer(raw: Fields, d: MixerSettings): MixerSettings {
  return {
    master: numberIn(raw.master, d.master, 0, 1),
    accent: numberIn(raw.accent, d.accent, 0, 1),
    medium: numberIn(raw.medium, d.medium, 0, 1),
    beat: numberIn(raw.beat, d.beat, 0, 1),
    sub: numberIn(raw.sub, d.sub, 0, 1),
    voice: numberIn(raw.voice, d.voice, 0, 1),
    muted: bool(raw.muted, d.muted),
  }
}

function sanitize(raw: unknown): Settings {
  const d = createDefaultSettings()
  const r = fields(raw)

  const usedIds = new Set<string>()
  const rawSections = Array.isArray(r.sections) ? r.sections : []
  const sections = rawSections
    .filter((s) => typeof s === 'object' && s !== null && !Array.isArray(s))
    .slice(0, MAX_SECTIONS)
    .map((s) => sanitizeSection(s as Fields, usedIds))
  if (sections.length === 0) sections.push(d.sections[0])

  const program = fields(r.program)
  const gap = fields(r.gap)
  const randomMute = fields(r.randomMute)
  const practice = fields(r.practice)
  const sounds = fields(r.sounds)
  const voice = fields(r.voice)
  const visual = fields(r.visual)

  const activeSection = intIn(r.activeSection, 0, 0, sections.length - 1)
  // Settings saved before the working rhythm existed start from the selected section.
  const current =
    typeof r.current === 'object' && r.current !== null && !Array.isArray(r.current)
      ? { ...sanitizeSection(r.current as Fields, new Set()), id: CURRENT_SECTION_ID }
      : toCurrent(sections[activeSection])

  return {
    version: 1,
    bpm: isNumber(r.bpm) ? clampBpm(r.bpm) : d.bpm,
    tempoPercent: isNumber(r.tempoPercent) ? clampTempoPercent(r.tempoPercent) : d.tempoPercent,
    sections,
    activeSection,
    current,
    program: {
      enabled: bool(program.enabled, d.program.enabled),
      loop: bool(program.loop, d.program.loop),
    },
    gap: {
      enabled: bool(gap.enabled, d.gap.enabled),
      playBars: intIn(gap.playBars, d.gap.playBars, 1, MAX_GAP_BARS),
      muteBars: intIn(gap.muteBars, d.gap.muteBars, 1, MAX_GAP_BARS),
    },
    randomMute: {
      enabled: bool(randomMute.enabled, d.randomMute.enabled),
      percent: intIn(randomMute.percent, d.randomMute.percent, 0, 100),
    },
    practice: {
      enabled: bool(practice.enabled, d.practice.enabled),
      startBpm: isNumber(practice.startBpm) ? clampBpm(practice.startBpm) : d.practice.startBpm,
      targetBpm: isNumber(practice.targetBpm) ? clampBpm(practice.targetBpm) : d.practice.targetBpm,
      stepBpm: intIn(practice.stepBpm, d.practice.stepBpm, 1, MAX_PRACTICE_STEP),
      everyBars: intIn(practice.everyBars, d.practice.everyBars, 1, MAX_PRACTICE_EVERY_BARS),
      atTarget: oneOf(practice.atTarget, PRACTICE_AT_TARGET, d.practice.atTarget),
    },
    sounds: {
      accent: soundId(sounds.accent, d.sounds.accent),
      // Settings saved before the sub-accent had its own sound played medium beats with the accent sound.
      medium: soundId(sounds.medium, soundId(sounds.accent, d.sounds.medium)),
      beat: soundId(sounds.beat, d.sounds.beat),
      sub: soundId(sounds.sub, d.sounds.sub),
    },
    voice: {
      enabled: bool(voice.enabled, d.voice.enabled),
      pack: oneOf(voice.pack, VOICE_PACK_IDS, d.voice.pack),
      subdivisions: bool(voice.subdivisions, d.voice.subdivisions),
      clicks: bool(voice.clicks, d.voice.clicks),
    },
    mixer: sanitizeMixer(fields(r.mixer), d.mixer),
    visual: { flash: bool(visual.flash, d.visual.flash) },
  }
}

/**
 * Turn anything (parsed localStorage JSON, an imported preset, garbage) into valid Settings.
 * Missing or invalid fields fall back to defaults; numbers are clamped to their ranges and rounded where they
 * are integers; every section's `beats` is re-fitted to its `beatsPerBar` and unknown levels become 'normal';
 * `activeSection` is clamped into range; an empty or missing section list becomes one default section;
 * unknown sound ids fall back to 'click' (ids starting with 'custom:' are kept); unknown subdivision / voice
 * pack / atTarget values fall back to defaults; mixer gains are clamped to 0..1. Never throws.
 */
export function sanitizeSettings(raw: unknown): Settings {
  try {
    return sanitize(raw)
  } catch {
    // Only exotic input (throwing getters, proxies) gets here.
    return createDefaultSettings()
  }
}

/** Default beat levels for a meter: accent on beat 1, medium on the start of every later group of defaultGrouping (6/8 → 3+3, 5/4 → 3+2, 7/8 → 4+3), rest normal. */
export function defaultBeats(beatsPerBar: number, beatUnit: BeatUnit): Section['beats'] {
  const count = intIn(beatsPerBar, 4, 1, MAX_BEATS_PER_BAR)
  const grouping = defaultGrouping(count, beatUnit)
  if (grouping) return beatsFromGrouping(grouping)
  return Array.from({ length: count }, (_, i) => (i === 0 ? 'accent' : 'normal'))
}

/** A copy of `section` as the working rhythm (Settings.current). */
export function toCurrent(section: Section): Section {
  return { ...section, id: CURRENT_SECTION_ID, beats: [...section.beats] }
}

/** True when the working rhythm differs from `section` in what "Save section" writes (meter, accents, subdivision). */
export function rhythmDiffers(current: Section, section: Section): boolean {
  return (
    current.beatsPerBar !== section.beatsPerBar ||
    current.beatUnit !== section.beatUnit ||
    current.subdivision !== section.subdivision ||
    current.beats.length !== section.beats.length ||
    current.beats.some((level, i) => level !== section.beats[i])
  )
}

/** Apply `update` to the section with `id`; CURRENT_SECTION_ID targets the working rhythm. */
export function updateSectionById(settings: Settings, id: string, update: (section: Section) => Section): Settings {
  if (id === CURRENT_SECTION_ID) return { ...settings, current: { ...update(settings.current), id: CURRENT_SECTION_ID } }
  return { ...settings, sections: settings.sections.map((s) => (s.id === id ? update(s) : s)) }
}

/** Select section `index` (clamped) and load its rhythm into the working rhythm. */
export function selectSection(settings: Settings, index: number): Settings {
  const activeSection = Math.min(Math.max(0, Math.round(index)), settings.sections.length - 1)
  const section = settings.sections[activeSection]
  if (!section) return settings
  return { ...settings, activeSection, current: toCurrent(section) }
}

/** "Save section": write the working rhythm (meter, accents, subdivision) into the selected section. */
export function saveCurrentToSection(settings: Settings): Settings {
  const index = settings.activeSection
  const section = settings.sections[index]
  if (!section || !rhythmDiffers(settings.current, section)) return settings
  const { beatsPerBar, beatUnit, beats, subdivision } = settings.current
  const saved: Section = { ...section, beatsPerBar, beatUnit, beats: [...beats], subdivision }
  return { ...settings, sections: settings.sections.toSpliced(index, 1, saved) }
}

/**
 * What the engine plays: the program sections in program mode; otherwise only the working rhythm, looped. The
 * sequencer itself only knows sections, so outside program mode the working rhythm becomes the one section.
 */
export function playbackSettings(settings: Settings): Settings {
  if (settings.program.enabled) return settings
  return { ...settings, sections: [settings.current], activeSection: 0 }
}
