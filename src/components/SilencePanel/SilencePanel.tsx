import { MAX_GAP_BARS } from '../../core/constants'
import type { GapSettings } from '../../core/types'
import { useGapPosition } from '../../state/useGapPosition'
import type { PanelProps } from '../panelTypes'
import { Badge, Panel, Segmented, Select, Stepper, Toggle, type SelectOption } from '../ui/ui'
import './SilencePanel.css'

const GAP_PATTERNS = ['2:1', '1:1', '3:1', '4:4', '2:2'] as const
type GapPattern = (typeof GAP_PATTERNS)[number]

const PATTERN_OPTIONS = GAP_PATTERNS.map((pattern) => {
  const [play, mute] = pattern.split(':')
  return { value: pattern, label: pattern, title: `Play ${play}, silence ${mute}` }
})

/** Above this many bars per cycle the blocks become a proportional two-part bar. */
const MAX_BLOCKS = 32

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function gapSentence(gap: GapSettings): string {
  return `Plays ${plural(gap.playBars, 'bar')}, then ${plural(gap.muteBars, 'bar')} of silence.`
}

const RANDOM_PERCENTS = [10, 20, 25, 33, 50, 66, 75, 90] as const

function percentLabel(percent: number): string {
  return `${percent} % of beats`
}

export function SilencePanel({ settings, onChange, metronome }: PanelProps) {
  const { gap, randomMute } = settings
  const { playback } = metronome
  const pulse = playback.status === 'playing' ? playback.pulse : null
  const { live, silentNow, position } = useGapPosition(pulse, gap)
  const cycle = gap.playBars + gap.muteBars

  const patternValue = `${gap.playBars}:${gap.muteBars}`
  const activeSection = settings.sections[settings.activeSection] ?? settings.sections[0]
  const mutedBeats = activeSection.beats.filter((level) => level === 'mute').length

  function setGap(update: Partial<GapSettings>) {
    onChange((prev) => ({ ...prev, gap: { ...prev.gap, ...update } }))
  }

  const percentValue = String(randomMute.percent)
  const percentOptions: SelectOption<string>[] = RANDOM_PERCENTS.map((p) => ({ value: String(p), label: percentLabel(p) }))
  if (!percentOptions.some((o) => o.value === percentValue)) {
    percentOptions.unshift({ value: percentValue, label: percentLabel(randomMute.percent) })
  }

  return (
    <div className="silence-panel">
      <Panel
        title="Gap trainer"
        description="Plays some bars, then goes silent. Keep time and land back on beat 1."
        headerAction={
          <Toggle hideLabel label="Gap trainer" checked={gap.enabled} onChange={(enabled) => setGap({ enabled })} />
        }
      >
        <div className="silence-panel__counts">
          <Stepper
            label="Play"
            size="sm"
            suffix={gap.playBars === 1 ? 'bar' : 'bars'}
            value={gap.playBars}
            min={1}
            max={MAX_GAP_BARS}
            onChange={(playBars) => setGap({ playBars })}
          />
          <Stepper
            label="Silence"
            size="sm"
            suffix={gap.muteBars === 1 ? 'bar' : 'bars'}
            value={gap.muteBars}
            min={1}
            max={MAX_GAP_BARS}
            onChange={(muteBars) => setGap({ muteBars })}
          />
          <Segmented<GapPattern>
            className="silence-panel__patterns"
            label="Quick patterns (bars played : bars silent)"
            size="sm"
            value={patternValue as GapPattern}
            options={PATTERN_OPTIONS}
            onChange={(pattern) => {
              const [playBars, muteBars] = pattern.split(':').map(Number)
              setGap({ playBars, muteBars })
            }}
          />
        </div>

        <div className={`silence-panel__cycle-wrap${gap.enabled ? '' : ' is-off'}`} title={gapSentence(gap)}>
          {cycle <= MAX_BLOCKS ? (
            <ol className="silence-panel__blocks" aria-hidden="true">
              {Array.from({ length: cycle }, (_, i) => (
                <li
                  key={i}
                  className={[
                    'silence-panel__block',
                    i < gap.playBars ? 'silence-panel__block--play' : 'silence-panel__block--mute',
                    i === position && 'is-current',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                />
              ))}
            </ol>
          ) : (
            <div className="silence-panel__ratio" aria-hidden="true">
              <span className="silence-panel__ratio-play" style={{ flexGrow: gap.playBars }}>
                {gap.playBars}
              </span>
              <span className="silence-panel__ratio-mute" style={{ flexGrow: gap.muteBars }}>
                {gap.muteBars}
              </span>
              {position !== null && (
                <span
                  className="silence-panel__ratio-marker"
                  style={{ insetInlineStart: `${((position + 0.5) / cycle) * 100}%` }}
                />
              )}
            </div>
          )}
          {live ? (
            <p className="silence-panel__live">
              <Badge tone={silentNow ? 'warning' : 'accent'}>{silentNow ? 'Silent' : 'Sounding'}</Badge>
              {position !== null && <span className="tabular">{`Bar ${position + 1} of ${cycle}`}</span>}
            </p>
          ) : (
            <p className="silence-panel__hint">{gapSentence(gap)}</p>
          )}
        </div>
      </Panel>

      <Panel
        title="Random mute"
        description="Randomly drops whole beats."
        headerAction={
          <>
            <Select
              className="silence-panel__percent"
              label="Beats dropped"
              hideLabel
              value={percentValue}
              options={percentOptions}
              onChange={(value) =>
                onChange((prev) => ({ ...prev, randomMute: { ...prev.randomMute, percent: Number(value) } }))
              }
            />
            <Toggle
              hideLabel
              label="Random mute"
              checked={randomMute.enabled}
              onChange={(enabled) => onChange((prev) => ({ ...prev, randomMute: { ...prev.randomMute, enabled } }))}
            />
          </>
        }
      />

      <p className="silence-panel__note">
        <Badge tone={mutedBeats > 0 ? 'accent' : 'neutral'}>{`${mutedBeats} of ${activeSection.beats.length}`}</Badge>
        {` beats muted in ${activeSection.name.trim() || 'the selected section'}. Tap a beat pad until it shows as muted.`}
      </p>
    </div>
  )
}
