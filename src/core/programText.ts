import {
  BEAT_UNITS,
  MAX_BEATS_PER_BAR,
  MAX_BPM,
  MAX_SECTION_BARS,
  MAX_SECTION_PARTS,
  MAX_SECTION_REPEATS,
  MAX_SECTIONS,
  MIN_BPM,
} from './constants'
import { beatsFromGrouping, defaultGrouping, groupingKey, matchingAccentGrouping } from './meter'
import { createSection, defaultBeats } from './settings'
import type { BeatUnit, Part, Section } from './types'

/**
 * A short text language for writing a program quickly, in the spirit of Emmet abbreviations:
 *
 *   3/8x3, 4/4x2              3 bars of 3/8, then 2 bars of 4/4 (two sections)
 *   4/4x8@140                 8 bars of 4/4 with its own tempo (140 BPM)
 *   7/8(2+2+3)x4              accents grouped 2+2+3
 *   intro:4/4x4, verse:3/4x8  named sections
 *   [2/4, 4/4]x3              one section: a bar of 2/4 then a bar of 4/4, played 3 times
 *   riff:[7/8, 4/4x2]x4@150   a named group with its own tempo
 *
 * Items are separated by commas, semicolons or new lines; spaces are ignored. A section is
 * `[name:]beats/unit[(grouping)][xBars][@bpm]` or `[name:][parts][xRepeats][@bpm]`, where the parts inside the
 * brackets are `beats/unit[(grouping)][xBars]`. Bars and repeats default to 1, `*` works like `x`, the unit is 2, 4,
 * 8 or 16. A group nested inside a group is written out in place (`[[2/4]x2, 3/4]` has the parts 2/4, 2/4, 3/4).
 */

export interface ParsedPart {
  beatsPerBar: number
  beatUnit: BeatUnit
  /** Accent grouping written in the text, or null for the meter's usual feel. */
  grouping: number[] | null
  bars: number
}

export interface ParsedSection {
  name: string
  parts: ParsedPart[]
  repeats: number
  tempo: number | null
}

export type ParseResult =
  | { ok: true; sections: ParsedSection[] }
  | { ok: false; error: string; /** Index in the text where the problem is. */ at: number }

class ParseError extends Error {
  readonly at: number

  constructor(message: string, at: number) {
    super(message)
    this.at = at
  }
}

const NAME_RE = /[A-Za-z][\w-]*/y
const INT_RE = /\d+/y

const copyPart = (part: ParsedPart): ParsedPart => ({ ...part, grouping: part.grouping && [...part.grouping] })

class Parser {
  private pos = 0
  private readonly text: string

  constructor(text: string) {
    this.text = text
  }

  parse(): ParsedSection[] {
    const sections: ParsedSection[] = []
    this.items(null, () => {
      sections.push(this.section())
      if (sections.length > MAX_SECTIONS) this.fail(`A program has at most ${MAX_SECTIONS} sections`)
    })
    this.skipSpace()
    if (this.pos < this.text.length) this.fail(`Unexpected "${this.text[this.pos]}"`)
    if (sections.length === 0) this.fail('Write at least one section, e.g. 4/4x4')
    return sections
  }

  /** Reads separated items up to `close` (a "]") or the end of the text, calling `item` at the start of each. */
  private items(close: string | null, item: () => void): void {
    for (;;) {
      this.skipSpace()
      // Empty items (",,", a trailing comma) are allowed.
      while (this.peekSeparator()) {
        this.pos++
        this.skipSpace()
      }
      if (this.pos >= this.text.length || this.text[this.pos] === close) return
      item()
      this.skipSpace()
      if (this.pos >= this.text.length || this.text[this.pos] === close) return
      if (!this.peekSeparator()) this.fail(`Expected "," between sections, found "${this.text[this.pos]}"`)
    }
  }

