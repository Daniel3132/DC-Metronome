import { useEffect, useId, useRef, useState } from 'react'
import { MAX_BPM, MAX_SECTION_REPEATS, MIN_BPM } from '../../core/constants'
import type { ImportedSong } from '../../core/import/importSong'
import type { ParsedSection } from '../../core/programText'
import { beatSeconds, clampBpm } from '../../core/settings'
import { CheckIcon, TrashIcon, XIcon } from '../icons/icons'
import { Button, IconButton, Stepper } from '../ui/ui'
import './ImportPreview.css'

const NAME_MAX_LENGTH = 40
const PRESET_NAME_MAX_LENGTH = 60

interface ImportPreviewProps {
  song: ImportedSong
  /** Tempo for sections without one (all imported sections have one, but the user cannot remove it here). */
  bpm: number
  onAccept: (presetName: string, sections: ParsedSection[]) => void
  onCancel: () => void
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function sectionBars(section: ParsedSection): number {
  return section.repeats * section.parts.reduce((sum, p) => sum + p.bars, 0)
}

function sectionSeconds(section: ParsedSection, bpm: number): number {
  const tempo = section.tempo ?? bpm
  return section.repeats * section.parts.reduce((sum, p) => sum + p.bars * p.beatsPerBar * beatSeconds(tempo, p.beatUnit), 0)
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** "4/4 ×8 + 7/8 + 4/4 ×2" */
function describeParts(section: ParsedSection): string {
  return section.parts.map((p) => `${p.beatsPerBar}/${p.beatUnit}${p.bars > 1 ? ` ×${p.bars}` : ''}`).join(' + ')
}

/**
 * The sections read from a song file, in a modal dialog: rename, retime or drop them and name the preset, then
 * Accept creates the preset (and loads it); Cancel or Escape changes nothing.
 */
export function ImportPreview({ song, bpm, onAccept, onCancel }: ImportPreviewProps) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(song.name.slice(0, PRESET_NAME_MAX_LENGTH))
  const [sections, setSections] = useState<ParsedSection[]>(song.sections)

  // No cleanup: unmounting removes the dialog from the top layer, and closing it there would fire onClose (a cancel),
  // which StrictMode's effect re-run in development would turn into an immediate cancel.
  useEffect(() => {
    const el = dialog.current
    if (el && !el.open) el.showModal()
  }, [])

  const update = (index: number, patch: Partial<ParsedSection>) =>
    setSections((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  const bars = sections.reduce((sum, s) => sum + sectionBars(s), 0)
  const seconds = sections.reduce((sum, s) => sum + sectionSeconds(s, bpm), 0)
  const trimmedName = name.trim()
  const canAccept = sections.length > 0 && trimmedName !== ''

  return (
    <dialog
      ref={dialog}
      className="import-preview"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-summary`}
      // Escape (the 'cancel' event) closes the dialog: that is a cancel too.
      onClose={onCancel}
    >
      <form
        className="import-preview__form"
        onSubmit={(e) => {
          e.preventDefault()
          if (canAccept) onAccept(trimmedName, sections)
        }}
      >
        <header className="import-preview__header">
          <h2 id={`${id}-title`} className="import-preview__title">
            Import song
          </h2>
          <IconButton size="sm" variant="ghost" label="Cancel the import" icon={<XIcon size={18} />} onClick={onCancel} />
        </header>

        <label className="import-preview__field" htmlFor={`${id}-name`}>
          <span className="import-preview__label">Preset name</span>
          <input
            id={`${id}-name`}
            className="import-preview__input"
            type="text"
            value={name}
            maxLength={PRESET_NAME_MAX_LENGTH}
            autoComplete="off"
            spellCheck={false}
            required
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </label>

        <p id={`${id}-summary`} className="import-preview__summary tabular">
          {plural(sections.length, 'section')} · {plural(bars, 'bar')} · about {formatDuration(seconds)}
        </p>

        {song.warnings.length > 0 && (
          <ul className="import-preview__warnings">
            {song.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}

        <ol className="import-preview__sections" aria-label="Sections">
          {sections.map((section, index) => (
            // Sections are only edited and removed here, never reordered, so the index is a stable key.
            <li key={index} className="import-preview__section">
              <span className="import-preview__index tabular" aria-hidden="true">
                {index + 1}
              </span>
              <div className="import-preview__main">
                <input
                  className="import-preview__input import-preview__section-name"
                  type="text"
                  aria-label={`Section ${index + 1} name`}
                  value={section.name}
                  placeholder={`Section ${index + 1}`}
                  maxLength={NAME_MAX_LENGTH}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => update(index, { name: e.currentTarget.value })}
                />
                <span className="import-preview__parts tabular" title={describeParts(section)}>
                  {describeParts(section)}
                </span>
              </div>
              <Stepper
                label={`Section ${index + 1} tempo`}
                hideLabel
                size="sm"
                suffix="BPM"
                value={section.tempo ?? clampBpm(bpm)}
                min={MIN_BPM}
                max={MAX_BPM}
                onChange={(tempo) => update(index, { tempo })}
              />
              <Stepper
                label={`Section ${index + 1} repeats`}
                hideLabel
                size="sm"
                suffix="×"
                value={section.repeats}
                min={1}
                max={MAX_SECTION_REPEATS}
                onChange={(repeats) => update(index, { repeats })}
              />
              <IconButton
                size="sm"
                variant="ghost"
                label={`Remove section ${index + 1}`}
                icon={<TrashIcon size={16} />}
                onClick={() => setSections((prev) => prev.filter((_, i) => i !== index))}
              />
            </li>
          ))}
        </ol>

        <footer className="import-preview__footer">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            icon={<CheckIcon size={16} />}
            disabled={!canAccept}
            title="Save these sections as a new preset and load it"
          >
            Accept
          </Button>
        </footer>
      </form>
    </dialog>
  )
}
