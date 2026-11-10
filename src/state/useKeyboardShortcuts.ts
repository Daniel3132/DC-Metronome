import { useEffect, useEffectEvent } from 'react'

export interface ShortcutHandlers {
  togglePlay: () => void
  tap: () => void
  /** Change the tempo by `delta` BPM. */
  nudgeBpm: (delta: number) => void
  /** Change the tempo percentage by `delta` points. */
  nudgeTempoPercent: (delta: number) => void
  toggleMute: () => void
  /** Gap trainer on/off. */
  toggleSilence: () => void
  toggleRandomMute: () => void
  toggleVoice: () => void
  toggleProgram: () => void
  toggleSpeedTrainer: () => void
  toggleFlash: () => void
  /** Open the settings tab at `index` (0-based). */
  openTab: (index: number) => void
  /** Go back to the main (Quick) tab. */
  closeTab: () => void
  /** Select the previous (-1) or next (+1) section. */
  stepSection: (delta: -1 | 1) => void
}

export interface ShortcutInfo {
  /** Keys pressed together (rendered as <kbd>); alternatives are separate entries. */
  keys: readonly string[]
  description: string
}

/** What the shortcuts help lists. Keep in sync with the handler below. */
export const SHORTCUTS: readonly ShortcutInfo[] = [
  { keys: ['Space'], description: 'Start / stop' },
  { keys: ['T'], description: 'Tap tempo' },
  { keys: ['↑'], description: 'Tempo +1 BPM' },
  { keys: ['↓'], description: 'Tempo −1 BPM' },
  { keys: ['Shift', '↑'], description: 'Tempo +10 BPM' },
  { keys: ['Shift', '↓'], description: 'Tempo −10 BPM' },
  { keys: ['+'], description: 'Tempo % +5' },
  { keys: ['−'], description: 'Tempo % −5' },
  { keys: ['M'], description: 'Mute / unmute' },
  { keys: ['S'], description: 'Rest bar (gap trainer) on / off' },
  { keys: ['R'], description: 'Random mute on / off' },
  { keys: ['V'], description: 'Voice counting on / off' },
  { keys: ['P'], description: 'Program mode on / off' },
  { keys: ['A'], description: 'Speed trainer on / off' },
  { keys: ['F'], description: 'Screen flash on / off' },
  { keys: ['['], description: 'Previous section' },
  { keys: [']'], description: 'Next section' },
  { keys: ['1 – 5'], description: 'Open a settings tab (1 = Quick)' },
  { keys: ['Esc'], description: 'Back to the Quick tab' },
]

const BPM_STEP = 1
const BPM_BIG_STEP = 10
const PERCENT_STEP = 5

// Widgets that use the arrow keys themselves (radio groups, tabs, sliders …).
const ARROW_OWNERS = 'input[type="range"],input[type="radio"],[role="radio"],[role="radiogroup"],[role="tab"],[role="tablist"],[role="slider"],[role="spinbutton"],[role="listbox"],[role="menu"],[role="grid"],[role="tree"]'

// Inputs that never take typed text: shortcuts stay live on them (sliders, kit radios, file pickers …).
const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color', 'image'])

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    (target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type)) ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  )
}

function ignored(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey || e.isComposing || isTextEntry(e.target)
}

/** An open popover (the shortcuts help) owns Escape: it closes itself first. */
function popoverOpen(): boolean {
  try {
    return document.querySelector(':popover-open') !== null
  } catch {
    return false
  }
}

type ToggleHandler = {
  [K in keyof ShortcutHandlers]: ShortcutHandlers[K] extends () => void ? K : never
}[keyof ShortcutHandlers]

// Single-letter on/off switches, by lowercase key.
const TOGGLES: Readonly<Partial<Record<string, ToggleHandler>>> = {
  m: 'toggleMute',
  s: 'toggleSilence',
  r: 'toggleRandomMute',
  v: 'toggleVoice',
  p: 'toggleProgram',
  a: 'toggleSpeedTrainer',
  f: 'toggleFlash',
}

function isSpace(e: KeyboardEvent): boolean {
  return e.key === ' ' || e.key === 'Spacebar'
}

/**
 * Global keyboard shortcuts (see SHORTCUTS). Ignored while typing in a form field or with Ctrl/Meta/Alt.
 * Space always means start/stop, so it never also activates the focused button.
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (ignored(e)) return

    if (isSpace(e)) {
      // Swallow repeats too, otherwise a held Space would scroll the page.
      e.preventDefault()
      if (!e.repeat) handlers.togglePlay()
      return
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (e.defaultPrevented) return
      if (e.target instanceof Element && e.target.closest(ARROW_OWNERS)) return
      e.preventDefault()
      const step = e.shiftKey ? BPM_BIG_STEP : BPM_STEP
      handlers.nudgeBpm(e.key === 'ArrowUp' ? step : -step)
      return
    }

    switch (e.key) {
      case '+':
      case '=':
        e.preventDefault()
        handlers.nudgeTempoPercent(PERCENT_STEP)
        return
      case '-':
      case '_':
        e.preventDefault()
        handlers.nudgeTempoPercent(-PERCENT_STEP)
        return
    }

    if (e.repeat) return
    if (e.key === 'Escape') {
      if (!popoverOpen()) handlers.closeTab()
      return
    }
    if (e.key === '[' || e.key === ']') {
      e.preventDefault()
      handlers.stepSection(e.key === '[' ? -1 : 1)
      return
    }
    if (e.key.length === 1 && e.key >= '1' && e.key <= '5') {
      e.preventDefault()
      handlers.openTab(Number(e.key) - 1)
      return
    }

    const key = e.key.toLowerCase()
    if (key === 't') {
      e.preventDefault()
      handlers.tap()
      return
    }
    const toggle = TOGGLES[key]
    if (toggle !== undefined) {
      e.preventDefault()
      handlers[toggle]()
    }
  })

  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      // Some browsers activate a focused button on Space keyup even when keydown was prevented.
      if (isSpace(e) && !ignored(e)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])
}
