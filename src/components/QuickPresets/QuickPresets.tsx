import { useId, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { makeId, withDefaultProgram } from '../../core/settings'
import { applyPreset, describeSettings, suggestedName } from '../../state/presetSummary'
import type { Preset } from '../../state/storage'
import { presetActions, usePresets } from '../../state/usePresets'
import { useReorder, type Reorder } from '../ProgramPanel/useReorder'
import type { PanelProps } from '../panelTypes'
import { GripIcon, SaveIcon, XIcon } from '../icons/icons'
import { Button, Panel } from '../ui/ui'
import './QuickPresets.css'

const NAME_MAX_LENGTH = 60

/**
 * Presets at a glance in the Quick tab: one tap loads a saved preset (with its program), and the current setup can be
 * saved under a name. Tapping the highlighted preset again unselects it and resets the
 * program to one section of 4 bars in the current signature (the other settings stay as they are). The x in a
 * card's corner deletes it; dragging a card reorders them. Renaming, import
 * and export stay in the Presets tab.
 */
interface QuickPresetsProps extends Pick<PanelProps, 'settings' | 'onChange'> {
  /** Replaces the "Presets" heading (the Quick tab puts its Program / Presets switch there). */
  title?: ReactNode
  /** Minimized: the header alone. Owned by the Quick tab. */
  collapsed?: boolean
  /** Rendered at the end of the header (the minimize button). */
  collapseButton?: ReactNode
}

/** Swallows the click that ends a drag, so dropping a card neither loads nor deletes it. */
function swallowDropClick(drag: Reorder) {
  return (e: MouseEvent) => {
    if (!drag.consumeClick()) return
    e.preventDefault()
    e.stopPropagation()
  }
}

/** Alt+arrow on a focused card moves it: -1 earlier, +1 later, 0 not a move key. */
function moveKey(e: KeyboardEvent): -1 | 0 | 1 {
  if (!e.altKey) return 0
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') return -1
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') return 1
  return 0
}

export function QuickPresets({
  settings,
  onChange,
  title = 'Presets',
  collapsed = false,
  collapseButton,
}: QuickPresetsProps) {
  const uid = useId()
  const { presets, active, activeName } = usePresets()
  const [name, setName] = useState('')
  const [status, setStatus] = useState('')
  const savedDrag = useReorder(presets.length, presetActions.move)

  const placeholder = suggestedName(settings)

  function save(e: FormEvent) {
    e.preventDefault()
    const presetName = (name.trim() || placeholder).slice(0, NAME_MAX_LENGTH)
    presetActions.add({ id: makeId(), name: presetName, settings, createdAt: Date.now() })
    setName('')
    setStatus(`Saved "${presetName}".`)
  }

  /** Writes the current setup into the active preset (Save as makes a new one instead). */
  function saveChanges() {
    if (activeName === null || !presetActions.saveActive(settings)) return
    setStatus(`Saved the changes to "${activeName}".`)
  }

  function load(preset: Preset) {
    if (unselect(preset)) return
    onChange((prev) => applyPreset(prev, preset.settings))
    presetActions.setActive(preset.id)
    setStatus(`Loaded "${preset.name}".`)
  }

  /** A tap on the highlighted preset unselects it (and resets the program it brought) instead of loading it again. */
  function unselect(preset: Preset): boolean {
    if (active !== preset.id) return false
    onChange(withDefaultProgram)
    presetActions.setActive(null)
    setStatus(`Unselected "${preset.name}". The program is back to one section.`)
    return true
  }

  /** Deletes at once: the undo bar brings it back for a few seconds. */
  function remove(preset: Preset) {
    presetActions.remove(preset.id)
    setStatus(`Deleted "${preset.name}".`)
  }

  function card(preset: Preset, index: number) {
    const loaded = active === preset.id
    const count = presets.length
    const canDrag = count > 1
    const cardId = `${uid}-${preset.id}`
    const onKeyDown = (e: KeyboardEvent) => {
      const to = index + moveKey(e)
      if (to === index || to < 0 || to >= count) return
      e.preventDefault()
      presetActions.move(index, to)
      // The card is re-inserted at its new place; keep the keyboard on it.
      requestAnimationFrame(() => document.getElementById(cardId)?.focus())
    }
    const description = describeSettings(preset.settings)
    return (
      <li
        key={preset.id}
        className={['quick-presets__item', savedDrag.itemClass(index)].filter(Boolean).join(' ')}
        {...savedDrag.itemProps(index)}
      >
        <button
          type="button"
          id={cardId}
          className={`quick-presets__card${loaded ? ' is-loaded' : ''}`}
          aria-pressed={loaded}
          title={
            loaded
              ? `Unselect ${preset.name}`
              : `Load ${preset.name}${canDrag ? ' (drag or Alt+arrow to reorder)' : ''}`
          }
          onClick={() => load(preset)}
          onKeyDown={onKeyDown}
        >
          <span className="quick-presets__name">{preset.name}</span>
          <span className="quick-presets__meta tabular">{description}</span>
          {canDrag && <GripIcon size={12} className="quick-presets__grip" />}
        </button>
        {/* A sibling of the card (a button cannot hold another button), laid over its corner. */}
        <button
          type="button"
          className="quick-presets__delete"
          aria-label={`Delete ${preset.name}`}
          title={`Delete ${preset.name}`}
          onClick={() => remove(preset)}
        >
          <XIcon size={12} />
        </button>
      </li>
    )
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
        icon={<SaveIcon size={16} />}
        disabled={activeName === null}
        title={
          activeName === null
            ? 'Load a preset first: Save writes your changes into the active preset'
            : `Save your changes to "${activeName}"`
        }
        onClick={saveChanges}
      >
        Save
      </Button>
      <Button
        size="sm"
        variant="secondary"
        type="submit"
        title="Save everything you set up (tempo, program, trainers, sounds) as a new preset, named as typed"
      >
        Save as
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
              No saved presets yet. Save the current setup (top right).
            </p>
          ) : (
            <ul
              className={['quick-presets__grid', savedDrag.from !== null && 'is-sorting'].filter(Boolean).join(' ')}
              aria-label="Saved presets"
              onClickCapture={swallowDropClick(savedDrag)}
            >
              {presets.map((preset, index) => card(preset, index))}
            </ul>
          )}
        </>
      )}
      <p role="status" className="sr-only">
        {status}
      </p>
    </Panel>
  )
}
