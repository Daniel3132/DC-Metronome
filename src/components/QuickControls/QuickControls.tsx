import type { ReactNode } from 'react'
import { getSubdivision, MAX_BPM, MAX_PRACTICE_EVERY_BARS, MAX_PRACTICE_STEP, MIN_BPM } from '../../core/constants'
import {
  accentGroupings,
  beatsFromGrouping,
  COMMON_SIGNATURES,
  groupingKey,
  matchingAccentGrouping,
  QUICK_SIGNATURES,
} from '../../core/meter'
import { defaultBeats, updateSectionById } from '../../core/settings'
import type { BeatUnit, GapSettings, PracticeSettings, RandomMuteSettings, Section, Settings, SubdivisionId } from '../../core/types'
import type { SettingsUpdater } from '../../state/useSettings'
import { MasterVolume } from '../MasterVolume/MasterVolume'
import { RhythmNotation } from '../RhythmNotation/RhythmNotation'
import { SilenceStatus } from '../SilenceStatus/SilenceStatus'
import { SubdivisionPicker } from '../SubdivisionPicker/SubdivisionPicker'
import { Segmented, Select, Stepper, Toggle, type SelectOption } from '../ui/ui'
import './QuickControls.css'

interface QuickControlsProps {
  settings: Settings
  onChange: SettingsUpdater
  /** Output peak 0..1 (engine.getLevel), for the volume meter. */
  getLevel: () => number
  /** Playback is running (poll the volume meter). */
  active: boolean
}

/** The subdivisions most people reach for; the "All" picker beside them has the rest. */
const COMMON_SUBDIVISIONS: readonly SubdivisionId[] = ['quarter', 'eighths', 'triplets', 'sixteenths']

const SUBDIVISION_CHIPS = COMMON_SUBDIVISIONS.map((id) => ({
  value: id,
  title: getSubdivision(id).label,
  label: <RhythmNotation subdivision={id} height={20} className="quick-controls__notation" />,
}))

const SIGNATURE_CHIPS = COMMON_SIGNATURES.map((sig) => ({ value: sig as string, label: sig }))

const GAP_PATTERNS = ['1:1', '2:1', '3:1', '4:1', '2:2', '4:4'] as const
const RANDOM_PERCENTS = [10, 20, 25, 33, 50, 66, 75, 90] as const
/** Value of the accents picker when the beats match no pattern (edited on the beat pads). */
const CUSTOM = 'custom'

function gapLabel(play: number, mute: number): string {
  return `${play}:${mute}`
}

/** Withheld options are prepended so the picker can always show the current value. */
function withCurrent<T extends string>(options: SelectOption<T>[], current: T, label: string): SelectOption<T>[] {
  return options.some((o) => o.value === current) ? options : [{ value: current, label }, ...options]
}

interface CellProps {
  label: string
  /** Shown at the right of the label (a switch, the current value …). */
  aside?: ReactNode
  /** Sizing modifier, e.g. 'signature' → quick-controls__cell--signature. */
  kind: string
  children?: ReactNode
}

function Cell({ label, aside, kind, children }: CellProps) {
  return (
    <div
      className={`quick-controls__cell quick-controls__cell--${kind}`}
      role="group"
      aria-label={label}
    >
      <div className="quick-controls__cell-head">
        <span className="quick-controls__cell-label" aria-hidden="true">
          {label}
        </span>
        {aside}
      </div>
      {children}
    </div>
  )
}

/**
 * The main tab's controls as a grid of small cells: signature, subdivision, accents, rest bar (gap trainer and random
 * mute), voice, volume
 * and the speed trainer. Each shows the most used choices and a compact picker for the rest.
 */
