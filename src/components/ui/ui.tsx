// DC Metronome UI kit. Styles live in ui.css ('ui-' class prefix); design tokens in src/index.css.
//
//   Panel       card section: title, description?, headerAction? (usually an enable Toggle), children
//   Toggle      switch (role="switch"): checked, onChange(checked), label, hideLabel?, size?
//   Slider      range with filled track: value, min, max, step?, onChange, label, format?, orientation?, marks?
//   Stepper     [-] number [+]: press-and-hold repeats, typing commits on Enter/blur, arrow keys step
//   Segmented   radiogroup of buttons with arrow-key navigation: value, options, onChange, label, wrap?
//   Select      styled native <select>; options with a `group` become optgroups
//   Button      variant: primary | secondary | ghost | danger, size: sm | md | lg, icon?
//   IconButton  icon-only button; `label` is its aria-label and tooltip
//   Field       visible label (+ hint) around any control; inline? puts the label beside it
//   Badge       small status pill: tone neutral | accent | warning | success | danger
//
// Layout helpers (CSS only): .ui-stack, .ui-stack--sm, .ui-row, .ui-row--between, .ui-grid, .ui-divider
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { ChevronDownIcon, MinusIcon, PlusIcon } from '../icons/icons'
import './ui.css'

type ClassValue = string | false | null | undefined

function cx(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(' ')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function decimalsOf(step: number): number {
  const text = String(step)
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}

/** Clamp to min..max and round to the step grid anchored at `min`. */
function snapToStep(value: number, min: number, max: number, step: number): number {
  const snapped = step > 0 ? Math.round((value - min) / step) * step + min : value
  return Number(clamp(snapped, min, max).toFixed(decimalsOf(step)))
}

function percentOf(value: number, min: number, max: number): number {
  return max > min ? ((clamp(value, min, max) - min) / (max - min)) * 100 : 0
}

/* Panel ------------------------------------------------------------------ */

export interface UiPanelProps {
  title: ReactNode
  description?: ReactNode
  /** Right side of the heading row, typically an enable <Toggle hideLabel />. */
  headerAction?: ReactNode
  children?: ReactNode
  id?: string
  className?: string
  /** Heading level of the title (default 2). */
  level?: 2 | 3
}

export function Panel({ title, description, headerAction, children, id, className, level = 2 }: UiPanelProps) {
  const headingId = useId()
  const Heading = level === 3 ? 'h3' : 'h2'
  return (
    <section id={id} className={cx('ui-panel', className)} aria-labelledby={headingId}>
      <header className="ui-panel-header">
        <div className="ui-panel-titles">
          <Heading id={headingId} className="ui-panel-title">
            {title}
          </Heading>
          {description != null && <p className="ui-panel-description">{description}</p>}
        </div>
        {headerAction != null && <div className="ui-panel-action">{headerAction}</div>}
      </header>
      {children != null && children !== false && <div className="ui-panel-body">{children}</div>}
    </section>
  )
}

/* Toggle ----------------------------------------------------------------- */

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  /** Keep the label for assistive tech (aria-label + tooltip) but do not show it. */
  hideLabel?: boolean
  disabled?: boolean
  size?: 'sm' | 'md'
  id?: string
  className?: string
}

export function Toggle({ checked, onChange, label, hideLabel = false, disabled = false, size = 'md', id, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={hideLabel ? label : undefined}
      title={hideLabel ? label : undefined}
      disabled={disabled}
      className={cx('ui-toggle', `ui-toggle--${size}`, className)}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-toggle-track" aria-hidden="true">
        <span className="ui-toggle-thumb" />
      </span>
      {!hideLabel && <span className="ui-toggle-label">{label}</span>}
    </button>
  )
}

/* Slider ----------------------------------------------------------------- */

