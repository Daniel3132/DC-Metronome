import { useState, type CSSProperties, type ReactNode } from 'react'
import { getSubdivision, MAX_BPM, MAX_PRACTICE_EVERY_BARS, MAX_PRACTICE_STEP, MIN_BPM } from '../../core/constants'
import {
  accentGroupings,
  beatsFromGrouping,
  COMMON_SIGNATURES,
  groupingKey,
  matchingAccentGrouping,
  QUICK_SIGNATURES,
} from '../../core/meter'
import { defaultBeats, findPart, practiceAt, practiceWithStart, updateEditedPart, withBpm } from '../../core/settings'
import type { BeatUnit, GapSettings, Part, PracticeSettings, PulseEvent, Settings, SubdivisionId } from '../../core/types'
import { readItem, writeItem } from '../../state/uiPrefs'
import type { SettingsUpdater } from '../../state/useSettings'
import { ChevronDownIcon, TrendDownIcon, TrendUpIcon } from '../icons/icons'
import type { BlockHandle } from '../MainPanel/blockHandle'
import { MasterVolume } from '../MasterVolume/MasterVolume'
import { RhythmNotation } from '../RhythmNotation/RhythmNotation'
import { SubdivisionPicker } from '../SubdivisionPicker/SubdivisionPicker'
import { IconButton, Segmented, Select, Stepper, Toggle, type SegmentedOption, type SelectOption } from '../ui/ui'
import './QuickControls.css'

