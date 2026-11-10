import type { GapSettings, RandomMuteSettings } from '../../core/types'
import { useGapPosition } from '../../state/useGapPosition'
import { usePulse } from '../../state/useMetronome'
import './SilenceStatus.css'

interface SilenceStatusProps {
  gap: GapSettings
  randomMute: RandomMuteSettings
}

/** Longer cycles only get the text readout; the blocks would be too small to read. */
const MAX_BLOCKS = 16

/**
 * Live silence readout for the quick controls: the gap trainer cycle with the current bar marked, whether the bar
 * playing now is silent, and random mute when it is on. Renders nothing while both trainers are off.
 */
export function SilenceStatus({ gap, randomMute }: SilenceStatusProps) {
  const pulse = usePulse()
  const { live, silentNow, position } = useGapPosition(pulse, gap)
  if (!gap.enabled && !randomMute.enabled) return null

  const cycle = gap.playBars + gap.muteBars
  const dropped = pulse?.silentReason === 'random'
  const silent = silentNow || dropped

  let state: string
  if (pulse === null) state = 'Ready'
  else if (silentNow) state = 'Silent bar'
  else if (dropped) state = 'Beat dropped'
  else state = 'Sounding'

  return (
    <div className={`silence-status${silent ? ' is-silent' : ''}${pulse !== null ? ' is-live' : ''}`}>
      {gap.enabled && cycle <= MAX_BLOCKS && (
        <ol className="silence-status__blocks" aria-hidden="true">
          {Array.from({ length: cycle }, (_, i) => (
            <li
              key={i}
              className={[
                'silence-status__block',
                i < gap.playBars ? 'silence-status__block--play' : 'silence-status__block--mute',
                i === position && 'is-current',
              ]
                .filter(Boolean)
                .join(' ')}
            />
          ))}
        </ol>
      )}
      <p className="silence-status__text">
        <span className="silence-status__state">{state}</span>
        {live && position !== null && (
          <span className="silence-status__muted tabular">{` · bar ${position + 1}/${cycle}`}</span>
        )}
        {randomMute.enabled && (
          <span className="silence-status__muted tabular">{` · random ${randomMute.percent} %`}</span>
        )}
      </p>
    </div>
  )
}
