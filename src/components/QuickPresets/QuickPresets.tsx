import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { STORAGE_KEYS } from '../../core/constants'
import { makeId } from '../../core/settings'
import { FACTORY_PRESETS } from '../../state/factoryPresets'
import { applyFactoryPreset, applyPreset, describeSettings, suggestedName } from '../../state/presetSummary'
import { loadPresets, savePresets, type Preset } from '../../state/storage'
import type { PanelProps } from '../panelTypes'
import { SaveIcon } from '../icons/icons'
import { Button, Panel } from '../ui/ui'
import './QuickPresets.css'

const NAME_MAX_LENGTH = 60

/**
 * Presets at a glance in the Quick tab: one tap loads a saved preset (with its program), and the current setup can be
 * saved under a name. Renaming, deleting, import and export stay in the Presets tab.
 */
interface QuickPresetsProps extends Pick<PanelProps, 'settings' | 'onChange'> {
  /** Replaces the "Presets" heading (the Quick tab puts its Program / Presets switch there). */
  title?: ReactNode
  /** Minimized: the header alone. Owned by the Quick tab, so Program and Presets share it. */
  collapsed?: boolean
  /** Rendered at the end of the header (the minimize button). */
  collapseButton?: ReactNode
}

export function QuickPresets({
  settings,
  onChange,
  title = 'Presets',
  collapsed = false,
  collapseButton,
}: QuickPresetsProps) {
  const uid = useId()
  const [presets, setPresets] = useState<Preset[]>(loadPresets)
  const [name, setName] = useState('')
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  // Another tab saved presets: show them here too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.presets) setPresets(loadPresets())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const placeholder = suggestedName(settings)

  function save(e: FormEvent) {
    e.preventDefault()
    const presetName = (name.trim() || placeholder).slice(0, NAME_MAX_LENGTH)
    const preset: Preset = { id: makeId(), name: presetName, settings, createdAt: Date.now() }
    // Re-read first, so a preset saved in the Presets tab or another window is not overwritten.
    const next = [preset, ...loadPresets()]
    setPresets(next)
    savePresets(next)
    setName('')
    setLoadedId(preset.id)
    setStatus(`Saved "${presetName}".`)
  }

  function load(preset: Preset) {
    onChange((prev) => applyPreset(prev, preset.settings))
    setLoadedId(preset.id)
    setStatus(`Loaded "${preset.name}".`)
  }

  const saveForm = (
    <form className="quick-presets__save" onSubmit={save}>
      <label className="sr-only" htmlFor={`${uid}-name`}>
        Preset name
      </label>
      <input
        id={`${uid}-name`}
        className="quick-presets__input"
        type="text"
        value={name}
        placeholder={placeholder}
        maxLength={NAME_MAX_LENGTH}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(e) => setName(e.currentTarget.value)}
      />
      <Button
        size="sm"
        variant="primary"
        type="submit"
        icon={<SaveIcon size={16} />}
        title="Save everything you set up (tempo, program, trainers, sounds) as a preset"
      >
        Save
      </Button>
    </form>
  )

  return (
    <Panel
      className={['quick-presets', collapsed && 'is-collapsed'].filter(Boolean).join(' ')}
      title={title}
      description={presets.length === 1 ? '1 saved preset' : `${presets.length} saved presets`}
      headerAction={
        <>
          {!collapsed && saveForm}
          {collapseButton}
        </>
      }
    >
      {!collapsed && (
        <>
          {presets.length === 0 ? (
            <p className="quick-presets__empty">
              No saved presets yet. Save the current setup (top right), or start from one below.
            </p>
          ) : (
            <ul className="quick-presets__grid" aria-label="Saved presets">
              {presets.map((preset) => (
                <li key={preset.id}>
                  <button
                    type="button"
                    className={`quick-presets__card${preset.id === loadedId ? ' is-loaded' : ''}`}
                    title={`Load ${preset.name}`}
                    onClick={() => load(preset)}
                  >
                    <span className="quick-presets__name">{preset.name}</span>
                    <span className="quick-presets__meta tabular">{describeSettings(preset.settings)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3 className="quick-presets__heading">Factory</h3>
          <ul className="quick-presets__grid quick-presets__grid--factory" aria-label="Factory presets">
            {FACTORY_PRESETS.map((preset) => (
              <li key={preset.id}>
                <button
                  type="button"
                  className={`quick-presets__card${preset.id === loadedId ? ' is-loaded' : ''}`}
                  title={preset.description}
                  onClick={() => {
                    onChange((prev) => applyFactoryPreset(prev, preset))
                    setLoadedId(preset.id)
                    setStatus(`Loaded "${preset.name}".`)
                  }}
                >
                  <span className="quick-presets__name">{preset.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p role="status" className="sr-only">
        {status}
      </p>
    </Panel>
  )
}
