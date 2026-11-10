import type { CSSProperties, ReactNode } from 'react'
import type { GapSettings, PracticeSettings, PulseEvent } from '../../core/types'
import { TrendDownIcon, TrendUpIcon } from '../icons/icons'
import './StatusBar.css'

interface StatusBarProps {
  /** The pulse sounding now; null when stopped. */
  pulse: PulseEvent | null
  startTime: number | null
  /** Name of the section playing now (program mode only). */
  sectionName: string | null
  programEnabled: boolean
  gap: GapSettings
  practice: PracticeSettings
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

/** Where playback is. Items for program, speed trainer and gap trainer appear whenever those features are on. */
export function StatusBar({ pulse, startTime, sectionName, programEnabled, gap, practice }: StatusBarProps) {
  const playing = pulse !== null
  const elapsed = pulse !== null && startTime !== null ? pulse.time - startTime : 0

  const run = pulse?.practice ?? null
  const practiceBpm = run?.bpm ?? practice.startBpm
  const span = practice.targetBpm - practice.startBpm
  const progress = span === 0 ? 1 : Math.min(1, Math.max(0, (practiceBpm - practice.startBpm) / span))
  const rising = run ? run.direction >= 0 : span >= 0

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

      {practice.enabled && (
        <Item label="Speed trainer" wide>
          <span className="status-bar__practice">
            {rising ? <TrendUpIcon size={14} /> : <TrendDownIcon size={14} />}
            {practiceBpm} BPM
            <span className="status-bar__muted">
              {run ? ` · bar ${run.barsAtTempo + 1}/${run.everyBars}` : ` → ${practice.targetBpm}`}
            </span>
          </span>
          <span className="status-bar__progress" aria-hidden="true">
            <span className="status-bar__progress-fill" style={{ '--progress': progress } as CSSProperties} />
          </span>
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
