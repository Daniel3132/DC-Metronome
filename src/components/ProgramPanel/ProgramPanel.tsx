import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { MAX_BPM, MAX_SECTION_BARS, MAX_SECTIONS, MIN_BPM } from '../../core/constants'
import {
  clampBpm,
  createSection,
  effectiveBpm,
  makeId,
  rhythmDiffers,
  saveCurrentToSection,
  selectSection,
  toCurrent,
} from '../../core/settings'
import type { BeatLevel, Section, Settings } from '../../core/types'
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, CopyIcon, PlusIcon, SaveIcon, TrashIcon } from '../icons/icons'
import type { PanelProps } from '../panelTypes'
import { Badge, Button, Field, IconButton, Panel, Stepper, Toggle } from '../ui/ui'
import { ProgramTemplates } from './ProgramTemplates'
import './ProgramPanel.css'

/** Remembers whether the program card is minimized (a per-browser convenience; failures are ignored). */
const COLLAPSED_KEY = 'dcmetronome.ui.programCollapsed'

function readCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    globalThis.localStorage?.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // Storage blocked or full: the card just opens expanded next time.
  }
}

const NAME_MAX_LENGTH = 40

function sectionLabel(section: Section, index: number): string {
  return section.name.trim() || `Section ${index + 1}`
}

/** Keeps the same section selected after the list changed; falls back to the slot it was in. */
function keepActive(prev: Settings, sections: Section[]): number {
  const activeId = prev.sections[prev.activeSection]?.id
  const index = sections.findIndex((s) => s.id === activeId)
  return index >= 0 ? index : Math.max(0, Math.min(prev.activeSection, sections.length - 1))
}

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

function sectionSeconds(section: Section, settings: Settings): number {
  return (section.bars * section.beatsPerBar * 60) / effectiveBpm(section.tempo ?? settings.bpm, settings.tempoPercent)
}

function describeBeats(beats: readonly BeatLevel[]): string {
  const at = (level: BeatLevel) => beats.flatMap((l, i) => (l === level ? [i + 1] : []))
  const parts = (
    [
      ['accent on', at('accent')],
      ['medium', at('medium')],
      ['muted', at('mute')],
    ] as const
  )
    .filter(([, list]) => list.length > 0)
    .map(([name, list]) => `${name} ${list.join(', ')}`)
  return `${plural(beats.length, 'beat')}${parts.length > 0 ? `: ${parts.join('; ')}` : ''}`
}

function AccentPreview({ beats }: { beats: readonly BeatLevel[] }) {
  return (
    <span className="program-panel__beats" role="img" aria-label={`Accents, ${describeBeats(beats)}`}>
      {beats.map((level, i) => (
        <span key={i} className={`program-panel__beat program-panel__beat--${level}`} />
      ))}
    </span>
  )
}

interface FocusRequest {
  id: string
  select: boolean
}

