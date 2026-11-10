import { MAX_BPM, MAX_PRACTICE_EVERY_BARS, MAX_PRACTICE_STEP, MIN_BPM } from '../../core/constants'
import { effectiveBpm } from '../../core/settings'
import type { PracticeAtTarget, PracticeSettings, PracticeState } from '../../core/types'
import { RepeatIcon, TrendDownIcon, TrendUpIcon } from '../icons/icons'
import type { PanelProps } from '../panelTypes'
import { Badge, Button, Field, Panel, Segmented, Stepper, Toggle } from '../ui/ui'
import './PracticePanel.css'

const PREVIEW_STEPS = 16

const AT_TARGET_OPTIONS: { value: PracticeAtTarget; label: string }[] = [
  { value: 'hold', label: 'Hold' },
  { value: 'restart', label: 'Restart' },
  { value: 'reverse', label: 'Ping-pong' },
  { value: 'stop', label: 'Stop' },
]

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

function formatBpm(bpm: number): string {
  return String(Math.round(bpm * 10) / 10)
}

function stepToward(from: number, to: number, step: number): number {
  return from < to ? Math.min(from + step, to) : Math.max(from - step, to)
}

function directionOf(p: PracticeSettings): 1 | -1 | 0 {
  return p.startBpm < p.targetBpm ? 1 : p.startBpm > p.targetBpm ? -1 : 0
}

interface RampStep {
  bpm: number
  /** On the way back to the start tempo ('reverse'). */
  back: boolean
}

/** Tempo of each successive step (each lasts `everyBars` bars), following the sequencer's speed-trainer rules. */
function rampSteps(p: PracticeSettings, limit: number): RampStep[] {
  const up = directionOf(p)
  const steps: RampStep[] = [{ bpm: p.startBpm, back: false }]
  if (up === 0) return steps
  let { bpm } = steps[0]
  let back = false
  while (steps.length < limit) {
    if (back) {
      if (bpm === p.startBpm) {
        bpm = stepToward(p.startBpm, p.targetBpm, p.stepBpm)
        back = false
      } else {
        bpm = stepToward(bpm, p.startBpm, p.stepBpm)
      }
    } else if (bpm !== p.targetBpm) {
      bpm = stepToward(bpm, p.targetBpm, p.stepBpm)
    } else if (p.atTarget === 'restart') {
      bpm = p.startBpm
    } else if (p.atTarget === 'reverse') {
      bpm = stepToward(p.targetBpm, p.startBpm, p.stepBpm)
      back = true
    } else {
      // 'hold' and 'stop' end the plan at the target.
      break
    }
    steps.push({ bpm, back })
  }
  return steps
}

/** The tempo the trainer moves to after the current step; null while holding, 'stop' when it will end. */
function nextTempo(state: PracticeState, p: PracticeSettings): number | 'stop' | null {
  const up = directionOf(p)
  if (state.direction === 0 || up === 0) return null
  if (state.direction !== up) {
    return state.bpm === p.startBpm
      ? stepToward(p.startBpm, p.targetBpm, p.stepBpm)
      : stepToward(state.bpm, p.startBpm, p.stepBpm)
  }
  if (state.bpm !== p.targetBpm) return stepToward(state.bpm, p.targetBpm, p.stepBpm)
  switch (p.atTarget) {
    case 'restart':
      return p.startBpm
    case 'reverse':
      return stepToward(p.targetBpm, p.startBpm, p.stepBpm)
    case 'stop':
      return 'stop'
    default:
      return null
  }
}

function atTargetText(p: PracticeSettings): string {
  if (directionOf(p) === 0) return `Start and target are equal, so the tempo stays at ${p.startBpm} BPM.`
  switch (p.atTarget) {
    case 'hold':
      return `Stays at ${p.targetBpm} BPM.`
    case 'restart':
      return `Jumps back to ${p.startBpm} BPM and runs the ramp again.`
    case 'reverse':
      return `Heads back to ${p.startBpm} BPM step by step, then turns around again.`
    case 'stop':
      return `Stops playback after ${plural(p.everyBars, 'bar')} at ${p.targetBpm} BPM.`
  }
}

function afterTargetText(p: PracticeSettings): string {
  switch (p.atTarget) {
    case 'hold':
      return 'then holds'
    case 'restart':
      return 'then starts over'
    case 'reverse':
      return 'then heads back and repeats'
    case 'stop':
      return 'then stops'
  }
}

interface ChartProps {
  practice: PracticeSettings
  steps: RampStep[]
  live: PracticeState | null
}