export interface SliderProps {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  label: string
  hideLabel?: boolean
  /** Text for the visible value and aria-valuetext (default String(value)). */
  format?: (value: number) => string
  /** Show the formatted value (default true). */
  showValue?: boolean
  disabled?: boolean
  /** 'vertical' renders a mixer fader: value on top, label below. */
  orientation?: 'horizontal' | 'vertical'
  /** Values to draw tick marks at (decorative). */
  marks?: number[]
  /** Track length of a vertical slider: px number or CSS length (default 180px, or the --slider-length variable). */
  length?: number | string
  id?: string
  className?: string
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  hideLabel = false,
  format,
  showValue = true,
  disabled = false,
  orientation = 'horizontal',
  marks,
  length,
  id,
  className,
}: SliderProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const vertical = orientation === 'vertical'
  const text = format ? format(value) : String(value)

  const style = { '--fill': `${percentOf(value, min, max)}%` } as Record<string, string>
  if (vertical && length != null) style['--slider-length'] = typeof length === 'number' ? `${length}px` : length

  const labelEl = (
    <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'ui-slider-label'}>
      {label}
    </label>
  )
  // The input already announces aria-valuetext; the visible copy is hidden from assistive tech to avoid echoes.
  const valueEl = showValue ? (
    <span className="ui-slider-value tabular" aria-hidden="true">
      {text}
    </span>
  ) : null
  const visibleMarks = (marks ?? []).filter((m) => m >= min && m <= max)

  const control = (
    <div className="ui-slider-control">
      <input
        id={inputId}
        type="range"
        className="ui-slider-input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={text}
        aria-orientation={vertical ? 'vertical' : undefined}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      {visibleMarks.length > 0 && (
        <div className="ui-slider-marks" aria-hidden="true">
          {visibleMarks.map((m) => (
            <span
              key={m}
              className={cx('ui-slider-mark', m <= value && 'is-passed')}
              style={{ '--pos': percentOf(m, min, max) / 100 } as CSSProperties}
            />
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div
      className={cx(
        'ui-slider',
        vertical ? 'ui-slider--vertical' : 'ui-slider--horizontal',
        !vertical && hideLabel && 'ui-slider--compact',
        !vertical && !showValue && 'ui-slider--no-value',
        disabled && 'is-disabled',
        className,
      )}
      style={style as CSSProperties}
    >
      {vertical ? (
        <>
          {valueEl}
          {control}
          {labelEl}
        </>
      ) : (
        <>
          {labelEl}
          {valueEl}
          {control}
        </>
      )}
    </div>
  )
}

/* Stepper ---------------------------------------------------------------- */

export interface StepperProps {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  label: string
  hideLabel?: boolean
  /** Unit shown after the number, e.g. 'BPM', '%', 'bars'. */
  suffix?: string
  size?: 'sm' | 'md'
  disabled?: boolean
  id?: string
  className?: string
}

const HOLD_DELAY_MS = 400
const HOLD_FIRST_INTERVAL_MS = 150
const HOLD_MIN_INTERVAL_MS = 30
const HOLD_ACCELERATION = 0.86

export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  hideLabel = false,
  suffix,
  size = 'md',
  disabled = false,
  id,
  className,
}: StepperProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const [draft, setDraft] = useState<string | null>(null)
  const holdTimer = useRef<number | null>(null)
  // Set on pointerdown so the click that follows does not step a second time.
  const pointerStepped = useRef(false)
  // A hold outlives the render that started it; always report through the newest callback.
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    if (disabled && holdTimer.current !== null) {
      clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }, [disabled])

  useEffect(
    () => () => {
      if (holdTimer.current !== null) clearTimeout(holdTimer.current)
    },
    [],
  )

  const decimals = decimalsOf(step)
  const display = (v: number) => String(Number(v.toFixed(decimals)))
  const stepFrom = (base: number, steps: number) => snapToStep(base + steps * step, min, max, step)

  function emit(next: number) {
    if (next !== value) onChange(next)
  }

  function stopHold() {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }

  function startHold(direction: 1 | -1, e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 || disabled) return
    pointerStepped.current = true
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Capture is a nicety (keeps the hold alive when the finger drifts off the button).
    }
    stopHold()
    setDraft(null)
    let current = stepFrom(value, direction)
    emit(current)
    let interval = HOLD_FIRST_INTERVAL_MS
    const tick = () => {
      const next = stepFrom(current, direction)
      if (next === current) {
        holdTimer.current = null
        return
      }
      current = next
      onChangeRef.current(next)
      interval = Math.max(HOLD_MIN_INTERVAL_MS, interval * HOLD_ACCELERATION)
      holdTimer.current = window.setTimeout(tick, interval)
    }
    holdTimer.current = window.setTimeout(tick, HOLD_DELAY_MS)
  }

  function onButtonClick(direction: 1 | -1, detail: number) {
    // detail 0 = keyboard or assistive-tech activation, which has no pointerdown.
    if (pointerStepped.current && detail !== 0) {
      pointerStepped.current = false
      return
    }
    pointerStepped.current = false
    setDraft(null)
    emit(stepFrom(value, direction))
  }

  function parseDraft(): number | null {
    if (draft === null) return null
    const trimmed = draft.trim().replace(',', '.')
    if (trimmed === '') return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  function commit() {
    const parsed = parseDraft()
    setDraft(null)
    if (parsed !== null) emit(snapToStep(parsed, min, max, step))
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const base = parseDraft() ?? value
    let next: number
    switch (e.key) {
      case 'Enter':
        e.preventDefault()
        commit()
        return
      case 'Escape':
        if (draft !== null) {
          e.preventDefault()
          setDraft(null)
        }
        return
      case 'ArrowUp':
        next = stepFrom(base, 1)
        break
      case 'ArrowDown':
        next = stepFrom(base, -1)
        break
      case 'PageUp':
        next = stepFrom(base, 10)
        break
      case 'PageDown':
        next = stepFrom(base, -10)
        break
      case 'Home':
        next = min
        break
      case 'End':
        next = max
        break
      default:
        return
    }
    e.preventDefault()
    setDraft(null)
    emit(next)
  }

  const chars = Math.max(display(min).length, display(max).length)
  const integerOnly = decimals === 0 && min >= 0

  return (
    <div className={cx('ui-stepper', `ui-stepper--${size}`, disabled && 'is-disabled', className)}>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'ui-field-label'}>
        {label}
      </label>
      <div className="ui-stepper-control">
        <button
          type="button"
          className="ui-stepper-button"
          tabIndex={-1}
          aria-label={`Decrease ${label}`}
          disabled={disabled || value <= min}
          onPointerDown={(e) => startHold(-1, e)}
          onPointerUp={stopHold}
          onPointerCancel={stopHold}
          onLostPointerCapture={stopHold}
          onContextMenu={(e) => e.preventDefault()}
          onClick={(e) => onButtonClick(-1, e.detail)}
        >
          <MinusIcon size={size === 'sm' ? 16 : 20} />
        </button>
        <div className="ui-stepper-field">
          <input
            id={inputId}
            type="text"
            role="spinbutton"
            className="ui-stepper-input tabular"
            style={{ '--chars': chars } as CSSProperties}
            inputMode={integerOnly ? 'numeric' : 'decimal'}
            enterKeyHint="done"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            value={draft ?? display(value)}
            aria-valuenow={value}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuetext={suffix ? `${display(value)} ${suffix}` : undefined}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
          />
          {suffix && (
            <span className="ui-stepper-suffix" aria-hidden="true">
              {suffix}
            </span>
          )}
        </div>
        <button
          type="button"
          className="ui-stepper-button"
          tabIndex={-1}
          aria-label={`Increase ${label}`}
          disabled={disabled || value >= max}
          onPointerDown={(e) => startHold(1, e)}
          onPointerUp={stopHold}
          onPointerCancel={stopHold}
          onLostPointerCapture={stopHold}
          onContextMenu={(e) => e.preventDefault()}
          onClick={(e) => onButtonClick(1, e.detail)}
        >
          <PlusIcon size={size === 'sm' ? 16 : 20} />
        </button>
      </div>
    </div>
  )
}

