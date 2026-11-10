import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { CustomSoundMeta } from '../../audio/customSounds'
import {
  BUILT_IN_SOUNDS,
  CUSTOM_SOUND_PREFIX,
  MAX_CUSTOM_SOUND_BYTES,
  MAX_CUSTOM_SOUND_SECONDS,
  SOUND_ROLES,
} from '../../core/constants'
import type { BuiltInSoundId, SoundId, SoundRole, SoundSettings } from '../../core/types'
import { useCustomSounds } from '../../state/useCustomSounds'
import { CheckIcon, PlayIcon, SpeakerIcon, TrashIcon, UploadIcon, XIcon } from '../icons/icons'
import type { PanelProps } from '../panelTypes'
import { Badge, Button, IconButton, Panel, Select, type SelectOption } from '../ui/ui'
import './SoundPanel.css'

const ROLES = SOUND_ROLES
const ALL_ROLES: readonly SoundRole[] = SOUND_ROLES.map((r) => r.role)

type UseTarget = SoundRole | 'all'
const USE_TARGETS: readonly { target: UseTarget; label: string; title: string }[] = [
  { target: 'accent', label: 'Accent', title: 'Use for accented beats' },
  { target: 'medium', label: 'Sub-acc.', title: 'Use for sub-accents (the first beat of later groups, e.g. beat 4 of 3+3)' },
  { target: 'beat', label: 'Beat', title: 'Use for the other beats' },
  { target: 'sub', label: 'Sub', title: 'Use for subdivisions' },
  { target: 'all', label: 'All', title: 'Use for every click' },
]

const DEFAULT_SOUND: BuiltInSoundId = 'click'
const KIT_PREVIEW_GAP_MS = 250
const MAX_NAME_LENGTH = 60
const MAX_MB = Math.round(MAX_CUSTOM_SOUND_BYTES / (1024 * 1024))

const BUILT_IN_OPTIONS: SelectOption<SoundId>[] = BUILT_IN_SOUNDS.map((s) => ({
  value: s.id,
  label: s.label,
  group: 'Built-in',
}))

function customSoundId(id: string): SoundId {
  return `${CUSTOM_SOUND_PREFIX}${id}` as SoundId
}

