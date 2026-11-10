// Trims leading/trailing silence from the 16-bit mono WAV files in public/voices
// so each spoken count starts exactly on the beat it is scheduled for.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', 'public', 'voices')
const THRESHOLD = 0.02 * 32768
const PAD_SAMPLES = 40
const FADE_SAMPLES = 220

function findChunk(buf, id) {
  let offset = 12
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (chunkId === id) return { offset: offset + 8, size }
    offset += 8 + size + (size % 2)
  }
  throw new Error(`chunk ${id} not found`)
}

function trim(file) {
  const buf = readFileSync(file)
  const fmt = findChunk(buf, 'fmt ')
  const channels = buf.readUInt16LE(fmt.offset + 2)
  const sampleRate = buf.readUInt32LE(fmt.offset + 4)
  const bits = buf.readUInt16LE(fmt.offset + 14)
  if (channels !== 1 || bits !== 16) throw new Error(`${file}: expected 16-bit mono`)
  const data = findChunk(buf, 'data')
  const count = Math.floor(Math.min(data.size, buf.length - data.offset) / 2)
  const samples = new Int16Array(count)
  for (let i = 0; i < count; i++) samples[i] = buf.readInt16LE(data.offset + i * 2)

  let start = 0
  while (start < count && Math.abs(samples[start]) < THRESHOLD) start++
  let end = count - 1
  while (end > start && Math.abs(samples[end]) < THRESHOLD) end--
  start = Math.max(0, start - PAD_SAMPLES)
  end = Math.min(count - 1, end + FADE_SAMPLES)
  const out = samples.slice(start, end + 1)
  for (let i = 0; i < FADE_SAMPLES && i < out.length; i++) {
    out[out.length - 1 - i] = Math.round(out[out.length - 1 - i] * (i / FADE_SAMPLES))
  }

  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + out.length * 2, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(out.length * 2, 40)
  const body = Buffer.alloc(out.length * 2)
  out.forEach((s, i) => body.writeInt16LE(s, i * 2))
  writeFileSync(file, Buffer.concat([header, body]))
  return { before: count / sampleRate, after: out.length / sampleRate }
}

for (const pack of readdirSync(root)) {
  const dir = join(root, pack)
  if (!statSync(dir).isDirectory()) continue
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.wav'))) {
    const { before, after } = trim(join(dir, name))
    console.log(`${pack}/${name}: ${before.toFixed(3)}s -> ${after.toFixed(3)}s`)
  }
}
