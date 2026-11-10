import type { ReactNode } from 'react'
import type { PlaybackStatus } from '../../core/types'
import { CheckIcon, PlayIcon, StopIcon } from '../icons/icons'
import { Button } from '../ui/ui'
import './Transport.css'

interface TransportProps {
  status: PlaybackStatus
  error: string | null
  /** Shown after playback stopped by itself (e.g. 'Program finished'); null otherwise. */
  finished: string | null
  onToggle: () => Promise<void>
  /** Placed beside the play button (the tap pad). */
  aside?: ReactNode
}

export function Transport({ status, error, finished, onToggle, aside }: TransportProps) {
  const running = status !== 'stopped'
  const label = status === 'starting' ? 'Starting…' : running ? 'Stop' : 'Start'

  return (
    <div className="transport">
      <div className="transport__row">
        <Button
          variant={running ? 'secondary' : 'primary'}
          size="lg"
          className={`transport__play${running ? ' is-running' : ''}`}
          icon={running ? <StopIcon size={20} /> : <PlayIcon size={20} />}
          aria-keyshortcuts="Space"
          aria-busy={status === 'starting' || undefined}
          title={running ? 'Stop (Space)' : 'Start (Space)'}
          onClick={() => void onToggle()}
        >
          {label}
        </Button>
        {aside != null && <div className="transport__aside">{aside}</div>}
      </div>

      {error !== null && (
        <p className="transport__message transport__message--error" role="alert">
          {error}
        </p>
      )}
      <p className="transport__message transport__message--done" role="status">
        {finished !== null && error === null && (
          <>
            <CheckIcon size={16} />
            {finished}
          </>
        )}
      </p>
    </div>
  )
}
