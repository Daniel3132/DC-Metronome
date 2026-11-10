import type { SettingsUpdater } from '../../state/useSettings'
import { VolumeIcon, VolumeMuteIcon } from '../icons/icons'
// Output meter disabled for now; restore together with the commented <LevelMeter> below.
// import { LevelMeter } from '../LevelMeter/LevelMeter'
import { IconButton, Slider } from '../ui/ui'
import './MasterVolume.css'

interface MasterVolumeProps {
  /** settings.mixer.master, 0..1 */
  master: number
  muted: boolean
  onChange: SettingsUpdater
  /** Output peak 0..1 (engine.getLevel). Unused while the level meter is disabled. */
  getLevel: () => number
  /** Poll the output level (while playing). Unused while the level meter is disabled. */
  active: boolean
}

export function MasterVolume({ master, muted, onChange }: MasterVolumeProps) {
  const percent = Math.round(master * 100)

  const setVolume = (value: number) =>
    // Moving the volume while muted means "I want to hear it": unmute.
    onChange((prev) => ({ ...prev, mixer: { ...prev.mixer, master: value / 100, muted: false } }))
  const toggleMute = () => onChange((prev) => ({ ...prev, mixer: { ...prev.mixer, muted: !prev.mixer.muted } }))

  return (
    <div className={`master-volume${muted ? ' is-muted' : ''}`}>
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
      <div className="master-volume__control">
        <Slider
          className="master-volume__slider"
          label="Volume"
          hideLabel
          value={percent}
          min={0}
          max={100}
          format={(v) => (muted ? 'Muted' : `${v}%`)}
          onChange={setVolume}
        />
        {/* <LevelMeter className="master-volume__meter" orientation="horizontal" getLevel={getLevel} active={active} /> */}
      </div>
    </div>
  )
}