function customIdOf(sound: SoundId): string | null {
  return sound.startsWith(CUSTOM_SOUND_PREFIX) ? sound.slice(CUSTOM_SOUND_PREFIX.length) : null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(seconds: number): string {
  return `${seconds < 1 ? seconds.toFixed(2) : seconds.toFixed(1)} s`
}

function hasFiles(transfer: DataTransfer): boolean {
  return Array.from(transfer.types).includes('Files')
}

// Auditioning is best-effort: a failed preview must never surface as an unhandled rejection.
function quietly(play: () => Promise<void>): void {
  try {
    play().catch(() => {})
  } catch {
    // Same as above, for an engine that throws synchronously.
  }
}

/** Which roles use `id`, as display text ("Accent, Beat" / "every click"), or null when unused. */
function usageText(sounds: SoundSettings, id: SoundId): string | null {
  const roles = ROLES.filter(({ role }) => sounds[role] === id)
  if (roles.length === 0) return null
  if (roles.length === ROLES.length) return 'every click'
  return roles.map((r) => r.label).join(', ')
}

export function SoundPanel({ settings, onChange, metronome }: PanelProps) {
  // remove() never throws; onDeleted firing is the only sign that a delete succeeded.
  const lastDeleted = useRef<string | null>(null)
  const custom = useCustomSounds((id) => {
    lastDeleted.current = id
    // A deleted sound must not linger in settings; fall back to the default click.
    const deleted = customSoundId(id)
    onChange((prev) => {
      if (!ALL_ROLES.some((role) => prev.sounds[role] === deleted)) return prev
      const sounds = { ...prev.sounds }
      for (const role of ALL_ROLES) if (sounds[role] === deleted) sounds[role] = DEFAULT_SOUND
      return { ...prev, sounds }
    })
  })
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState('')
  const kitTimer = useRef<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadButton = useRef<HTMLButtonElement>(null)
  const kitGroupName = useId()

  useEffect(
    () => () => {
      if (kitTimer.current !== null) clearTimeout(kitTimer.current)
    },
    [],
  )

  const { sounds } = settings
  const uniform = ALL_ROLES.every((role) => sounds[role] === sounds.accent) ? sounds.accent : null

  function nameOf(id: SoundId): string {
    const customId = customIdOf(id)
    if (customId === null) return BUILT_IN_SOUNDS.find((s) => s.id === id)?.label ?? id
    const sound = custom.sounds.find((s) => s.id === customId)
    if (sound) return sound.name
    return custom.loading ? 'Loading…' : 'Missing sound'
  }

  function isMissing(id: SoundId): boolean {
    const customId = customIdOf(id)
    return customId !== null && !custom.loading && !custom.sounds.some((s) => s.id === customId)
  }

  function optionsFor(value: SoundId): SelectOption<SoundId>[] {
    const options = [...BUILT_IN_OPTIONS]
    const customOptions = custom.sounds.map((s) => ({ value: customSoundId(s.id), label: s.name, group: 'Your sounds' }))
    // The select must contain its value; a sound that is gone (or not listed yet) shows as a disabled entry.
    if (customIdOf(value) !== null && !customOptions.some((o) => o.value === value)) {
      options.unshift({ value, label: nameOf(value), disabled: true })
    }
    return [...options, ...customOptions]
  }

  function setRole(role: SoundRole, id: SoundId) {
    onChange((prev) => (prev.sounds[role] === id ? prev : { ...prev, sounds: { ...prev.sounds, [role]: id } }))
  }

  function chooseKit(id: BuiltInSoundId) {
    onChange((prev) => ({ ...prev, sounds: { accent: id, medium: id, beat: id, sub: id } }))
    previewKit(id)
  }

  function previewKit(id: BuiltInSoundId) {
    if (kitTimer.current !== null) clearTimeout(kitTimer.current)
    quietly(() => metronome.previewSound(id, 'accent'))
    kitTimer.current = window.setTimeout(() => {
      kitTimer.current = null
      quietly(() => metronome.previewSound(id, 'beat'))
    }, KIT_PREVIEW_GAP_MS)
  }

  /** Toggle: assigns the sound to the target roles, or puts them back to the default click if they all use it. */
  function toggleUse(id: SoundId, target: UseTarget) {
    const roles = target === 'all' ? ALL_ROLES : [target]
    onChange((prev) => {
      const using = roles.every((role) => prev.sounds[role] === id)
      const next = { ...prev.sounds }
      for (const role of roles) next[role] = using ? DEFAULT_SOUND : id
      return { ...prev, sounds: next }
    })
  }

  async function upload(files: File[]) {
    if (files.length === 0 || uploading) return
    setUploading(true)
    setStatus('')
    const added: CustomSoundMeta[] = []
    try {
      for (const file of files) {
        const meta = await custom.add(file)
        if (meta) added.push(meta)
      }
    } finally {
      setUploading(false)
    }
    const failed = files.length - added.length
    const parts: string[] = []
    if (added.length === 1) parts.push(`Added “${added[0].name}”. Choose where to use it below.`)
    else if (added.length > 1) parts.push(`Added ${added.length} sounds.`)
    // With several files only the last failure keeps its reason in the error box, so count the others here.
    if (failed > 0 && files.length > 1) parts.push(`${failed} of ${files.length} files could not be added.`)
    setStatus(parts.join(' '))
  }

  function onFilesPicked(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files ?? [])
    // Reset so picking the same file again still fires a change.
    e.currentTarget.value = ''
    void upload(files)
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!hasFiles(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = uploading ? 'none' : 'copy'
    if (!dragging) setDragging(true)
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDragging(false)
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    if (!hasFiles(e.dataTransfer)) return
    // Without preventDefault the browser would navigate away to open the file.
    e.preventDefault()
    setDragging(false)
    void upload(Array.from(e.dataTransfer.files))
  }

  async function deleteSound(sound: CustomSoundMeta) {
    lastDeleted.current = null
    await custom.remove(sound.id)
    // On failure the row stays and the error box explains why.
    if (lastDeleted.current !== sound.id) return
    setStatus(`Deleted “${sound.name}”.`)
    // The row (and the focused confirm button) is gone; land somewhere sensible.
    uploadButton.current?.focus()
  }

  return (
    <div
      className={dragging ? 'sound-panel is-dragging' : 'sound-panel'}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Panel
        title="Sound kit"
        description="One sound for every click. Pick one to hear it."
        headerAction={
          uniform === null ? (
            <Badge title="Accent, beat and subdivision use different sounds">Mixed</Badge>
          ) : (
            <Badge tone="accent">{nameOf(uniform)}</Badge>
          )
        }
      >
        <fieldset className="sound-panel__kits">
          <legend className="sr-only">Built-in sounds</legend>
          {BUILT_IN_SOUNDS.map((sound) => {
            const active = uniform === sound.id
            return (
              <label key={sound.id} className="sound-panel__kit">
                <input
                  type="radio"
                  name={kitGroupName}
                  className="sound-panel__kit-input"
                  checked={active}
                  onChange={() => chooseKit(sound.id)}
                  // A click on the kit already in use fires no change; let it replay the preview.
                  onClick={() => {
                    if (active) previewKit(sound.id)
                  }}
                />
                <span className="sound-panel__kit-face">
                  <span className="sound-panel__kit-name">{sound.label}</span>
                  {active ? (
                    <CheckIcon size={18} className="sound-panel__kit-icon" />
                  ) : (
                    <PlayIcon size={14} className="sound-panel__kit-icon" />
                  )}
                </span>
              </label>
            )
          })}
        </fieldset>
      </Panel>

      <Panel
        title="Sound per role"
        description="Accent plays on accented beats, Beat on the other beats, Subdivision between beats."
      >
        <div className="sound-panel__roles">
          {ROLES.map(({ role, label }) => {
            const value = sounds[role]
            return (
              <div key={role} className="sound-panel__role">
                <Select<SoundId>
                  className="sound-panel__role-select"
                  label={label}
                  value={value}
                  options={optionsFor(value)}
                  onChange={(id) => {
                    setRole(role, id)
                    quietly(() => metronome.previewSound(id, role))
                  }}
                />
                <IconButton
                  variant="secondary"
                  label={`Play ${label.toLowerCase()} sound`}
                  icon={<SpeakerIcon />}
                  onClick={() => quietly(() => metronome.previewSound(value, role))}
                />
                {isMissing(value) && (
                  <p className="sound-panel__role-warning">This sound was deleted, so Click plays instead.</p>
                )}
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel
        title="Your sounds"
        description="Upload your own clicks. Short, percussive samples work best. Stored in this browser only."
      >
        <div className="sound-panel__dropzone">
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            multiple
            hidden
            aria-label="Sound files"
            onChange={onFilesPicked}
          />
          <Button
            ref={uploadButton}
            variant="primary"
            icon={<UploadIcon />}
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? 'Adding…' : 'Upload sound'}
          </Button>
          <p className="sound-panel__dropzone-text">
            <span className="sound-panel__dropzone-drop">{dragging ? 'Drop to add' : 'or drop audio files here'}</span>
            <span className="sound-panel__dropzone-limits">
              WAV, MP3 or OGG · up to {MAX_MB} MB · up to {MAX_CUSTOM_SOUND_SECONDS} s
            </span>
          </p>
        </div>

        {custom.error !== null && (
          <div className="sound-panel__error" role="alert">
            <p>{custom.error}</p>
            <IconButton size="sm" label="Dismiss error" icon={<XIcon size={18} />} onClick={custom.clearError} />
          </div>
        )}
        <p className="sound-panel__status" role="status">
          {status}
        </p>

        {custom.loading ? (
          <p className="sound-panel__empty">Loading your sounds…</p>
        ) : custom.sounds.length === 0 ? (
          <p className="sound-panel__empty">No sounds yet.</p>
        ) : (
          <ul className="sound-panel__list" aria-label="Uploaded sounds" aria-busy={custom.busy || undefined}>
            {custom.sounds.map((sound) => (
              <CustomSoundRow
                key={sound.id}
                sound={sound}
                usage={usageText(sounds, customSoundId(sound.id))}
                isUsedFor={(target) =>
                  (target === 'all' ? ALL_ROLES : [target]).every((role) => sounds[role] === customSoundId(sound.id))
                }
                onToggleUse={(target) => toggleUse(customSoundId(sound.id), target)}
                onPreview={() => quietly(() => metronome.previewSound(customSoundId(sound.id), 'beat'))}
                onRename={(name) => custom.rename(sound.id, name)}
                onDelete={() => deleteSound(sound)}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

interface CustomSoundRowProps {
  sound: CustomSoundMeta
  /** Roles using this sound as display text, or null. */
  usage: string | null
  isUsedFor: (target: UseTarget) => boolean
  onToggleUse: (target: UseTarget) => void
  onPreview: () => void
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
}

function CustomSoundRow({ sound, usage, isUsedFor, onToggleUse, onPreview, onRename, onDelete }: CustomSoundRowProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const deleteButton = useRef<HTMLButtonElement>(null)

  function commitName() {
    if (draft === null) return
    const name = draft.trim()
    if (name === '' || name === sound.name) {
      setDraft(null)
      return
    }
    // Keep showing the typed name until the store has the new one, so it does not flash back.
    void onRename(name).finally(() => setDraft((current) => (current === draft ? null : current)))
  }

  function onNameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    } else if (e.key === 'Escape' && draft !== null) {
      e.preventDefault()
      setDraft(null)
    }
  }

  function cancelDelete() {
    setConfirming(false)
    deleteButton.current?.focus()
  }

  return (
    <li className="sound-panel__item">
      <div className="sound-panel__item-main">
        <IconButton variant="secondary" label={`Play ${sound.name}`} icon={<PlayIcon size={18} />} onClick={onPreview} />
        <div className="sound-panel__item-text">
          <input
            className="sound-panel__name"
            type="text"
            aria-label="Sound name"
            title="Rename"
            maxLength={MAX_NAME_LENGTH}
            autoComplete="off"
            spellCheck={false}
            value={draft ?? sound.name}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={commitName}
            onKeyDown={onNameKeyDown}
          />
          <span className="sound-panel__meta tabular">
            {formatDuration(sound.duration)} · {formatBytes(sound.size)}
            {usage !== null && <span className="sound-panel__usage"> · Used for {usage}</span>}
          </span>
        </div>
        <IconButton
          ref={deleteButton}
          label={`Delete ${sound.name}`}
          icon={<TrashIcon size={18} />}
          aria-expanded={confirming}
          onClick={() => setConfirming((open) => !open)}
        />
      </div>

      {confirming ? (
        <div
          className="sound-panel__confirm"
          role="group"
          aria-label={`Delete ${sound.name}?`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              cancelDelete()
            }
          }}
        >
          <p className="sound-panel__confirm-text">
            Delete “{sound.name}”?{usage !== null && ' Clicks using it go back to Click.'}
          </p>
          <div className="sound-panel__confirm-actions">
            <Button size="sm" variant="danger" icon={<TrashIcon size={16} />} onClick={() => void onDelete()}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" autoFocus onClick={cancelDelete}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="sound-panel__use" role="group" aria-label={`Use ${sound.name} for`}>
          <span className="sound-panel__use-label" aria-hidden="true">
            Use for
          </span>
          {USE_TARGETS.map(({ target, label, title }) => (
            <Button
              key={target}
              size="sm"
              variant="ghost"
              className="sound-panel__use-button"
              title={title}
              aria-pressed={isUsedFor(target)}
              onClick={() => onToggleUse(target)}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
    </li>
  )
}
