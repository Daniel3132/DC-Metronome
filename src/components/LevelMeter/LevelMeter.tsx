import { useEffect, useRef, type CSSProperties } from 'react'
import './LevelMeter.css'

export interface LevelMeterProps {
  /** Current output peak, linear 0..1 (MetronomeControls.getLevel). */
  getLevel: () => number
  /** Poll only while true (playing); the meter drops to zero otherwise. */
  active: boolean
  /** Vertical (beside a fader, the default) or horizontal (under a slider). */
  orientation?: 'vertical' | 'horizontal'
  className?: string
}

// Scale shown by the meter, in dBFS. The CSS zone stops (70 % / 90 %) put yellow at -12 dB and red at -4 dB.
const FLOOR_DB = -40
const SEGMENTS = 20
// Ballistics in meter units (0..1 of the scale) per second: instant attack, smooth release.
const RELEASE_PER_SECOND = 1.1
const PEAK_HOLD_MS = 1200
const PEAK_FALL_PER_SECOND = 0.6

function toMeter(level: number): number {
  if (!(level > 0)) return 0
  const db = 20 * Math.log10(Math.min(level, 1))
  return Math.min(1, Math.max(0, 1 - db / FLOOR_DB))
}

/** Lit segments as a fraction of the scale; anything above the floor lights at least one LED. */
function quantize(value: number): number {
  return Math.min(SEGMENTS, Math.ceil(value * SEGMENTS - 1e-6)) / SEGMENTS
}

function readLevel(getLevel: () => number): number {
  try {
    return toMeter(getLevel())
  } catch {
    return 0
  }
}

/**
 * Segmented LED output meter with a peak-hold marker. Updates through CSS variables on its own element from a
 * requestAnimationFrame loop, so playback never re-renders React. Purely visual (aria-hidden).
 */
export function LevelMeter({ getLevel, active, orientation = 'vertical', className }: LevelMeterProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !active) return

    let frame = 0
    let last = performance.now()
    let shown = 0
    let peak = 0
    let peakSince = last
    let litWritten = -1
    let peakWritten = -1

    const tick = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
      last = now
      const level = readLevel(getLevel)

      shown = Math.max(level, shown - RELEASE_PER_SECOND * dt)
      if (shown >= peak) {
        peak = shown
        peakSince = now
      } else if (now - peakSince > PEAK_HOLD_MS) {
        peak = Math.max(shown, peak - PEAK_FALL_PER_SECOND * dt)
      }

      // Only touch the DOM when a segment actually changes.
      const lit = quantize(shown)
      const held = quantize(peak)
      if (lit !== litWritten) {
        el.style.setProperty('--level-meter-lit', String(lit))
        litWritten = lit
      }
      if (held !== peakWritten) {
        el.style.setProperty('--level-meter-peak', String(held))
        peakWritten = held
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      el.style.setProperty('--level-meter-lit', '0')
      el.style.setProperty('--level-meter-peak', '0')
    }
  }, [active, getLevel])

  return (
    <div
      ref={ref}
      className={['level-meter', orientation === 'horizontal' && 'level-meter--horizontal', className]
        .filter(Boolean)
        .join(' ')}
      style={{ '--level-meter-segments': SEGMENTS } as CSSProperties}
      aria-hidden="true"
    >
      <div className="level-meter__layer level-meter__layer--off" />
      <div className="level-meter__layer level-meter__layer--lit" />
      <div className="level-meter__layer level-meter__layer--peak" />
    </div>
  )
}
