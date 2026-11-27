import type { ReactNode } from 'react'
import { Slider } from '../ui/ui'
import './VolumeFader.css'

export interface VolumeFaderProps {
  /** Short visible name ("Accent"); the fader's accessible name is "<label> volume". */
  label: string
  /** Linear gain 0..max, shown as a percentage. */
  value: number
  /** Highest gain (default 1, i.e. 100 %). */
  max?: number
  /** Gain that Alt+click on the fader goes back to. */
  defaultValue?: number
  onChange: (value: number) => void
  /** Rendered next to the fader track, bottom-aligned with it (e.g. a LevelMeter). */
  beside?: ReactNode
  /** Rendered under the label (e.g. a test or mute button). */
  children?: ReactNode
  /** Visually de-emphasize the strip (e.g. while the output is muted); the fader stays usable. */
  dimmed?: boolean
  className?: string
}

const MARKS = [0, 0.25, 0.5, 0.75, 1, 1.25]

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** One mixer channel strip: vertical fader with its value on top, the name below and optional actions. */
export function VolumeFader({
  label,
  value,
  max = 1,
  defaultValue,
  onChange,
  beside,
  children,
  dimmed = false,
  className,
}: VolumeFaderProps) {
  const classes = ['volume-fader', dimmed && 'is-dimmed', className].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      <div className="volume-fader__track">
        <Slider
          orientation="vertical"
          hideLabel
          label={`${label} volume`}
          value={value}
          min={0}
          max={max}
          step={0.01}
          format={formatPercent}
          marks={MARKS}
          defaultValue={defaultValue}
          onChange={onChange}
        />
        {beside}
      </div>
      {/* The fader already carries the full accessible name. */}
      <span className="volume-fader__label" aria-hidden="true">
        {label}
      </span>
      {children != null && <div className="volume-fader__actions">{children}</div>}
    </div>
  )
}