  /** A top-level item: `[name:]` then a group or a single meter. */
  private section(): ParsedSection {
    const start = this.pos
    let name = ''
    NAME_RE.lastIndex = this.pos
    const nameMatch = NAME_RE.exec(this.text)
    if (nameMatch) {
      this.pos += nameMatch[0].length
      this.skipSpace()
      if (this.text[this.pos] !== ':') this.fail('A name is followed by ":" and a time signature, e.g. verse:4/4x8', start)
      this.pos++
      this.skipSpace()
      name = nameMatch[0]
    }

    if (this.text[this.pos] === '[') {
      const open = this.pos
      const parts = this.group()
      let repeats: number | null = null
      let tempo: number | null = null
      for (;;) {
        this.skipSpace()
        const ch = this.text[this.pos]
        if (this.isRepeat(ch) && repeats === null) {
          repeats = this.repeat()
          if (repeats !== null && repeats > MAX_SECTION_REPEATS) {
            this.fail(`A section repeats at most ${MAX_SECTION_REPEATS} times`)
          }
        } else if (ch === '@' && tempo === null) {
          tempo = this.tempo()
        } else {
          break
        }
      }
      if (parts.length === 0) this.fail('Empty group', open)
      return { name, parts, repeats: repeats ?? 1, tempo }
    }

    let tempo: number | null = null
    const part = this.part(() => {
      if (this.text[this.pos] !== '@' || tempo !== null) return false
      tempo = this.tempo()
      return true
    })
    return { name, parts: [part], repeats: 1, tempo }
  }

  /** `[ parts ]`: the parts of one section; a nested group with `xN` is written out N times. */
  private group(): ParsedPart[] {
    const open = this.pos
    this.pos++
    const parts: ParsedPart[] = []
    const push = (more: ParsedPart[]) => {
      parts.push(...more)
      if (parts.length > MAX_SECTION_PARTS) this.fail(`A section has at most ${MAX_SECTION_PARTS} parts`, open)
    }
    this.items(']', () => {
      if (this.text[this.pos] === '[') {
        const inner = this.pos
        const nested = this.group()
        if (nested.length === 0) this.fail('Empty group', inner)
        const times = this.repeat() ?? 1
        if (nested.length * times > MAX_SECTION_PARTS) this.fail(`A section has at most ${MAX_SECTION_PARTS} parts`, open)
        push(Array.from({ length: times }, () => nested.map(copyPart)).flat())
        return
      }
      NAME_RE.lastIndex = this.pos
      if (NAME_RE.test(this.text)) this.fail('Name the whole group instead, e.g. verse:[2/4, 4/4]x4')
      push([
        this.part(() => {
          if (this.text[this.pos] === '@') this.fail('Put the tempo after the group, e.g. [2/4, 4/4]x4@120')
          return false
        }),
      ])
    })
    if (this.text[this.pos] !== ']') this.fail('Missing "]"', open)
    this.pos++
    return parts
  }

  /** `beats/unit[(grouping)][xBars]`; `extra` may consume one more modifier (returns true when it did). */
  private part(extra: () => boolean): ParsedPart {
    const beatsAt = this.pos
    const beatsPerBar = this.int('a time signature such as 4/4')
    if (beatsPerBar < 1 || beatsPerBar > MAX_BEATS_PER_BAR) {
      this.fail(`Beats per bar must be 1–${MAX_BEATS_PER_BAR}`, beatsAt)
    }
    this.skipSpace()
    if (this.text[this.pos] !== '/') this.fail('Expected "/" in the time signature, e.g. 3/4')
    this.pos++
    this.skipSpace()
    const unitAt = this.pos
    const unit = this.int('the beat unit (2, 4, 8 or 16)')
    if (!(BEAT_UNITS as readonly number[]).includes(unit)) this.fail('The beat unit must be 2, 4, 8 or 16', unitAt)

    let grouping: number[] | null = null
    let bars: number | null = null
    for (;;) {
      this.skipSpace()
      const ch = this.text[this.pos]
      if (ch === '(' && grouping === null) {
        grouping = this.grouping(beatsPerBar)
      } else if (this.isRepeat(ch) && bars === null) {
        bars = this.repeat()
        if (bars !== null && bars > MAX_SECTION_BARS) this.fail(`A section lasts at most ${MAX_SECTION_BARS} bars`)
      } else if (!extra()) {
        break
      }
    }

    return { beatsPerBar, beatUnit: unit as BeatUnit, grouping, bars: bars ?? 1 }
  }

  private tempo(): number {
    this.pos++
    this.skipSpace()
    const at = this.pos
    const tempo = this.int('a tempo after "@", e.g. @120')
    if (tempo < MIN_BPM || tempo > MAX_BPM) this.fail(`Tempo must be ${MIN_BPM}–${MAX_BPM} BPM`, at)
    return tempo
  }

