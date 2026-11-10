import { describe, expect, it } from 'vitest'
import { BEAT_LEVELS, MAX_BEATS_PER_BAR, MAX_BPM, MIN_BPM } from './constants'
import {
  accentGroupings,
  beatsFromGrouping,
  cycleBeatLevel,
  defaultGrouping,
  matchingAccentGrouping,
  matchingGrouping,
  resizeBeats,
  suggestedGroupings,
  tempoMarking,
} from './meter'
import type { BeatLevel } from './types'

describe('cycleBeatLevel', () => {
  it('cycles accent → medium → normal → mute → accent', () => {
    expect(cycleBeatLevel('accent')).toBe('medium')
    expect(cycleBeatLevel('medium')).toBe('normal')
    expect(cycleBeatLevel('normal')).toBe('mute')
    expect(cycleBeatLevel('mute')).toBe('accent')
  })

  it('returns to the start after a full cycle', () => {
    for (const level of BEAT_LEVELS) {
      let current = level
      for (let i = 0; i < BEAT_LEVELS.length; i++) current = cycleBeatLevel(current)
      expect(current).toBe(level)
    }
  })
})

describe('resizeBeats', () => {
  const beats: BeatLevel[] = ['medium', 'mute', 'accent']

  it('keeps existing levels and appends normal beats', () => {
    expect(resizeBeats(beats, 5)).toEqual(['medium', 'mute', 'accent', 'normal', 'normal'])
  })

  it('truncates', () => {
    expect(resizeBeats(beats, 2)).toEqual(['medium', 'mute'])
  })

  it('returns a copy of the same size', () => {
    const resized = resizeBeats(beats, 3)
    expect(resized).toEqual(beats)
    expect(resized).not.toBe(beats)
  })

  it('makes a brand-new beat 0 an accent', () => {
    expect(resizeBeats([], 4)).toEqual(['accent', 'normal', 'normal', 'normal'])
    expect(resizeBeats([], 1)).toEqual(['accent'])
  })

  it('does not touch an existing beat 0', () => {
    expect(resizeBeats(['normal'], 3)).toEqual(['normal', 'normal', 'normal'])
  })

  it('clamps the count to 1..MAX_BEATS_PER_BAR', () => {
    expect(resizeBeats(beats, 0)).toEqual(['medium'])
    expect(resizeBeats(beats, -3)).toEqual(['medium'])
    expect(resizeBeats(beats, 40)).toHaveLength(MAX_BEATS_PER_BAR)
    expect(resizeBeats([], 0)).toEqual(['accent'])
  })

  it('rounds fractional counts and survives NaN', () => {
    expect(resizeBeats(beats, 4.6)).toHaveLength(5)
    expect(resizeBeats(beats, Number.NaN)).toEqual(beats)
    expect(resizeBeats([], Number.NaN)).toEqual(['accent'])
  })

  it('does not mutate its input', () => {
    const input: BeatLevel[] = ['accent', 'normal']
    resizeBeats(input, 6)
    resizeBeats(input, 1)
    expect(input).toEqual(['accent', 'normal'])
  })
})

describe('beatsFromGrouping', () => {
  it('is strong on beat 1 and medium on the first beat of every later group', () => {
    expect(beatsFromGrouping([2, 2, 3])).toEqual(['accent', 'normal', 'medium', 'normal', 'medium', 'normal', 'normal'])
    expect(beatsFromGrouping([3, 2])).toEqual(['accent', 'normal', 'normal', 'medium', 'normal'])
    expect(beatsFromGrouping([3, 3])).toEqual(['accent', 'normal', 'normal', 'medium', 'normal', 'normal'])
    expect(beatsFromGrouping([4, 3])).toEqual(['accent', 'normal', 'normal', 'normal', 'medium', 'normal', 'normal'])
    expect(beatsFromGrouping([1, 1])).toEqual(['accent', 'medium'])
    expect(beatsFromGrouping([4])).toEqual(['accent', 'normal', 'normal', 'normal'])
  })

  it('returns [] for no groups', () => {
    expect(beatsFromGrouping([])).toEqual([])
  })

  it('skips invalid groups and never exceeds MAX_BEATS_PER_BAR', () => {
    expect(beatsFromGrouping([0, -2, Number.NaN, 2])).toEqual(['accent', 'normal'])
    expect(beatsFromGrouping([8, 8, 8])).toHaveLength(MAX_BEATS_PER_BAR)
  })
})

describe('suggestedGroupings', () => {
  it('matches the documented examples', () => {
    expect(suggestedGroupings(5)).toEqual([
      [3, 2],
      [2, 3],
    ])
    expect(suggestedGroupings(7)).toEqual([
      [4, 3],
      [3, 4],
      [2, 2, 3],
      [3, 2, 2],
      [2, 3, 2],
    ])
    expect(suggestedGroupings(9)).toEqual([
      [3, 3, 3],
      [2, 2, 2, 3],
    ])
  })

  it('has none for very short bars or invalid counts', () => {
    for (const count of [0, 1, 2, 3, 4, 17, -5, 5.5, Number.NaN]) expect(suggestedGroupings(count)).toEqual([])
  })

  it('only suggests groupings that fill the bar exactly', () => {
    for (let count = 1; count <= MAX_BEATS_PER_BAR; count++) {
      const groupings = suggestedGroupings(count)
      if (count >= 5) expect(groupings.length).toBeGreaterThan(0)
      for (const grouping of groupings) {
        expect(grouping.reduce((sum, group) => sum + group, 0)).toBe(count)
        expect(grouping.every((group) => Number.isInteger(group) && group >= 1)).toBe(true)
        expect(beatsFromGrouping(grouping)).toHaveLength(count)
      }
      // No duplicates.
      expect(new Set(groupings.map((grouping) => grouping.join(','))).size).toBe(groupings.length)
    }
  })

  it('returns fresh arrays the caller may mutate', () => {
    suggestedGroupings(7)[0].push(99)
    expect(suggestedGroupings(7)[0]).toEqual([4, 3])
  })
})

