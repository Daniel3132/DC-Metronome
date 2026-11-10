// Shared data model for the metronome. Everything here is plain serializable data
// so settings can be persisted to localStorage and saved as presets.

/**
 * How a beat is played. Cycles accent → medium → normal → mute in the beat editor.
 * 'medium' marks the start of a later group in the bar (beat 4 of 6/8, beat 4 of 5/4 as 3+2).
 */
export type BeatLevel = 'accent' | 'medium' | 'normal' | 'mute'

/** Time signature denominator. The tempo (BPM) always counts this note value. */
export type BeatUnit = 2 | 4 | 8 | 16

export type SubdivisionId =
  | 'quarter'
  | 'eighths'
  | 'triplets'
  | 'sixteenths'
  | 'quintuplets'
  | 'sextuplets'
  | 'septuplets'
  | 'thirty-seconds'
  | 'swing'
  | 'gallop'
  | 'reverse-gallop'
  | 'dotted'

/** Syllables spoken on subdivision pulses ("1 e and a", "1 trip let"). */
export type SubdivisionWord = 'e' | 'and' | 'a' | 'trip' | 'let'

export type BeatWord =
  | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8'
  | '9' | '10' | '11' | '12' | '13' | '14' | '15' | '16'

/** Every word a voice pack provides; also the sample file name (public/voices/<pack>/<word>.wav). */
export type VoiceWord = BeatWord | SubdivisionWord

export interface SubdivisionDef {
  id: SubdivisionId
  label: string
  /** Pulse offsets as fractions of one beat: ascending, in [0, 1), first is always 0. */
  pulses: readonly number[]
  /** Voice syllable per pulse (same length as `pulses`). Index 0 is always null: the beat number is spoken there. */
  words: readonly (SubdivisionWord | null)[]
}

export type BuiltInSoundId =
  | 'click'
  | 'beep'
  | 'woodblock'
  | 'cowbell'
  | 'clave'
  | 'hihat'
  | 'rim'
  | 'tick'
  | 'bell'
  | 'kick'

/** A built-in synthesized sound, or `custom:<id>` for a sound file the user uploaded. */
export type SoundId = BuiltInSoundId | `custom:${string}`

/**
 * Which click a pulse uses. Each role has its own sound and mixer channel.
 * 'medium' is the sub-accent: the first beat of a later group (beat 4 of 6/8 as 3+3).
 */
export type SoundRole = 'accent' | 'medium' | 'beat' | 'sub'

export type VoicePackId = 'en-male' | 'en-female' | 'es-female'

/** One part of a program: a meter played for a number of bars. Outside program mode the active section loops forever. */
export interface Section {
  id: string
  name: string
  /** Time signature numerator, 1..MAX_BEATS_PER_BAR. */
  beatsPerBar: number
  beatUnit: BeatUnit
  /** One level per beat; always exactly `beatsPerBar` long. */
  beats: BeatLevel[]
  subdivision: SubdivisionId
  /** Bars this section lasts in program mode, 1..MAX_SECTION_BARS. Ignored outside program mode. */
  bars: number
  /** Tempo for this section in program mode; null means "use the global tempo". */
  tempo: number | null
}

export interface ProgramSettings {
  /** When on, sections play in order, each for its `bars`, starting at section 0. */
  enabled: boolean
  /** Restart at section 0 after the last section; when off playback stops at the end. */
  loop: boolean
}

/** Gap trainer: play `playBars` bars, then silence `muteBars` bars, repeat. */
export interface GapSettings {
  enabled: boolean
  playBars: number
  muteBars: number
}

/** Randomly silences whole beats (with their subdivisions) with the given probability. */
export interface RandomMuteSettings {
  enabled: boolean
  /** 0..100 */
  percent: number
}

/** What the speed trainer does once it has played `everyBars` bars at the target tempo. */
export type PracticeAtTarget = 'hold' | 'restart' | 'reverse' | 'stop'

/**
 * Speed trainer. Starts at `startBpm` and moves by `stepBpm` toward `targetBpm` every `everyBars` bars.
 * Increases when target > start, decreases when target < start. While enabled it overrides every other
 * tempo source (global tempo and section tempos); the tempo percentage still applies on top.
 */
export interface PracticeSettings {
  enabled: boolean
  startBpm: number
  targetBpm: number
  /** Positive step size in BPM. */
  stepBpm: number
  everyBars: number
  atTarget: PracticeAtTarget
}

export interface SoundSettings {
  accent: SoundId
  /** Sub-accent (medium beats). */
  medium: SoundId
  beat: SoundId
  sub: SoundId
}

