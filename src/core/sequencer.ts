import {
  BEAT_WORDS,
  LEVEL_GAIN,
  LEVEL_VOICE_GAIN,
  MAX_BEATS_PER_BAR,
  MAX_BPM,
  MIN_BPM,
  SUB_VOICE_GAIN,
  getSubdivision,
} from './constants'
import { DEFAULT_BPM, clampBpm, effectiveBpm } from './settings'
import type {
  BeatLevel,
  GapSettings,
  PracticeSettings,
  PracticeState,
  PulseEvent,
  Section,
  Settings,
  SilentReason,
  SoundRole,
  VoiceWord,
} from './types'

export interface SequencerOptions {
  /** Random source for random mute, in [0, 1). Defaults to Math.random. Injected by tests. */
  random?: () => number
}

/**
 * Pure, clock-free pulse generator. The audio engine asks it for pulses ahead of time; it never touches audio.
 *
 * Every call takes the *current* settings so live edits apply to the next pulse that has not been produced yet:
 * - The time of the next pulse is computed lazily from the previous pulse's time and offset using the tempo
 *   and subdivision in effect at the moment of the call, so a tempo change takes effect on the very next pulse.
 *   peekTime() and the following next() with the same settings must agree exactly.
 * - If the subdivision changes mid-beat, the next pulse is the first pulse of the new pattern whose offset is
 *   greater than the previous pulse's offset, or the next beat.
 * - If the meter shrinks mid-bar (beat index ≥ beatsPerBar) the bar ends at the next beat boundary.
 * - If sections are removed so the current index is out of range, playback continues from the clamped/first section.
 *
 * Tempo resolution for each beat: base = practice.enabled ? practice tempo
 *   : program.enabled && section.tempo != null ? section.tempo : settings.bpm;
 *   bpm = effectiveBpm(base, tempoPercent). One beat (one `beatUnit` note) lasts 60 / bpm seconds.
 *
 * Bars and sections:
 * - Outside program mode the section is `settings.activeSection`, re-read at every bar start; it loops forever.
 * - In program mode playback starts at section 0; after a section has played `bars` bars it moves to the next;
 *   after the last section it loops to 0 if program.loop, otherwise the sequence ends (next() returns null).
 *   sectionBars is the section's `bars` in program mode, null otherwise.
 *
 * Gap trainer (settings.gap): with a counter of bars played since the gap trainer was (re)enabled (starting at 0),
 *   a bar is silent when counter % (playBars + muteBars) >= playBars. The counter resets when gap.enabled
 *   switches from false to true. All pulses of a silent bar: gapBar = true, silent = true, silentReason 'gap'.
 * Random mute: when enabled, at each beat start the whole beat (with its subdivisions) is silenced if
 *   random() < percent / 100 (silentReason 'random'). Gap silence takes precedence over random, random over level.
 * Beat level 'mute' silences the beat and its subdivision pulses (silentReason 'level').
 *
 * Practice (speed trainer): practice tempo starts at startBpm on the first bar where practice is enabled
 *   (and restarts whenever startBpm, targetBpm, stepBpm, everyBars or atTarget change, or practice is re-enabled).
 *   After every `everyBars` completed bars at one tempo it steps by stepBpm toward the target (clamped so it never
 *   passes it). Once it has played `everyBars` bars AT the target: 'hold' stays there; 'restart' jumps back to
 *   startBpm; 'reverse' heads back toward startBpm by stepBpm per step and turns around again at startBpm
 *   (ping-pong forever); 'stop' ends the sequence (next() returns null). start === target means hold.
 *   Practice tempos are clamped to MIN_BPM..MAX_BPM. PulseEvent.practice is null when practice is disabled.
 *   Tempo changes from practice (and from section tempos) take effect at bar boundaries.
 *
 * Voice and clicks, for a pulse that is not silent:
 * - pulse 0: role 'accent' for accent, 'medium' for medium (sub-accent), 'beat' for normal; gain = LEVEL_GAIN[level];
 *   voice = beat number word ('1'..'16') when voice.enabled; voiceGain = LEVEL_VOICE_GAIN[level].
 * - pulse > 0: role 'sub'; gain 1; voice = the subdivision's word for that pulse
 *   when voice.enabled && voice.subdivisions (may be null); voiceGain = SUB_VOICE_GAIN (0 when voice is null).
 * - click = !(voice !== null && !settings.voice.clicks).
 * A silent pulse has role null, click false, gain 0, voice null, voiceGain 0.
 *
 * Interpretations of live edits (see the tests): enabling the gap trainer or the speed trainer mid-bar, or changing
 * the speed-trainer settings, takes effect at the next bar start; disabling either takes effect on the next pulse.
 * The section of the current bar is tracked by id, so reordering or deleting other sections does not disturb it.
 * Pulses that remain in a beat cut off by a shrinking meter are skipped.
 */