function RampChart({ practice, steps, live }: ChartProps) {
  const { everyBars } = practice
  // A hold (or a constant tempo) goes on forever: one extra, dashed plateau says so.
  const continues = directionOf(practice) === 0 || practice.atTarget === 'hold'
  const width = (steps.length + (continues ? 1 : 0)) * everyBars
  const lo = Math.min(...steps.map((s) => s.bpm))
  const hi = Math.max(...steps.map((s) => s.bpm))
  const pad = Math.max(4, (hi - lo) * 0.12)
  const y = (bpm: number) => 100 - ((bpm - (lo - pad)) / (hi - lo + 2 * pad)) * 100

  const line = steps
    .map((step, i) => `${i === 0 ? `M0 ${y(step.bpm)}` : `V${y(step.bpm)}`} H${(i + 1) * everyBars}`)
    .join(' ')
  const area = `${line} V100 H0 Z`
  const lastY = y(steps[steps.length - 1].bpm)
  const tail = continues ? `M${steps.length * everyBars} ${lastY} H${width}` : null

  // The first plateau matching the live tempo and direction is the one being played.
  const liveBack = live !== null && live.direction !== 0 && live.direction !== directionOf(practice)
  const liveIndex = live ? steps.findIndex((s) => s.bpm === live.bpm && s.back === liveBack) : -1
  // While holding, barsAtTempo keeps counting, so the dot walks on into the dashed plateau.
  const liveSpan = continues && liveIndex === steps.length - 1 ? 2 * everyBars : everyBars
  const dot =
    live && liveIndex >= 0
      ? {
          left: ((liveIndex * everyBars + Math.min(live.barsAtTempo, liveSpan - 1) + 0.5) / width) * 100,
          top: y(live.bpm),
        }
      : null

  return (
    <div className="practice-panel__chart">
      <div className="practice-panel__axis-y tabular" aria-hidden="true">
        <span style={{ top: `${y(hi)}%` }}>{hi}</span>
        {lo !== hi && <span style={{ top: `${y(lo)}%` }}>{lo}</span>}
      </div>
      <div className="practice-panel__plot">
        <svg
          className="practice-panel__svg"
          viewBox={`0 0 ${width} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <line className="practice-panel__grid" x1={0} x2={width} y1={y(hi)} y2={y(hi)} />
          <line className="practice-panel__grid" x1={0} x2={width} y1={y(lo)} y2={y(lo)} />
          {liveIndex >= 0 && (
            <rect className="practice-panel__current" x={liveIndex * everyBars} width={liveSpan} y={0} height={100} />
          )}
          <path className="practice-panel__area" d={area} />
          <path className="practice-panel__line" d={line} />
          {tail && <path className="practice-panel__line practice-panel__line--tail" d={tail} />}
          {steps.map((step, i) => (
            <rect key={i} className="practice-panel__hit" x={i * everyBars} width={everyBars} y={0} height={100}>
              <title>{`Bars ${i * everyBars + 1}–${(i + 1) * everyBars}: ${step.bpm} BPM`}</title>
            </rect>
          ))}
        </svg>
        {dot && (
          <span className="practice-panel__dot" style={{ left: `${dot.left}%`, top: `${dot.top}%` }} aria-hidden="true" />
        )}
      </div>
      <div className="practice-panel__axis-x tabular" aria-hidden="true">
        <span>Bar 1</span>
        <span>{continues ? 'then holds' : `Bar ${width}`}</span>
      </div>
    </div>
  )
}

export function PracticePanel({ settings, onChange, metronome }: PanelProps) {
  const { practice, tempoPercent } = settings
  const direction = directionOf(practice)
  const section = settings.sections[settings.activeSection] ?? settings.sections[0]

  const { playback } = metronome
  const playing = playback.status === 'playing'
  const live = practice.enabled && playing ? (playback.pulse?.practice ?? null) : null

  const preview = rampSteps(practice, PREVIEW_STEPS)
  // One full pass, start to target, including the bars played at the target.
  const pass = rampSteps({ ...practice, atTarget: 'stop' }, Number.POSITIVE_INFINITY)
  const passBars = pass.length * practice.everyBars
  const passSeconds = pass.reduce(
    (sum, step) => sum + (practice.everyBars * section.beatsPerBar * 60) / effectiveBpm(step.bpm, tempoPercent),
    0,
  )

  const summary =
    direction === 0
      ? `Constant ${practice.startBpm} BPM. Set a different target to build a ramp.`
      : `${practice.startBpm} → ${practice.targetBpm} BPM in ${plural(pass.length - 1, 'step')}, ` +
        `${plural(passBars, 'bar')} (about ${formatDuration(passSeconds)}), ${afterTargetText(practice)}.`
  const percentNote =
    tempoPercent === 100
      ? null
      : `At ${tempoPercent} % tempo that plays as ${formatBpm(effectiveBpm(practice.startBpm, tempoPercent))} → ` +
        `${formatBpm(effectiveBpm(practice.targetBpm, tempoPercent))} BPM.`

  function setPractice(update: Partial<PracticeSettings>) {
    onChange((prev) => ({ ...prev, practice: { ...prev.practice, ...update } }))
  }

  const next = live ? nextTempo(live, practice) : null
  const span = practice.targetBpm - practice.startBpm
  const progress = live && span !== 0 ? Math.min(1, Math.max(0, (live.bpm - practice.startBpm) / span)) : 0

  return (
    <div className="practice-panel">
      <Panel
        title="Speed trainer"
        description="Raises or lowers the tempo every few bars. While on, it overrides the main tempo and section tempos; the tempo % still applies."
        headerAction={
          <Toggle
            hideLabel
            label="Speed trainer"
            checked={practice.enabled}
            onChange={(enabled) => setPractice({ enabled })}
          />
        }
      >
        {practice.enabled && playing && (
          <div className="practice-panel__live">
            {live ? (
              <>
                <div className="practice-panel__now">
                  <span className="practice-panel__now-label">Now</span>
                  <span className="practice-panel__now-value tabular">{live.bpm}</span>
                  <span className="practice-panel__now-unit">BPM</span>
                  {tempoPercent !== 100 && (
                    <span className="practice-panel__now-percent tabular">
                      {`plays at ${formatBpm(effectiveBpm(live.bpm, tempoPercent))}`}
                    </span>
                  )}
                </div>
                <p className="practice-panel__live-text tabular">
                  {next === null
                    ? live.direction === 0 && direction !== 0
                      ? 'Holding at the target.'
                      : 'Holding this tempo.'
                    : `Bar ${Math.min(live.barsAtTempo + 1, live.everyBars)} of ${live.everyBars} at this tempo. ` +
                      (next === 'stop'
                        ? 'Stops after this step.'
                        : `Next: ${next} BPM in ${plural(Math.max(1, live.everyBars - live.barsAtTempo), 'bar')}.`)}
                </p>
                {direction !== 0 && (
                  <div
                    className="practice-panel__progress"
                    role="progressbar"
                    aria-label="Progress to target tempo"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress * 100)}
                    aria-valuetext={`${live.bpm} of ${practice.targetBpm} BPM`}
                  >
                    <span className="practice-panel__progress-fill" style={{ width: `${progress * 100}%` }} />
                  </div>
                )}
              </>
            ) : (
              <p className="practice-panel__live-text">Starts at {practice.startBpm} BPM on the next bar.</p>
            )}
          </div>
        )}

        <div className="practice-panel__tempos">
          <Stepper
            label="Start"
            suffix="BPM"
            value={practice.startBpm}
            min={MIN_BPM}
            max={MAX_BPM}
            onChange={(startBpm) => setPractice({ startBpm })}
          />
          <Stepper
            label="Target"
            suffix="BPM"
            value={practice.targetBpm}
            min={MIN_BPM}
            max={MAX_BPM}
            onChange={(targetBpm) => setPractice({ targetBpm })}
          />
          <div className="practice-panel__direction">
            <Badge tone={direction === 0 ? 'neutral' : 'accent'}>
              {direction > 0 && <TrendUpIcon size={14} />}
              {direction < 0 && <TrendDownIcon size={14} />}
              {direction > 0 ? 'Increase' : direction < 0 ? 'Decrease' : 'Constant'}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              icon={<RepeatIcon size={16} />}
              aria-label="Swap start and target"
              title="Swap start and target"
              disabled={direction === 0}
              onClick={() =>
                onChange((prev) => ({
                  ...prev,
                  practice: { ...prev.practice, startBpm: prev.practice.targetBpm, targetBpm: prev.practice.startBpm },
                }))
              }
            >
              Swap
            </Button>
          </div>
        </div>

        <div className="practice-panel__tempos">
          <Stepper
            label="Step"
            suffix="BPM"
            value={practice.stepBpm}
            min={1}
            max={MAX_PRACTICE_STEP}
            onChange={(stepBpm) => setPractice({ stepBpm })}
          />
          <Stepper
            label="Every"
            suffix={practice.everyBars === 1 ? 'bar' : 'bars'}
            value={practice.everyBars}
            min={1}
            max={MAX_PRACTICE_EVERY_BARS}
            onChange={(everyBars) => setPractice({ everyBars })}
          />
        </div>

        <Field label="At the target" hint={atTargetText(practice)}>
          <Segmented<PracticeAtTarget>
            label="At the target"
            wrap
            value={practice.atTarget}
            options={AT_TARGET_OPTIONS}
            disabled={direction === 0}
            onChange={(atTarget) => setPractice({ atTarget })}
          />
        </Field>
      </Panel>

      <Panel
        title="Ramp preview"
        level={3}
        description={`Times assume ${section.beatsPerBar}/${section.beatUnit}, the selected section's time signature.`}
      >
        <figure className="practice-panel__figure">
          <RampChart practice={practice} steps={preview} live={live} />
          <figcaption className="practice-panel__summary">
            <span className="tabular">{summary}</span>
            {percentNote && <span className="practice-panel__percent tabular">{percentNote}</span>}
          </figcaption>
          <ol className="sr-only" aria-label="Tempo steps">
            {preview.map((step, i) => (
              <li key={i}>{`Bars ${i * practice.everyBars + 1} to ${(i + 1) * practice.everyBars}: ${step.bpm} BPM`}</li>
            ))}
          </ol>
        </figure>
      </Panel>
    </div>
  )
}