/* Segmented -------------------------------------------------------------- */

export interface SegmentedOption<T extends string | number> {
  value: T
  label: ReactNode
  /** Tooltip, and the accessible name when `label` is not text (e.g. an icon). */
  title?: string
  disabled?: boolean
}

export interface SegmentedProps<T extends string | number> {
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  /** Accessible name of the radiogroup. */
  label: string
  size?: 'sm' | 'md'
  /** Let options flow onto several lines instead of scrolling horizontally. */
  wrap?: boolean
  /** Fill the container width with equal-width options. */
  stretch?: boolean
  disabled?: boolean
  className?: string
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  wrap = false,
  stretch = false,
  disabled = false,
  className,
}: SegmentedProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null)
  const selectedIndex = options.findIndex((o) => o.value === value)
  const firstEnabled = options.findIndex((o) => !o.disabled)
  const tabStop = selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : firstEnabled

  function select(index: number) {
    const option = options[index]
    if (!option || option.disabled) return
    if (option.value !== value) onChange(option.value)
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index]?.focus()
  }

  function nextEnabled(from: number, delta: 1 | -1): number {
    for (let i = 1; i <= options.length; i++) {
      const index = (from + delta * i + options.length) % options.length
      if (!options[index].disabled) return index
    }
    return from
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let target: number
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        target = nextEnabled(index, 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        target = nextEnabled(index, -1)
        break
      case 'Home':
        target = firstEnabled
        break
      case 'End':
        target = nextEnabled(0, -1)
        break
      default:
        return
    }
    e.preventDefault()
    select(target)
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cx(
        'ui-segmented',
        `ui-segmented--${size}`,
        wrap && 'ui-segmented--wrap',
        stretch && 'ui-segmented--stretch',
        className,
      )}
    >
      {options.map((option, index) => {
        const checked = index === selectedIndex
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={typeof option.label === 'string' ? undefined : option.title}
            title={option.title}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={disabled || option.disabled}
            className="ui-segmented-item"
            onClick={() => select(index)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/* Select ----------------------------------------------------------------- */

export interface SelectOption<T extends string> {
  value: T
  label: string
  /** Options sharing a group are rendered in one <optgroup>, in order of first appearance. */
  group?: string
  disabled?: boolean
}

export interface SelectProps<T extends string> {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  label: string
  hideLabel?: boolean
  disabled?: boolean
  id?: string
  className?: string
}

type SelectEntry<T extends string> =
  | { kind: 'option'; option: SelectOption<T> }
  | { kind: 'group'; name: string; options: SelectOption<T>[] }

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  hideLabel = false,
  disabled = false,
  id,
  className,
}: SelectProps<T>) {
  const autoId = useId()
  const selectId = id ?? autoId

  const entries: SelectEntry<T>[] = []
  const groups = new Map<string, SelectOption<T>[]>()
  for (const option of options) {
    if (option.group == null) {
      entries.push({ kind: 'option', option })
      continue
    }
    let group = groups.get(option.group)
    if (!group) {
      group = []
      groups.set(option.group, group)
      entries.push({ kind: 'group', name: option.group, options: group })
    }
    group.push(option)
  }

  const renderOption = (option: SelectOption<T>) => (
    <option key={option.value} value={option.value} disabled={option.disabled}>
      {option.label}
    </option>
  )

  return (
    <div className={cx('ui-select', disabled && 'is-disabled', className)}>
      <label htmlFor={selectId} className={hideLabel ? 'sr-only' : 'ui-field-label'}>
        {label}
      </label>
      <div className="ui-select-wrap">
        <select
          id={selectId}
          className="ui-select-input"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const picked = options.find((o) => o.value === e.currentTarget.value)
            if (picked) onChange(picked.value)
          }}
        >
          {entries.map((entry) =>
            entry.kind === 'option' ? (
              renderOption(entry.option)
            ) : (
              <optgroup key={`group:${entry.name}`} label={entry.name}>
                {entry.options.map(renderOption)}
              </optgroup>
            ),
          )}
        </select>
        <ChevronDownIcon className="ui-select-chevron" size={18} />
      </div>
    </div>
  )
}