export interface Sequencer {
  /** AudioContext time of the pulse next() would return, or null when the sequence has ended. Does not advance. */
  peekTime(settings: Settings): number | null
  /** Produce the next pulse and advance; null once the sequence has ended (and on every later call). */
  next(settings: Settings): PulseEvent | null
}

/** Offsets closer than this are the same position in the beat. */
const OFFSET_EPSILON = 1e-9

/** Only used when the settings have no sections at all (the sanitizer never produces that). */
const FALLBACK_SECTION: Section = {
  id: '',
  name: 'Section',
  beatsPerBar: 4,
  beatUnit: 4,
  beats: ['accent', 'normal', 'normal', 'normal'],
  subdivision: 'quarter',
  bars: 4,
  tempo: null,
}

interface PracticeRun extends PracticeState {
  /** The practice settings the run was started with; any change restarts it. */
  key: string
}

/** Everything the sequencer remembers. Never mutated: advance() returns a new state. */
interface State {
  /** Only before the first pulse: the state describes the pulse next() returns rather than the last one produced. */
  pending: boolean
  ended: boolean
  sectionIndex: number
  /** The section of the current bar is tracked by id so reordering or removing other sections does not disturb it. */
  sectionId: string
  sectionBar: number
  totalBar: number
  beat: number
  /** Index of the last pulse in the subdivision pattern it was produced with. */
  pulse: number
  /** In-beat offset of the last pulse, as a fraction of a beat. */
  offset: number
  time: number
  /** The last pulse started a beat (pulse 0), so the random-mute decision must be drawn for it. */
  beatStart: boolean
  /**
   * Tempo segment: beat k of the segment starts at segStart + k × segSpb. Times are computed from the segment start
   * rather than accumulated pulse by pulse, so a constant tempo never drifts. A new segment starts on tempo changes.
   */
  segStart: number
  segSpb: number
  segBeat: number
  /** Bars since the gap trainer was (re)enabled, for the current bar. */
  gapCount: number
  /** The gap trainer has stayed enabled since the counter was reset, so the counter continues. */
  gapArmed: boolean
  /** The current bar is silenced by the gap trainer (decided at the bar start). */
  gapBar: boolean
  practice: PracticeRun | null
  /** Random-mute decision for the current beat. */
  randomMuted: boolean
}

function sectionsOf(settings: Settings): readonly Section[] {
  return Array.isArray(settings.sections) && settings.sections.length > 0 ? settings.sections : [FALLBACK_SECTION]
}

function clampIndex(index: number, length: number): number {
  return Number.isNaN(index) ? 0 : Math.min(length - 1, Math.max(0, Math.round(index)))
}

function beatsPerBarOf(section: Section): number {
  const beats = Math.round(section.beatsPerBar)
  return beats >= 1 ? Math.min(beats, MAX_BEATS_PER_BAR) : 1
}

function barsOf(section: Section): number {
  const bars = Math.round(section.bars)
  return bars >= 1 ? bars : 1
}

