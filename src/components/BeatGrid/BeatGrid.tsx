import type { CSSProperties } from 'react'
import { getSubdivision } from '../../core/constants'
import { cycleBeatLevel } from '../../core/meter'
import { updateSectionById } from '../../core/settings'
import type { BeatLevel, PulseEvent, Section } from '../../core/types'
import type { SettingsUpdater } from '../../state/useSettings'
import { XIcon } from '../icons/icons'
import { Badge } from '../ui/ui'
import './BeatGrid.css'

interface BeatGridProps {
  section: Section
  /** Show the section name in the header (when the program has several sections). */
  showName: boolean
  onChange: SettingsUpdater
  /** The pulse sounding now when it belongs to `section`; null when stopped or another section plays. */
  pulse: PulseEvent | null
}

const LEVEL_LABEL: Readonly<Record<BeatLevel, string>> = {
  accent: 'Accent',
  medium: 'Sub-accent',
  normal: 'Normal',
  mute: 'Mute',
}

/** Up to 8 pads per row; longer bars wrap into two even rows. */
function columnsFor(beats: number): number {
  return beats <= 8 ? beats : Math.ceil(beats / 2)
}

export function BeatGrid({ section, showName, onChange, pulse }: BeatGridProps) {
  const subdivision = getSubdivision(section.subdivision)
  const offsets = subdivision.pulses
  // pulse.pulse indexes the pattern it was produced with; only trust it while the pattern is unchanged.
  const pulseIndex = pulse !== null && pulse.pulsesInBeat === offsets.length ? pulse.pulse : -1
  const gapBar = pulse?.gapBar ?? false

  function cycle(beat: number) {
    const id = section.id
    onChange((prev) =>
      updateSectionById(prev, id, (s) => ({
        ...s,
        beats: s.beats.map((level, i) => (i === beat ? cycleBeatLevel(level) : level)),
      })),
    )
  }

  return (
    <section className={`beat-grid${gapBar ? ' is-gap' : ''}`} aria-label="Beats">
      <header className="beat-grid__header">
        <p className="beat-grid__meter">
          {showName && <span className="beat-grid__name">{section.name || 'Section'}</span>}
          <span className="beat-grid__signature tabular">
            {section.beatsPerBar}/{section.beatUnit}
          </span>
          <span className="beat-grid__subdivision">{subdivision.label}</span>
        </p>
        {gapBar && (
          <Badge tone="warning" className="beat-grid__gap">
            Silent bar
          </Badge>
        )}
      </header>

      <div
        className="beat-grid__pads"
        role="group"
        aria-label="Beat levels: click a beat to change it"
        style={{ '--cols': columnsFor(section.beats.length) } as CSSProperties}
      >
        {section.beats.map((level, i) => {
          const current = pulse !== null && pulse.beat === i
          const silent = current && pulse.silent
          return (
            <button
              key={i}
              type="button"
              className={[
                'beat-grid__pad',
                `beat-grid__pad--${level}`,
                current && 'is-current',
                silent && 'is-silent',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label={`Beat ${i + 1}: ${LEVEL_LABEL[level]}`}
              title={`Beat ${i + 1}: ${LEVEL_LABEL[level]} (click to change)`}
              onClick={() => cycle(i)}
            >
              {/* Keyed per beat: the hit animation restarts on each beat and survives its subdivision pulses. */}
              {current && !silent && (
                <span key={`${pulse.totalBar}:${i}`} className="beat-grid__hit" aria-hidden="true" />
              )}
              <span className="beat-grid__bar" aria-hidden="true">
                <span className="beat-grid__fill" />
                {level === 'mute' && <XIcon className="beat-grid__x" size={16} />}
              </span>
              <span className="beat-grid__number tabular" aria-hidden="true">
                {i + 1}
              </span>
              {offsets.length > 1 && (
                <span
                  className="beat-grid__dots"
                  aria-hidden="true"
                  style={{ '--n': offsets.length } as CSSProperties}
                >
                  {offsets.map((offset, p) => (
                    <span
                      key={p}
                      className={`beat-grid__dot${current && p <= pulseIndex ? (p === pulseIndex ? ' is-now' : ' is-past') : ''}`}
                      style={{ '--x': offset } as CSSProperties}
                    />
                  ))}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}