export function QuickControls({ settings, onChange, getLevel, active }: QuickControlsProps) {
  const { gap, voice, practice } = settings
  // The working rhythm: saved into the selected program section only with "Save section".
  const section = settings.current

  function updateSection(fn: (s: Section) => Section) {
    onChange((prev) => updateSectionById(prev, prev.current.id, fn))
  }
  const setGap = (patch: Partial<GapSettings>) => onChange((prev) => ({ ...prev, gap: { ...prev.gap, ...patch } }))
  const setRandomMute = (patch: Partial<RandomMuteSettings>) =>
    onChange((prev) => ({ ...prev, randomMute: { ...prev.randomMute, ...patch } }))
  const setPractice = (patch: Partial<PracticeSettings>) =>
    onChange((prev) => ({ ...prev, practice: { ...prev.practice, ...patch } }))

  // Signature: picking a named meter resets its accents to the usual feel (6/8: accent 1, sub-accent 4).
  const signature = `${section.beatsPerBar}/${section.beatUnit}`
  const moreSignatures = withCurrent(
    QUICK_SIGNATURES.map((sig): SelectOption<string> => ({ value: sig, label: sig })),
    signature,
    signature,
  )
  const setSignature = (value: string) => {
    const [count, unit] = value.split('/').map(Number) as [number, BeatUnit]
    updateSection((s) => ({ ...s, beatsPerBar: count, beatUnit: unit, beats: defaultBeats(count, unit) }))
  }

  // Accents: plain (accent on 1 only) or a grouping; hand-edited pads show as Custom.
  const matching = matchingAccentGrouping(section.beats)
  const accentValue = matching ? groupingKey(matching) : CUSTOM
  const accentOptions = withCurrent(
    accentGroupings(section.beatsPerBar).map(
      (g): SelectOption<string> => ({ value: groupingKey(g), label: g.length === 1 ? `Plain (${g[0]})` : groupingKey(g) }),
    ),
    accentValue,
    'Custom',
  )
  const setGrouping = (key: string) => {
    if (key === CUSTOM) return
    const groups = key.split('+').map(Number)
    updateSection((s) => ({ ...s, beats: beatsFromGrouping(groups) }))
  }

  const setSubdivision = (subdivision: SubdivisionId) => updateSection((s) => ({ ...s, subdivision }))

  const gapValue = `${gap.playBars}:${gap.muteBars}`
  const gapOptions = withCurrent(
    GAP_PATTERNS.map((pattern): SelectOption<string> => {
      const [play, mute] = pattern.split(':').map(Number)
      return { value: pattern, label: gapLabel(play, mute) }
    }),
    gapValue,
    gapLabel(gap.playBars, gap.muteBars),
  )

  const percentValue = String(settings.randomMute.percent)
  const percentOptions = withCurrent(
    RANDOM_PERCENTS.map((p): SelectOption<string> => ({ value: String(p), label: `${p} %` })),
    percentValue,
    `${percentValue} %`,
  )

  return (
    <section className="quick-controls" aria-label="Quick controls">
      <div className="quick-controls__grid">
        <Cell
          kind="signature"
          label="Signature"
          aside={
            <Select
              className="quick-controls__more"
              label="More time signatures"
              hideLabel
              value={signature}
              options={moreSignatures}
              onChange={setSignature}
            />
          }
        >
          <Segmented
            className="quick-controls__chips quick-controls__chips--signatures"
            label="Common time signatures"
            size="sm"
            wrap
            value={signature}
            options={SIGNATURE_CHIPS}
            onChange={setSignature}
          />
        </Cell>

        <Cell
          kind="subdivision"
          label="Subdivision"
          aside={
            <SubdivisionPicker
              className="quick-controls__all-subdivisions"
              label="All subdivisions"
              hideLabel
              value={section.subdivision}
              onChange={setSubdivision}
            />
          }
        >
          <Segmented
            className="quick-controls__chips quick-controls__chips--subdivisions"
            label="Common subdivisions"
            size="sm"
            value={section.subdivision}
            options={SUBDIVISION_CHIPS}
            onChange={setSubdivision}
          />
        </Cell>

        <Cell kind="accents" label="Accents">
          <Select
            className="quick-controls__accents"
            label="Accent pattern"
            hideLabel
            value={accentValue}
            options={accentOptions}
            onChange={setGrouping}
          />
        </Cell>

        <Cell
          kind="rest"
          label="Rest bar"
          aside={
            <Toggle
              hideLabel
              size="sm"
              label="Rest bar (gap trainer)"
              checked={gap.enabled}
              onChange={(enabled) => setGap({ enabled })}
            />
          }
        >
          <Select
            className="quick-controls__gap"
            label="Bars played : bars of rest"
            hideLabel
            value={gapValue}
            options={gapOptions}
            onChange={(pattern) => {
              const [playBars, muteBars] = pattern.split(':').map(Number)
              setGap({ playBars, muteBars })
            }}
          />
          <div className="quick-controls__random" title="Randomly drops whole beats">
            <Toggle
              size="sm"
              label="Random"
              checked={settings.randomMute.enabled}
              onChange={(enabled) => setRandomMute({ enabled })}
            />
            <Select
              className="quick-controls__percent"
              label="Share of beats dropped at random"
              hideLabel
              value={percentValue}
              options={percentOptions}
              onChange={(value) => setRandomMute({ percent: Number(value) })}
            />
          </div>
          <SilenceStatus gap={gap} randomMute={settings.randomMute} />
        </Cell>

        <Cell
          kind="practice"
          label="Speed trainer"
          aside={
            <Toggle
              hideLabel
              size="sm"
              label="Speed trainer"
              checked={practice.enabled}
              onChange={(enabled) => setPractice({ enabled })}
            />
          }
        >
          <div className="quick-controls__steppers">
            <Stepper
              label="Start BPM"
              size="sm"
              value={practice.startBpm}
              min={MIN_BPM}
              max={MAX_BPM}
              onChange={(startBpm) => setPractice({ startBpm })}
            />
            <Stepper
              label="Target BPM"
              size="sm"
              value={practice.targetBpm}
              min={MIN_BPM}
              max={MAX_BPM}
              onChange={(targetBpm) => setPractice({ targetBpm })}
            />
            <Stepper
              label="Step BPM"
              size="sm"
              value={practice.stepBpm}
              min={1}
              max={MAX_PRACTICE_STEP}
              onChange={(stepBpm) => setPractice({ stepBpm })}
            />
            <Stepper
              label="Every (bars)"
              size="sm"
              value={practice.everyBars}
              min={1}
              max={MAX_PRACTICE_EVERY_BARS}
              onChange={(everyBars) => setPractice({ everyBars })}
            />
          </div>
        </Cell>

        <Cell kind="voice" label="Voice">
          <Toggle
            hideLabel
            size="sm"
            label="Voice counting"
            checked={voice.enabled}
            onChange={(enabled) => onChange((prev) => ({ ...prev, voice: { ...prev.voice, enabled } }))}
          />
        </Cell>

        <Cell kind="volume" label="Volume">
          <MasterVolume
            master={settings.mixer.master}
            muted={settings.mixer.muted}
            onChange={onChange}
            getLevel={getLevel}
            active={active}
          />
        </Cell>
      </div>
    </section>
  )
}