function levelOf(section: Section, beat: number): BeatLevel {
  const level = section.beats[beat]
  return level !== undefined && Object.hasOwn(LEVEL_GAIN, level) ? level : 'normal'
}

function resolveSectionIndex(state: State, sections: readonly Section[]): number {
  if (sections[state.sectionIndex]?.id === state.sectionId) return state.sectionIndex
  const byId = sections.findIndex((section) => section.id === state.sectionId)
  return byId >= 0 ? byId : clampIndex(state.sectionIndex, sections.length)
}

/** Tempo before the percentage, for the bar the state is in. */
function baseTempo(state: State, settings: Settings, section: Section): number {
  let base = settings.bpm
  if (settings.practice.enabled && state.practice) base = state.practice.bpm
  else if (settings.program.enabled && section.tempo != null) base = section.tempo
  return Number.isNaN(base) ? DEFAULT_BPM : Math.min(MAX_BPM, Math.max(MIN_BPM, base))
}

// --- Gap trainer ---

function isGapBar(count: number, gap: GapSettings): boolean {
  const play = Math.max(0, Math.round(gap.playBars)) || 0
  const mute = Math.max(0, Math.round(gap.muteBars)) || 0
  return mute > 0 && count % (play + mute) >= play
}

function gapForNewBar(state: State, gap: GapSettings): Pick<State, 'gapCount' | 'gapArmed' | 'gapBar'> {
  if (!gap.enabled) return { gapCount: state.gapCount, gapArmed: false, gapBar: false }
  const gapCount = state.gapArmed ? state.gapCount + 1 : 0
  return { gapCount, gapArmed: true, gapBar: isGapBar(gapCount, gap) }
}

// --- Speed trainer ---

interface PracticePlan {
  start: number
  target: number
  step: number
  everyBars: number
  /** Direction from start to target. */
  up: 1 | -1 | 0
}

function practiceKey(practice: PracticeSettings): string {
  const { startBpm, targetBpm, stepBpm, everyBars, atTarget } = practice
  return `${startBpm}|${targetBpm}|${stepBpm}|${everyBars}|${atTarget}`
}

function practicePlan(practice: PracticeSettings): PracticePlan {
  const start = clampBpm(practice.startBpm)
  const target = clampBpm(practice.targetBpm)
  const everyBars = Math.round(practice.everyBars)
  return {
    start,
    target,
    step: practice.stepBpm > 0 && Number.isFinite(practice.stepBpm) ? practice.stepBpm : 1,
    everyBars: everyBars >= 1 ? everyBars : 1,
    up: start < target ? 1 : start > target ? -1 : 0,
  }
}

function startPractice(practice: PracticeSettings): PracticeRun {
  const plan = practicePlan(practice)
  return { key: practiceKey(practice), bpm: plan.start, barsAtTempo: 0, everyBars: plan.everyBars, direction: plan.up }
}

function stepToward(from: number, to: number, step: number): number {
  return from < to ? Math.min(from + step, to) : Math.max(from - step, to)
}

/** The run after one more completed bar; null when the trainer ends the sequence ('stop'). */
function finishPracticeBar(run: PracticeRun, practice: PracticeSettings): PracticeRun | null {
  const plan = practicePlan(practice)
  const barsAtTempo = run.barsAtTempo + 1
  if (run.direction === 0 || barsAtTempo < plan.everyBars) return { ...run, barsAtTempo }
  const stepped = { ...run, barsAtTempo: 0 }

  if (run.direction !== plan.up) {
    // 'reverse' on its way back: turn around once everyBars were played at the start tempo.
    return run.bpm === plan.start
      ? { ...stepped, bpm: stepToward(plan.start, plan.target, plan.step), direction: plan.up }
      : { ...stepped, bpm: stepToward(run.bpm, plan.start, plan.step) }
  }
  if (run.bpm !== plan.target) {
    const bpm = stepToward(run.bpm, plan.target, plan.step)
    return { ...stepped, bpm, direction: bpm === plan.target && practice.atTarget === 'hold' ? 0 : plan.up }
  }
  switch (practice.atTarget) {
    case 'restart':
      return { ...stepped, bpm: plan.start }
    case 'reverse':
      return { ...stepped, bpm: stepToward(plan.target, plan.start, plan.step), direction: plan.up === 1 ? -1 : 1 }
    case 'stop':
      return null
    default:
      return { ...run, barsAtTempo, direction: 0 }
  }
}

