import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { MAX_BPM, MAX_SECTION_BARS, MAX_SECTIONS, MIN_BPM } from '../../core/constants'
import {
  clampBpm,
  createSection,
  beatSeconds,
  effectiveBpm,
  makeId,
  rhythmDiffers,
  saveCurrentToSection,
  selectSection,
  toCurrent,
} from '../../core/settings'
import type { Section, Settings } from '../../core/types'
import { ArrowDownIcon, ArrowUpIcon, CopyIcon, PlusIcon, SaveIcon, TrashIcon, XIcon } from '../icons/icons'
import type { PanelProps } from '../panelTypes'
import { Button, IconButton, Panel, Stepper, Toggle } from '../ui/ui'
import { ProgramQuickEntry } from './ProgramQuickEntry'
import { ProgramTemplates } from './ProgramTemplates'
import './ProgramPanel.css'

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
  const bpm = effectiveBpm(section.tempo ?? settings.bpm, settings.tempoPercent)
  return section.bars * section.beatsPerBar * beatSeconds(bpm, section.beatUnit)
}

interface FocusRequest {
  id: string
  select: boolean
}

interface ProgramPanelProps extends PanelProps {
  /** Replaces the "Program" heading (the Quick tab puts its Program / Presets switch there). */
  title?: ReactNode
  /** Minimized: the header alone. Owned by the Quick tab, so Program and Presets share it. */
  collapsed: boolean
  /** Rendered at the end of the header (the minimize button). */
  collapseButton?: ReactNode
}

export function ProgramPanel({
  settings,
  onChange,
  metronome,
  title = 'Program',
  collapsed,
  collapseButton,
}: ProgramPanelProps) {
  const uid = useId()
  const [status, setStatus] = useState('')
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
      title={title}
      description={
        <>
          <span className="tabular">{summary}</span>
          {!program.enabled && <span> · off</span>}
          {settings.practice.enabled && (
            <span
              className="program-panel__warn"
              title="The speed trainer sets the tempo instead of the section tempos"
            >
              {' · speed trainer sets the tempo'}
            </span>
          )}
        </>
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
          {collapseButton}
        </>
      }
    >
      {!collapsed && (
        <>
          <div className="program-panel__tools">
            <ProgramQuickEntry settings={settings} onChange={onChange} onStatus={setStatus} />
            <ProgramTemplates settings={settings} onChange={onChange} onStatus={setStatus} />
          </div>

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
                    <span className="program-panel__cell-line program-panel__cell-line--head" aria-hidden="true">
                      <span className="program-panel__index tabular">{index + 1}</span>
                      <span className="program-panel__cell-name">{label}</span>
                    </span>
                    <span className="program-panel__cell-line" aria-hidden="true">
                      <span className="program-panel__cell-meter tabular">
                        {section.beatsPerBar}/{section.beatUnit}
                      </span>
                      <span className="program-panel__cell-info tabular">
                        {bar !== null ? `${bar}/${section.bars}` : `×${section.bars}`}
                        {section.tempo !== null && ` @${section.tempo}`}
                      </span>
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
                  {/* A sibling of the cell (a button cannot hold another button), laid over its corner. */}
                  <button
                    type="button"
                    className="program-panel__cell-delete"
                    aria-label={`Delete ${label}`}
                    title={sections.length <= 1 ? 'A program keeps at least one section' : `Delete ${label}`}
                    disabled={sections.length <= 1}
                    onClick={() => remove(section, index)}
                  >
                    <XIcon size={12} />
                  </button>
                </li>
              )
            })}
            <li className="program-panel__matrix-item">
              <button
                type="button"
                className="program-panel__cell program-panel__cell--add"
                disabled={!canAdd}
                onClick={add}
              >
                <PlusIcon size={16} />
                {canAdd ? 'Add' : `Max ${MAX_SECTIONS}`}
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
              <div className="program-panel__editor">
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
                <Stepper
                  label={`Section ${editIndex + 1} bars`}
                  hideLabel
                  size="sm"
                  suffix="bars"
                  value={editing.bars}
                  min={1}
                  max={MAX_SECTION_BARS}
                  onChange={(bars) => updateSection(editing.id, (s) => ({ ...s, bars }))}
                />
                <span
                  className="program-panel__tempo"
                  title={editing.tempo !== null ? undefined : `Uses the main tempo (${settings.bpm} BPM)`}
                >
                  <Toggle
                    size="sm"
                    label="Tempo"
                    checked={editing.tempo !== null}
                    onChange={(on) =>
                      updateSection(editing.id, (s) => ({ ...s, tempo: on ? clampBpm(settings.bpm) : null }))
                    }
                  />
                  {/* Always there (greyed out with the main tempo when off), so switching it on moves nothing. */}
                  <Stepper
                    hideLabel
                    size="sm"
                    label={`Section ${editIndex + 1} tempo`}
                    suffix="BPM"
                    value={editing.tempo ?? clampBpm(settings.bpm)}
                    min={MIN_BPM}
                    max={MAX_BPM}
                    disabled={editing.tempo === null}
                    onChange={(tempo) => updateSection(editing.id, (s) => ({ ...s, tempo }))}
                  />
                </span>
                <span className="program-panel__actions">
                  <IconButton
                    id={elId(editing, 'up')}
                    size="sm"
                    label={`Move ${editLabel} earlier`}
                    icon={<ArrowUpIcon size={16} />}
                    disabled={editIndex === 0}
                    onClick={() => move(editing, editIndex, -1)}
                  />
                  <IconButton
                    id={elId(editing, 'down')}
                    size="sm"
                    label={`Move ${editLabel} later`}
                    icon={<ArrowDownIcon size={16} />}
                    disabled={editIndex === sections.length - 1}
                    onClick={() => move(editing, editIndex, 1)}
                  />
                  <IconButton
                    size="sm"
                    label={`Duplicate ${editLabel}`}
                    icon={<CopyIcon size={16} />}
                    disabled={!canAdd}
                    onClick={() => duplicate(editing)}
                  />
                  <IconButton
                    size="sm"
                    label={`Delete ${editLabel}`}
                    icon={<TrashIcon size={16} />}
                    disabled={sections.length <= 1}
                    onClick={() => remove(editing, editIndex)}
                  />
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
                    {unsaved ? 'Save' : 'Saved'}
                  </Button>
                </span>
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