describe('defaultGrouping', () => {
  it('picks the usual feel', () => {
    expect(defaultGrouping(5, 4)).toEqual([3, 2])
    expect(defaultGrouping(5, 8)).toEqual([3, 2])
    expect(defaultGrouping(6, 8)).toEqual([3, 3])
    expect(defaultGrouping(6, 4)).toEqual([3, 3])
    expect(defaultGrouping(7, 8)).toEqual([4, 3])
    expect(defaultGrouping(8, 8)).toEqual([3, 3, 2])
    expect(defaultGrouping(9, 8)).toEqual([3, 3, 3])
    expect(defaultGrouping(12, 8)).toEqual([3, 3, 3, 3])
  })

  it('keeps groups of four over 2 and 4 when the bar divides into them', () => {
    expect(defaultGrouping(8, 4)).toEqual([4, 4])
    expect(defaultGrouping(12, 4)).toEqual([4, 4, 4])
    expect(defaultGrouping(16, 2)).toEqual([4, 4, 4, 4])
  })

  it('has none for bars of up to four beats', () => {
    for (const count of [1, 2, 3, 4]) expect(defaultGrouping(count, 4)).toBeNull()
    expect(defaultGrouping(3, 8)).toBeNull()
  })
})

describe('matchingGrouping', () => {
  it('finds the grouping behind a set of accents', () => {
    expect(matchingGrouping(beatsFromGrouping([2, 3]))).toEqual([2, 3])
    expect(matchingGrouping(beatsFromGrouping([3, 4]))).toEqual([3, 4])
  })

  it('returns null for hand-edited accents and short bars', () => {
    expect(matchingGrouping(['accent', 'normal', 'normal', 'accent', 'normal'])).toBeNull()
    expect(matchingGrouping(['accent', 'normal', 'normal', 'normal'])).toBeNull()
  })
})

describe('accentGroupings', () => {
  it('offers plain (one group) first, then the suggestions', () => {
    expect(accentGroupings(12)).toEqual([[12], ...suggestedGroupings(12)])
    expect(accentGroupings(4)).toEqual([[4]])
    expect(accentGroupings(1)).toEqual([[1]])
  })

  it('offers nothing outside 1..MAX_BEATS_PER_BAR', () => {
    for (const count of [0, -3, MAX_BEATS_PER_BAR + 1, Number.NaN]) expect(accentGroupings(count)).toEqual([])
  })
})

describe('matchingAccentGrouping', () => {
  it('recognizes plain accents, including short bars', () => {
    expect(matchingAccentGrouping(beatsFromGrouping([12]))).toEqual([12])
    expect(matchingAccentGrouping(['accent', 'normal', 'normal', 'normal'])).toEqual([4])
    expect(matchingAccentGrouping(beatsFromGrouping([3, 3]))).toEqual([3, 3])
  })

  it('returns null for hand-edited accents', () => {
    expect(matchingAccentGrouping(['accent', 'normal', 'mute', 'normal'])).toBeNull()
  })
})

describe('tempoMarking', () => {
  it.each([
    [20, 'Larghissimo'],
    [24.9, 'Larghissimo'],
    [25, 'Grave'],
    [39, 'Grave'],
    [40, 'Largo'],
    [59.9, 'Largo'],
    [60, 'Larghetto'],
    [65, 'Larghetto'],
    [66, 'Adagio'],
    [75, 'Adagio'],
    [76, 'Andante'],
    [107, 'Andante'],
    [108, 'Moderato'],
    [119, 'Moderato'],
    [120, 'Allegro'],
    [155, 'Allegro'],
    [156, 'Vivace'],
    [175, 'Vivace'],
    [176, 'Presto'],
    [199, 'Presto'],
    [200, 'Prestissimo'],
    [MAX_BPM, 'Prestissimo'],
  ])('tempoMarking(%s) = %s', (bpm, marking) => {
    expect(tempoMarking(bpm)).toBe(marking)
  })

  it('never goes back to a slower marking as the tempo rises', () => {
    const order = [
      'Larghissimo',
      'Grave',
      'Largo',
      'Larghetto',
      'Adagio',
      'Andante',
      'Moderato',
      'Allegro',
      'Vivace',
      'Presto',
      'Prestissimo',
    ]
    let previous = 0
    for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) {
      const rank = order.indexOf(tempoMarking(bpm))
      expect(rank).toBeGreaterThanOrEqual(previous)
      previous = rank
    }
    expect(previous).toBe(order.length - 1)
  })

  it('handles out-of-range input', () => {
    expect(tempoMarking(0)).toBe('Larghissimo')
    expect(tempoMarking(1000)).toBe('Prestissimo')
    expect(tempoMarking(Number.NaN)).toBe('')
  })
})
