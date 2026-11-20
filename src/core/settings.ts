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
  MAX_SECTION_PARTS,
  MAX_SECTION_REPEATS,
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
  Part,
  PartRef,
  PlaybackSettings,
  PlaySection,
  PracticeAtTarget,
  PracticeSettings,
  Rhythm,
  Section,
  Settings,
  SoundId,
  SubdivisionId,
  VoicePackId,
} from './types'

export const DEFAULT_BPM = 120
/** Id of Settings.current, the free rhythm. Never used by a program section or part (those are random ids). */
export const CURRENT_PART_ID = 'current'
export const DEFAULT_TEMPO_PERCENT = 100

const PRACTICE_AT_TARGET: readonly PracticeAtTarget[] = ['hold', 'restart', 'reverse', 'stop']
const SUBDIVISION_IDS: readonly SubdivisionId[] = SUBDIVISIONS.map((s) => s.id)
const VOICE_PACK_IDS: readonly VoicePackId[] = VOICE_PACKS.map((p) => p.id)
const BUILT_IN_SOUND_IDS: readonly SoundId[] = BUILT_IN_SOUNDS.map((s) => s.id)

/** Random id for sections, parts, presets and custom sounds (crypto.randomUUID with a fallback). */
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

const MIN_PRACTICE_RATIO = MIN_BPM / MAX_BPM
const MAX_PRACTICE_RATIO = MAX_BPM / MIN_BPM

/** The speed trainer aiming at `bpm`, its start keeping the target's ratio to it. */
export function practiceAt(practice: PracticeSettings, bpm: number): PracticeSettings {
  const targetBpm = clampBpm(bpm)
  const startBpm = clampBpm(targetBpm / practice.targetRatio)
  return practice.startBpm === startBpm && practice.targetBpm === targetBpm ? practice : { ...practice, startBpm, targetBpm }
}

/** The speed trainer with a new start; its ratio to the target is remembered for when the main tempo changes. */
export function practiceWithStart(practice: PracticeSettings, bpm: number): PracticeSettings {
  const startBpm = clampBpm(bpm)
  return { ...practice, startBpm, targetRatio: practice.targetBpm / startBpm }
}

