import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

/** Pixels a mouse or pen must move with the button down before a press becomes a drag. */
const DRAG_THRESHOLD = 6
/** Touch must hold still this long before a drag starts, so swiping over the items still scrolls the page. */
const LONG_PRESS_MS = 320
/** Moving further than this before the long press fires is a scroll, not a drag. */
const TOUCH_SLOP = 10

export interface ReorderState {
  /** Index of the item being dragged, or null. */
  from: number | null
  /** Insertion point 0..count while dragging over the list (before item i, or count for the end), else null. */
  insertAt: number | null
}

export interface Reorder extends ReorderState {
  /** Spread on every item's root element; the items must be siblings (e.g. the li of one list). */
  itemProps: (index: number) => {
    'data-reorder-index': number
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  }
  /** True right after a drag ended: the click that follows the drop must not also select the item. */
  consumeClick: () => boolean
  /** Class names for an item: 'is-dragging' and the drop marker ('is-drop-before' / 'is-drop-after'). */
  itemClass: (index: number) => string
}

interface Pending {
  index: number
  pointerId: number
  touch: boolean
  startX: number
  startY: number
  el: HTMLElement
  timer: number | null
}

/**
 * Drag to reorder the items of a list or wrapping grid. Mouse and pen drag once moved a few pixels; touch drags after a
 * long press (a quick swipe keeps scrolling). The dragged item follows the pointer and a marker shows where it lands;
 * dropping calls `onMove(from, to)` with the item's new index. Escape cancels. Keyboard users get separate buttons.
 */
export function useReorder(count: number, onMove: (from: number, to: number) => void): Reorder {
  const [state, setState] = useState<ReorderState>({ from: null, insertAt: null })
  const pending = useRef<Pending | null>(null)
  const dragging = useRef<{ el: HTMLElement; rects: DOMRect[]; from: number; insertAt: number | null } | null>(null)
  const suppressClick = useRef(false)
  const cleanup = useRef<(() => void) | null>(null)
  const onMoveRef = useRef(onMove)
  const countRef = useRef(count)

  useEffect(() => {
    onMoveRef.current = onMove
    countRef.current = count
  })

  // Unmounting mid-drag must not leave listeners behind.
  useEffect(() => () => cleanup.current?.(), [])

  function finish(commit: boolean) {
    const drag = dragging.current
    const press = pending.current
    if (press?.timer != null) window.clearTimeout(press.timer)
    pending.current = null
    dragging.current = null
    cleanup.current?.()
    cleanup.current = null
    if (!drag) return
    drag.el.style.transform = ''
    setState({ from: null, insertAt: null })
    // The browser follows the pointerup with a click on the item: swallow it.
    suppressClick.current = true
    window.setTimeout(() => {
      suppressClick.current = false
    }, 0)
    if (!commit || drag.insertAt === null) return
    const to = drag.insertAt > drag.from ? drag.insertAt - 1 : drag.insertAt
    if (to !== drag.from) onMoveRef.current(drag.from, to)
  }

  function begin(press: Pending) {
    const items = Array.from(press.el.parentElement?.querySelectorAll<HTMLElement>(':scope > [data-reorder-index]') ?? [])
    const rects = Array.from({ length: countRef.current }, (_, i) => {
      const el = items.find((item) => item.dataset.reorderIndex === String(i))
      return el?.getBoundingClientRect() ?? new DOMRect()
    })
    dragging.current = { el: press.el, rects, from: press.index, insertAt: null }
    if (press.touch) navigator.vibrate?.(10)
    setState({ from: press.index, insertAt: null })
  }

  function track(x: number, y: number) {
    const drag = dragging.current
    const press = pending.current
    if (!drag || !press) return
    drag.el.style.transform = `translate(${x - press.startX}px, ${y - press.startY}px)`
    const over = drag.rects.findIndex((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
    if (over < 0) return
    const rect = drag.rects[over]
    const insertAt = x < rect.left + rect.width / 2 ? over : over + 1
    // Dropping right before or after itself changes nothing: show no marker.
    const next = insertAt === drag.from || insertAt === drag.from + 1 ? null : insertAt
    if (next !== drag.insertAt) {
      drag.insertAt = next
      setState({ from: drag.from, insertAt: next })
    }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLElement>, index: number) {
    if (e.button !== 0 || pending.current || countRef.current < 2) return
    const touch = e.pointerType === 'touch'
    const press: Pending = {
      index,
      pointerId: e.pointerId,
      touch,
      startX: e.clientX,
      startY: e.clientY,
      el: e.currentTarget,
      timer: null,
    }
    pending.current = press

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== press.pointerId) return
      const distance = Math.hypot(ev.clientX - press.startX, ev.clientY - press.startY)
      if (!dragging.current) {
        if (touch) {
          if (distance > TOUCH_SLOP) finish(false)
          return
        }
        if (distance < DRAG_THRESHOLD) return
        begin(press)
      }
      ev.preventDefault()
      track(ev.clientX, ev.clientY)
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === press.pointerId) finish(true)
    }
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId === press.pointerId) finish(false)
    }
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && dragging.current) {
        ev.preventDefault()
        ev.stopPropagation()
        finish(false)
      }
    }
    // While dragging on touch the page must not scroll (touch-action cannot change mid-gesture).
    const touchMove = (ev: TouchEvent) => {
      if (dragging.current && ev.cancelable) ev.preventDefault()
    }
    const contextMenu = (ev: Event) => {
      if (pending.current) ev.preventDefault()
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
    window.addEventListener('touchmove', touchMove, { passive: false })
    window.addEventListener('contextmenu', contextMenu)
    cleanup.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('touchmove', touchMove)
      window.removeEventListener('contextmenu', contextMenu)
    }

    if (touch) {
      press.timer = window.setTimeout(() => {
        press.timer = null
        if (pending.current === press) begin(press)
      }, LONG_PRESS_MS)
    }
  }

  return {
    ...state,
    itemProps: (index) => ({
      'data-reorder-index': index,
      onPointerDown: (e) => onPointerDown(e, index),
    }),
    consumeClick: () => suppressClick.current,
    itemClass: (index) =>
      [
        state.from === index && 'is-dragging',
        state.insertAt === index && 'is-drop-before',
        state.insertAt === count && index === count - 1 && 'is-drop-after',
      ]
        .filter(Boolean)
        .join(' '),
  }
}