  private grouping(beatsPerBar: number): number[] {
    const open = this.pos
    this.pos++
    const groups: number[] = []
    for (;;) {
      this.skipSpace()
      groups.push(this.int('a group size, e.g. (2+2+3)'))
      this.skipSpace()
      if (this.text[this.pos] === '+') {
        this.pos++
        continue
      }
      if (this.text[this.pos] === ')') {
        this.pos++
        break
      }
      this.fail('Expected "+" or ")" in the accent grouping')
    }
    const sum = groups.reduce((a, b) => a + b, 0)
    if (groups.some((g) => g < 1) || sum !== beatsPerBar) {
      this.fail(`The groups (${groupingKey(groups)}) must add up to ${beatsPerBar} beats`, open)
    }
    return groups
  }

  private isRepeat(ch: string | undefined): boolean {
    return ch === 'x' || ch === 'X' || ch === '*'
  }

  /** `xN` / `*N`, or null when there is none. */
  private repeat(): number | null {
    this.skipSpace()
    if (!this.isRepeat(this.text[this.pos])) return null
    this.pos++
    this.skipSpace()
    const at = this.pos
    const n = this.int('a number after "x", e.g. x4')
    if (n < 1) this.fail('Repeat at least once', at)
    return n
  }

  private int(what: string): number {
    INT_RE.lastIndex = this.pos
    const match = INT_RE.exec(this.text)
    if (!match) this.fail(`Expected ${what}`)
    this.pos += match[0].length
    return Number(match[0])
  }

  private peekSeparator(): boolean {
    const ch = this.text[this.pos]
    return ch === ',' || ch === ';' || ch === '\n'
  }

  private skipSpace(): void {
    while (this.pos < this.text.length && /[ \t\r]/.test(this.text[this.pos])) this.pos++
  }

  private fail(message: string, at = this.pos): never {
    throw new ParseError(message, at)
  }
}

/** Parse program text such as "3/8x3, [2/4, 4/4]x4". Never throws. */
export function parseProgram(text: string): ParseResult {
  try {
    return { ok: true, sections: new Parser(text).parse() }
  } catch (error) {
    if (error instanceof ParseError) return { ok: false, error: error.message, at: error.at }
    throw error
  }
}

/** Real sections from parsed ones; unnamed ones are called "Section N" after their place in the program. */
export function toSections(parsed: readonly ParsedSection[], firstNumber = 1): Section[] {
  return parsed.map((p, i) =>
    createSection({
      name: p.name || `Section ${firstNumber + i}`,
      parts: p.parts.map((part) => ({
        beatsPerBar: part.beatsPerBar,
        beatUnit: part.beatUnit,
        beats: part.grouping ? beatsFromGrouping(part.grouping) : defaultBeats(part.beatsPerBar, part.beatUnit),
        bars: part.bars,
      })),
      repeats: p.repeats,
      tempo: p.tempo,
    }),
  )
}

const DEFAULT_NAME_RE = /^Section \d+$/

function partToText(part: Part): string {
  // Plain accents read "(7)"; the meter's usual feel needs no grouping at all.
  const grouping = matchingAccentGrouping(part.beats)
  const usual = defaultGrouping(part.beatsPerBar, part.beatUnit) ?? [part.beatsPerBar]
  const writeGrouping = grouping !== null && groupingKey(usual) !== groupingKey(grouping)
  return [
    `${part.beatsPerBar}/${part.beatUnit}`,
    writeGrouping ? `(${groupingKey(grouping)})` : '',
    part.bars !== 1 ? `x${part.bars}` : '',
  ].join('')
}

/**
 * The program as text, to edit it in the quick entry. Keeps names that fit the syntax, signatures, accent groupings,
 * bars, parts, repeats and tempos. Subdivisions and hand-edited accents have no syntax, so they are not kept.
 */
export function programToText(sections: readonly Section[]): string {
  return sections
    .map((s) => {
      const name = s.name.trim()
      const keepName = name !== '' && !DEFAULT_NAME_RE.test(name) && /^[A-Za-z][\w-]*$/.test(name)
      const single = s.parts.length === 1 && s.repeats === 1
      return [
        keepName ? `${name}:` : '',
        single ? partToText(s.parts[0]) : `[${s.parts.map(partToText).join(', ')}]`,
        !single && s.repeats !== 1 ? `x${s.repeats}` : '',
        s.tempo !== null ? `@${s.tempo}` : '',
      ].join('')
    })
    .join(', ')
}