/** Settings with a new main tempo. The main tempo is the speed trainer's target, so the trainer follows (practiceAt). */
export function withBpm(prev: Settings, bpm: number): Settings {
  const next = clampBpm(bpm)
  const practice = practiceAt(prev.practice, next)
  return next === prev.bpm && practice === prev.practice ? prev : { ...prev, bpm: next, practice }
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

/** Tempo that plays: the speed trainer's tempo plays exactly as set; every other tempo is scaled by the percentage. */
export function playedBpm(baseBpm: number, tempoPercent: number, speedTrainer: boolean): number {
  return effectiveBpm(baseBpm, speedTrainer ? DEFAULT_TEMPO_PERCENT : tempoPercent)
}

/**
 * Seconds one beat lasts. The tempo always counts quarter notes, so a beat of an eighth-note meter (3/8, 6/8) lasts
 * half as long as one of 3/4, a sixteenth a quarter as long, and a half note (2/2) twice as long.
 */
export function beatSeconds(bpm: number, beatUnit: BeatUnit): number {
  const unit = BEAT_UNITS.includes(beatUnit) ? beatUnit : 4
  return (60 / bpm) * (4 / unit)
}

function makeRhythm(partial: Partial<Rhythm>): Rhythm {
  const beatsPerBar = intIn(partial.beatsPerBar, 4, 1, MAX_BEATS_PER_BAR)
  const beatUnit = partial.beatUnit ?? 4
  return {
    beatsPerBar,
    beatUnit,
    beats: partial.beats ? resizeBeats(partial.beats, beatsPerBar) : defaultBeats(beatsPerBar, beatUnit),
    subdivision: partial.subdivision ?? 'quarter',
  }
}

/** A new part (4/4, accent on 1, quarter subdivision, 1 bar), overridden by `partial`. `beats` is re-fitted to `beatsPerBar`. */
export function createPart(partial: Partial<Omit<Part, 'id'>> = {}): Part {
  return { id: makeId(), ...makeRhythm(partial), bars: partial.bars ?? 1 }
}

/** What createSection takes: the parts, or the rhythm and bar count of its single part. */
export interface SectionInit extends Partial<Rhythm> {
  name?: string
  /** Bars of the single part when `parts` is not given (default 4). */
  bars?: number
  parts?: Partial<Omit<Part, 'id'>>[]
  repeats?: number
  tempo?: number | null
}

/**
 * A new section (name 'Section', played once, tempo null). Without `parts` it has one part built from the rhythm
 * fields and `bars` (default: 4 bars of 4/4, accent on 1, quarter subdivision).
 */
export function createSection(init: SectionInit = {}): Section {
  const { name, bars, parts, repeats, tempo, ...rhythm } = init
  return {
    id: makeId(),
    name: name ?? 'Section',
    parts:
      parts && parts.length > 0 ? parts.map((part) => createPart(part)) : [createPart({ ...rhythm, bars: bars ?? 4 })],
    repeats: repeats ?? 1,
    tempo: tempo ?? null,
  }
}

/** A single-meter playback step with the same defaults as createSection (4 bars of 4/4). For the sequencer and its tests. */
export function createPlaySection(partial: Partial<Omit<PlaySection, 'id'>> = {}): PlaySection {
  const step: PlaySection = {
    id: makeId(),
    name: partial.name ?? 'Section',
    ...makeRhythm(partial),
    bars: partial.bars ?? 4,
    tempo: partial.tempo ?? null,
  }
  return partial.origin ? { ...step, origin: partial.origin } : step
}

/** Factory defaults: 120 BPM, 100 %, one section of 4 bars of 4/4 (none selected), gap trainer 2 played : 1 silent (disabled), random mute 25 % (disabled), practice 80→120 (×1.5) +5 every 2 bars 'hold' (disabled), all sounds 'click', voice en-male beats only with clicks, no section announcements (disabled), mixer master 0.8 / accent 1 / sub-accent 0.8 / beat 0.85 / sub 0.6 / voice 1, flash off. */
export function createDefaultSettings(): Settings {
  const section = createSection()
  return {
    version: 1,
    bpm: DEFAULT_BPM,
    tempoPercent: DEFAULT_TEMPO_PERCENT,
    sections: [section],
    selected: null,
    current: toCurrent(section.parts[0]),
    program: { enabled: false, loop: true },
    gap: { enabled: false, playBars: 2, muteBars: 1 },
    randomMute: { enabled: false, percent: 25 },
    practice: { enabled: false, startBpm: 80, targetBpm: DEFAULT_BPM, targetRatio: 1.5, stepBpm: 5, everyBars: 2, atTarget: 'hold' },
    sounds: { accent: 'click', medium: 'click', beat: 'click', sub: 'click' },
    voice: { enabled: false, pack: 'en-male', subdivisions: false, clicks: true, announceSections: false },
    mixer: { master: 0.8, accent: 1, medium: 0.8, beat: 0.85, sub: 0.6, voice: 1, muted: false },
    visual: { flash: false },
  }
}

type Fields = Record<string, unknown>

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fields(value: unknown): Fields {
  return isFields(value) ? value : {}
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

function sanitizeRhythm(raw: Fields): Rhythm {
  const beatsPerBar = intIn(raw.beatsPerBar, 4, 1, MAX_BEATS_PER_BAR)
  const beatUnit = oneOf<BeatUnit>(raw.beatUnit, BEAT_UNITS, 4)
  const beats = Array.isArray(raw.beats)
    ? resizeBeats(raw.beats.map((level) => oneOf<BeatLevel>(level, BEAT_LEVELS, 'normal')), beatsPerBar)
    : defaultBeats(beatsPerBar, beatUnit)
  return { beatsPerBar, beatUnit, beats, subdivision: oneOf<SubdivisionId>(raw.subdivision, SUBDIVISION_IDS, 'quarter') }
}

/** Ids key React lists and track the playing step, so they must be unique (sections and parts share `usedIds`). */
function uniqueId(value: unknown, usedIds: Set<string>): string {
  const id = typeof value === 'string' && value !== '' && !usedIds.has(value) ? value : makeId()
  usedIds.add(id)
  return id
}

function sanitizePart(raw: Fields, usedIds: Set<string>, defaultBars: number): Part {
  return { id: uniqueId(raw.id, usedIds), ...sanitizeRhythm(raw), bars: intIn(raw.bars, defaultBars, 1, MAX_SECTION_BARS) }
}

function sanitizeSection(raw: Fields, usedIds: Set<string>): Section {
  const id = uniqueId(raw.id, usedIds)
  const rawParts = Array.isArray(raw.parts) ? raw.parts.filter(isFields).slice(0, MAX_SECTION_PARTS) : []
  // Sections saved before they had parts were a single meter: that becomes their one part (with a new id).
  const parts =
    rawParts.length > 0
      ? rawParts.map((part) => sanitizePart(part, usedIds, 1))
      : [sanitizePart({ ...raw, id: undefined }, usedIds, 4)]
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : 'Section',
    parts,
    repeats: intIn(raw.repeats, 1, 1, MAX_SECTION_REPEATS),
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
  // A missing list gets the default section; a list (even an emptied one: "Clear all") keeps what is valid in it.
  const sections = Array.isArray(r.sections)
    ? r.sections
        .filter(isFields)
        .slice(0, MAX_SECTIONS)
        .map((s) => sanitizeSection(s, usedIds))
    : d.sections

  const program = fields(r.program)
  const gap = fields(r.gap)
  const randomMute = fields(r.randomMute)
  const practice = fields(r.practice)
  const sounds = fields(r.sounds)
  const voice = fields(r.voice)
  const visual = fields(r.visual)
  const startBpm = isNumber(practice.startBpm) ? clampBpm(practice.startBpm) : d.practice.startBpm
  const targetBpm = isNumber(practice.targetBpm) ? clampBpm(practice.targetBpm) : d.practice.targetBpm

  const selection = fields(r.selected)
  const selected = findPart({ sections }, { section: String(selection.section), part: String(selection.part) })
  // Settings saved before the free rhythm existed start from the section that was selected then.
  const current = isFields(r.current)
    ? toCurrent(sanitizeRhythm(r.current))
    : toCurrent(sections[intIn(r.activeSection, 0, 0, sections.length - 1)]?.parts[0] ?? d.current)

  return {
    version: 1,
    bpm: isNumber(r.bpm) ? clampBpm(r.bpm) : d.bpm,
    tempoPercent: isNumber(r.tempoPercent) ? clampTempoPercent(r.tempoPercent) : d.tempoPercent,
    sections,
    selected: selected && { section: selected.section.id, part: selected.part.id },
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
      // Random mute was removed from the app: it is always off, even in old settings and presets.
      enabled: false,
      percent: intIn(randomMute.percent, d.randomMute.percent, 0, 100),
    },
    practice: {
      enabled: bool(practice.enabled, d.practice.enabled),
      startBpm,
      targetBpm,
      // Older settings have no ratio: take it from the start and target.
      targetRatio:
        isNumber(practice.targetRatio) && practice.targetRatio > 0
          ? clamp(practice.targetRatio, MIN_PRACTICE_RATIO, MAX_PRACTICE_RATIO)
          : targetBpm / startBpm,
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
      announceSections: bool(voice.announceSections, d.voice.announceSections),
    },
    mixer: sanitizeMixer(fields(r.mixer), d.mixer),
    visual: { flash: bool(visual.flash, d.visual.flash) },
  }
}

/**
 * Turn anything (parsed localStorage JSON, an imported preset, garbage) into valid Settings.
 * Missing or invalid fields fall back to defaults; numbers are clamped to their ranges and rounded where they
 * are integers; every part's `beats` is re-fitted to its `beatsPerBar` and unknown levels become 'normal';
 * sections saved before they had parts become single-part sections; a selection that points at no part becomes null;
 * a missing section list becomes one default section (a list may be empty);
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
export function defaultBeats(beatsPerBar: number, beatUnit: BeatUnit): BeatLevel[] {
  const count = intIn(beatsPerBar, 4, 1, MAX_BEATS_PER_BAR)
  const grouping = defaultGrouping(count, beatUnit)
  if (grouping) return beatsFromGrouping(grouping)
  return Array.from({ length: count }, (_, i) => (i === 0 ? 'accent' : 'normal'))
}

/** `rhythm` as the free rhythm (Settings.current): fixed id, one bar, its own beats array. */
export function toCurrent(rhythm: Rhythm): Part {
  const { beatsPerBar, beatUnit, beats, subdivision } = rhythm
  return { id: CURRENT_PART_ID, beatsPerBar, beatUnit, beats: [...beats], subdivision, bars: 1 }
}

export interface FoundPart {
  section: Section
  sectionIndex: number
  part: Part
  partIndex: number
}

/** The section and part `ref` points at, or null when it points at nothing. */
export function findPart(settings: Pick<Settings, 'sections'>, ref: PartRef | null): FoundPart | null {
  if (ref === null) return null
  const sectionIndex = settings.sections.findIndex((s) => s.id === ref.section)
  const section = settings.sections[sectionIndex]
  const partIndex = section ? section.parts.findIndex((p) => p.id === ref.part) : -1
  return section && partIndex >= 0 ? { section, sectionIndex, part: section.parts[partIndex], partIndex } : null
}

/** The rhythm the quick controls and beat pads edit: the selected part, or the free rhythm when none is selected. */
export function editedPart(settings: Settings): Part {
  return findPart(settings, settings.selected)?.part ?? settings.current
}

/** Apply `update` to the part `ref` points at; null targets the free rhythm. Unchanged when `ref` points at nothing. */
export function updatePart(settings: Settings, ref: PartRef | null, update: (part: Part) => Part): Settings {
  if (ref === null) return { ...settings, current: { ...update(settings.current), id: CURRENT_PART_ID, bars: 1 } }
  if (!findPart(settings, ref)) return settings
  return {
    ...settings,
    sections: settings.sections.map((section) =>
      section.id !== ref.section
        ? section
        : {
            ...section,
            parts: section.parts.map((part) => (part.id === ref.part ? { ...update(part), id: part.id } : part)),
          },
    ),
  }
}

/** updatePart on whatever is being edited (see editedPart). */
export function updateEditedPart(settings: Settings, update: (part: Part) => Part): Settings {
  return updatePart(settings, findPart(settings, settings.selected) ? settings.selected : null, update)
}

/** Select a part (null: none, so the free rhythm is edited and played). A ref that points at nothing selects none. */
export function selectPart(settings: Settings, ref: PartRef | null): Settings {
  const found = findPart(settings, ref)
  const selected = found && { section: found.section.id, part: found.part.id }
  const same = selected?.section === settings.selected?.section && selected?.part === settings.selected?.part
  return same ? settings : { ...settings, selected }
}

/**
 * Select section `index` (null or out of range: none). Keeps the selected part when that section is already selected,
 * otherwise selects its first part.
 */
export function selectSection(settings: Settings, index: number | null): Settings {
  const section = index === null ? undefined : settings.sections[index]
  if (!section) return selectPart(settings, null)
  if (settings.selected?.section === section.id && findPart(settings, settings.selected)) return settings
  return selectPart(settings, { section: section.id, part: section.parts[0].id })
}

/** Bars of one pass through a section's parts. */
export function sectionPassBars(section: Section): number {
  return section.parts.reduce((sum, part) => sum + part.bars, 0)
}

/** Bars a section lasts in program mode: every part, every repetition. */
export function sectionBars(section: Section): number {
  return sectionPassBars(section) * section.repeats
}

/** The steps of one section: each part of each repetition, in play order. */
function sectionSteps(section: Section, sectionIndex: number, repeats: number, tempo: number | null): PlaySection[] {
  const pass = sectionPassBars(section)
  const steps: PlaySection[] = []
  for (let rep = 0; rep < repeats; rep++) {
    let barOffset = rep * pass
    section.parts.forEach((part, partIndex) => {
      const { beatsPerBar, beatUnit, beats, subdivision, bars } = part
      steps.push({
        // Stable across edits and reordering, so the sequencer keeps its place while the program changes.
        id: `${section.id}:${rep}:${part.id}`,
        name: section.name,
        beatsPerBar,
        beatUnit,
        beats,
        subdivision,
        bars,
        tempo,
        origin: { section: sectionIndex, part: partIndex, barOffset, sectionBars: pass * repeats },
      })
      barOffset += bars
    })
  }
  return steps
}

// Sections only change when the program is edited; tempo and mixer changes reuse the steps.
const programStepsCache = new WeakMap<Section[], PlaySection[]>()

function programSteps(sections: Section[]): PlaySection[] {
  let steps = programStepsCache.get(sections)
  if (!steps) {
    steps = sections.flatMap((section, index) => sectionSteps(section, index, section.repeats, section.tempo))
    programStepsCache.set(sections, steps)
  }
  return steps
}

/**
 * What the engine plays. The sequencer only knows single-meter steps, so sections are expanded into one step per part
 * and repetition (each with its origin). In program mode that is the whole program; outside it the selected section
 * loops at the main tempo (one pass, advanced like a looping program), or the free rhythm loops when none is selected.
 */
export function playbackSettings(settings: Settings): PlaybackSettings {
  const { sections, selected, current, ...rest } = settings
  // An empty program has nothing to play: the free rhythm plays instead, as outside program mode.
  if (settings.program.enabled && sections.length > 0) {
    return { ...rest, sections: programSteps(sections), activeSection: 0 }
  }
  const found = findPart(settings, selected)
  if (found) {
    return {
      ...rest,
      sections: sectionSteps(found.section, found.sectionIndex, 1, null),
      activeSection: 0,
      program: { enabled: true, loop: true },
    }
  }
  return {
    ...rest,
    sections: [{ ...current, name: '', tempo: null }],
    activeSection: 0,
    program: { ...rest.program, enabled: false },
  }
}

/** createDefaultSettings as the sequencer sees it (one step: the free rhythm). */
export function createDefaultPlaybackSettings(): PlaybackSettings {
  return playbackSettings(createDefaultSettings())
}
