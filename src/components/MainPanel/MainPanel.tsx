import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { readItem, writeItem } from '../../state/uiPrefs'
import { ChevronDownIcon, GripIcon } from '../icons/icons'
import type { PanelProps } from '../panelTypes'
import { ProgramPanel } from '../ProgramPanel/ProgramPanel'
import { useReorder } from '../ProgramPanel/useReorder'
import { QuickControls } from '../QuickControls/QuickControls'
import { QuickPresets } from '../QuickPresets/QuickPresets'
import { IconButton } from '../ui/ui'
import type { BlockHandle, BlockId } from './blockHandle'
import './MainPanel.css'

/** Kept from when only the program could be minimized, so that choice carries over. */
const COLLAPSED_KEY = 'dcmetronome.ui.programCollapsed'
const PRESETS_COLLAPSED_KEY = 'dcmetronome.ui.presetsCollapsed'
/** The blocks in the order the user dragged them into. */
const ORDER_KEY = 'dcmetronome.ui.blockOrder'
const DEFAULT_ORDER: readonly BlockId[] = ['rhythm', 'practice', 'program', 'presets']

const BLOCK_LABELS: Record<BlockId, string> = {
  rhythm: 'rhythm row',
  practice: 'trainer row',
  program: 'program',
  presets: 'presets',
}

/** Where a drag may start: the grips, and a minimized row's bar. Never the controls inside a block. */
const DRAG_HANDLES = '.main-panel__grip, .quick-controls__row-bar'

function readOrder(): BlockId[] {
  try {
    const raw: unknown = JSON.parse(readItem(ORDER_KEY) ?? '[]')
    const stored = Array.isArray(raw) ? raw.filter((id): id is BlockId => DEFAULT_ORDER.includes(id as BlockId)) : []
    // Blocks the stored order does not name (or names twice) fall back to the default order.
    const unique = [...new Set(stored)]
    return [...unique, ...DEFAULT_ORDER.filter((id) => !unique.includes(id))]
  } catch {
    return [...DEFAULT_ORDER]
  }
}

/** A minimized-by-default flag kept in localStorage ('0' = expanded). */
function useCollapsed(key: string) {
  const [collapsed, setCollapsed] = useState(() => readItem(key) !== '0')
  const toggle = () => {
    setCollapsed(!collapsed)
    writeItem(key, collapsed ? '0' : '1')
  }
  return [collapsed, toggle] as const
}

function CollapseButton({ collapsed, what, onToggle }: { collapsed: boolean; what: string; onToggle: () => void }) {
  return (
    <IconButton
      size="sm"
      variant="ghost"
      className="main-panel__collapse"
      label={collapsed ? `Expand ${what}` : `Minimize ${what}`}
      aria-expanded={!collapsed}
      icon={<ChevronDownIcon size={18} />}
      onClick={onToggle}
    />
  )
}

/**
 * The main ("Quick") tab: the rhythm row, the trainer row, the program card and the presets card. Each block can be
 * dragged by its grip (or moved with the arrow keys on it) into another order, which is remembered. On desktop the
 * presets card stretches to the bottom of the tab. The cards are minimized by default.
 */
export function MainPanel(props: PanelProps) {
  const { settings, onChange, metronome } = props
  const [programCollapsed, toggleProgram] = useCollapsed(COLLAPSED_KEY)
  const [presetsCollapsed, togglePresets] = useCollapsed(PRESETS_COLLAPSED_KEY)
  const [order, setOrder] = useState<BlockId[]>(readOrder)

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return
    const next = order.toSpliced(from, 1).toSpliced(to, 0, order[from])
    setOrder(next)
    writeItem(ORDER_KEY, JSON.stringify(next))
  }
  const drag = useReorder(order.length, move, 'y')

  function handleFor(id: BlockId, index: number): BlockHandle {
    const { onPointerDown, ...rest } = drag.itemProps(index)
    const onGripKey = (e: KeyboardEvent) => {
      const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
      if (delta === 0) return
      e.preventDefault()
      move(index, index + delta)
    }
    return {
      rootProps: {
        ...rest,
        onPointerDown: (e: PointerEvent<HTMLElement>) => {
          if (e.target instanceof Element && e.target.closest(DRAG_HANDLES)) onPointerDown(e)
        },
      },
      className: drag.itemClass(index),
      consumeClick: drag.consumeClick,
      grip: (
        <button
          type="button"
          className="main-panel__grip"
          aria-label={`Move the ${BLOCK_LABELS[id]} (drag, or arrow keys)`}
          title="Drag to move"
          onKeyDown={onGripKey}
        >
          <GripIcon size={14} />
        </button>
      ),
    }
  }

  function block(id: BlockId, index: number) {
    const handle = handleFor(id, index)
    switch (id) {
      case 'rhythm':
      case 'practice':
        return (
          <QuickControls
            key={id}
            row={id}
            handle={handle}
            settings={settings}
            onChange={onChange}
            getLevel={metronome.getLevel}
            active={metronome.playback.status !== 'stopped'}
            pulse={metronome.playback.status === 'playing' ? metronome.playback.pulse : null}
          />
        )
      case 'program':
        return (
          <div key={id} className={['main-panel__block', handle.className].filter(Boolean).join(' ')} {...handle.rootProps}>
            <ProgramPanel
              {...props}
              collapsed={programCollapsed}
              collapseButton={
                <>
                  {handle.grip}
                  <CollapseButton collapsed={programCollapsed} what="program" onToggle={toggleProgram} />
                </>
              }
            />
          </div>
        )
      case 'presets':
        return (
          <div
            key={id}
            className={['main-panel__block', 'main-panel__block--presets', handle.className].filter(Boolean).join(' ')}
            {...handle.rootProps}
          >
            <QuickPresets
              settings={settings}
              onChange={onChange}
              collapsed={presetsCollapsed}
              collapseButton={
                <>
                  {handle.grip}
                  <CollapseButton collapsed={presetsCollapsed} what="presets" onToggle={togglePresets} />
                </>
              }
            />
          </div>
        )
    }
  }

  return <div className="main-panel">{order.map(block)}</div>
}