// --- Position ---

function initialState(settings: Settings, startTime: number): State {
  const sections = sectionsOf(settings)
  const sectionIndex = settings.program.enabled ? 0 : clampIndex(settings.activeSection, sections.length)
  const state: State = {
    pending: true,
    ended: false,
    sectionIndex,
    sectionId: sections[sectionIndex].id,
    sectionBar: 0,
    totalBar: 0,
    beat: 0,
    pulse: 0,
    offset: 0,
    time: startTime,
    beatStart: true,
    segStart: startTime,
    segSpb: Number.NaN,
    segBeat: 0,
    gapCount: 0,
    gapArmed: false,
    gapBar: false,
    practice: settings.practice.enabled ? startPractice(settings.practice) : null,
    randomMuted: false,
  }
  return { ...state, ...gapForNewBar(state, settings.gap) }
}

/** Bar-boundary work, in order: gap counter, speed trainer, program advance, next section. `state` is at the boundary. */
function startBar(state: State, settings: Settings): State {
  const gap = gapForNewBar(state, settings.gap)

  let practice: PracticeRun | null = null
  if (settings.practice.enabled) {
    if (state.practice && state.practice.key === practiceKey(settings.practice)) {
      practice = finishPracticeBar(state.practice, settings.practice)
      if (!practice) return { ...state, ended: true }
    } else {
      practice = startPractice(settings.practice)
    }
  }

  const sections = sectionsOf(settings)
  let sectionIndex = state.sectionIndex
  let sectionBar = state.sectionBar + 1
  if (settings.program.enabled) {
    if (sectionBar >= barsOf(sections[sectionIndex])) {
      sectionIndex += 1
      sectionBar = 0
      if (sectionIndex >= sections.length) {
        if (!settings.program.loop) return { ...state, ended: true }
        sectionIndex = 0
      }
    }
  } else {
    const active = clampIndex(settings.activeSection, sections.length)
    if (active !== sectionIndex) {
      sectionIndex = active
      sectionBar = 0
    }
  }

  return {
    ...state,
    ...gap,
    practice,
    sectionIndex,
    sectionId: sections[sectionIndex].id,
    sectionBar,
    totalBar: state.totalBar + 1,
    beat: 0,
  }
}

/** The state after producing the next pulse with the current settings. Pure: peekTime and next share it. */
function advance(state: State, settings: Settings): State {
  if (state.ended) return state
  const sections = sectionsOf(settings)
  const sectionIndex = resolveSectionIndex(state, sections)
  const section = sections[sectionIndex]
  const s: State = {
    ...state,
    sectionIndex,
    sectionId: section.id,
    // Disabling forgets the counters, so re-enabling starts them over at the next bar.
    gapArmed: state.gapArmed && settings.gap.enabled,
    practice: settings.practice.enabled ? state.practice : null,
  }
  if (s.pending) return { ...s, pending: false }

  const spb = 60 / effectiveBpm(baseTempo(s, settings, section), settings.tempoPercent)
  // A tempo change starts a new segment anchored so that the last pulse keeps its time and offset.
  const anchored = spb !== s.segSpb
  const segStart = anchored ? s.time - s.offset * spb : s.segStart
  const segBeat = anchored ? 0 : s.segBeat
  const beatsPerBar = beatsPerBarOf(section)

  if (s.beat < beatsPerBar) {
    const pulses = getSubdivision(section.subdivision).pulses
    const pulse = pulses.findIndex((offset) => offset > s.offset + OFFSET_EPSILON)
    if (pulse >= 0) {
      const offset = pulses[pulse]
      const time = segStart + segBeat * spb + offset * spb
      return { ...s, segStart, segSpb: spb, segBeat, pulse, offset, time, beatStart: false }
    }
  }

  const boundary: State = {
    ...s,
    segStart,
    segSpb: spb,
    segBeat: segBeat + 1,
    time: segStart + (segBeat + 1) * spb,
    pulse: 0,
    offset: 0,
    beatStart: true,
    randomMuted: false,
  }
  return s.beat + 1 < beatsPerBar ? { ...boundary, beat: s.beat + 1 } : startBar(boundary, settings)
}

