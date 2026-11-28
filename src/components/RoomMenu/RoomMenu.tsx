import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { parseRoomCode, type RoomSnapshot } from '../../state/room'
import { Button, IconButton } from '../ui/ui'
import { CheckIcon, XIcon } from '../icons/icons'
import './RoomMenu.css'

interface RoomMenuProps {
  room: RoomSnapshot | null
  onCreate: () => void
  onJoin: (code: string) => void
  onLeave: () => void
  onEnableAudio: () => void
}

export function RoomMenu({ room, onCreate, onJoin, onLeave, onEnableAudio }: RoomMenuProps) {
  const id = useId()
  const popoverId = `${id}-room`
  const titleId = `${id}-title`
  const popover = useRef<HTMLDivElement>(null)
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')

  // Opened from an invite link: show the room so the guest can enable audio. The URL keeps ?room= while in a room,
  // so this runs on load only, not on every status change.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('room')) {
      try { popover.current?.showPopover() } catch { /* Already open, or the browser is navigating away. */ }
    }
  }, [])

  // A failed join (an invite to a closed room, a bad configuration) should be seen, not hidden behind the button.
  useEffect(() => {
    if (!room?.error) return
    try { popover.current?.showPopover() } catch { /* Already open. */ }
  }, [room?.error])

  async function copyInvite() {
    if (!room?.inviteUrl) return
    try {
      await navigator.clipboard.writeText(room.inviteUrl)
      setCopied(true)
      setCopyError('')
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopyError('Copy was blocked by the browser. Select and copy the link above.')
    }
  }

  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onJoin(code)
  }

  return (
    <>
      <Button variant={room?.status === 'connected' ? 'secondary' : 'ghost'} size="sm" popoverTarget={popoverId}>
        {room?.status === 'connected' ? 'Room · Live' : room?.status === 'reconnecting' ? 'Room · Reconnecting' : 'Room'}
      </Button>
      <div ref={popover} id={popoverId} popover="auto" className="room-menu" role="dialog" aria-labelledby={titleId}>
        <header className="room-menu__header">
          <div>
            <h2 id={titleId}>Metronome room</h2>
            <p>Share a live rhythm with people you invite.</p>
          </div>
          <IconButton label="Close" size="sm" icon={<XIcon size={18} />} popoverTarget={popoverId} popoverTargetAction="hide" />
        </header>

        {room && (room.status === 'connected' || room.status === 'reconnecting') ? (
          <div className="room-menu__active">
            <div className={`room-menu__status${room.status === 'reconnecting' ? ' is-reconnecting' : ''}`} role="status">
              <span aria-hidden="true" /> {room.status === 'connected' ? 'Connected' : 'Reconnecting…'}
            </div>
            <label className="room-menu__label" htmlFor={`${id}-invite`}>Invite link</label>
            <input id={`${id}-invite`} className="room-menu__input" readOnly value={room.inviteUrl} onFocus={(event) => event.currentTarget.select()} />
            <div className="room-menu__code-row">
              <span>Room code <strong>{room.code}</strong></span>
              <Button variant="secondary" size="sm" onClick={() => void copyInvite()} icon={copied ? <CheckIcon size={16} /> : undefined}>
                {copied ? 'Copied' : 'Copy invite'}
              </Button>
            </div>
            {copyError && <p className="room-menu__error" role="status">{copyError}</p>}
            <p className="room-menu__note">Everyone can change the shared tempo and rhythm. Sounds and mixer stay local; programs and trainers pause until you leave.</p>
            <Button variant="secondary" size="sm" disabled={room.status !== 'connected'} onClick={onEnableAudio}>Enable audio on this device</Button>
            <Button variant="ghost" size="sm" onClick={onLeave}>Leave room</Button>
          </div>
        ) : (
          <div className="room-menu__actions">
            {room?.error && <p className="room-menu__error" role="alert">{room.error}</p>}
            {room?.status === 'connecting' && !room.error && <p className="room-menu__note" role="status">Connecting to room {room.code}…</p>}
            <Button variant="primary" size="md" onClick={onCreate}>Create a room</Button>
            <div className="room-menu__divider"><span>or join an existing room</span></div>
            <form onSubmit={join} className="room-menu__join">
              <label className="room-menu__label" htmlFor={`${id}-code`}>Room code</label>
              <div className="room-menu__code-row">
                <input
                  id={`${id}-code`}
                  className="room-menu__input room-menu__input--code"
                  value={code}
                  onChange={(event) => setCode(event.currentTarget.value)}
                  placeholder="Room code or invite link"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button variant="secondary" size="sm" type="submit" disabled={parseRoomCode(code) === null}>Join</Button>
              </div>
            </form>
            <p className="room-menu__note">Room sync is temporary. Rooms end when everyone leaves.</p>
          </div>
        )}
      </div>
    </>
  )
}
