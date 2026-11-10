import { MAX_BEATS_PER_BAR } from './constants'
import type { BeatLevel, BeatUnit } from './types'

const NEXT_LEVEL: Readonly<Record<BeatLevel, BeatLevel>> = {
  accent: 'medium',
  medium: 'normal',
  normal: 'mute',
  mute: 'accent',
}

/** Next level when a beat pad is clicked: accent → medium → normal → mute → accent. */
export function cycleBeatLevel(level: BeatLevel): BeatLevel {
  return NEXT_LEVEL[level] ?? 'accent'
}

/** Resize a beat-level list to `count` (clamped 1..MAX_BEATS_PER_BAR), keeping existing levels; new beats are 'normal'. A brand-new beat 0 is 'accent'. */
export function resizeBeats(beats: readonly BeatLevel[], count: number): BeatLevel[] {
  const n = Number.isNaN(count) ? Math.max(1, beats.length) : Math.round(count)
  const size = Math.min(MAX_BEATS_PER_BAR, Math.max(1, n))
  return Array.from({ length: size }, (_, i) => beats[i] ?? (i === 0 ? 'accent' : 'normal'))
}

/** Beat levels for a grouping such as [3, 2]: 'accent' on beat 1, 'medium' on the first beat of every later group, 'normal' elsewhere. */
export function beatsFromGrouping(groups: readonly number[]): BeatLevel[] {
  const beats: BeatLevel[] = []
  for (const group of groups) {
    const size = Math.round(group)
    if (!(size >= 1)) continue
    for (let i = 0; i < size; i++) beats.push(i > 0 ? 'normal' : beats.length === 0 ? 'accent' : 'medium')
  }
  return beats.slice(0, MAX_BEATS_PER_BAR)
}

// Most idiomatic grouping first; every entry sums to its beat count (checked by the tests).
const GROUPINGS: Readonly<Record<number, readonly (readonly number[])[]>> = {
  5: [[3, 2], [2, 3]],
  6: [[3, 3], [2, 2, 2]],
  7: [[4, 3], [3, 4], [2, 2, 3], [3, 2, 2], [2, 3, 2]],
  8: [[3, 3, 2], [4, 4], [3, 2, 3], [2, 3, 3], [2, 2, 2, 2]],
  9: [[3, 3, 3], [2, 2, 2, 3]],
  10: [[3, 3, 2, 2], [2, 2, 3, 3], [3, 2, 3, 2], [5, 5]],
  11: [[3, 3, 3, 2], [2, 3, 3, 3], [2, 2, 3, 2, 2]],
  12: [[3, 3, 3, 3], [4, 4, 4], [3, 3, 2, 2, 2]],
  13: [[3, 3, 3, 2, 2], [2, 2, 3, 3, 3], [3, 2, 3, 2, 3]],
  14: [[3, 3, 2, 3, 3], [4, 3, 4, 3], [2, 2, 3, 2, 2, 3]],
  15: [[3, 3, 3, 3, 3], [5, 5, 5], [4, 4, 4, 3]],
  16: [[4, 4, 4, 4], [3, 3, 3, 3, 2, 2], [3, 3, 2, 3, 3, 2]],
}

/** Common groupings for a beat count, e.g. 5 → [[3,2],[2,3]], 7 → [[4,3],[3,4],[2,2,3],…], 9 → [[3,3,3],[2,2,2,3]]; [] when none. */
export function suggestedGroupings(beatsPerBar: number): number[][] {
  return (GROUPINGS[beatsPerBar] ?? []).map((grouping) => [...grouping])
}

/**
 * The grouping a meter is usually felt in, or null for bars of up to 4 beats (accent on 1 only).
 * Over 8 and 16 the first suggestion wins (6/8 → 3+3, 7/8 → 4+3, 8/8 → 3+3+2); over 2 and 4, counts that
 * divide into 4s keep them (8/4 → 4+4, 12/4 → 4+4+4) and the rest follow the suggestion (5/4 → 3+2, 6/4 → 3+3).
 */
export function defaultGrouping(beatsPerBar: number, beatUnit: BeatUnit): number[] | null {
  const groupings = suggestedGroupings(beatsPerBar)
  if (groupings.length === 0) return null
  if (beatUnit === 2 || beatUnit === 4) {
    const fours = groupings.find((g) => g.every((size) => size === 4))
    if (fours) return fours
  }
  return groupings[0]
}

/**
 * Accent patterns offered for a beat count: "plain" first (the whole bar as one group, accent on 1 only, so 12 → [12]),
 * then the suggested groupings. Bars of 1..4 beats only get plain.
 */
export function accentGroupings(beatsPerBar: number): number[][] {
  const count = Math.round(beatsPerBar)
  if (!(count >= 1 && count <= MAX_BEATS_PER_BAR)) return []
  return [[count], ...suggestedGroupings(count)]
}

/** The entry of accentGroupings whose accents match `beats` exactly (plain included), or null when edited by hand. */
export function matchingAccentGrouping(beats: readonly BeatLevel[]): number[] | null {
  for (const grouping of accentGroupings(beats.length)) {
    const levels = beatsFromGrouping(grouping)
    if (levels.every((level, i) => level === beats[i])) return grouping
  }
  return null
}

/** "3+2" for [3, 2]. */
export function groupingKey(groups: readonly number[]): string {
  return groups.join('+')
}

/** The suggested grouping whose accents match `beats` exactly, or null when the accents were edited by hand. */
export function matchingGrouping(beats: readonly BeatLevel[]): number[] | null {
  for (const grouping of suggestedGroupings(beats.length)) {
    const levels = beatsFromGrouping(grouping)
    if (levels.every((level, i) => level === beats[i])) return grouping
  }
  return null
}

/** Time signatures offered as one-tap choices. */
export const COMMON_SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '9/8', '12/8'] as const

/** A longer list for the compact signature picker. */
export const QUICK_SIGNATURES = [
  '2/4', '3/4', '4/4', '5/4', '6/4', '7/4', '2/2', '3/8', '5/8', '6/8', '7/8', '9/8', '11/8', '12/8',
] as const

// Lower bound (inclusive) of each marking; a common simplification of the overlapping traditional ranges.
const MARKINGS: readonly (readonly [number, string])[] = [
  [200, 'Prestissimo'],
  [176, 'Presto'],
  [156, 'Vivace'],
  [120, 'Allegro'],
  [108, 'Moderato'],
  [76, 'Andante'],
  [66, 'Adagio'],
  [60, 'Larghetto'],
  [40, 'Largo'],
  [25, 'Grave'],
]

/** Italian tempo marking for a BPM (Grave, Largo, Adagio, Andante, Moderato, Allegro, Vivace, Presto, Prestissimo …). */
export function tempoMarking(bpm: number): string {
  if (Number.isNaN(bpm)) return ''
  for (const [min, name] of MARKINGS) {
    if (bpm >= min) return name
  }
  return 'Larghissimo'
}