interface QuickControlsProps {
  settings: Settings
  onChange: SettingsUpdater
  /** Output peak 0..1 (engine.getLevel), for the volume meter. */
  getLevel: () => number
  /** Playback is running (poll the volume meter). */
  active: boolean
  /** Which row to show: the Quick tab places each row on its own (they can be dragged around). */
  row: RowId
  /** Makes the row draggable (MainPanel owns the order). */
  handle: BlockHandle
  /** The pulse sounding now; null when stopped (for the speed trainer's progress). */
  pulse: PulseEvent | null
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

/** The cells come in two rows, each of which can be minimized to a one-line summary. */
export type RowId = 'rhythm' | 'practice'
const ROW_LABELS: Record<RowId, string> = { rhythm: 'Rhythm', practice: 'Trainer, voice & volume' }

const COLLAPSED_ROWS_KEY = 'dcmetronome.ui.collapsedRows'
function readCollapsedRows(): RowId[] {
  try {
    const raw: unknown = JSON.parse(readItem(COLLAPSED_ROWS_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((id): id is RowId => id === 'rhythm' || id === 'practice') : []
  } catch {
    return []
  }
}

/** The speed trainer's tempo now and how far it is towards the target, shown in its cell header while it is on. */
function TrainerProgress({ practice, pulse }: { practice: PracticeSettings; pulse: PulseEvent | null }) {
  const run = pulse?.practice ?? null
  const bpm = run?.bpm ?? practice.startBpm
  const span = practice.targetBpm - practice.startBpm
  const progress = span === 0 ? 1 : Math.min(1, Math.max(0, (bpm - practice.startBpm) / span))
  const rising = run ? run.direction >= 0 : span >= 0
  const detail = run ? `bar ${run.barsAtTempo + 1}/${run.everyBars}` : `→ ${practice.targetBpm}`
  return (
    <span className="quick-controls__trainer" role="status" aria-label={`Speed trainer at ${bpm} BPM, ${detail}`}>
      <span className="quick-controls__trainer-text tabular" aria-hidden="true">
        {rising ? <TrendUpIcon size={12} /> : <TrendDownIcon size={12} />}
        {bpm}
        <span className="quick-controls__trainer-muted"> · {detail}</span>
      </span>
      <span className="quick-controls__trainer-bar" aria-hidden="true">
        <span className="quick-controls__trainer-fill" style={{ '--progress': progress } as CSSProperties} />
      </span>
    </span>
  )
}

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
 * The main tab's controls as a grid of small cells: signature, subdivision, accents, rest bar (gap trainer), voice, volume
 * and the speed trainer. Each shows the most used choices and a compact picker for the rest.
 * Signature, subdivision and accents edit the selected program section part directly (the program shows which), or
 * the free rhythm when no section is selected.
 */
export function QuickControls({ settings, onChange, getLevel, active, pulse, row: rowId, handle }: QuickControlsProps) {
  const { gap, voice, practice, mixer } = settings
  const [collapsedRows, setCollapsedRows] = useState<RowId[]>(readCollapsedRows)
  const target = findPart(settings, settings.selected)
  const section = target?.part ?? settings.current

  function updateSection(fn: (part: Part) => Part) {
    onChange((prev) => updateEditedPart(prev, fn))
  }
  const setGap = (patch: Partial<GapSettings>) => onChange((prev) => ({ ...prev, gap: { ...prev.gap, ...patch } }))
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

  // Accents: plain (accent on 1 only) or a grouping, as chips. Accents edited on the beat pads match no chip, so
  // none is lit.
  const matching = matchingAccentGrouping(section.beats)
  const accentValue = matching ? groupingKey(matching) : ''
  const accentChips: SegmentedOption<string>[] = accentGroupings(section.beatsPerBar).map((g) => ({
    value: groupingKey(g),
    label: g.length === 1 ? 'Plain' : groupingKey(g),
    title: g.length === 1 ? `Plain: accent on 1 only` : `Accents grouped ${groupingKey(g)}`,
  }))
  const setGrouping = (key: string) => {
    const groups = key.split('+').map(Number)
    updateSection((s) => ({ ...s, beats: beatsFromGrouping(groups) }))
  }

  const setSubdivision = (subdivision: SubdivisionId) => updateSection((s) => ({ ...s, subdivision }))

  const gapValue = gapLabel(gap.playBars, gap.muteBars)
  // A pattern set elsewhere (a preset) is added as an extra chip so the current value always shows.
  const gapChips: SegmentedOption<string>[] = (
    (GAP_PATTERNS as readonly string[]).includes(gapValue) ? [...GAP_PATTERNS] : [...GAP_PATTERNS, gapValue]
  ).map((pattern) => {
    const [play, mute] = pattern.split(':').map(Number)
    return { value: pattern, label: pattern, title: `Play ${play} bar${play === 1 ? '' : 's'}, rest ${mute}` }
  })

  function toggleRow(id: RowId) {
    // Each row is its own component: start from what is stored, so the other row's state is kept.
    const stored = readCollapsedRows()
    const next = stored.includes(id) ? stored.filter((r) => r !== id) : [...stored, id]
    setCollapsedRows(next)
    writeItem(COLLAPSED_ROWS_KEY, JSON.stringify(next))
  }

  /**
   * A box of cells with its minimize button and drag grip inside, at the end; minimized, a one-line bar with what is
   * set (the whole bar drags). Rows only drag from the grip or the bar, never from the controls in them.
   */
  function row(id: RowId, summary: string, cells: ReactNode) {
    const label = ROW_LABELS[id]
    const className = (base: string) => ['quick-controls', base, handle.className].filter(Boolean).join(' ')
    if (collapsedRows.includes(id)) {
      return (
        <button
          type="button"
          className={className('quick-controls__row-bar')}
          aria-expanded={false}
          title={`Show the ${label.toLowerCase()} controls (drag to move the row)`}
          {...handle.rootProps}
          onClick={() => {
            if (!handle.consumeClick()) toggleRow(id)
          }}
        >
          <span className="quick-controls__row-label">{label}</span>
          <span className="quick-controls__row-summary tabular">{summary}</span>
          <ChevronDownIcon size={18} className="quick-controls__row-chevron" />
        </button>
      )
    }
    return (
      <div className={className('quick-controls__row')} role="group" aria-label={label} {...handle.rootProps}>
        <div className="quick-controls__grid">{cells}</div>
        <div className="quick-controls__row-side">
          <IconButton
            size="sm"
            variant="ghost"
            className="quick-controls__row-collapse"
            aria-expanded={true}
            label={`Minimize ${label.toLowerCase()}`}
            icon={<ChevronDownIcon size={18} />}
            onClick={() => toggleRow(id)}
          />
          {handle.grip}
        </div>
      </div>
    )
  }

  const accentSummary = matching
    ? matching.length === 1
      ? 'Plain accents'
      : `Accents ${groupingKey(matching)}`
    : 'Custom accents'
  const rhythmSummary = [
    signature,
    getSubdivision(section.subdivision).label,
    accentSummary,
    gap.enabled ? `Rest bar ${gapValue}` : 'Rest bar off',
  ].join(' · ')
  const practiceSummary = [
    practice.enabled ? `Trainer ${practice.startBpm} → ${practice.targetBpm}` : 'Trainer off',
    voice.enabled ? 'Voice on' : 'Voice off',
    mixer.muted ? 'Muted' : `Volume ${Math.round(mixer.master * 100)}%`,
  ].join(' · ')

  return rowId === 'rhythm'
    ? row(
        'rhythm',
        rhythmSummary,
        <>
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
            <Segmented
              className="quick-controls__chips quick-controls__chips--accents"
              label="Accent pattern"
              size="sm"
              wrap
              value={accentValue}
              options={accentChips}
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
            <Segmented
              className="quick-controls__chips quick-controls__chips--gap"
              label="Bars played : bars of rest"
              size="sm"
              wrap
              value={gapValue}
              options={gapChips}
              onChange={(pattern) => {
                const [playBars, muteBars] = pattern.split(':').map(Number)
                setGap({ playBars, muteBars })
              }}
            />
          </Cell>
        </>,
      )
    : row(
        'practice',
        practiceSummary,
        <>
          <Cell
            kind="practice"
            label="Speed trainer"
            aside={
              <span className="quick-controls__cell-aside">
                {practice.enabled && <TrainerProgress practice={practice} pulse={pulse} />}
                <Toggle
                  hideLabel
                  size="sm"
                  label="Speed trainer"
                  checked={practice.enabled}
                  // The trainer aims at the main tempo; older settings may have drifted apart.
                  onChange={(enabled) =>
                    onChange((prev) => ({ ...prev, practice: { ...practiceAt(prev.practice, prev.bpm), enabled } }))
                  }
                />
              </span>
            }
          >
            <div className="quick-controls__steppers">
              <Stepper
                label="Start BPM"
                size="sm"
                value={practice.startBpm}
                min={MIN_BPM}
                max={MAX_BPM}
                onChange={(startBpm) => onChange((prev) => ({ ...prev, practice: practiceWithStart(prev.practice, startBpm) }))}
              />
              <Stepper
                label="Target BPM"
                size="sm"
                value={practice.targetBpm}
                min={MIN_BPM}
                max={MAX_BPM}
                // The target is the main tempo: changing one changes the other (and the start keeps its ratio).
                onChange={(targetBpm) => onChange((prev) => withBpm(prev, targetBpm))}
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
              master={mixer.master}
              muted={mixer.muted}
              onChange={onChange}
              getLevel={getLevel}
              active={active}
            />
          </Cell>
        </>,
      )
}
