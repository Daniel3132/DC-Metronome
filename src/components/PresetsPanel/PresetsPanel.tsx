import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { STORAGE_KEYS } from '../../core/constants'
import { makeId, sanitizeSettings } from '../../core/settings'
import type { Settings } from '../../core/types'
import { FACTORY_PRESETS, type FactoryPreset } from '../../state/factoryPresets'
import { loadPresets, savePresets, type Preset } from '../../state/storage'
import { CheckIcon, DownloadIcon, EditIcon, SaveIcon, TrashIcon, UploadIcon, XIcon } from '../icons/icons'
import type { PanelProps } from '../panelTypes'
import { Button, IconButton, Panel } from '../ui/ui'
import './PresetsPanel.css'

const NAME_MAX_LENGTH = 60
const MAX_IMPORT_BYTES = 2 * 1024 * 1024
const EXPORT_FORMAT = 'dc-metronome-presets'

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

type StatusArea = 'save' | 'list' | 'factory'

interface Status {
  area: StatusArea
  text: string
  tone: 'success' | 'danger'
}

interface Confirming {
  id: string
  action: 'delete' | 'overwrite'
}

interface Renaming {
  id: string
  name: string
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describeSettings(s: Settings): string {
  const section = s.current
  const parts = [
    s.practice.enabled ? `${s.practice.startBpm} → ${s.practice.targetBpm} BPM` : `${s.bpm} BPM`,
    s.program.enabled ? plural(s.sections.length, 'section') : `${section.beatsPerBar}/${section.beatUnit}`,
  ]
  if (s.tempoPercent !== 100) parts.push(`${s.tempoPercent} %`)
  if (s.gap.enabled) parts.push(`gap ${s.gap.playBars}:${s.gap.muteBars}`)
  if (s.randomMute.enabled) parts.push(`random mute ${s.randomMute.percent} %`)
  if (s.voice.enabled) parts.push('voice')
  return parts.join(' · ')
}

function suggestedName(s: Settings): string {
  const section = s.current
  return s.program.enabled
    ? `Program, ${plural(s.sections.length, 'section')}`
    : `${s.bpm} BPM ${section.beatsPerBar}/${section.beatUnit}`
}

/** Accepts our export format, a bare preset array, or a single preset object. */
function presetItems(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data
  if (isRecord(data) && Array.isArray(data.presets)) return data.presets
  if (isRecord(data) && isRecord(data.settings)) return [data]
  return null
}

export function PresetsPanel({ settings, onChange }: PanelProps) {
  const uid = useId()
  const [presets, setPresets] = useState<Preset[]>(loadPresets)
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  const [confirming, setConfirming] = useState<Confirming | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // Rows re-render into different controls (rename form, confirm bar); the handler names what gets focus next.
  const focusRequest = useRef<string | null>(null)

  useEffect(() => {
    const id = focusRequest.current
    if (id === null) return
    focusRequest.current = null
    document.getElementById(id)?.focus()
  })

  // Another tab saved presets: show them here too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.presets) setPresets(loadPresets())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const elId = (presetId: string, part: string) => `${uid}-${presetId}-${part}`
  const saveInputId = `${uid}-save-name`
  const placeholder = suggestedName(settings)

  function commit(next: Preset[]) {
    setPresets(next)
    savePresets(next)
  }

  function report(area: StatusArea, text: string, tone: Status['tone'] = 'success') {
    setStatus({ area, text, tone })
  }

  function saveCurrent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const presetName = name.trim() || placeholder
    commit([{ id: makeId(), name: presetName, settings, createdAt: Date.now() }, ...presets])
    setName('')
    report('save', `Saved "${presetName}".`)
  }

  function load(preset: Preset) {
    // Volumes belong to the room and the headphones, not to the exercise.
    onChange((prev) => ({ ...sanitizeSettings(preset.settings), mixer: prev.mixer }))
    report('list', `Loaded "${preset.name}".`)
  }

  function loadFactory(preset: FactoryPreset) {
    const built = preset.build()
    onChange((prev) => ({
      ...built,
      mixer: prev.mixer,
      sounds: prev.sounds,
      voice: { ...built.voice, pack: prev.voice.pack },
      visual: prev.visual,
    }))
    report('factory', `Loaded "${preset.name}".`)
  }

  function startRename(preset: Preset) {
    setConfirming(null)
    setRenaming({ id: preset.id, name: preset.name })
    focusRequest.current = elId(preset.id, 'rename-input')
  }

