import type { ImportedBar } from './toProgram'

/** A Standard MIDI File could not be read. */
export class MidiError extends Error {}

interface MetaEvent {
  tick: number
  /** Order within the file, so events at the same tick keep their order. */
  order: number
  type: number
  data: Uint8Array
}

const META_TEXT = 0x01
const META_MARKER = 0x06
const META_CUE = 0x07
const META_END = 0x2f
const META_TEMPO = 0x51
const META_TIME_SIGNATURE = 0x58

const DEFAULT_TEMPO_US = 500000 // 120 BPM

class Reader {
  pos: number
  readonly bytes: Uint8Array
  readonly end: number

  constructor(bytes: Uint8Array, start = 0, end = bytes.length) {
    this.bytes = bytes
    this.pos = start
    this.end = end
  }

  byte(): number {
    if (this.pos >= this.end) throw new MidiError('The MIDI file ends unexpectedly.')
    return this.bytes[this.pos++]
  }

  uint(length: number): number {
    let value = 0
    for (let i = 0; i < length; i++) value = value * 256 + this.byte()
    return value
  }

  varLen(): number {
    let value = 0
    for (let i = 0; i < 4; i++) {
      const b = this.byte()
      value = value * 128 + (b & 0x7f)
      if ((b & 0x80) === 0) return value
    }
    throw new MidiError('The MIDI file has an invalid length.')
  }

  text(length: number): string {
    return String.fromCharCode(...this.take(length))
  }

  take(length: number): Uint8Array {
    if (this.pos + length > this.end) throw new MidiError('The MIDI file ends unexpectedly.')
    const out = this.bytes.subarray(this.pos, this.pos + length)
    this.pos += length
    return out
  }
}

function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return String.fromCharCode(...data)
  }
}

/** Reads one track chunk; returns its meta events and the tick it ends at. */
function readTrack(reader: Reader, end: number, orderStart: number): { events: MetaEvent[]; endTick: number } {
  const events: MetaEvent[] = []
  let tick = 0
  let status = 0
  while (reader.pos < end) {
    tick += reader.varLen()
    const first = reader.byte()
    if (first === 0xff) {
      const type = reader.byte()
      const data = reader.take(reader.varLen())
      events.push({ tick, order: orderStart + events.length, type, data })
      if (type === META_END) break
      continue
    }
    if (first === 0xf0 || first === 0xf7) {
      reader.take(reader.varLen())
      continue
    }
    if (first & 0x80) {
      status = first
      reader.byte() // the running-status byte was the status; this is the first data byte
    } else if (status === 0) {
      throw new MidiError('The MIDI file has a data byte without a status.')
    }
    // The first data byte has been read; program change and channel pressure have one, the rest two.
    const kind = status & 0xf0
    if (kind !== 0xc0 && kind !== 0xd0) reader.byte()
  }
  reader.pos = end
  return { events, endTick: tick }
}

/**
 * The bars of a Standard MIDI File (format 0 or 1) from its time signature, tempo and marker meta events, read from
 * every track. Markers (or cue points; text events on the first track when there are neither) name sections; a marker
 * inside a bar applies to the bar it falls in. The song lasts until the last track ends (rounded up to a whole bar).
 */
export function readMidiBars(bytes: Uint8Array): ImportedBar[] {
  const reader = new Reader(bytes)
  if (bytes.length < 14 || reader.text(4) !== 'MThd') throw new MidiError('This is not a MIDI file.')
  const headerLength = reader.uint(4)
  const headerEnd = reader.pos + headerLength
  reader.uint(2) // format
  const trackCount = reader.uint(2)
  const division = reader.uint(2)
  if (division & 0x8000) throw new MidiError('MIDI files timed in SMPTE frames are not supported.')
  if (division === 0) throw new MidiError('The MIDI file has no timing.')
  reader.pos = headerEnd

  const events: MetaEvent[] = []
  const firstTrackTexts: MetaEvent[] = []
  let endTick = 0
  for (let track = 0; track < trackCount && reader.pos + 8 <= bytes.length; track++) {
    const id = reader.text(4)
    const length = reader.uint(4)
    const end = Math.min(bytes.length, reader.pos + length)
    if (id !== 'MTrk') {
      reader.pos = end
      track--
      continue
    }
    const result = readTrack(reader, end, events.length + firstTrackTexts.length)
    for (const event of result.events) {
      if (event.type === META_TEXT) {
        if (track === 0) firstTrackTexts.push(event)
      } else {
        events.push(event)
      }
    }
    endTick = Math.max(endTick, result.endTick)
  }

  const hasMarkers = events.some((e) => e.type === META_MARKER || e.type === META_CUE)
  const all = [...events, ...(hasMarkers ? [] : firstTrackTexts)].sort((a, b) => a.tick - b.tick || a.order - b.order)

  const bars: ImportedBar[] = []
  let numerator = 4
  let denominator = 4
  let tempoUs = DEFAULT_TEMPO_US
  let barStart = 0
  let next = 0
  // Always at least one bar; stop at the end of the song (or the last event, whichever is later).
  const lastTick = Math.max(endTick, all.at(-1)?.tick ?? 0)
  do {
    let marker: string | null = null
    // Events at the start of this bar set its signature and tempo.
    while (next < all.length && all[next].tick <= barStart) {
      const e = all[next++]
      if (e.type === META_TIME_SIGNATURE && e.data.length >= 2) {
        numerator = e.data[0] || 4
        denominator = 2 ** e.data[1]
      } else if (e.type === META_TEMPO && e.data.length >= 3) {
        tempoUs = (e.data[0] << 16) | (e.data[1] << 8) | e.data[2] || DEFAULT_TEMPO_US
      } else if (e.type === META_MARKER || e.type === META_CUE || e.type === META_TEXT) {
        const text = decodeText(e.data).trim()
        if (text) marker = text
      }
    }
    const barTicks = Math.max(1, Math.round((numerator * 4 * division) / denominator))
    const barEnd = barStart + barTicks
    // A marker inside the bar names it too (markers placed a little late).
    while (next < all.length && all[next].tick < barEnd && marker === null) {
      const e = all[next]
      if (e.type !== META_MARKER && e.type !== META_CUE && e.type !== META_TEXT) break
      next++
      const text = decodeText(e.data).trim()
      if (text) marker = text
    }
    bars.push({ numerator, denominator, tempo: 60000000 / tempoUs, marker })
    barStart = barEnd
  } while (barStart < lastTick)
  return bars
}
