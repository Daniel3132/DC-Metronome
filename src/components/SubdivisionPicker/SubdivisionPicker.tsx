import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { getSubdivision, SUBDIVISIONS } from '../../core/constants'
import type { SubdivisionId } from '../../core/types'
import { ChevronDownIcon } from '../icons/icons'
import { RhythmNotation } from '../RhythmNotation/RhythmNotation'
import './SubdivisionPicker.css'

interface SubdivisionPickerProps {
  value: SubdivisionId
  onChange: (value: SubdivisionId) => void
  className?: string
  /** Visible field label; defaults to 'Subdivision'. */
  label?: string
  /** Keep the label for screen readers only. */
  hideLabel?: boolean
}

/** Options per row in the popup; arrow up/down move by a row. */
const COLUMNS = 3

/**
 * Compact subdivision picker: a select-like button showing the current rhythm in notation, opening a grid of all
 * subdivisions (notation + name). The popup opens below, or above when the window has no room under the trigger.
 */
export function SubdivisionPicker({ value, onChange, className, label = 'Subdivision', hideLabel = false }: SubdivisionPickerProps) {
  const [open, setOpen] = useState(false)
  const [alignEnd, setAlignEnd] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const labelId = useId()
  const listId = useId()
  const current = getSubdivision(value)

  function close(refocus: boolean) {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }

  // Close on a press outside; the trigger toggles itself.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Keep the popup on screen (flip above the trigger or to its right edge) and focus the selected rhythm.
  useLayoutEffect(() => {
    if (!open) return
    const box = list.current
    const rect = trigger.current?.getBoundingClientRect()
    if (!box || !rect) return
    setAlignEnd(rect.left + box.offsetWidth > window.innerWidth - 8)
    setOpenUp(rect.bottom + box.offsetHeight + 8 > window.innerHeight && rect.top > box.offsetHeight + 8)
    box.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
  }, [open])

  function pick(id: SubdivisionId) {
    if (id !== value) onChange(id)
    close(true)
  }

  function onOptionKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let target: number
    switch (e.key) {
      case 'ArrowRight':
        target = index + 1
        break
      case 'ArrowLeft':
        target = index - 1
        break
      case 'ArrowDown':
        target = index + COLUMNS
        break
      case 'ArrowUp':
        target = index - COLUMNS
        break
      case 'Home':
        target = 0
        break
      case 'End':
        target = SUBDIVISIONS.length - 1
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        close(true)
        return
      case 'Tab':
        setOpen(false)
        return
      default:
        return
    }
    e.preventDefault()
    const clamped = Math.min(Math.max(0, target), SUBDIVISIONS.length - 1)
    list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[clamped]?.focus()
  }

  return (
    <div ref={root} className={['subdivision-picker', className].filter(Boolean).join(' ')}>
      <span id={labelId} className={hideLabel ? 'sr-only' : 'ui-field-label'}>
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className="subdivision-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Subdivision: ${current.label}`}
        title={current.label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <RhythmNotation subdivision={value} height={26} className="subdivision-picker__notation" />
        <ChevronDownIcon className="subdivision-picker__chevron" size={18} />
      </button>

      {open && (
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          className={['subdivision-picker__list', alignEnd && 'is-end', openUp && 'is-up'].filter(Boolean).join(' ')}
        >
          {SUBDIVISIONS.map((sub, index) => {
            const selected = sub.id === value
            return (
              <button
                key={sub.id}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className="subdivision-picker__option"
                onClick={() => pick(sub.id)}
                onKeyDown={(e) => onOptionKeyDown(e, index)}
              >
                <RhythmNotation subdivision={sub.id} height={26} />
                <span className="subdivision-picker__name">{sub.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
