import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { MAX_BPM, MAX_TEMPO_PERCENT, MIN_BPM, MIN_TEMPO_PERCENT, TEMPO_PERCENT_STEP } from '../../core/constants'
import { tempoMarking } from '../../core/meter'
import { clampTempoPercent, DEFAULT_BPM, DEFAULT_TEMPO_PERCENT, playedBpm, withBpm } from '../../core/settings'
import type { Settings } from '../../core/types'
import type { SettingsUpdater } from '../../state/useSettings'
import { MinusIcon, PlusIcon, TrendDownIcon, TrendUpIcon } from '../icons/icons'
import { Badge, Button, Slider } from '../ui/ui'
import './TempoControl.css'

interface TempoControlProps {
  settings: Settings
  onChange: SettingsUpdater
  /** Effective tempo of the pulse sounding now (rounded to 0.1); null when not playing. */
  playingBpm: number | null
  /** Tempo of the pulse sounding now before the percentage; null when not playing. */
  playingBaseBpm: number | null
}

/** Ruler numbers every 10 % (50, 60 … 120), so a value like 70 can be found at a glance. */
const percentMarkLabel = (mark: number): string | null => (mark % 10 === 0 ? String(mark) : null)

/** A checkpoint at every step of the speed bar (50, 55 … 120). The CSS emphasizes every 25 % and 100 %. */
const PERCENT_MARKS = Array.from(
  { length: (MAX_TEMPO_PERCENT - MIN_TEMPO_PERCENT) / TEMPO_PERCENT_STEP + 1 },
  (_, i) => MIN_TEMPO_PERCENT + i * TEMPO_PERCENT_STEP,
)
const SLIDER_MARKS = [60, 120, 180, 240]

const HOLD_DELAY_MS = 400
const HOLD_FIRST_INTERVAL_MS = 150
const HOLD_MIN_INTERVAL_MS = 35
const HOLD_ACCELERATION = 0.85

function formatBpm(bpm: number): string {
  return String(Math.round(bpm * 10) / 10)
}

interface HoldButtonProps {
  onStep: () => void
  disabled: boolean
  label: string
  className: string
  children: ReactNode
}

/** Steps once on press, then repeats (accelerating) while held. Keyboard activation steps once. */
function HoldButton({ onStep, disabled, label, className, children }: HoldButtonProps) {
  const timer = useRef<number | null>(null)
  // Set on pointerdown so the click that follows does not step a second time.
  const pointerStepped = useRef(false)

  function stopHold() {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  // A button that becomes disabled (tempo limit reached) stops receiving pointerup.
  useEffect(() => {
    if (disabled && timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [disabled])

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 || disabled) return
    pointerStepped.current = true
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Capture only keeps the hold alive when the finger drifts off the button.
    }
    stopHold()
    onStep()
    let interval = HOLD_FIRST_INTERVAL_MS
    const tick = () => {
      onStep()
      interval = Math.max(HOLD_MIN_INTERVAL_MS, interval * HOLD_ACCELERATION)
      timer.current = window.setTimeout(tick, interval)
    }
    timer.current = window.setTimeout(tick, HOLD_DELAY_MS)
  }

  function onClick(detail: number) {
    // detail 0 = keyboard or assistive-tech activation, which has no pointerdown.
    if (pointerStepped.current && detail !== 0) {
      pointerStepped.current = false
      return
    }
    pointerStepped.current = false
    onStep()
  }

  return (
    <Button
      variant="secondary"
      className={className}
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerUp={stopHold}
      onPointerCancel={stopHold}
      onLostPointerCapture={stopHold}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => onClick(e.detail)}
    >
      {children}
    </Button>
  )
}

