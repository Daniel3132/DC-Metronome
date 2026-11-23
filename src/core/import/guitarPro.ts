import type { ImportedBar } from './toProgram'

/** The parts of an alphaTab MasterBar this import reads (a structural type, so tests can pass plain objects). */
export interface ScoreBar {
  timeSignatureNumerator: number
  timeSignatureDenominator: number
  isRepeatStart: boolean
  /** On the bar that closes a repeat: how many times the repeated bars are played in total (0 = no repeat end). */
  repeatCount: number
  /** Bit n set: the bar is played on pass n + 1 (volta brackets); 0 = every pass. */
  alternateEndings: number
  section: { text: string; marker: string } | null
  tempoAutomations: readonly { value: number; ratioPosition: number }[]
}

export interface ScoreLike {
  tempo: number
  masterBars: readonly ScoreBar[]
}

/** Guards against malformed repeat structures (e.g. a repeat count of 1000). */
const MAX_PLAYED_BARS = 20000

/**
 * The master bars in play order: |: … :| repeats are played `repeatCount` times, and bars with alternate endings only
 * on the passes they name. Nested repeats are not supported (an inner end repeat restarts at the latest start).
 */
export function playOrder(bars: readonly ScoreBar[]): number[] {
  const order: number[] = []
  let start = 0
  let pass = 1
  let index = 0
  // After a repeat closes, the following alternate endings (2nd, 3rd … volta) still belong to its last pass.
  let closed = false
  while (index < bars.length && order.length < MAX_PLAYED_BARS) {
    const bar = bars[index]
    const ending = bar.alternateEndings
    if ((bar.isRepeatStart && index !== start) || (closed && ending === 0)) {
      start = index
      pass = 1
      closed = false
    }
    const plays = ending === 0 || (ending & (1 << (pass - 1))) !== 0
    if (plays) order.push(index)
    if (plays && bar.repeatCount > 0) {
      if (pass < bar.repeatCount) {
        pass += 1
        index = start
        continue
      }
      closed = true
    }
    index += 1
  }
  return order
}

/** The bars of a score in play order: signature, tempo at the bar start and section marks. */
export function scoreBars(score: ScoreLike): ImportedBar[] {
  // The tempo in effect at the start of each master bar (an automation later in a bar applies from the next one).
  const startTempo: number[] = []
  let tempo = score.tempo > 0 ? score.tempo : 120
  for (const bar of score.masterBars) {
    const sorted = [...bar.tempoAutomations].sort((a, b) => a.ratioPosition - b.ratioPosition)
    for (const automation of sorted) if (automation.ratioPosition <= 0.001 && automation.value > 0) tempo = automation.value
    startTempo.push(tempo)
    for (const automation of sorted) if (automation.ratioPosition > 0.001 && automation.value > 0) tempo = automation.value
  }

  let lastIndex = -1
  return playOrder(score.masterBars).map((index) => {
    const bar = score.masterBars[index]
    const text = bar.section ? (bar.section.text || bar.section.marker).trim() : ''
    // A repeated section is marked again when it comes round (but not on every bar of a repeat region).
    const marker = text !== '' && index !== lastIndex ? text : null
    lastIndex = index
    return {
      numerator: bar.timeSignatureNumerator,
      denominator: bar.timeSignatureDenominator,
      tempo: startTempo[index],
      marker,
    }
  })
}

/** Read a Guitar Pro file (.gp3/.gp4/.gp5/.gpx/.gp) with alphaTab, loaded on demand. Throws when it cannot. */
export async function readGuitarProBars(bytes: Uint8Array): Promise<{ bars: ImportedBar[]; title: string }> {
  const alphaTab = await import('@coderline/alphatab/core')
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, new alphaTab.Settings())
  return { bars: scoreBars(score as unknown as ScoreLike), title: score.title }
}
