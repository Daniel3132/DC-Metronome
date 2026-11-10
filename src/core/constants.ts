import type {
  BeatLevel,
  BeatUnit,
  BeatWord,
  BuiltInSoundId,
  SoundRole,
  SubdivisionDef,
  SubdivisionId,
  VoicePackId,
  VoiceWord,
} from './types'

export const MIN_BPM = 60
export const MAX_BPM = 300
export const MIN_TEMPO_PERCENT = 25
export const MAX_TEMPO_PERCENT = 200
export const MAX_BEATS_PER_BAR = 16
export const MAX_SECTION_BARS = 999
export const MAX_GAP_BARS = 64
export const MAX_PRACTICE_EVERY_BARS = 64
export const MAX_PRACTICE_STEP = 50
export const MAX_SECTIONS = 64

export const BEAT_UNITS: readonly BeatUnit[] = [2, 4, 8, 16]

/** Click roles in display order, with their user-facing names. */
export const SOUND_ROLES: readonly { role: SoundRole; label: string; short: string }[] = [
  { role: 'accent', label: 'Accent', short: 'Accent' },
  { role: 'medium', label: 'Sub-accent', short: 'Sub-acc.' },
  { role: 'beat', label: 'Beat', short: 'Beat' },
  { role: 'sub', label: 'Subdivision', short: 'Sub' },
]

export const BEAT_LEVELS: readonly BeatLevel[] = ['accent', 'medium', 'normal', 'mute']

/** Click gain per beat level, before the mixer. Medium beats have their own sound and mixer channel. */
export const LEVEL_GAIN: Readonly<Record<BeatLevel, number>> = {
  accent: 1,
  medium: 1,
  normal: 1,
  mute: 0,
}

/** Voice gain per beat level, before the mixer. */
export const LEVEL_VOICE_GAIN: Readonly<Record<BeatLevel, number>> = {
  accent: 1,
  medium: 0.9,
  normal: 0.8,
  mute: 0,
}
/** Voice gain of spoken subdivision syllables. */
export const SUB_VOICE_GAIN = 0.6

const even = (n: number) => Array.from({ length: n }, (_, i) => i / n)
const silentWords = (n: number) => Array.from({ length: n }, () => null)

export const SUBDIVISIONS: readonly SubdivisionDef[] = [
  { id: 'quarter', label: 'Beats only', pulses: [0], words: [null] },
  { id: 'eighths', label: 'Eighths', pulses: even(2), words: [null, 'and'] },
  { id: 'triplets', label: 'Triplets', pulses: even(3), words: [null, 'trip', 'let'] },
  { id: 'sixteenths', label: 'Sixteenths', pulses: even(4), words: [null, 'e', 'and', 'a'] },
  { id: 'quintuplets', label: 'Quintuplets', pulses: even(5), words: silentWords(5) },
  { id: 'sextuplets', label: 'Sextuplets', pulses: even(6), words: [null, 'trip', 'let', 'and', 'trip', 'let'] },
  { id: 'swing', label: 'Swing', pulses: [0, 2 / 3], words: [null, 'and'] },
  { id: 'gallop', label: 'Gallop', pulses: [0, 0.5, 0.75], words: [null, 'and', 'a'] },
  { id: 'reverse-gallop', label: 'Reverse gallop', pulses: [0, 0.25, 0.5], words: [null, 'e', 'and'] },
  { id: 'dotted', label: 'Dotted', pulses: [0, 0.75], words: [null, 'a'] },
]

export function getSubdivision(id: SubdivisionId): SubdivisionDef {
  return SUBDIVISIONS.find((s) => s.id === id) ?? SUBDIVISIONS[0]
}

export const BUILT_IN_SOUNDS: readonly { id: BuiltInSoundId; label: string }[] = [
  { id: 'click', label: 'Click' },
  { id: 'beep', label: 'Beep' },
  { id: 'woodblock', label: 'Woodblock' },
  { id: 'cowbell', label: 'Cowbell' },
  { id: 'clave', label: 'Clave' },
  { id: 'hihat', label: 'Hi-hat' },
  { id: 'rim', label: 'Rimshot' },
  { id: 'tick', label: 'Mechanical' },
  { id: 'bell', label: 'Bell' },
  { id: 'kick', label: 'Kick' },
]

export const CUSTOM_SOUND_PREFIX = 'custom:'
/** Uploaded sound files larger than this are rejected. */
export const MAX_CUSTOM_SOUND_BYTES = 5 * 1024 * 1024
/** Uploaded sounds longer than this (seconds) are rejected. */
export const MAX_CUSTOM_SOUND_SECONDS = 4

export const VOICE_PACKS: readonly { id: VoicePackId; label: string; lang: string }[] = [
  { id: 'en-male', label: 'English (male)', lang: 'en' },
  { id: 'en-female', label: 'English (female)', lang: 'en' },
  { id: 'es-female', label: 'Español (femenina)', lang: 'es' },
]

export const BEAT_WORDS: readonly BeatWord[] = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16',
]

export const VOICE_WORDS: readonly VoiceWord[] = [...BEAT_WORDS, 'e', 'and', 'a', 'trip', 'let']

/** URL of a voice sample, served from public/voices. */
export function voiceSampleUrl(pack: VoicePackId, word: VoiceWord): string {
  return `${import.meta.env.BASE_URL}voices/${pack}/${word}.wav`
}

export const STORAGE_KEYS = {
  settings: 'dcmetronome.settings.v1',
  presets: 'dcmetronome.presets.v1',
  templates: 'dcmetronome.templates.v1',
} as const
