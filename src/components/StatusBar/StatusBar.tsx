import type { ReactNode } from 'react'
import type { GapSettings, PulseEvent } from '../../core/types'
import './StatusBar.css'

interface StatusBarProps {
  /** The pulse sounding now; null when stopped. */
  pulse: PulseEvent | null
  startTime: number | null
  /** Name of the section playing now (program mode only). */
  sectionName: string | null
  programEnabled: boolean
  gap: GapSettings
}

const DASH = '–'

function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

function Item({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`status-bar__item${wide ? ' status-bar__item--wide' : ''}`}>
      <dt className="status-bar__label">{label}</dt>
      <dd className="status-bar__value tabular">{children}</dd>
    </div>
  )
}

/** Where playback is. Items for program and gap trainer appear whenever those features are on (the speed trainer's
 * progress is in its own card in the Quick tab). */
export function StatusBar({ pulse, startTime, sectionName, programEnabled, gap }: StatusBarProps) {
  const playing = pulse !== null
  const elapsed = pulse !== null && startTime !== null ? pulse.time - startTime : 0

  return (
    <dl className={`status-bar${playing ? ' is-playing' : ''}`} aria-label="Playback status">
      <Item label="Bar">{pulse ? pulse.totalBar + 1 : DASH}</Item>
      <Item label="Beat">
        {pulse ? (
          <>
            {pulse.beat + 1}
            <span className="status-bar__muted">/{pulse.beatsPerBar}</span>
          </>
        ) : (
          DASH
        )}
      </Item>
      <Item label="Time">{formatElapsed(elapsed)}</Item>

      {programEnabled && (
        <Item label="Section" wide>
          {pulse && pulse.sectionBars !== null ? (
            <>
              <span className="status-bar__name">{sectionName || 'Section'}</span>
              <span className="status-bar__muted">
                {' '}
                · bar {pulse.sectionBar + 1}/{pulse.sectionBars}
              </span>
            </>
          ) : (
            DASH
          )}
        </Item>
      )}

      {gap.enabled && (
        <Item label="Gap trainer" wide>
          {pulse ? (
            <span className={pulse.gapBar ? 'status-bar__silent' : undefined}>
              {pulse.gapBar ? 'Silent bar' : 'Playing'}
            </span>
          ) : (
            <span className="status-bar__muted">Ready</span>
          )}
          <span className="status-bar__muted">
            {' '}
            · {gap.playBars} on / {gap.muteBars} off
          </span>
        </Item>
      )}
    </dl>
  )
}