export function ProgramPanel({ settings, onChange, metronome }: PanelProps) {
  const uid = useId()
  const [status, setStatus] = useState('')
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      writeCollapsed(!c)
      return !c
    })
  }
  // Reordering moves DOM nodes (and can drop focus); the handler names the element to focus after the next commit.
  const focusRequest = useRef<FocusRequest | null>(null)

  useEffect(() => {
    const request = focusRequest.current
    if (request === null) return
    focusRequest.current = null
    const el = document.getElementById(request.id)
    el?.focus()
    if (request.select && el instanceof HTMLInputElement) el.select()
  })

  const { sections, program } = settings
  const elId = (section: Section, part: string) => `${uid}-${section.id}-${part}`

  const { playback } = metronome
  const pulse = playback.status === 'playing' ? playback.pulse : null
  // Outside program mode the engine plays the working rhythm, not a section.
  const playingIndex = pulse && program.enabled ? pulse.sectionIndex : -1

  const totalBars = sections.reduce((sum, s) => sum + s.bars, 0)
  const totalSeconds = sections.reduce((sum, s) => sum + sectionSeconds(s, settings), 0)
  const canAdd = sections.length < MAX_SECTIONS

  function updateSection(id: string, update: (section: Section) => Section) {
    onChange((prev) => ({ ...prev, sections: prev.sections.map((s) => (s.id === id ? update(s) : s)) }))
  }

  function move(section: Section, index: number, delta: -1 | 1) {
    const to = index + delta
    if (to < 0 || to >= sections.length) return
    onChange((prev) => {
      const from = prev.sections.findIndex((s) => s.id === section.id)
      const target = from + delta
      if (from < 0 || target < 0 || target >= prev.sections.length) return prev
      const next = prev.sections.toSpliced(from, 1).toSpliced(target, 0, prev.sections[from])
      return { ...prev, sections: next, activeSection: keepActive(prev, next) }
    })
    // At either end the button that was used becomes disabled, so focus its opposite.
    const atEdge = to === 0 || to === sections.length - 1
    const part = delta < 0 ? (atEdge ? 'down' : 'up') : atEdge ? 'up' : 'down'
    focusRequest.current = { id: elId(section, part), select: false }
  }

  /** Keeps the working rhythm in step with the selection when a list change selects another section. */
  function withSelection(prev: Settings, next: Section[], activeSection: number): Settings {
    const changed = next[activeSection]?.id !== prev.sections[prev.activeSection]?.id
    return changed
      ? { ...prev, sections: next, activeSection, current: toCurrent(next[activeSection]) }
      : { ...prev, sections: next, activeSection }
  }

  function duplicate(section: Section) {
    if (!canAdd) return
    const copy: Section = {
      ...section,
      id: makeId(),
      name: section.name.trim() ? `${section.name.trim()} copy`.slice(0, NAME_MAX_LENGTH) : '',
      beats: [...section.beats],
    }
    onChange((prev) => {
      if (prev.sections.length >= MAX_SECTIONS) return prev
      const from = prev.sections.findIndex((s) => s.id === section.id)
      const at = from < 0 ? prev.sections.length : from + 1
      return withSelection(prev, prev.sections.toSpliced(at, 0, copy), at)
    })
    focusRequest.current = { id: elId(copy, 'name'), select: true }
    setStatus(`Added ${sectionLabel(copy, sections.indexOf(section) + 1)}.`)
  }

  function remove(section: Section, index: number) {
    if (sections.length <= 1) return
    onChange((prev) => {
      if (prev.sections.length <= 1) return prev
      const next = prev.sections.filter((s) => s.id !== section.id)
      return withSelection(prev, next, keepActive(prev, next))
    })
    const neighbour = sections[index + 1] ?? sections[index - 1]
    if (neighbour) focusRequest.current = { id: elId(neighbour, 'name'), select: false }
    setStatus(`Deleted ${sectionLabel(section, index)}.`)
  }

  /** A new section from the working rhythm (signature, accents and subdivision set in the quick controls). */
  function add() {
    if (!canAdd) return
    const { beatsPerBar, beatUnit, beats, subdivision } = settings.current
    const section = createSection({
      name: `Section ${sections.length + 1}`,
      beatsPerBar,
      beatUnit,
      beats: [...beats],
      subdivision,
    })
    onChange((prev) =>
      prev.sections.length >= MAX_SECTIONS
        ? prev
        : { ...prev, sections: [...prev.sections, section], activeSection: prev.sections.length },
    )
    focusRequest.current = { id: elId(section, 'name'), select: true }
    setStatus(`Added ${section.name}.`)
  }

  /** Selecting a section loads its rhythm into the quick controls (unsaved edits to the previous one are dropped). */
  function select(section: Section) {
    onChange((prev) => {
      const active = prev.sections.findIndex((s) => s.id === section.id)
      return active < 0 || active === prev.activeSection ? prev : selectSection(prev, active)
    })
  }

  const summary = [
    plural(sections.length, 'section'),
    plural(totalBars, 'bar'),
    `about ${formatDuration(totalSeconds)}`,
  ].join(' · ')

  // The matrix picks the section; one editor below shows it.
  const editIndex = Math.min(Math.max(0, settings.activeSection), sections.length - 1)
  const editing = sections[editIndex]
  const editLabel = sectionLabel(editing, editIndex)
  const editPlaying = editIndex === playingIndex
  const unsaved = rhythmDiffers(settings.current, editing)

  function save() {
    onChange(saveCurrentToSection)
    setStatus(`Saved ${editLabel}.`)
  }

  return (
    <Panel
      className={['program-panel', collapsed && 'is-collapsed'].filter(Boolean).join(' ')}
      title="Program"
      description={
        collapsed
          ? summary
          : 'Sections play in order. Set the signature and subdivision above, then save them into the selected section.'
      }
      headerAction={
        <>
          <span
            className="program-panel__loop"
            title={program.loop ? 'Starts over after the last section.' : 'Stops after the last section.'}
          >
            <Toggle
              size="sm"
              label="Loop"
              checked={program.loop}
              onChange={(loop) => onChange((prev) => ({ ...prev, program: { ...prev.program, loop } }))}
            />
          </span>
          <Toggle
            hideLabel
            label="Program mode"
            checked={program.enabled}
            onChange={(enabled) => onChange((prev) => ({ ...prev, program: { ...prev.program, enabled } }))}
          />
          <IconButton
            size="sm"
            variant="ghost"
            className="program-panel__collapse"
            label={collapsed ? 'Expand program' : 'Minimize program'}
            aria-expanded={!collapsed}
            icon={<ChevronDownIcon size={18} />}
            onClick={toggleCollapsed}
          />
        </>
      }
    >
      {!collapsed && (
        <>
          <div className="program-panel__summary">
            <span className="tabular">{summary}</span>
            {program.enabled ? (
              <Badge tone="accent">{program.loop ? 'Loops' : 'Plays once'}</Badge>
            ) : (
              <Badge>Program off</Badge>
            )}
          </div>

          {!program.enabled && (
            <p className="program-panel__note">
              Program mode is off: the rhythm set above plays and loops. Section tempos apply in program mode.
            </p>
          )}
          {settings.practice.enabled && (
            <p className="program-panel__note program-panel__note--warning">
              The speed trainer is on, so it sets the tempo instead of the section tempos.
            </p>
          )}
          <p className="program-panel__note">
            Pick a section to load its rhythm into the controls above. Changes reach the section only when you save it.
          </p>

          <ProgramTemplates settings={settings} onChange={onChange} onStatus={setStatus} />

          <ol className="program-panel__matrix" aria-label="Sections">
            {sections.map((section, index) => {
              const label = sectionLabel(section, index)
              const isActive = index === editIndex
              const isPlaying = index === playingIndex
              const bar = isPlaying && pulse && pulse.sectionBars !== null ? pulse.sectionBar + 1 : null
              return (
                <li key={section.id} className="program-panel__matrix-item">
                  <button
                    type="button"
                    className={['program-panel__cell', isActive && 'is-active', isPlaying && 'is-playing']
                      .filter(Boolean)
                      .join(' ')}
                    aria-pressed={isActive}
                    aria-current={isPlaying ? 'step' : undefined}
                    aria-label={`${index + 1}. ${label}: ${section.beatsPerBar}/${section.beatUnit}, ${plural(section.bars, 'bar')}${
                      section.tempo !== null ? `, ${section.tempo} BPM` : ''
                    }${isPlaying ? ', playing' : ''}`}
                    onClick={() => select(section)}
                  >
                    <span className="program-panel__cell-head" aria-hidden="true">
                      <span className="program-panel__index tabular">{index + 1}</span>
                      <span className="program-panel__cell-name">{label}</span>
                    </span>
                    <span className="program-panel__cell-meter tabular" aria-hidden="true">
                      {section.beatsPerBar}/{section.beatUnit}
                    </span>
                    <span className="program-panel__cell-info tabular" aria-hidden="true">
                      {bar !== null ? `bar ${bar}/${section.bars}` : plural(section.bars, 'bar')}
                      {section.tempo !== null && ` · ${section.tempo} BPM`}
                    </span>
                    <span className="program-panel__cell-beats" aria-hidden="true">
                      {section.beats.map((level, i) => (
                        <span key={i} className={`program-panel__beat program-panel__beat--${level}`} />
                      ))}
                    </span>
                    {bar !== null && (
                      <span className="program-panel__cell-progress" aria-hidden="true">
                        <span style={{ '--progress': bar / section.bars } as CSSProperties} />
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
            <li className="program-panel__matrix-item">
              <button type="button" className="program-panel__cell program-panel__cell--add" disabled={!canAdd} onClick={add}>
                <PlusIcon size={20} />
                {canAdd ? 'Add section' : `Up to ${MAX_SECTIONS} sections`}
              </button>
            </li>
          </ol>

          <div
            key={editing.id}
            className={['program-panel__section', editPlaying && 'is-playing'].filter(Boolean).join(' ')}
          >
            <div role="group" aria-labelledby={elId(editing, 'heading')} className="program-panel__group">
              <h3 id={elId(editing, 'heading')} className="sr-only">
                {`Edit section ${editIndex + 1}: ${editLabel}${editPlaying ? ', playing' : ''}`}
              </h3>
              <div className="program-panel__head">
                <span className="program-panel__index tabular" aria-hidden="true">
                  {editIndex + 1}
                </span>
                <label className="sr-only" htmlFor={elId(editing, 'name')}>
                  {`Section ${editIndex + 1} name`}
                </label>
                <input
                  id={elId(editing, 'name')}
                  className="program-panel__name"
                  type="text"
                  value={editing.name}
                  placeholder={`Section ${editIndex + 1}`}
                  maxLength={NAME_MAX_LENGTH}
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  onChange={(e) => {
                    const name = e.currentTarget.value
                    updateSection(editing.id, (s) => ({ ...s, name }))
                  }}
                />
                {editPlaying && pulse && (
                  <Badge tone="accent" className="program-panel__bar tabular">
                    {pulse.sectionBars === null ? 'Playing' : `Bar ${pulse.sectionBar + 1} / ${pulse.sectionBars}`}
                  </Badge>
                )}
                {unsaved && (
                  <Badge tone="warning" className="program-panel__unsaved">
                    Unsaved
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant={unsaved ? 'primary' : 'secondary'}
                  icon={<SaveIcon size={16} />}
                  disabled={!unsaved}
                  title={
                    unsaved
                      ? `Write the signature, accents and subdivision from the controls above into ${editLabel}`
                      : `${editLabel} already matches the controls above`
                  }
                  onClick={save}
                >
                  Save section
                </Button>
              </div>

              <div className="program-panel__fields">
                <Stepper
                  label="Bars"
                  value={editing.bars}
                  min={1}
                  max={MAX_SECTION_BARS}
                  onChange={(bars) => updateSection(editing.id, (s) => ({ ...s, bars }))}
                />

                <Field label="Tempo" hint={editing.tempo !== null ? undefined : `Uses the main tempo (${settings.bpm} BPM).`}>
                  <div className="program-panel__tempo">
                    <Toggle
                      size="sm"
                      label="Own tempo"
                      checked={editing.tempo !== null}
                      onChange={(on) =>
                        updateSection(editing.id, (s) => ({ ...s, tempo: on ? clampBpm(settings.bpm) : null }))
                      }
                    />
                    {editing.tempo !== null && (
                      <Stepper
                        hideLabel
                        label={`Section ${editIndex + 1} tempo`}
                        suffix="BPM"
                        value={editing.tempo}
                        min={MIN_BPM}
                        max={MAX_BPM}
                        onChange={(tempo) => updateSection(editing.id, (s) => ({ ...s, tempo }))}
                      />
                    )}
                  </div>
                </Field>
              </div>

              <div className="program-panel__foot">
                <AccentPreview beats={editing.beats} />
                <div className="program-panel__actions">
                  <IconButton
                    id={elId(editing, 'up')}
                    size="sm"
                    label={`Move ${editLabel} earlier`}
                    icon={<ArrowUpIcon size={18} />}
                    disabled={editIndex === 0}
                    onClick={() => move(editing, editIndex, -1)}
                  />
                  <IconButton
                    id={elId(editing, 'down')}
                    size="sm"
                    label={`Move ${editLabel} later`}
                    icon={<ArrowDownIcon size={18} />}
                    disabled={editIndex === sections.length - 1}
                    onClick={() => move(editing, editIndex, 1)}
                  />
                  <IconButton
                    size="sm"
                    label={`Duplicate ${editLabel}`}
                    icon={<CopyIcon size={18} />}
                    disabled={!canAdd}
                    onClick={() => duplicate(editing)}
                  />
                  <IconButton
                    size="sm"
                    label={`Delete ${editLabel}`}
                    icon={<TrashIcon size={18} />}
                    disabled={sections.length <= 1}
                    onClick={() => remove(editing, editIndex)}
                  />
                </div>
              </div>
            </div>
          </div>

        </>
      )}
      <p role="status" className="sr-only">
        {status}
      </p>
    </Panel>
  )
}