  function finishRename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!renaming) return
    const trimmed = renaming.name.trim()
    if (trimmed) commit(presets.map((p) => (p.id === renaming.id ? { ...p, name: trimmed } : p)))
    focusRequest.current = elId(renaming.id, 'rename')
    setRenaming(null)
  }

  function cancelRename() {
    if (renaming) focusRequest.current = elId(renaming.id, 'rename')
    setRenaming(null)
  }

  function askConfirm(preset: Preset, action: Confirming['action']) {
    setRenaming(null)
    setConfirming({ id: preset.id, action })
    focusRequest.current = elId(preset.id, 'confirm-cancel')
  }

  function cancelConfirm() {
    if (confirming) focusRequest.current = elId(confirming.id, confirming.action)
    setConfirming(null)
  }

  function confirmAction(preset: Preset, index: number) {
    if (!confirming) return
    if (confirming.action === 'delete') {
      commit(presets.filter((p) => p.id !== preset.id))
      const neighbour = presets[index + 1] ?? presets[index - 1]
      focusRequest.current = neighbour ? elId(neighbour.id, 'load') : saveInputId
      report('list', `Deleted "${preset.name}".`)
    } else {
      commit(presets.map((p) => (p.id === preset.id ? { ...p, settings, createdAt: Date.now() } : p)))
      focusRequest.current = elId(preset.id, 'load')
      report('list', `Updated "${preset.name}" with the current settings.`)
    }
    setConfirming(null)
  }

  function onConfirmKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancelConfirm()
    }
  }

  function exportPresets() {
    const data = { format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), presets }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `dc-metronome-presets-${new Date().toISOString().slice(0, 10)}.json`
    document.body.append(link)
    link.click()
    link.remove()
    // Some browsers start reading the blob after click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    report('list', `Exported ${plural(presets.length, 'preset')}.`)
  }

  async function importPresets(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const file = input.files?.[0]
    // Clear it so picking the same file again still fires change.
    input.value = ''
    if (!file) return
    if (file.size > MAX_IMPORT_BYTES) {
      report('list', 'That file is too large to be a preset export.', 'danger')
      return
    }

    let data: unknown
    try {
      data = JSON.parse(await file.text())
    } catch {
      report('list', 'That file is not valid JSON.', 'danger')
      return
    }
    const items = presetItems(data)
    if (!items || items.length === 0) {
      report('list', 'No presets found in that file.', 'danger')
      return
    }

    const usedIds = new Set(presets.map((p) => p.id))
    const imported: Preset[] = []
    for (const item of items) {
      if (!isRecord(item) || !isRecord(item.settings)) continue
      const id = typeof item.id === 'string' && item.id !== '' && !usedIds.has(item.id) ? item.id : makeId()
      usedIds.add(id)
      const itemName = typeof item.name === 'string' ? item.name.trim().slice(0, NAME_MAX_LENGTH) : ''
      const createdAt =
        typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : Date.now()
      imported.push({ id, name: itemName || 'Imported preset', settings: sanitizeSettings(item.settings), createdAt })
    }

    const skipped = items.length - imported.length
    if (imported.length === 0) {
      report('list', `No valid presets found (skipped ${skipped}).`, 'danger')
      return
    }
    commit([...imported, ...presets])
    report(
      'list',
      `Imported ${plural(imported.length, 'preset')}${skipped > 0 ? `, skipped ${skipped} invalid` : ''}.`,
    )
  }

  // The live region below announces; this is the visible copy next to the control that was used.
  const statusFor = (area: StatusArea) =>
    status?.area === area && (
      <p
        className={`presets-panel__status${status.tone === 'danger' ? ' presets-panel__status--danger' : ''}`}
        aria-hidden="true"
      >
        {status.text}
      </p>
    )

  return (
    <div className="presets-panel">
      <Panel
        title="Save preset"
        description="Save everything you set up (tempo, sections, trainers, sounds) to come back to it later."
      >
        <form className="presets-panel__save" onSubmit={saveCurrent}>
          <label htmlFor={saveInputId} className="ui-field-label">
            Preset name
          </label>
          <div className="presets-panel__save-row">
            <input
              id={saveInputId}
              className="presets-panel__input"
              type="text"
              value={name}
              placeholder={placeholder}
              maxLength={NAME_MAX_LENGTH}
              autoComplete="off"
              enterKeyHint="done"
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <Button type="submit" variant="primary" icon={<SaveIcon />}>
              Save
            </Button>
          </div>
          {statusFor('save')}
        </form>
      </Panel>

      <Panel title="Your presets" description="Loading a preset replaces your current setup but keeps your volumes.">
        {presets.length === 0 ? (
          <p className="presets-panel__empty">No saved presets yet. Save one above or import a file.</p>
        ) : (
          <ul className="presets-panel__list">
            {presets.map((preset, index) => {
              const isRenaming = renaming?.id === preset.id
              const confirm = confirming?.id === preset.id ? confirming.action : null
              return (
                <li key={preset.id} className="presets-panel__item">
                  {isRenaming ? (
                    <form className="presets-panel__rename" onSubmit={finishRename}>
                      <label className="sr-only" htmlFor={elId(preset.id, 'rename-input')}>
                        {`New name for ${preset.name}`}
                      </label>
                      <input
                        id={elId(preset.id, 'rename-input')}
                        className="presets-panel__input"
                        type="text"
                        value={renaming.name}
                        maxLength={NAME_MAX_LENGTH}
                        autoComplete="off"
                        enterKeyHint="done"
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => {
                          const value = e.currentTarget.value
                          setRenaming((prev) => prev && { ...prev, name: value })
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelRename()
                          }
                        }}
                      />
                      <IconButton type="submit" size="sm" variant="primary" label="Save name" icon={<CheckIcon size={18} />} />
                      <IconButton size="sm" label="Cancel renaming" icon={<XIcon size={18} />} onClick={cancelRename} />
                    </form>
                  ) : (
                    <div className="presets-panel__row">
                      <div className="presets-panel__info">
                        <span className="presets-panel__name">{preset.name}</span>
                        <span className="presets-panel__meta tabular">
                          {describeSettings(preset.settings)}
                          {preset.createdAt > 0 && ` · ${DATE_FORMAT.format(preset.createdAt)}`}
                        </span>
                      </div>
                      <div className="presets-panel__actions">
                        <Button
                          id={elId(preset.id, 'load')}
                          size="sm"
                          aria-label={`Load ${preset.name}`}
                          onClick={() => load(preset)}
                        >
                          Load
                        </Button>
                        <IconButton
                          id={elId(preset.id, 'rename')}
                          size="sm"
                          label={`Rename ${preset.name}`}
                          icon={<EditIcon size={18} />}
                          onClick={() => startRename(preset)}
                        />
                        <IconButton
                          id={elId(preset.id, 'overwrite')}
                          size="sm"
                          label={`Overwrite ${preset.name} with the current settings`}
                          icon={<SaveIcon size={18} />}
                          aria-expanded={confirm === 'overwrite'}
                          onClick={() => askConfirm(preset, 'overwrite')}
                        />
                        <IconButton
                          id={elId(preset.id, 'delete')}
                          size="sm"
                          label={`Delete ${preset.name}`}
                          icon={<TrashIcon size={18} />}
                          aria-expanded={confirm === 'delete'}
                          onClick={() => askConfirm(preset, 'delete')}
                        />
                      </div>
                    </div>
                  )}

                  {confirm && (
                    <div
                      className="presets-panel__confirm"
                      role="group"
                      aria-labelledby={elId(preset.id, 'confirm-text')}
                      onKeyDown={onConfirmKeyDown}
                    >
                      <p id={elId(preset.id, 'confirm-text')} className="presets-panel__confirm-text">
                        {confirm === 'delete'
                          ? `Delete "${preset.name}"? This cannot be undone.`
                          : `Replace "${preset.name}" with the current settings?`}
                      </p>
                      <div className="presets-panel__confirm-actions">
                        <Button size="sm" variant="danger" onClick={() => confirmAction(preset, index)}>
                          {confirm === 'delete' ? 'Delete' : 'Overwrite'}
                        </Button>
                        <Button id={elId(preset.id, 'confirm-cancel')} size="sm" variant="ghost" onClick={cancelConfirm}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="presets-panel__files">
          <div className="presets-panel__file-buttons">
            <Button size="sm" icon={<DownloadIcon size={16} />} disabled={presets.length === 0} onClick={exportPresets}>
              Export
            </Button>
            <Button size="sm" icon={<UploadIcon size={16} />} onClick={() => fileInput.current?.click()}>
              Import
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => void importPresets(e)}
            />
          </div>
          {statusFor('list')}
        </div>
      </Panel>

      <Panel
        title="Factory presets"
        description="Ready-made starting points. They keep your sounds, voice pack and volumes."
      >
        <ul className="presets-panel__list">
          {FACTORY_PRESETS.map((preset) => (
            <li key={preset.id} className="presets-panel__item">
              <div className="presets-panel__row">
                <div className="presets-panel__info">
                  <span className="presets-panel__name">{preset.name}</span>
                  <span className="presets-panel__meta">{preset.description}</span>
                </div>
                <div className="presets-panel__actions">
                  <Button size="sm" aria-label={`Load ${preset.name}`} onClick={() => loadFactory(preset)}>
                    Load
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {statusFor('factory')}
      </Panel>

      <p role="status" className="sr-only">
        {status?.text ?? ''}
      </p>
    </div>
  )
}
