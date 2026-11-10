import { useEffect, useImperativeHandle, useRef, useState, type MouseEvent, type PointerEvent, type Ref } from 'react'
import { TapTempo } from '../../core/tapTempo'
import { TapIcon } from '../icons/icons'
import './TapTempoButton.css'

export interface TapTempoHandle {
  /** Register a tap now (used by the T shortcut). */
  tap: () => void
}

interface TapTempoButtonProps {
  /** Called with the detected tempo (integer BPM) from the second tap on. */
  onTempo: (bpm: number) => void
  ref?: Ref<TapTempoHandle>
}

/** Feedback stays up a little longer than the detector waits for the next tap. */
function feedbackTimeout(bpm: number | null): number {
  return bpm === null ? 3500 : Math.max(2500, (60000 / bpm) * 1.5)
}

export function TapTempoButton({ onTempo, ref }: TapTempoButtonProps) {
  const detector = useRef<TapTempo | null>(null)
  const idleTimer = useRef<number | null>(null)
  const [taps, setTaps] = useState(0)
  const [detected, setDetected] = useState<number | null>(null)
  // Remounts the ripple so its animation restarts on every tap.
  const [hit, setHit] = useState(0)

  useEffect(
    () => () => {
      if (idleTimer.current !== null) clearTimeout(idleTimer.current)
    },
    [],
  )

  function tap() {
    detector.current ??= new TapTempo()
    const bpm = detector.current.tap(performance.now())
    setTaps(detector.current.count)
    setDetected(bpm)
    setHit((n) => n + 1)
    if (bpm !== null) onTempo(bpm)

    if (idleTimer.current !== null) clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      idleTimer.current = null
      setTaps(0)
      setDetected(null)
    }, feedbackTimeout(bpm))
  }

  useImperativeHandle(ref, () => ({ tap }))

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    // pointerdown is ~100 ms earlier than click on touch screens, which matters for tempo accuracy.
    if (e.button !== 0) return
    tap()
  }

  function onClick(e: MouseEvent<HTMLButtonElement>) {
    // detail 0: Enter key or assistive-tech activation, which has no pointerdown.
    if (e.detail === 0) tap()
  }

  const active = taps > 0
  const main = detected ?? (active ? taps : 'Tap')
  const sub = detected !== null ? `${taps} taps` : active ? 'Keep going' : 'Key T'

  return (
    <>
      <button
        type="button"
        className={`tap-tempo${active ? ' is-active' : ''}`}
        aria-label="Tap tempo"
        aria-keyshortcuts="T"
        title="Tap tempo (T)"
        onPointerDown={onPointerDown}
        onClick={onClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        {hit > 0 && <span key={hit} className="tap-tempo__ripple" aria-hidden="true" />}
        <span className="tap-tempo__icon" aria-hidden="true">
          <TapIcon size={22} />
        </span>
        <span className="tap-tempo__main tabular" aria-hidden="true">
          {main}
        </span>
        <span className="tap-tempo__sub" aria-hidden="true">
          {sub}
        </span>
      </button>
      {/* Outside the button: a live region inside a named button is not announced reliably. */}
      <span className="sr-only" role="status">
        {detected !== null ? `Tapped ${detected} BPM` : ''}
      </span>
    </>
  )
}