export interface VoiceSettings {
  enabled: boolean
  pack: VoicePackId
  /** Also speak subdivision syllables ("e", "and", "a", "trip", "let") where the subdivision defines them. */
  subdivisions: boolean
  /** Keep the clicks playing under the voice. When off, the voice replaces the click on pulses it speaks. */
  clicks: boolean
}

/** All volumes are linear gains in 0..1. */
export interface MixerSettings {
  master: number
  accent: number
  medium: number
  beat: number
  sub: number
  voice: number
  muted: boolean
}

export interface VisualSettings {
  /** Flash the screen on every beat (accents stronger). */
  flash: boolean
}

export interface Settings {
  version: 1
  /** Global tempo in BPM, MIN_BPM..MAX_BPM (integer). */
  bpm: number
  /** Scales whatever tempo is in effect, MIN_TEMPO_PERCENT..MAX_TEMPO_PERCENT (integer). */
  tempoPercent: number
  /** Always at least one section. */
  sections: Section[]
  /** Index of the section selected in the program (the one "Save section" writes to). */
  activeSection: number
  /**
   * The rhythm the quick controls and beat pads edit (meter, accents, subdivision), id CURRENT_SECTION_ID.
   * Outside program mode this is what plays. It is only written into a section by "Save section", so editing it
   * never changes the program by accident.
   */
  current: Section
  program: ProgramSettings
  gap: GapSettings
  randomMute: RandomMuteSettings
  practice: PracticeSettings
  sounds: SoundSettings
  voice: VoiceSettings
  mixer: MixerSettings
  visual: VisualSettings
}

export type SilentReason = 'gap' | 'random' | 'level'

export interface PracticeState {
  /** Practice tempo in effect for this bar (before the tempo percentage). */
  bpm: number
  /** Bars already completed at this practice tempo (0-based count, so 0 on the first bar of a step). */
  barsAtTempo: number
  everyBars: number
  /** +1 moving up, -1 moving down, 0 holding (start === target, or holding at target). */
  direction: 1 | -1 | 0
}

/** One scheduled pulse produced by the sequencer. Times are AudioContext seconds. */
export interface PulseEvent {
  time: number
  /** Seconds until the following pulse, at the tempo in effect when this pulse was produced. */
  duration: number
  /** Seconds in one beat at `bpm`. */
  beatDuration: number
  sectionIndex: number
  /** 0-based bar within the current section. */
  sectionBar: number
  /** Bars the current section lasts in program mode; null outside program mode. */
  sectionBars: number | null
  /** 0-based bars since playback started. */
  totalBar: number
  /** 0-based beat within the bar. */
  beat: number
  beatsPerBar: number
  /** 0-based pulse within the beat; 0 is the beat itself. */
  pulse: number
  pulsesInBeat: number
  /** Configured level of the beat this pulse belongs to. */
  level: BeatLevel
  /** Click this pulse would use (pulse 0: accent→'accent', medium→'medium', normal→'beat'; pulse > 0: 'sub'). Null when silent. */
  role: SoundRole | null
  /** Whether the click should sound (false when silent, or when the voice replaces it). */
  click: boolean
  /** Click gain multiplier before the mixer: 1 for every audible level (each role has its own mixer channel). */
  gain: number
  /** Word to speak on this pulse, or null. */
  voice: VoiceWord | null
  /** Voice gain multiplier before the mixer: accent 1, medium 0.9, normal 0.8, subdivision syllables 0.6. */
  voiceGain: number
  /** True when nothing sounds on this pulse because of the gap trainer, random mute or a muted beat. */
  silent: boolean
  silentReason: SilentReason | null
  /** True for every pulse of a bar silenced by the gap trainer. */
  gapBar: boolean
  /** Effective tempo: base tempo × percentage, clamped to MIN_BPM..MAX_BPM. */
  bpm: number
  /** Tempo before the percentage is applied (practice tempo, section tempo or global tempo). */
  baseBpm: number
  practice: PracticeState | null
}

export type PlaybackStatus = 'stopped' | 'starting' | 'playing'

/** What the UI renders. A new object is published only when something changed (useSyncExternalStore). */
export interface PlaybackSnapshot {
  status: PlaybackStatus
  /** Most recent pulse that has become audible; null when stopped. */
  pulse: PulseEvent | null
  /** Increments with every new audible pulse, so the UI can retrigger animations. */
  serial: number
  /** AudioContext time of the first pulse; null when stopped. Elapsed = pulse.time - startTime. */
  startTime: number | null
  /** True when playback stopped by itself (non-looping program finished, or practice 'stop'). Cleared on start. */
  ended: boolean
  /** Human-readable problem (e.g. audio could not start); null when fine. */
  error: string | null
}
