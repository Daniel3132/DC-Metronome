import {
  BEAT_UNITS,
  MAX_BEATS_PER_BAR,
  MAX_BPM,
  MAX_SECTION_BARS,
  MAX_SECTION_PARTS,
  MAX_SECTIONS,
  MIN_BPM,
} from '../constants'
import type { ParsedPart, ParsedSection } from '../programText'
import type { BeatUnit } from '../types'

/** One bar of an imported song, in play order (repeats already expanded). */
export interface ImportedBar {
  /** Time signature as written in the file (may be outside what the metronome supports). */
  numerator: number
  denominator: number
  /** Tempo in quarter notes per minute at the start of the bar. */
  tempo: number
  /** A section / rehearsal mark starting at this bar, or null. */
  marker: string | null
}

export interface ImportResult {
  sections: ParsedSection[]
  /** Things that were changed to fit the metronome, for the user to check. */
  warnings: string[]
}

const MAX_NAME_LENGTH = 40

function clampTempo(bpm: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)))
}

/**
 * A signature the metronome can play for `numerator/denominator`. Units outside 2/4/8/16 are rewritten with the same
 * bar length (x/1 → 2x/2) or the nearest one (x/32 → ceil(x/2)/16); more than MAX_BEATS_PER_BAR beats are clamped.
 */
export function fitSignature(numerator: number, denominator: number): { beatsPerBar: number; beatUnit: BeatUnit } {
  let beats = Math.max(1, Math.round(numerator) || 1)
  let unit = Math.round(denominator) || 4
  while (unit < 2) {
    beats *= 2
    unit *= 2
  }
  while (unit > 16) {
    beats = Math.ceil(beats / 2)
    unit /= 2
  }
  // Make the unit one of BEAT_UNITS (a power of two between 2 and 16); others (e.g. x/12) fall back to quarters.
  const beatUnit = (BEAT_UNITS as readonly number[]).includes(unit) ? (unit as BeatUnit) : 4
  return { beatsPerBar: Math.min(MAX_BEATS_PER_BAR, beats), beatUnit }
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
}

interface Run {
  name: string
  tempo: number
  bars: { beatsPerBar: number; beatUnit: BeatUnit }[]
}

/**
 * Turn the bars of a song into program sections:
 * - a new section starts at every marker and at every tempo change (an unmarked continuation is "<name> (2)", …);
 * - inside a section, consecutive bars in the same signature become one part;
 * - sections with more than MAX_SECTION_PARTS parts or MAX_SECTION_BARS bars in a part are split into continuations;
 * - tempos are rounded and clamped to MIN_BPM..MAX_BPM; at most MAX_SECTIONS sections are kept.
 * Bars before the first marker form a section named `firstName`.
 */
export function barsToProgram(bars: readonly ImportedBar[], firstName = 'Intro'): ImportResult {
  const warnings = new Set<string>()
  if (bars.length === 0) return { sections: [], warnings: ['The file has no bars.'] }

  const runs: Run[] = []
  const continuations = new Map<string, number>()
  const continuationName = (base: string) => {
    const n = (continuations.get(base) ?? 1) + 1
    continuations.set(base, n)
    return `${base} (${n})`
  }

  let baseName = firstName
  for (const [index, bar] of bars.entries()) {
    const tempo = clampTempo(bar.tempo)
    if (tempo !== Math.round(bar.tempo)) warnings.add(`Tempos outside ${MIN_BPM}–${MAX_BPM} BPM were clamped.`)
    const signature = fitSignature(bar.numerator, bar.denominator)
    if (signature.beatsPerBar !== bar.numerator || signature.beatUnit !== bar.denominator) {
      warnings.add(`${bar.numerator}/${bar.denominator} became ${signature.beatsPerBar}/${signature.beatUnit}.`)
    }

    const marker = bar.marker !== null ? cleanName(bar.marker) : ''
    const current = runs.at(-1)
    if (index === 0 || marker !== '') {
      baseName = marker || baseName
      continuations.delete(baseName)
      runs.push({ name: baseName, tempo, bars: [signature] })
    } else if (current && current.tempo !== tempo) {
      runs.push({ name: continuationName(baseName), tempo, bars: [signature] })
    } else {
      current?.bars.push(signature)
    }
  }

  const sections: ParsedSection[] = []
  for (const run of runs) {
    let parts: ParsedPart[] = []
    let name = run.name
    const flush = () => {
      if (parts.length === 0) return
      sections.push({ name, parts, repeats: 1, tempo: run.tempo })
      parts = []
      name = continuationName(run.name)
    }
    for (const bar of run.bars) {
      const last = parts.at(-1)
      if (last && last.beatsPerBar === bar.beatsPerBar && last.beatUnit === bar.beatUnit && last.bars < MAX_SECTION_BARS) {
        last.bars += 1
        continue
      }
      if (parts.length >= MAX_SECTION_PARTS) {
        warnings.add(`Sections with more than ${MAX_SECTION_PARTS} signature changes were split.`)
        flush()
      }
      parts.push({ ...bar, grouping: null, bars: 1 })
    }
    flush()
  }

  if (sections.length > MAX_SECTIONS) {
    warnings.add(`Only the first ${MAX_SECTIONS} sections were kept (the file has ${sections.length}).`)
    sections.length = MAX_SECTIONS
  }
  return { sections, warnings: [...warnings] }
}