export function TempoControl({ settings, onChange, playingBpm, playingBaseBpm }: TempoControlProps) {
  const { bpm, tempoPercent, practice, program, sections } = settings
  const [draft, setDraft] = useState<string | null>(null)
  // Escape blurs the field too; this tells the blur handler to discard the draft instead of committing it.
  const cancelEdit = useRef(false)

  const setBpm = (next: number) => onChange((prev) => withBpm(prev, next))
  const nudge = (delta: number) => () => onChange((prev) => withBpm(prev, prev.bpm + delta))
  const setPercent = (next: number) => onChange((prev) => ({ ...prev, tempoPercent: clampTempoPercent(next) }))

  // While stopped, show what Start would play: the speed trainer and a program's first section tempo win over bpm.
  const firstSectionTempo = program.enabled ? sections[0]?.tempo ?? null : null
  const startBase = practice.enabled ? practice.startBpm : firstSectionTempo ?? bpm
  // The speed trainer plays its tempo as set; the percentage only scales the other tempos.
  const actual = playingBpm ?? playedBpm(startBase, tempoPercent, practice.enabled)
  // While the speed trainer plays, the big readout shows its current tempo; buttons and slider still set the main
  // tempo (which is the trainer's target).
  const trainerPlaying = practice.enabled && playingBpm !== null
  const shown = trainerPlaying ? Math.round(actual) : bpm
  // With the trainer on, its badge takes the notes row instead of "Plays at" (the readout already shows its tempo).
  const differs = !practice.enabled && Math.abs(actual - shown) >= 0.05

  const base = playingBaseBpm ?? startBase
  let reason: string | null = null
  if (differs) {
    const parts: string[] = []
    if (base !== bpm) parts.push('section tempo')
    if (tempoPercent !== 100) parts.push(`${tempoPercent}%`)
    reason = parts.length > 0 ? parts.join(' · ') : null
  }

  const notes =
    practice.enabled || differs ? (
      <div className="tempo-control__notes">
        {practice.enabled && (
          <Badge tone="warning" title="The speed trainer sets the tempo while it is on. Its target is the main tempo.">
            {practice.targetBpm >= practice.startBpm ? <TrendUpIcon size={14} /> : <TrendDownIcon size={14} />}
            <span className="tempo-control__badge-text">
              Trainer {practice.startBpm} → {practice.targetBpm}
            </span>
          </Badge>
        )}
        {differs && (
          <Badge tone="accent" title={reason ? `Because of: ${reason}` : undefined}>
            <span className="tempo-control__badge-text">
              {playingBpm !== null ? 'Playing' : 'Plays at'} {formatBpm(actual)} BPM
            </span>
          </Badge>
        )}
        {differs && reason && <span className="tempo-control__reason">{reason}</span>}
      </div>
    ) : null

  function onValueBlur() {
    if (cancelEdit.current) {
      cancelEdit.current = false
      setDraft(null)
      return
    }
    if (draft === null) return
    const parsed = Number(draft.trim().replace(',', '.'))
    setDraft(null)
    if (draft.trim() !== '' && Number.isFinite(parsed)) setBpm(parsed)
  }

  function onValueKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    let delta: number
    switch (e.key) {
      case 'Enter':
        // Leaving the field commits (onBlur) and hands Space back to the start/stop shortcut.
        e.preventDefault()
        e.currentTarget.blur()
        return
      case 'Escape':
        e.preventDefault()
        cancelEdit.current = true
        e.currentTarget.blur()
        return
      case 'ArrowUp':
        delta = e.shiftKey ? 10 : 1
        break
      case 'ArrowDown':
        delta = e.shiftKey ? -10 : -1
        break
      case 'PageUp':
        delta = 10
        break
      case 'PageDown':
        delta = -10
        break
      default:
        return
    }
    e.preventDefault()
    setDraft(null)
    setBpm(bpm + delta)
  }

  return (
    <section className="tempo-control" aria-label="Tempo">
      {/* The section is the size container; this inner box is what the container query lays out. */}
      <div className="tempo-control__layout">
        <div className="tempo-control__main">
          <HoldButton
            className="tempo-control__step tempo-control__step--round"
            label="Tempo −1 BPM"
            disabled={bpm <= MIN_BPM}
            onStep={nudge(-1)}
          >
            <MinusIcon size={20} />
          </HoldButton>

          <div className="tempo-control__readout">
            <span className="tempo-control__marking">{trainerPlaying ? 'Speed trainer' : tempoMarking(bpm)}</span>
            <input
              type="text"
              role="spinbutton"
              className="tempo-control__value tabular"
              inputMode="numeric"
              enterKeyHint="done"
              autoComplete="off"
              spellCheck={false}
              maxLength={5}
              aria-label="Tempo in BPM"
              aria-valuenow={shown}
              aria-valuemin={MIN_BPM}
              aria-valuemax={MAX_BPM}
              aria-valuetext={trainerPlaying ? `${shown} BPM, speed trainer` : `${bpm} BPM, ${tempoMarking(bpm)}`}
              title={trainerPlaying ? 'Speed trainer tempo. Type to set the target tempo' : 'Click to type a tempo'}
              value={draft ?? String(shown)}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onBlur={onValueBlur}
              onKeyDown={onValueKeyDown}
            />
            {/* Under the number: what changes the tempo played (trainer, percentage), else the unit. */}
            {notes ?? (
              <span className="tempo-control__unit" aria-hidden="true">
                BPM
              </span>
            )}
          </div>

          <HoldButton
            className="tempo-control__step tempo-control__step--round"
            label="Tempo +1 BPM"
            disabled={bpm >= MAX_BPM}
            onStep={nudge(1)}
          >
            <PlusIcon size={20} />
          </HoldButton>
        </div>

        <div className="tempo-control__slider-row">
          <HoldButton className="tempo-control__step" label="Tempo −5 BPM" disabled={bpm <= MIN_BPM} onStep={nudge(-5)}>
            −5
          </HoldButton>
          <Slider
            className="tempo-control__slider"
            label="Tempo"
            hideLabel
            showValue={false}
            value={bpm}
            min={MIN_BPM}
            max={MAX_BPM}
            marks={SLIDER_MARKS}
            defaultValue={DEFAULT_BPM}
            format={(v) => `${v} BPM`}
            onChange={setBpm}
          />
          <HoldButton className="tempo-control__step" label="Tempo +5 BPM" disabled={bpm >= MAX_BPM} onStep={nudge(5)}>
            +5
          </HoldButton>
        </div>

        {/* Speed percentage: scales the tempo played, in steps of 5 % (resets to 100 % from its label). */}
        <div className={`tempo-control__speed${tempoPercent !== 100 ? ' is-changed' : ''}`}>
          <Button
            variant="ghost"
            size="sm"
            className="tempo-control__speed-reset"
            title={tempoPercent !== 100 ? 'Reset speed percentage to 100 %' : 'Speed percentage: scales the tempo played'}
            aria-label="Reset speed percentage to 100 %"
            disabled={tempoPercent === 100}
            onClick={() => setPercent(100)}
          >
            Speed %
          </Button>
          <div className="tempo-control__speed-control" title="Plays the tempo at this percentage (steps of 5 %)">
            <Slider
              className="tempo-control__speed-slider"
              label="Speed %"
              hideLabel
              value={tempoPercent}
              min={MIN_TEMPO_PERCENT}
              max={MAX_TEMPO_PERCENT}
              step={TEMPO_PERCENT_STEP}
              marks={PERCENT_MARKS}
              markLabel={percentMarkLabel}
              defaultValue={DEFAULT_TEMPO_PERCENT}
              format={(v) => `${v}%`}
              onChange={setPercent}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
