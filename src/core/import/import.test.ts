import { describe, expect, it } from 'vitest'
import { MAX_SECTION_PARTS } from '../constants'
import { playOrder, scoreBars, type ScoreBar } from './guitarPro'
import { baseName, importSong } from './importSong'
import { MidiError, readMidiBars } from './midi'
import { barsToProgram, fitSignature, type ImportedBar } from './toProgram'

// --- MIDI builders ---

function varLen(value: number): number[] {
  const out = [value & 0x7f]
  for (let v = value >> 7; v > 0; v >>= 7) out.unshift((v & 0x7f) | 0x80)
  return out
}

const str = (s: string) => Array.from(s, (c) => c.charCodeAt(0))
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]

type Ev = [delta: number, ...bytes: number[]]
const timeSig = (delta: number, num: number, denPow: number): Ev => [delta, 0xff, 0x58, 4, num, denPow, 24, 8]
const tempo = (delta: number, bpm: number): Ev => {
  const us = Math.round(60000000 / bpm)
  return [delta, 0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]
}
const marker = (delta: number, text: string): Ev => [delta, 0xff, 0x06, ...varLen(text.length), ...str(text)]
const noteOn = (delta: number): Ev => [delta, 0x90, 60, 100]
const noteOff = (delta: number): Ev => [delta, 0x80, 60, 0]
const end = (delta: number): Ev => [delta, 0xff, 0x2f, 0]

function track(events: Ev[]): number[] {
  const body = events.flatMap(([delta, ...bytes]) => [...varLen(delta), ...bytes])
  return [...str('MTrk'), ...u32(body.length), ...body]
}

function midi(division: number, ...tracks: Ev[][]): Uint8Array<ArrayBuffer> {
  const header = [...str('MThd'), ...u32(6), 0, 1, 0, tracks.length, (division >> 8) & 0xff, division & 0xff]
  return new Uint8Array([...header, ...tracks.flatMap(track)])
}

const PPQ = 480

describe('readMidiBars', () => {
  it('reads signatures, tempos and markers bar by bar', () => {
    const conductor: Ev[] = [
      timeSig(0, 4, 2),
      tempo(0, 100),
      marker(0, 'Intro'),
      // Bar 2 (after 2 bars of 4/4): 7/8 at 140 named Verse.
      timeSig(PPQ * 8, 7, 3),
      tempo(0, 140),
      marker(0, 'Verse'),
      end(0),
    ]
    // A note track lasting 2 bars of 4/4 + 2 bars of 7/8 (7 eighths = 3.5 quarters each).
    const notes: Ev[] = [noteOn(0), noteOff(PPQ * 8 + PPQ * 7), end(0)]
    const bars = readMidiBars(midi(PPQ, conductor, notes))
    expect(bars.map((b) => [b.numerator, b.denominator, Math.round(b.tempo), b.marker])).toEqual([
      [4, 4, 100, 'Intro'],
      [4, 4, 100, null],
      [7, 8, 140, 'Verse'],
      [7, 8, 140, null],
    ])
  })

  it('defaults to 4/4 at 120 and supports running status', () => {
    const notes: Ev[] = [[0, 0x90, 60, 100], [PPQ, 62, 100], [PPQ * 7, 64, 0], end(0)]
    const bars = readMidiBars(midi(PPQ, notes))
    expect(bars).toEqual([
      { numerator: 4, denominator: 4, tempo: 120, marker: null },
      { numerator: 4, denominator: 4, tempo: 120, marker: null },
    ])
  })

  it('rejects files that are not MIDI or are timed in SMPTE frames', () => {
    expect(() => readMidiBars(new Uint8Array(str('RIFF0000WAVEfmt ')))).toThrow(MidiError)
    const smpte = midi(PPQ, [end(0)])
    smpte[12] = 0xe7
    expect(() => readMidiBars(smpte)).toThrow(/SMPTE/)
  })
})

// --- Program building ---

const bar = (numerator: number, denominator: number, tempo = 120, marker: string | null = null): ImportedBar => ({
  numerator,
  denominator,
  tempo,
  marker,
})

