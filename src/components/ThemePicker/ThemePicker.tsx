import { useId, useState } from 'react'
import { ACCENTS, loadAccent, saveAccent, type AccentId } from '../../state/theme'
import { CheckIcon, XIcon } from '../icons/icons'
import { Button, IconButton } from '../ui/ui'
import './ThemePicker.css'

/** "Theme" button opening a native popover to pick the accent color (Escape and clicking outside close it). */
export function ThemePicker() {
  const id = useId()
  const popoverId = `${id}-theme`
  const titleId = `${id}-title`
  const [accent, setAccent] = useState<AccentId>(loadAccent)

  function pick(next: AccentId) {
    setAccent(next)
    saveAccent(next)
  }

  return (
    <>
      <Button variant="ghost" size="sm" popoverTarget={popoverId}>
        Theme
      </Button>
      <div id={popoverId} popover="auto" className="theme-picker" role="dialog" aria-labelledby={titleId}>
        <div className="theme-picker__header">
          <h2 id={titleId} className="theme-picker__title">
            Theme
          </h2>
          <IconButton
            label="Close"
            size="sm"
            icon={<XIcon size={18} />}
            popoverTarget={popoverId}
            popoverTargetAction="hide"
          />
        </div>
        <p className="theme-picker__label" id={`${id}-accent`}>
          Accent color
        </p>
        <div className="theme-picker__swatches" role="radiogroup" aria-labelledby={`${id}-accent`}>
          {ACCENTS.map((option) => {
            const checked = option.id === accent
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={checked}
                className="theme-picker__swatch"
                title={option.label}
                onClick={() => pick(option.id)}
              >
                <span className="theme-picker__color" style={{ background: option.swatch }} aria-hidden="true">
                  {checked && <CheckIcon size={16} />}
                </span>
                <span className="theme-picker__name">{option.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
