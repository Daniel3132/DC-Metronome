import { useRef } from 'react'
import { MAX_MASTER_VOLUME } from '../../core/constants'
import type { SettingsUpdater } from '../../state/useSettings'
import { VolumeIcon, VolumeMuteIcon } from '../icons/icons'
// Output meter disabled for now; restore together with the commented <LevelMeter> below.
// import { LevelMeter } from '../LevelMeter/LevelMeter'
import { IconButton, Slider } from '../ui/ui'
import './MasterVolume.css'

interface MasterVolumeProps {
  /** settings.mixer.master, 0..MAX_MASTER_VOLUME */
  master: number
  muted: boolean
  onChange: SettingsUpdater
  /** Output peak 0..1 (engine.getLevel). Unused while the level meter is disabled. */
  getLevel: () => number
  /** Poll the output level (while playing). Unused while the level meter is disabled. */
  active: boolean
}

const MAX_PERCENT = Math.round(MAX_MASTER_VOLUME * 100)
/** A drag coming from 100 % or below stops at 100 % until it is pushed this far past it (the boost is opt-in). */
const DETENT_PERCENT = 108

/**
 * Dragging the slider stops at 100 % ("checkpoint") unless pushed well past it; up to MAX_PERCENT is a boost. The
 * keyboard steps through freely.
 */
function detent(next: number, prev: number): number {
  return prev <= 100 && next > 100 && next < DETENT_PERCENT ? 100 : next
}

export function MasterVolume({ master, muted, onChange }: MasterVolumeProps) {
  const percent = Math.round(master * 100)
  // True while a pointer drags the slider (the checkpoint applies to drags only).
  const dragging = useRef(false)

  const setVolume = (value: number) => {
    const next = dragging.current ? detent(value, percent) : value
    // Moving the volume while muted means "I want to hear it": unmute.
    onChange((prev) => ({ ...prev, mixer: { ...prev.mixer, master: next / 100, muted: false } }))
  }
  const toggleMute = () => onChange((prev) => ({ ...prev, mixer: { ...prev.mixer, muted: !prev.mixer.muted } }))

  return (
    <div className={`master-volume${muted ? ' is-muted' : ''}${percent > 100 ? ' is-boosted' : ''}`}>
      <IconButton
        className="master-volume__mute"
        label="Mute"
        title={muted ? 'Unmute (M)' : 'Mute (M)'}
        aria-pressed={muted}
        aria-keyshortcuts="M"
        variant={muted ? 'danger' : 'ghost'}
        icon={muted ? <VolumeMuteIcon size={22} /> : <VolumeIcon size={22} />}
        onClick={toggleMute}
      />
      <div
        className="master-volume__control"
        title="Stops at 100 %; drag further to boost up to 125 %. Alt+click: back to 100 %"
        onPointerDownCapture={() => {
          dragging.current = true
          // The drag can end anywhere on the page.
          const end = () => {
            dragging.current = false
            window.removeEventListener('pointerup', end)
            window.removeEventListener('pointercancel', end)
          }
          window.addEventListener('pointerup', end)
          window.addEventListener('pointercancel', end)
        }}
      >
        <Slider
          className="master-volume__slider"
          label="Volume"
          hideLabel
          value={percent}
          min={0}
          max={MAX_PERCENT}
          marks={[100]}
          defaultValue={100}
          format={(v) => (muted ? 'Muted' : `${v}%`)}
          onChange={setVolume}
        />
        {/* <LevelMeter className="master-volume__meter" orientation="horizontal" getLevel={getLevel} active={active} /> */}
      </div>
    </div>
  )
}