describe('barsToProgram', () => {
  it('starts sections at markers and merges bars in the same signature into parts', () => {
    const { sections, warnings } = barsToProgram([
      bar(4, 4, 120, 'Intro'),
      bar(4, 4),
      bar(4, 4, 120, 'Verse 1'),
      bar(4, 4),
      bar(7, 8),
      bar(4, 4),
    ])
    expect(warnings).toEqual([])
    expect(sections.map((s) => [s.name, s.tempo, s.parts.map((p) => `${p.beatsPerBar}/${p.beatUnit}x${p.bars}`)])).toEqual([
      ['Intro', 120, ['4/4x2']],
      ['Verse 1', 120, ['4/4x2', '7/8x1', '4/4x1']],
    ])
  })

  it('starts a continuation section on a tempo change', () => {
    const { sections } = barsToProgram([bar(4, 4, 90, 'Solo'), bar(4, 4, 90), bar(4, 4, 150), bar(4, 4, 150)])
    expect(sections.map((s) => [s.name, s.tempo, s.parts[0].bars])).toEqual([
      ['Solo', 90, 2],
      ['Solo (2)', 150, 2],
    ])
  })

  it('names bars before the first marker "Intro"', () => {
    expect(barsToProgram([bar(3, 4), bar(3, 4, 120, 'A')]).sections.map((s) => s.name)).toEqual(['Intro', 'A'])
  })

  it('fits signatures, tempos and part counts to the metronome and says so', () => {
    const many = Array.from({ length: MAX_SECTION_PARTS + 2 }, (_, i) => bar(i % 2 ? 3 : 4, 4, 400))
    const { sections, warnings } = barsToProgram([bar(3, 32, 400, 'X'), ...many])
    expect(sections[0].parts[0]).toMatchObject({ beatsPerBar: 2, beatUnit: 16 })
    expect(sections[0].tempo).toBe(300)
    expect(sections.length).toBe(2)
    expect(sections[1].name).toBe('X (2)')
    expect(warnings.length).toBe(3)
  })

  it('maps whole-note signatures to the same bar length', () => {
    expect(fitSignature(2, 1)).toEqual({ beatsPerBar: 4, beatUnit: 2 })
    expect(fitSignature(5, 4)).toEqual({ beatsPerBar: 5, beatUnit: 4 })
    expect(fitSignature(20, 8)).toEqual({ beatsPerBar: 16, beatUnit: 8 })
  })
})

// --- Guitar Pro (score model) ---

function sb(patch: Partial<ScoreBar> = {}): ScoreBar {
  return {
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    isRepeatStart: false,
    repeatCount: 0,
    alternateEndings: 0,
    section: null,
    tempoAutomations: [],
    ...patch,
  }
}

describe('playOrder', () => {
  it('plays repeats and alternate endings', () => {
    const bars = [
      sb(),
      sb({ isRepeatStart: true }),
      sb(),
      sb({ alternateEndings: 0b01, repeatCount: 2 }),
      sb({ alternateEndings: 0b10 }),
      sb(),
    ]
    expect(playOrder(bars)).toEqual([0, 1, 2, 3, 1, 2, 4, 5])
  })

  it('repeats from the start when there is no repeat start', () => {
    expect(playOrder([sb(), sb({ repeatCount: 3 }), sb()])).toEqual([0, 1, 0, 1, 0, 1, 2])
  })
})

describe('scoreBars', () => {
  it('reads sections, signatures and tempo changes at the bar start', () => {
    const bars = scoreBars({
      tempo: 96,
      masterBars: [
        sb({ section: { text: 'Intro', marker: 'A' } }),
        sb({ tempoAutomations: [{ value: 150, ratioPosition: 0.5 }] }),
        sb({ timeSignatureNumerator: 6, timeSignatureDenominator: 8, section: { text: '', marker: 'B' } }),
      ],
    })
    expect(bars).toEqual([
      { numerator: 4, denominator: 4, tempo: 96, marker: 'Intro' },
      { numerator: 4, denominator: 4, tempo: 96, marker: null },
      { numerator: 6, denominator: 8, tempo: 150, marker: 'B' },
    ])
  })
})

describe('baseName', () => {
  it('drops the extension', () => {
    expect(baseName('My Song.final.gp5')).toBe('My Song.final')
    expect(baseName('.mid')).toBe('.mid')
  })
})

describe('importSong', () => {
  it('reads a MIDI file into sections named after its markers', async () => {
    const bytes = midi(PPQ, [timeSig(0, 3, 2), tempo(0, 90), marker(0, 'Verse'), end(PPQ * 6)])
    const song = await importSong(new File([bytes], 'My Song.mid'))
    expect(song.name).toBe('My Song')
    expect(song.sections).toEqual([
      { name: 'Verse', tempo: 90, repeats: 1, parts: [{ beatsPerBar: 3, beatUnit: 4, grouping: null, bars: 2 }] },
    ])
  })

  it('explains when a file is neither MIDI nor Guitar Pro', async () => {
    const warn = console.warn
    console.warn = () => {}
    try {
      await expect(importSong(new File([new Uint8Array([1, 2, 3, 4, 5])], 'notes.txt'))).rejects.toThrow(/could not be read/)
    } finally {
      console.warn = warn
    }
  })
})
