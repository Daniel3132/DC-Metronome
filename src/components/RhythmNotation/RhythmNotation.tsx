import type { SubdivisionId } from '../../core/types'

/** One note of a beat: how many beams (or flags) it carries (0 = quarter, 1 = eighth, 2 = 16th, 3 = 32nd). */
interface Note {
  beams: 0 | 1 | 2 | 3
  dot?: boolean
}

interface Figure {
  notes: readonly Note[]
  /** Tuplet number drawn above the group (3, 5, 6, 7). */
  tuplet?: number
}

const n = (beams: Note['beams'], count: number): Note[] => Array.from({ length: count }, () => ({ beams }))

/** How one beat of each subdivision is written, with the beat as a quarter note. */
const FIGURES: Readonly<Record<SubdivisionId, Figure>> = {
  quarter: { notes: n(0, 1) },
  eighths: { notes: n(1, 2) },
  triplets: { notes: n(1, 3), tuplet: 3 },
  sixteenths: { notes: n(2, 4) },
  quintuplets: { notes: n(2, 5), tuplet: 5 },
  sextuplets: { notes: n(2, 6), tuplet: 6 },
  septuplets: { notes: n(2, 7), tuplet: 7 },
  'thirty-seconds': { notes: n(3, 8) },
  swing: { notes: [{ beams: 0 }, { beams: 1 }], tuplet: 3 },
  gallop: { notes: [{ beams: 1 }, { beams: 2 }, { beams: 2 }] },
  'reverse-gallop': { notes: [{ beams: 2 }, { beams: 2 }, { beams: 1 }] },
  dotted: { notes: [{ beams: 1, dot: true }, { beams: 2 }] },
}

// Drawing units: the viewBox is 32 high; noteheads sit low, the tuplet number above the stems.
const HEIGHT = 32
const HEAD_Y = 25
const STEM_TOP = 8
const BEAM_GAP = 3.4
const BEAM_THICK = 2.2
const STEP = 10
const DOT_EXTRA = 3
const PAD = 4
const STUB = 5

/** Runs of consecutive notes with at least `level` beams, as [first, last] index pairs. */
function runs(notes: readonly Note[], level: number, from = 0, to = notes.length - 1): [number, number][] {
  const result: [number, number][] = []
  let start = -1
  for (let i = from; i <= to + 1; i++) {
    const inRun = i <= to && notes[i].beams >= level
    if (inRun && start < 0) start = i
    if (!inRun && start >= 0) {
      result.push([start, i - 1])
      start = -1
    }
  }
  return result
}

interface RhythmNotationProps {
  subdivision: SubdivisionId
  /** Rendered height in px; the width follows the number of notes. */
  height?: number
  className?: string
}

/** One beat of a subdivision in standard notation (stems up, beamed), drawn in currentColor. */
export function RhythmNotation({ subdivision, height = 24, className }: RhythmNotationProps) {
  const { notes, tuplet } = FIGURES[subdivision]

  const xs: number[] = []
  let x = PAD + 3.4
  for (const note of notes) {
    xs.push(x)
    x += STEP + (note.dot ? DOT_EXTRA : 0)
  }
  const last = notes[notes.length - 1]
  const width = xs[xs.length - 1] + 3.4 + PAD + (last.dot ? DOT_EXTRA + 2 : 0) + (notes.length === 1 && last.beams > 0 ? 5 : 0)
  const stemX = (i: number) => xs[i] + 3

  const beams: { x1: number; x2: number; y: number }[] = []
  const flagged: number[] = []
  for (const [a, b] of runs(notes, 1)) {
    if (a === b) {
      flagged.push(a)
      continue
    }
    beams.push({ x1: stemX(a) - 0.6, x2: stemX(b) + 0.6, y: STEM_TOP })
    for (let level = 2; level <= 3; level++) {
      const y = STEM_TOP + (level - 1) * BEAM_GAP
      for (const [c, d] of runs(notes, level, a, b)) {
        if (c !== d) beams.push({ x1: stemX(c) - 0.6, x2: stemX(d) + 0.6, y })
        // A lone shorter note gets a stub pointing into its group (left at the group's end, right otherwise).
        else if (c === b) beams.push({ x1: stemX(c) - STUB, x2: stemX(c) + 0.6, y })
        else beams.push({ x1: stemX(c) - 0.6, x2: stemX(c) + STUB, y })
      }
    }
  }

  const center = (xs[0] + xs[xs.length - 1]) / 2 + 3
  const beamed = beams.length > 0

  return (
    <svg
      className={className}
      width={(width * height) / HEIGHT}
      height={height}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="currentColor" stroke="currentColor">
        {xs.map((cx, i) => (
          <g key={i}>
            <ellipse cx={cx} cy={HEAD_Y} rx="3.6" ry="2.6" transform={`rotate(-20 ${cx} ${HEAD_Y})`} stroke="none" />
            <line x1={stemX(i)} y1={HEAD_Y - 1} x2={stemX(i)} y2={STEM_TOP} strokeWidth="1.1" />
            {notes[i].dot && <circle cx={cx + 6.2} cy={HEAD_Y - 1} r="1.2" stroke="none" />}
          </g>
        ))}
        {beams.map((beam, i) => (
          <rect key={i} x={beam.x1} y={beam.y} width={beam.x2 - beam.x1} height={BEAM_THICK} stroke="none" />
        ))}
        {flagged.flatMap((i) =>
          Array.from({ length: notes[i].beams }, (_, level) => {
            const sx = stemX(i)
            const y = STEM_TOP + level * BEAM_GAP
            return (
              <path
                key={`${i}:${level}`}
                d={`M${sx} ${y} c0.4 3 4.6 4 4.2 9`}
                fill="none"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            )
          }),
        )}
        {tuplet !== undefined && (
          <>
            {/* Unbeamed tuplets (swing) get a bracket so the number reads as a group. */}
            {!beamed && (
              <path
                d={`M${stemX(0) - 2} 6 V3.5 H${center - 4} M${center + 4} 3.5 H${stemX(notes.length - 1) + 2} V6`}
                fill="none"
                strokeWidth="0.9"
              />
            )}
            <text
              x={center}
              y="6"
              stroke="none"
              fontSize="7.5"
              fontStyle="italic"
              fontWeight="700"
              textAnchor="middle"
              fontFamily="Georgia, 'Times New Roman', serif"
            >
              {tuplet}
            </text>
          </>
        )}
      </g>
    </svg>
  )
}
