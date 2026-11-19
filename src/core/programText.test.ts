import { describe, expect, it } from 'vitest'
import { MAX_SECTIONS } from './constants'
import { parseProgram, programToText, toSections, type ParsedSection } from './programText'

function sections(text: string): ParsedSection[] {
  const result = parseProgram(text)
  if (!result.ok) throw new Error(`${result.error} at ${result.at}`)
  return result.sections
}

function error(text: string): { error: string; at: number } {
  const result = parseProgram(text)
  if (result.ok) throw new Error(`"${text}" parsed`)
  return result
}

const brief = (list: ParsedSection[]) => list.map((s) => `${s.beatsPerBar}/${s.beatUnit}x${s.bars}`)

describe('parseProgram', () => {
  it('reads signatures with bar counts, in order', () => {
    expect(brief(sections('3/8x3,4/4x2'))).toEqual(['3/8x3', '4/4x2'])
  })

  it('defaults to one bar and ignores spaces, empty items and other separators', () => {
    expect(brief(sections(' 4/4 , 3/4 x 2 ;\n 5/8*3 ,, '))).toEqual(['4/4x1', '3/4x2', '5/8x3'])
  })

  it('reads tempos, accent groupings and names', () => {
    expect(sections('intro:7/8(2+2+3)x4@140')).toEqual([
      { name: 'intro', beatsPerBar: 7, beatUnit: 8, grouping: [2, 2, 3], bars: 4, tempo: 140 },
    ])
    // The modifiers may come in any order.
    expect(sections('4/4@90x2')[0]).toMatchObject({ bars: 2, tempo: 90 })
  })

  it('repeats groups, also nested', () => {
    expect(brief(sections('[3/4x2, 4/4]x2'))).toEqual(['3/4x2', '4/4x1', '3/4x2', '4/4x1'])
    expect(brief(sections('[[2/4]x2, 3/4]x2'))).toHaveLength(6)
    expect(brief(sections('[6/8]'))).toEqual(['6/8x1'])
  })

  it('reports what is wrong and where', () => {
    expect(error('')).toMatchObject({ error: expect.stringContaining('at least one') })
    expect(error('4/5')).toMatchObject({ error: 'The beat unit must be 2, 4, 8 or 16', at: 2 })
    expect(error('17/4').error).toContain('1–16')
    expect(error('4/4x0').error).toContain('at least once')
    expect(error('4/4@20').error).toContain('Tempo')
    expect(error('7/8(3+3)').error).toContain('add up to 7')
    expect(error('4/4 3/4').error).toContain('","')
    expect(error('[4/4').error).toContain(']')
    expect(error('4/4x1000').error).toContain('bars')
    expect(error('verse 4/4').error).toContain(':')
    expect(error(`[4/4]x${MAX_SECTIONS + 1}`).error).toContain(`${MAX_SECTIONS}`)
  })
})

describe('toSections', () => {
  it('builds sections with the usual accents or the written grouping', () => {
    const [a, b, c] = toSections(sections('6/8x2, 7/8(2+2+3), chorus:4/4@150'))
    expect(a).toMatchObject({ name: 'Section 1', beatsPerBar: 6, beatUnit: 8, bars: 2, tempo: null })
    expect(a.beats).toEqual(['accent', 'normal', 'normal', 'medium', 'normal', 'normal'])
    expect(b.beats).toEqual(['accent', 'normal', 'medium', 'normal', 'medium', 'normal', 'normal'])
    expect(c).toMatchObject({ name: 'chorus', tempo: 150 })
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
  })
})

describe('programToText', () => {
  it('round-trips through the parser', () => {
    const text = 'intro:4/4x4, 3/8x3@180, 7/8(2+2+3)x2, 6/8(6), 3/4'
    expect(programToText(toSections(sections(text)))).toBe(text)
  })
})
