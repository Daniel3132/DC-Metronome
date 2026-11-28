import { describe, expect, it } from 'vitest'
import { barMs, bestOffset, clockSample, compareRevision, nextBarTime, parseMessage, parseRoomCode, validCore, type RoomCore } from './room'

const core: RoomCore = {
  bpm: 120,
  tempoPercent: 100,
  rhythm: { beatsPerBar: 4, beatUnit: 4, beats: ['accent', 'normal', 'normal', 'normal'], subdivision: 'quarter' },
}

const state = {
  kind: 'state', actor: 'a', revision: 3, writer: 'a', source: 'a', core, playing: true, startsAt: 1_000,
}

describe('barMs / nextBarTime', () => {
  it('measures a 4/4 bar at 120 BPM as 2 s, and 6/8 at the same tempo as 1.5 s', () => {
    expect(barMs(core)).toBe(2000)
    expect(barMs({ ...core, rhythm: { ...core.rhythm, beatsPerBar: 6, beatUnit: 8, beats: Array(6).fill('normal') } })).toBe(1500)
  })

  it('applies the tempo percentage', () => {
    expect(barMs({ ...core, tempoPercent: 50 })).toBe(4000)
  })

  it('keeps a future start and moves a past one to the next bar line', () => {
    expect(nextBarTime(5000, core, 1000)).toBe(5000)
    expect(nextBarTime(1000, core, 1000)).toBe(3000)
    expect(nextBarTime(1000, core, 4500)).toBe(5000)
    expect(nextBarTime(1000, core, 5000)).toBe(7000)
  })
})

describe('compareRevision', () => {
  it('orders by revision, then by writer so concurrent edits converge', () => {
    expect(compareRevision({ revision: 2, writer: 'a' }, { revision: 1, writer: 'z' })).toBeGreaterThan(0)
    expect(compareRevision({ revision: 2, writer: 'b' }, { revision: 2, writer: 'a' })).toBeGreaterThan(0)
    expect(compareRevision({ revision: 2, writer: 'a' }, { revision: 2, writer: 'a' })).toBe(0)
  })
})

describe('clock estimate', () => {
  it('takes the remote time as read halfway through the round trip', () => {
    expect(clockSample(1000, 5050, 1100)).toEqual({ offset: 4000, rtt: 100, at: 1100 })
  })

  it('uses the sample with the fastest round trip', () => {
    expect(bestOffset([])).toBeNull()
    expect(bestOffset([
      { offset: 90, rtt: 300, at: 1 },
      { offset: 12, rtt: 40, at: 2 },
      { offset: 60, rtt: 120, at: 3 },
    ])).toBe(12)
  })
})

describe('parseRoomCode', () => {
  it('accepts a code with stray case, spaces or dashes', () => {
    expect(parseRoomCode('  0123456789ABCDEF ')).toBe('0123456789abcdef')
    expect(parseRoomCode('01234567-89abcdef')).toBe('0123456789abcdef')
  })

  it('extracts the code from a pasted invite link', () => {
    expect(parseRoomCode('https://example.com/?theme=x&room=0123456789abcdef')).toBe('0123456789abcdef')
  })

  it('rejects anything else', () => {
    expect(parseRoomCode('')).toBeNull()
    expect(parseRoomCode('0123456789abcde')).toBeNull()
    expect(parseRoomCode('0123456789abcdeg')).toBeNull()
    expect(parseRoomCode('https://example.com/?room=nope')).toBeNull()
  })
})

describe('validCore', () => {
  it('accepts a valid core and rejects out-of-range or inconsistent ones', () => {
    expect(validCore(core)).toBe(true)
    expect(validCore({ ...core, bpm: 301 })).toBe(false)
    expect(validCore({ ...core, bpm: 120.5 })).toBe(false)
    expect(validCore({ ...core, rhythm: { ...core.rhythm, beatsPerBar: 3 } })).toBe(false)
    expect(validCore({ ...core, rhythm: { ...core.rhythm, subdivision: 'bogus' } })).toBe(false)
    expect(validCore(null)).toBe(false)
  })
})

describe('parseMessage', () => {
  it('accepts well-formed state, probe and reply messages', () => {
    expect(parseMessage(state)).not.toBeNull()
    expect(parseMessage({ ...state, playing: false, startsAt: null })).not.toBeNull()
    expect(parseMessage({ kind: 'request-state', actor: 'b' })).not.toBeNull()
    expect(parseMessage({ kind: 'clock-probe', actor: 'b', probeId: 'p', sentAt: 1 })).not.toBeNull()
    expect(parseMessage({ kind: 'clock-reply', actor: 'b', probeId: 'p', sentAt: 1, remoteTime: 2 })).not.toBeNull()
  })

  it('accepts a start far from the local clock (devices may be skewed)', () => {
    expect(parseMessage({ ...state, startsAt: Date.now() + 10 * 60_000 })).not.toBeNull()
  })

  it('rejects malformed frames', () => {
    expect(parseMessage(null)).toBeNull()
    expect(parseMessage({ kind: 'hello', actor: 'b' })).toBeNull()
    expect(parseMessage({ kind: 'request-state' })).toBeNull()
    expect(parseMessage({ ...state, revision: 0 })).toBeNull()
    expect(parseMessage({ ...state, revision: 1.5 })).toBeNull()
    expect(parseMessage({ ...state, writer: undefined })).toBeNull()
    expect(parseMessage({ ...state, source: '' })).toBeNull()
    expect(parseMessage({ ...state, startsAt: null })).toBeNull()
    expect(parseMessage({ ...state, startsAt: Number.NaN })).toBeNull()
    expect(parseMessage({ ...state, core: { ...core, tempoPercent: 10 } })).toBeNull()
    expect(parseMessage({ kind: 'clock-reply', actor: 'b', probeId: 'p', sentAt: 1 })).toBeNull()
  })
})
