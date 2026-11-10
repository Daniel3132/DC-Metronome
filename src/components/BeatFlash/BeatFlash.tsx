import type { CSSProperties } from 'react'
import type { PulseEvent } from '../../core/types'
import './BeatFlash.css'

interface BeatFlashProps {
  /** The pulse sounding now; pass null when the flash is off or playback is stopped. */
  pulse: PulseEvent | null
}

/** Full-screen flash on every audible beat (accents stronger). Reduced motion gets a soft edge glow instead. */
export function BeatFlash({ pulse }: BeatFlashProps) {
  // Silence and muted beats cover the whole beat, so any pulse of the beat tells whether it sounded.
  if (pulse === null || pulse.silent || pulse.level === 'mute') return null
  // Short enough to fade out before the next beat even at 300 BPM.
  const duration = Math.min(0.22, pulse.beatDuration * 0.75)
  return (
    <div
      // One element per beat: the key restarts the animation and survives the beat's subdivision pulses.
      key={`${pulse.totalBar}:${pulse.beat}`}
      className={`beat-flash beat-flash--${pulse.level}`}
      style={{ '--flash-duration': `${duration}s` } as CSSProperties}
      aria-hidden="true"
    />
  )
}
