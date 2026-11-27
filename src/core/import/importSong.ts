import { readMidiBars } from './midi'
import { barsToProgram, type ImportResult } from './toProgram'

/** What the file picker accepts. */
export const SONG_FILE_ACCEPT = '.mid,.midi,.gp,.gp3,.gp4,.gp5,.gpx'

/** Song files larger than this are refused (a long Guitar Pro file is a few hundred KB). */
const MAX_SONG_BYTES = 20 * 1024 * 1024

export interface ImportedSong extends ImportResult {
  /** File name without its extension: the suggested preset name. */
  name: string
}

/** The file name without its extension. */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return (dot > 0 ? fileName.slice(0, dot) : fileName).trim() || 'Imported song'
}

function isMidi(bytes: Uint8Array): boolean {
  return bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64 // "MThd"
}

/**
 * Read a MIDI or Guitar Pro file into program sections (named sections, signature changes, tempo changes).
 * MIDI is recognized by its header; anything else is handed to the Guitar Pro reader (loaded on demand).
 * Throws an Error with a message for the user when the file cannot be read.
 */
export async function importSong(file: File): Promise<ImportedSong> {
  if (file.size > MAX_SONG_BYTES) throw new Error('The file is too large.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const name = baseName(file.name)
  if (isMidi(bytes)) return { name, ...barsToProgram(readMidiBars(bytes)) }

  let bars
  try {
    const { readGuitarProBars } = await import('./guitarPro')
    bars = (await readGuitarProBars(bytes)).bars
  } catch (error) {
    // The reader's own message is technical; keep it for the console.
    console.warn('Could not read the song file', error)
    throw new Error('This file could not be read. Use a MIDI (.mid) or Guitar Pro (.gp, .gpx, .gp3–.gp5) file.', {
      cause: error,
    })
  }
  return { name, ...barsToProgram(bars) }
}
