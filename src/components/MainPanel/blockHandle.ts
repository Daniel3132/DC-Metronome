import type { PointerEvent, ReactNode } from 'react'

/** The blocks of the Quick tab, in their default order. Each can be dragged to another place (MainPanel). */
export type BlockId = 'rhythm' | 'practice' | 'program' | 'presets'

/** What a block needs from MainPanel to be draggable. */
export interface BlockHandle {
  /** Spread on the block's root element (a direct child of .main-panel). */
  rootProps: {
    'data-reorder-index': number
    onPointerDown: (e: PointerEvent<HTMLElement>) => void
  }
  /** Drag state classes for the root ('is-dragging', drop markers). */
  className: string
  /** True right after a drop: the click that ends a drag must not also act. */
  consumeClick: () => boolean
  /** The grip button to place in the block (drag it, or arrow keys on it). */
  grip: ReactNode
}
