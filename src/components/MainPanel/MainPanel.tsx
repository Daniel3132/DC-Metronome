import { useState } from 'react'
import { ChevronDownIcon } from '../icons/icons'
import type { PanelProps } from '../panelTypes'
import { ProgramPanel } from '../ProgramPanel/ProgramPanel'
import { QuickControls } from '../QuickControls/QuickControls'
import { QuickPresets } from '../QuickPresets/QuickPresets'
import { IconButton, Segmented } from '../ui/ui'
import './MainPanel.css'

type LowerView = 'program' | 'presets'

// Per-browser conveniences; storage failures are ignored.
const VIEW_KEY = 'dcmetronome.ui.mainView'
/** Kept from when only the program could be minimized, so that choice carries over. */
const COLLAPSED_KEY = 'dcmetronome.ui.programCollapsed'

function readItem(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeItem(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // Storage blocked or full: the default applies next time.
  }
}

const VIEWS = [
  { value: 'program' as const, label: 'Program' },
  { value: 'presets' as const, label: 'Presets' },
]

/**
 * The main ("Quick") tab: a grid of small cells with everything used while practising, then one card that shows
 * either the program or the saved presets. The card is minimized by default; both views share that state.
 */
export function MainPanel(props: PanelProps) {
  const { settings, onChange, metronome } = props
  const [view, setView] = useState<LowerView>(() => (readItem(VIEW_KEY) === 'presets' ? 'presets' : 'program'))
  const [collapsed, setCollapsed] = useState(() => readItem(COLLAPSED_KEY) !== '0')

  // The switch is the card's title, so it costs no extra row.
  const switcher = (
    <Segmented
      className="main-panel__views"
      label="Show program or presets"
      size="sm"
      value={view}
      options={VIEWS}
      onChange={(next) => {
        setView(next)
        writeItem(VIEW_KEY, next)
      }}
    />
  )

  const collapseButton = (
    <IconButton
      size="sm"
      variant="ghost"
      className="main-panel__collapse"
      label={collapsed ? `Expand ${view}` : `Minimize ${view}`}
      aria-expanded={!collapsed}
      icon={<ChevronDownIcon size={18} />}
      onClick={() => {
        setCollapsed(!collapsed)
        writeItem(COLLAPSED_KEY, collapsed ? '0' : '1')
      }}
    />
  )

  const shared = { title: switcher, collapsed, collapseButton }
  return (
    <div className="main-panel">
      <QuickControls
        settings={settings}
        onChange={onChange}
        getLevel={metronome.getLevel}
        active={metronome.playback.status !== 'stopped'}
      />
      {view === 'program' ? (
        <ProgramPanel {...props} {...shared} />
      ) : (
        <QuickPresets settings={settings} onChange={onChange} {...shared} />
      )}
    </div>
  )
}
