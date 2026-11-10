import { useId } from 'react'
import { SHORTCUTS } from '../../state/useKeyboardShortcuts'
import { XIcon } from '../icons/icons'
import { Button, IconButton } from '../ui/ui'
import './ShortcutsHelp.css'

/** "Shortcuts" button opening a native popover (Escape and clicking outside close it). */
export function ShortcutsHelp() {
  const id = useId()
  const popoverId = `${id}-shortcuts`
  const titleId = `${id}-title`

  return (
    <>
      <Button variant="ghost" size="sm" className="shortcuts-help__trigger" popoverTarget={popoverId}>
        Shortcuts
      </Button>
      <div id={popoverId} popover="auto" className="shortcuts-help" role="dialog" aria-labelledby={titleId}>
        <div className="shortcuts-help__header">
          <h2 id={titleId} className="shortcuts-help__title">
            Keyboard shortcuts
          </h2>
          <IconButton
            label="Close"
            size="sm"
            icon={<XIcon size={18} />}
            popoverTarget={popoverId}
            popoverTargetAction="hide"
          />
        </div>
        <dl className="shortcuts-help__list">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.description} className="shortcuts-help__row">
              <dt className="shortcuts-help__keys">
                {shortcut.keys.map((key, i) => (
                  <span key={key}>
                    {i > 0 && <span className="shortcuts-help__plus"> + </span>}
                    <kbd className="shortcuts-help__kbd">{key}</kbd>
                  </span>
                ))}
              </dt>
              <dd className="shortcuts-help__action">{shortcut.description}</dd>
            </div>
          ))}
        </dl>
        <p className="shortcuts-help__note">Shortcuts pause while you type in a field.</p>
      </div>
    </>
  )
}
