import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import {
  MAX_BPM,
  MAX_SECTION_BARS,
  MAX_SECTION_PARTS,
  MAX_SECTION_REPEATS,
  MAX_SECTIONS,
  MIN_BPM,
} from '../../core/constants'
import {
  beatSeconds,
  clampBpm,
  createPart,
  createSection,
  editedPart,
  effectiveBpm,
  findPart,
  makeId,
  sectionBars,
  selectPart,
  selectSection,
  withBpm,
} from '../../core/settings'
import { importSong, SONG_FILE_ACCEPT, type ImportedSong } from '../../core/import/importSong'
import { toSections, type ParsedSection } from '../../core/programText'
import { presetActions } from '../../state/usePresets'
import type { Part, Section, Settings } from '../../core/types'
import {
  CheckIcon,
  GripIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from '../icons/icons'
import type { PanelProps } from '../panelTypes'
import { Button, Panel, Stepper, Toggle } from '../ui/ui'
import { ImportPreview } from './ImportPreview'
import { ProgramQuickEntry } from './ProgramQuickEntry'
import { useReorder } from './useReorder'
import './ProgramPanel.css'

const NAME_MAX_LENGTH = 40

/** What the disabled editor shows while no section is selected. */
const PLACEHOLDER_SECTION: Section = {
  id: 'none',
  name: '',
  parts: [{ id: 'none', beatsPerBar: 4, beatUnit: 4, beats: ['accent', 'normal', 'normal', 'normal'], subdivision: 'quarter', bars: 1 }],
  repeats: 1,
  tempo: null,
}
/** Parts drawn in a matrix cell; longer sections end in "…". */
const CELL_PARTS = 3

function sectionLabel(section: Section, index: number): string {
  return section.name.trim() || `Section ${index + 1}`
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function meterOf(part: Part): string {
  return `${part.beatsPerBar}/${part.beatUnit}`
}

/** "4/4", or "2/4 then 4/4 ×3" for screen readers. */
function describeParts(section: Section): string {
  const parts = section.parts.map((p) => (p.bars === 1 ? meterOf(p) : `${p.bars} bars of ${meterOf(p)}`)).join(' then ')
  return section.repeats > 1 ? `${parts}, ${section.repeats} times` : parts
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
  const pass = section.parts.reduce((sum, p) => sum + p.bars * p.beatsPerBar * beatSeconds(bpm, p.beatUnit), 0)
  return pass * section.repeats
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  return list.toSpliced(from, 1).toSpliced(to, 0, list[from])
}

function updateSection(settings: Settings, id: string, update: (section: Section) => Section): Settings {
  return { ...settings, sections: settings.sections.map((s) => (s.id === id ? update(s) : s)) }
}

/** Alt+arrow on a focused cell or part moves it: -1 earlier, +1 later, 0 not a move key. */
function moveKey(e: KeyboardEvent): -1 | 0 | 1 {
  if (!e.altKey) return 0
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') return -1
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') return 1
  return 0
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

/**
 * The program: a matrix of sections in play order (drag to reorder, click to select, click again to deselect) and an
 * editor for the selected one. A section is one or more parts (a bar of 2/4, then a bar of 4/4 …) repeated a number
 * of times. The quick controls above edit the selected part directly; with nothing selected they edit the free rhythm.
 */
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
  // A song file being read, then shown for review (ImportPreview); its error stays until the next attempt.
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState<ImportedSong | null>(null)
  const [importError, setImportError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
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
  const elId = (id: string, part: string) => `${uid}-${id}-${part}`
  const selected = findPart(settings, settings.selected)
  const editing = selected?.section ?? null
  const editIndex = selected?.sectionIndex ?? -1
  const editPartIndex = selected?.partIndex ?? 0

  const { playback } = metronome
  const pulse = playback.status === 'playing' ? playback.pulse : null
  // Program mode plays the sections; outside it the selected section loops (and the free rhythm plays when none is).
  const playingIndex = pulse && (program.enabled || selected) ? pulse.sectionIndex : -1

  const totalBars = sections.reduce((sum, s) => sum + sectionBars(s), 0)
  const totalSeconds = sections.reduce((sum, s) => sum + sectionSeconds(s, settings), 0)
  const canAdd = sections.length < MAX_SECTIONS

  function moveSection(from: number, to: number) {
    onChange((prev) => ({ ...prev, sections: moveItem(prev.sections, from, to) }))
    const section = sections[from]
    if (section) setStatus(`Moved ${sectionLabel(section, from)} to position ${to + 1}.`)
  }

  function movePart(sectionId: string, from: number, to: number) {
    onChange((prev) => updateSection(prev, sectionId, (s) => ({ ...s, parts: moveItem(s.parts, from, to) })))
    setStatus(`Moved part ${from + 1} to position ${to + 1}.`)
  }

  const sectionDrag = useReorder(sections.length, moveSection)
  const partDrag = useReorder(editing?.parts.length ?? 0, (from, to) => {
    if (editing) movePart(editing.id, from, to)
  })

  /** Move by one with Alt+arrows; focus follows the moved cell. */
  function stepSection(index: number, delta: -1 | 1) {
    const to = index + delta
    const section = sections[index]
    if (!section || to < 0 || to >= sections.length) return
    moveSection(index, to)
    focusRequest.current = { id: elId(section.id, 'cell'), select: false }
  }

  function remove(section: Section, index: number) {
    onChange((prev) => {
      const next = { ...prev, sections: prev.sections.filter((s) => s.id !== section.id) }
      return prev.selected?.section === section.id ? selectPart(next, null) : next
    })
    const neighbour = sections[index + 1] ?? sections[index - 1]
    focusRequest.current = { id: neighbour ? elId(neighbour.id, 'cell') : elId('program', 'add'), select: false }
    setStatus(`Deleted ${sectionLabel(section, index)}.`)
  }

  function clearAll() {
    if (sections.length === 0) return
    if (!window.confirm(`Delete all ${plural(sections.length, 'section')} of the program?`)) return
    onChange((prev) => ({ ...prev, sections: [], selected: null }))
    focusRequest.current = { id: elId('program', 'add'), select: false }
    setStatus('Deleted all sections.')
  }

  /** A new section from the rhythm being edited (signature, accents and subdivision from the quick controls), selected. */
  function add() {
    if (!canAdd) return
    const { beatsPerBar, beatUnit, beats, subdivision } = editedPart(settings)
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
        : selectPart(
            { ...prev, sections: [...prev.sections, section] },
            { section: section.id, part: section.parts[0].id },
          ),
    )
    focusRequest.current = { id: elId(section.id, 'name'), select: true }
    setStatus(`Added ${section.name}.`)
  }

  /** Clicking a section selects it (the quick controls then edit it); clicking the selected one selects none. */
  function toggleSelect(section: Section, index: number) {
    const deselect = settings.selected?.section === section.id
    onChange((prev) => {
      const at = prev.sections.findIndex((s) => s.id === section.id)
      if (at < 0) return prev
      return prev.selected?.section === section.id ? selectPart(prev, null) : selectSection(prev, at)
    })
    setStatus(deselect ? 'No section selected: the controls edit the free rhythm.' : `Editing ${sectionLabel(section, index)}.`)
  }

  function deselect() {
    if (editing) focusRequest.current = { id: elId(editing.id, 'cell'), select: false }
    onChange((prev) => selectPart(prev, null))
    setStatus('No section selected: the controls edit the free rhythm.')
  }

  function addPart(section: Section) {
    if (section.parts.length >= MAX_SECTION_PARTS) return
    const base = section.parts[editPartIndex] ?? section.parts[section.parts.length - 1]
    const part = createPart({
      beatsPerBar: base.beatsPerBar,
      beatUnit: base.beatUnit,
      beats: [...base.beats],
      subdivision: base.subdivision,
      bars: 1,
    })
    const at = editPartIndex + 1
    onChange((prev) => {
      const next = updateSection(prev, section.id, (s) =>
        s.parts.length >= MAX_SECTION_PARTS ? s : { ...s, parts: s.parts.toSpliced(Math.min(at, s.parts.length), 0, part) },
      )
      return selectPart(next, { section: section.id, part: part.id })
    })
    focusRequest.current = { id: elId(part.id, 'part'), select: false }
    setStatus(`Added part ${at + 1}: pick its signature above.`)
  }

  function removePart(section: Section, index: number) {
    if (section.parts.length <= 1) return
    const part = section.parts[index]
    onChange((prev) => {
      const next = updateSection(prev, section.id, (s) =>
        s.parts.length <= 1 ? s : { ...s, parts: s.parts.filter((p) => p.id !== part.id) },
      )
      if (prev.selected?.part !== part.id) return next
      const parts = next.sections.find((s) => s.id === section.id)?.parts ?? []
      const neighbour = parts[Math.min(index, parts.length - 1)]
      return neighbour ? selectPart(next, { section: section.id, part: neighbour.id }) : next
    })
    const neighbour = section.parts[index + 1] ?? section.parts[index - 1]
    focusRequest.current = { id: elId(neighbour.id, 'part'), select: false }
    setStatus(`Removed part ${index + 1}.`)
  }

  async function readSongFile(file: File) {
    setImporting(true)
    setImportError('')
    try {
      const song = await importSong(file)
      if (song.sections.length === 0) throw new Error('No bars were found in this file.')
      setImported(song)
      setStatus(`Read ${plural(song.sections.length, 'section')} from ${file.name}. Review them, then accept.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'This file could not be read.'
      setImportError(message)
      setStatus(message)
    } finally {
      setImporting(false)
    }
  }

  /** The reviewed sections become the program of a new preset (named after the file), which is loaded. */
  function acceptImport(name: string, parsed: ParsedSection[]) {
    const sections = toSections(parsed)
    const tempo = sections[0]?.tempo
    const base = tempo != null ? withBpm(settings, tempo) : settings
    const next: Settings = { ...base, sections, selected: null, program: { ...base.program, enabled: true } }
    onChange(() => next)
    presetActions.add({ id: makeId(), name, settings: next, createdAt: Date.now() })
    setImported(null)
    setStatus(`Created the preset "${name}" with ${plural(sections.length, 'section')}.`)
  }

  function stepPart(section: Section, index: number, delta: -1 | 1) {
    const to = index + delta
    if (to < 0 || to >= section.parts.length) return
    movePart(section.id, index, to)
    focusRequest.current = { id: elId(section.parts[index].id, 'part'), select: false }
  }

  const summary = [
    plural(sections.length, 'section'),
    plural(totalBars, 'bar'),
    `about ${formatDuration(totalSeconds)}`,
  ].join(' · ')

  const editLabel = editing ? sectionLabel(editing, editIndex) : ''
  // With nothing selected the editor still shows (disabled), from a placeholder, so selecting causes no jump.
  const shown = editing ?? PLACEHOLDER_SECTION
  const shownPart = shown.parts[editing ? editPartIndex : 0] ?? shown.parts[0]
  const editPlaying = editIndex >= 0 && editIndex === playingIndex
  const playingPart = editPlaying && pulse ? pulse.partIndex : -1

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
            title="Play one bar of the starting section (beats only) before the program starts"
          >
            <Toggle
              size="sm"
              label="Count-in"
              checked={program.countIn}
              onChange={(countIn) => onChange((prev) => ({ ...prev, program: { ...prev.program, countIn } }))}
            />
          </span>
          <span
            className="program-panel__loop"
            title="Cue: beat 1 of every section plays the cue sound, even when the signature stays the same"
          >
            <Toggle
              size="sm"
              label="Cue"
              checked={settings.cue.sectionChange}
              onChange={(sectionChange) => onChange((prev) => ({ ...prev, cue: { ...prev.cue, sectionChange } }))}
            />
          </span>
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
            <Button
              size="sm"
              variant="ghost"
              icon={<UploadIcon size={16} />}
              disabled={importing}
              title="Read sections, signatures and tempos from a MIDI or Guitar Pro file into a new preset"
              onClick={() => fileInput.current?.click()}
            >
              {importing ? 'Reading…' : 'Import'}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept={SONG_FILE_ACCEPT}
              hidden
              onChange={(e) => {
                const file = e.currentTarget.files?.[0]
                // Cleared, so choosing the same file again reads it again.
                e.currentTarget.value = ''
                if (file) void readSongFile(file)
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<TrashIcon size={16} />}
              disabled={sections.length === 0}
              title="Delete every section of the program"
              onClick={clearAll}
            >
              Clear all
            </Button>
          </div>

          {importError !== '' && (
            <p className="program-panel__import-error" role="alert">
              {importError}
            </p>
          )}

          <ol
            className={['program-panel__matrix', sectionDrag.from !== null && 'is-sorting'].filter(Boolean).join(' ')}
            aria-label="Sections (drag to reorder, Alt+arrow keys move the focused one)"
          >
            {sections.map((section, index) => {
              const label = sectionLabel(section, index)
              const isActive = index === editIndex
              const isPlaying = index === playingIndex
              const total = sectionBars(section)
              const bar =
                isPlaying && pulse && pulse.sectionBars !== null && !pulse.countIn ? pulse.sectionBar + 1 : null
              const shown = section.parts.slice(0, CELL_PARTS)
              const meters = shown.map(meterOf).join(' + ') + (section.parts.length > CELL_PARTS ? ' …' : '')
              return (
                <li
                  key={section.id}
                  className={['program-panel__matrix-item', sectionDrag.itemClass(index)].filter(Boolean).join(' ')}
                  {...sectionDrag.itemProps(index)}
                >
                  <button
                    type="button"
                    id={elId(section.id, 'cell')}
                    className={['program-panel__cell', isActive && 'is-active', isPlaying && 'is-playing']
                      .filter(Boolean)
                      .join(' ')}
                    aria-pressed={isActive}
                    aria-current={isPlaying ? 'step' : undefined}
                    aria-label={`${index + 1}. ${label}: ${describeParts(section)}, ${plural(total, 'bar')}${
                      section.tempo !== null ? `, ${section.tempo} BPM` : ''
                    }${isPlaying ? ', playing' : ''}`}
                    title={isActive ? 'Click to stop editing this section' : 'Click to edit, drag to reorder'}
                    onClick={() => {
                      if (!sectionDrag.consumeClick()) toggleSelect(section, index)
                    }}
                    onKeyDown={(e) => {
                      const delta = moveKey(e)
                      if (delta === 0) return
                      e.preventDefault()
                      stepSection(index, delta)
                    }}
                  >
                    <span className="program-panel__cell-line program-panel__cell-line--head" aria-hidden="true">
                      <span className="program-panel__index tabular">{index + 1}</span>
                      <span className="program-panel__cell-name">{label}</span>
                    </span>
                    {sections.length > 1 && <GripIcon size={14} className="program-panel__grip" />}
                    <span className="program-panel__cell-line" aria-hidden="true">
                      <span
                        className={`program-panel__cell-meter tabular${section.parts.length > 1 ? ' is-multi' : ''}`}
                      >
                        {meters}
                      </span>
                    </span>
                    <span className="program-panel__cell-info tabular" aria-hidden="true">
                      {section.repeats > 1 && (
                        <span className="program-panel__repeat tabular">×{section.repeats}</span>
                      )}
                      {isPlaying && pulse?.countIn ? 'count-in' : bar !== null ? `bar ${bar}/${total}` : plural(total, 'bar')}
                      {section.tempo !== null && ` @${section.tempo}`}
                    </span>
                    <span className="program-panel__cell-beats" aria-hidden="true">
                      {shown.map((part, p) => (
                        <span
                          key={part.id}
                          className={`program-panel__cell-part${isPlaying && pulse?.partIndex === p ? ' is-playing' : ''}`}
                        >
                          {part.beats.map((level, i) => (
                            <span key={i} className={`program-panel__beat program-panel__beat--${level}`} />
                          ))}
                        </span>
                      ))}
                    </span>
                    {bar !== null && (
                      <span className="program-panel__cell-progress" aria-hidden="true">
                        <span style={{ '--progress': bar / total } as CSSProperties} />
                      </span>
                    )}
                  </button>
                  {/* A sibling of the cell (a button cannot hold another button), laid over its corner. */}
                  <button
                    type="button"
                    className="program-panel__cell-delete"
                    aria-label={`Delete ${label}`}
                    title={`Delete ${label}`}
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
                id={elId('program', 'add')}
                className="program-panel__cell program-panel__cell--add"
                disabled={!canAdd}
                title="Add a section with the rhythm set above"
                onClick={add}
              >
                <PlusIcon size={16} />
                {canAdd ? 'Add' : `Max ${MAX_SECTIONS}`}
              </button>
            </li>
          </ol>

          <div
            key={shown.id}
            className={['program-panel__section', editPlaying && 'is-playing', !editing && 'is-disabled']
              .filter(Boolean)
              .join(' ')}
            // Nothing selected: the same controls, greyed out and out of reach, so selecting moves nothing.
            inert={!editing}
            aria-disabled={!editing || undefined}
          >
            <div role="group" aria-labelledby={elId(shown.id, 'heading')} className="program-panel__group">
              <h3 id={elId(shown.id, 'heading')} className="sr-only">
                {editing
                  ? `Edit section ${editIndex + 1}: ${editLabel}${editPlaying ? ', playing' : ''}`
                  : 'No section selected'}
              </h3>
              <div className="program-panel__editor">
                <span className="program-panel__index tabular" aria-hidden="true">
                  {editing ? editIndex + 1 : '–'}
                </span>
                <label className="sr-only" htmlFor={elId(shown.id, 'name')}>
                  {`Section ${editIndex + 1} name`}
                </label>
                <input
                  id={elId(shown.id, 'name')}
                  className="program-panel__name"
                  type="text"
                  value={shown.name}
                  placeholder={editing ? `Section ${editIndex + 1}` : 'No section selected'}
                  maxLength={NAME_MAX_LENGTH}
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  onChange={(e) => {
                    const name = e.currentTarget.value
                    onChange((prev) => updateSection(prev, shown.id, (s) => ({ ...s, name })))
                  }}
                />
                <span className="program-panel__repeats" title="Times the parts are played through">
                  <span className="program-panel__field-label" aria-hidden="true">
                    Repeat
                  </span>
                  <Stepper
                    label={`Section ${editIndex + 1} repeats`}
                    hideLabel
                    size="sm"
                    suffix="×"
                    value={shown.repeats}
                    min={1}
                    max={MAX_SECTION_REPEATS}
                    onChange={(repeats) => onChange((prev) => updateSection(prev, shown.id, (s) => ({ ...s, repeats })))}
                  />
                </span>
                <span
                  className="program-panel__tempo"
                  title={shown.tempo !== null ? undefined : `Uses the main tempo (${settings.bpm} BPM)`}
                >
                  <Toggle
                    size="sm"
                    label="Tempo"
                    checked={shown.tempo !== null}
                    onChange={(on) =>
                      onChange((prev) =>
                        updateSection(prev, shown.id, (s) => ({ ...s, tempo: on ? clampBpm(prev.bpm) : null })),
                      )
                    }
                  />
                  {/* Always there (greyed out with the main tempo when off), so switching it on moves nothing. */}
                  <Stepper
                    hideLabel
                    size="sm"
                    label={`Section ${editIndex + 1} tempo`}
                    suffix="BPM"
                    value={shown.tempo ?? clampBpm(settings.bpm)}
                    min={MIN_BPM}
                    max={MAX_BPM}
                    disabled={shown.tempo === null}
                    onChange={(tempo) => onChange((prev) => updateSection(prev, shown.id, (s) => ({ ...s, tempo })))}
                  />
                </span>
                <span className="program-panel__actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<CheckIcon size={16} />}
                    title="Stop shown this section: the controls above go back to the free rhythm"
                    onClick={deselect}
                  >
                    Done
                  </Button>
                </span>
              </div>

              <div className="program-panel__parts-row">
                <span className="program-panel__field-label" aria-hidden="true">
                  Parts
                </span>
                <ol
                  className={['program-panel__parts', partDrag.from !== null && 'is-sorting'].filter(Boolean).join(' ')}
                  aria-label={`Parts of ${editLabel}, played in order (drag to reorder)`}
                >
                  {shown.parts.map((part, index) => {
                    const isSelected = index === editPartIndex
                    const isPlaying = index === playingPart
                    return (
                      <li
                        key={part.id}
                        className={['program-panel__part-item', partDrag.itemClass(index)].filter(Boolean).join(' ')}
                        {...partDrag.itemProps(index)}
                      >
                        <button
                          type="button"
                          id={elId(part.id, 'part')}
                          className={['program-panel__part', isSelected && 'is-active', isPlaying && 'is-playing']
                            .filter(Boolean)
                            .join(' ')}
                          aria-pressed={isSelected}
                          aria-label={`Part ${index + 1}: ${plural(part.bars, 'bar')} of ${meterOf(part)}${isPlaying ? ', playing' : ''}`}
                          title={shown.parts.length > 1 ? 'Click to edit, drag to reorder' : undefined}
                          onClick={() => {
                            if (partDrag.consumeClick()) return
                            onChange((prev) => selectPart(prev, { section: shown.id, part: part.id }))
                          }}
                          onKeyDown={(e) => {
                            const delta = moveKey(e)
                            if (delta === 0) return
                            e.preventDefault()
                            stepPart(shown, index, delta)
                          }}
                        >
                          <span className="program-panel__part-meter tabular">{meterOf(part)}</span>
                          <span className="program-panel__part-bars tabular">×{part.bars}</span>
                        </button>
                        {shown.parts.length > 1 && (
                          <button
                            type="button"
                            className="program-panel__part-delete"
                            aria-label={`Remove part ${index + 1}`}
                            title={`Remove part ${index + 1}`}
                            onClick={() => removePart(shown, index)}
                          >
                            <XIcon size={10} />
                          </button>
                        )}
                      </li>
                    )
                  })}
                  <li className="program-panel__part-item">
                    <button
                      type="button"
                      className="program-panel__part program-panel__part--add"
                      disabled={shown.parts.length >= MAX_SECTION_PARTS}
                      title={
                        shown.parts.length >= MAX_SECTION_PARTS
                          ? `A section has at most ${MAX_SECTION_PARTS} parts`
                          : 'Add a part after the selected one (e.g. a bar in another signature)'
                      }
                      onClick={() => addPart(shown)}
                    >
                      <PlusIcon size={14} />
                      Part
                    </button>
                  </li>
                </ol>
                <Stepper
                  label={`Part ${editPartIndex + 1} bars`}
                  hideLabel
                  size="sm"
                  suffix={shownPart.bars === 1 ? 'bar' : 'bars'}
                  value={shownPart.bars}
                  min={1}
                  max={MAX_SECTION_BARS}
                  onChange={(bars) =>
                    onChange((prev) =>
                      updateSection(prev, shown.id, (s) => ({
                        ...s,
                        parts: s.parts.map((p) => (p.id === shownPart.id ? { ...p, bars } : p)),
                      })),
                    )
                  }
                />
              </div>
            </div>
          </div>
        </>
      )}
      <p role="status" className="sr-only">
        {status}
      </p>
      {imported !== null && (
        <ImportPreview song={imported} bpm={settings.bpm} onAccept={acceptImport} onCancel={() => setImported(null)} />
      )}
    </Panel>
  )
}