function pulseEvent(state: State, settings: Settings): PulseEvent {
  const section = sectionsOf(settings)[state.sectionIndex]
  const subdivision = getSubdivision(section.subdivision)
  const baseBpm = baseTempo(state, settings, section)
  const bpm = effectiveBpm(baseBpm, settings.tempoPercent)
  const beatDuration = 60 / bpm
  const following = subdivision.pulses[state.pulse + 1] ?? 1
  const level = levelOf(section, state.beat)
  const gapBar = state.gapBar && settings.gap.enabled
  const practice = settings.practice.enabled ? state.practice : null

  let silentReason: SilentReason | null = null
  if (gapBar) silentReason = 'gap'
  else if (state.randomMuted && settings.randomMute.enabled) silentReason = 'random'
  else if (level === 'mute') silentReason = 'level'

  const event = {
    time: state.time,
    duration: (following - state.offset) * beatDuration,
    beatDuration,
    sectionIndex: state.sectionIndex,
    sectionBar: state.sectionBar,
    sectionBars: settings.program.enabled ? barsOf(section) : null,
    totalBar: state.totalBar,
    beat: state.beat,
    beatsPerBar: beatsPerBarOf(section),
    pulse: state.pulse,
    pulsesInBeat: subdivision.pulses.length,
    level,
    gapBar,
    bpm,
    baseBpm,
    practice: practice && {
      bpm: practice.bpm,
      barsAtTempo: practice.barsAtTempo,
      everyBars: practice.everyBars,
      direction: practice.direction,
    },
  }

  if (silentReason !== null) {
    return { ...event, role: null, click: false, gain: 0, voice: null, voiceGain: 0, silent: true, silentReason }
  }

  let role: SoundRole
  let gain: number
  let voice: VoiceWord | null = null
  let voiceGain = 0
  if (state.pulse === 0) {
    role = level === 'accent' ? 'accent' : level === 'medium' ? 'medium' : 'beat'
    gain = LEVEL_GAIN[level]
    if (settings.voice.enabled) voice = BEAT_WORDS[state.beat] ?? null
    if (voice !== null) voiceGain = LEVEL_VOICE_GAIN[level]
  } else {
    role = 'sub'
    gain = 1
    if (settings.voice.enabled && settings.voice.subdivisions) voice = subdivision.words[state.pulse] ?? null
    if (voice !== null) voiceGain = SUB_VOICE_GAIN
  }
  const click = !(voice !== null && !settings.voice.clicks)
  return { ...event, role, click, gain, voice, voiceGain, silent: false, silentReason: null }
}

/** Create a sequencer whose first pulse (bar 0, beat 0, pulse 0) is at `startTime`. */
export function createSequencer(settings: Settings, startTime: number, options: SequencerOptions = {}): Sequencer {
  const random = options.random ?? Math.random
  let state = initialState(settings, startTime)

  return {
    peekTime(current) {
      const next = advance(state, current)
      return next.ended ? null : next.time
    },
    next(current) {
      let next = advance(state, current)
      if (!next.ended && next.beatStart) {
        const { enabled, percent } = current.randomMute
        next = { ...next, randomMuted: enabled && random() < percent / 100 }
      }
      state = next
      return next.ended ? null : pulseEvent(next, current)
    },
  }
}