/* Button / IconButton ---------------------------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon, e.g. <PlayIcon />. */
  icon?: ReactNode
  /** Stretch to the container width. */
  block?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  block = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('ui-button', `ui-button--${variant}`, `ui-button--${size}`, block && 'ui-button--block', className)}
      {...rest}
    >
      {icon != null && <span className="ui-button-icon">{icon}</span>}
      {children != null && children !== false && <span className="ui-button-label">{children}</span>}
    </button>
  )
}

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  /** Accessible name; also shown as the tooltip unless `title` is given. */
  label: string
  icon: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  className,
  title,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cx('ui-button', 'ui-icon-button', `ui-button--${variant}`, `ui-button--${size}`, className)}
      {...rest}
    >
      {icon}
    </button>
  )
}

/* Field ------------------------------------------------------------------ */

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  /** Label (and hint) on the left, control on the right. */
  inline?: boolean
  /**
   * Id of a single native control to label with <label for>. Without it the field is a role="group"
   * labelled by the visible text; give kit controls inside it hideLabel so they keep their own accessible name.
   */
  htmlFor?: string
  className?: string
}

export function Field({ label, hint, children, inline = false, htmlFor, className }: FieldProps) {
  const labelId = useId()
  const hintId = `${labelId}-hint`
  const hasHint = hint != null && hint !== false
  return (
    <div
      className={cx('ui-field', inline && 'ui-field--inline', className)}
      role={htmlFor ? undefined : 'group'}
      aria-labelledby={htmlFor ? undefined : labelId}
      aria-describedby={!htmlFor && hasHint ? hintId : undefined}
    >
      <div className="ui-field-text">
        {htmlFor ? (
          <label id={labelId} htmlFor={htmlFor} className="ui-field-label">
            {label}
          </label>
        ) : (
          <span id={labelId} className="ui-field-label">
            {label}
          </span>
        )}
        {hasHint && (
          <span id={hintId} className="ui-field-hint">
            {hint}
          </span>
        )}
      </div>
      <div className="ui-field-control">{children}</div>
    </div>
  )
}

/* Badge ------------------------------------------------------------------ */

export interface BadgeProps {
  tone?: 'neutral' | 'accent' | 'warning' | 'success' | 'danger'
  children: ReactNode
  title?: string
  className?: string
}

export function Badge({ tone = 'neutral', children, title, className }: BadgeProps) {
  return (
    <span className={cx('ui-badge', `ui-badge--${tone}`, className)} title={title}>
      {children}
    </span>
  )
}
