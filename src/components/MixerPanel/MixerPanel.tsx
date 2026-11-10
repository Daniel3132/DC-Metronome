import { SOUND_ROLES } from '../../core/constants'
import { createDefaultSettings } from '../../core/settings'
import type { MixerSettings, SoundRole } from '../../core/types'
import { SpeakerIcon, VolumeIcon, VolumeMuteIcon } from '../icons/icons'
import { LevelMeter } from '../LevelMeter/LevelMeter'
import type { PanelProps } from '../panelTypes'
import { Badge, Button, IconButton, Panel } from '../ui/ui'
import { VolumeFader } from '../VolumeFader/VolumeFader'
import './MixerPanel.css'

type GainKey = Exclude<keyof MixerSettings, 'muted'>

const CLICK_CHANNELS: readonly { role: SoundRole; label: string }[] = SOUND_ROLES

const DEFAULT_MIXER: MixerSettings = createDefaultSettings().mixer

function isDefaultMixer(mixer: MixerSettings): boolean {
  return (Object.keys(DEFAULT_MIXER) as (keyof MixerSettings)[]).every((key) => mixer[key] === DEFAULT_MIXER[key])
}

// Auditioning is best-effort: a failed preview must never surface as an unhandled rejection.
function quietly(play: () => Promise<void>): void {
  try {
    play().catch(() => {})
  } catch {
    // Same as above, for an engine that throws synchronously.
  }
}

export function MixerPanel({ settings, onChange, metronome }: PanelProps) {
  const { mixer } = settings
  const playing = metronome.playback.status === 'playing'

  function setGain(key: GainKey, value: number) {
    onChange((prev) => (prev.mixer[key] === value ? prev : { ...prev, mixer: { ...prev.mixer, [key]: value } }))
  }

  function setMuted(muted: boolean) {
    onChange((prev) => (prev.mixer.muted === muted ? prev : { ...prev, mixer: { ...prev.mixer, muted } }))
  }

  function reset() {
    onChange((prev) => ({ ...prev, mixer: createDefaultSettings().mixer }))
  }

  return (
    <Panel
      className="mixer-panel"
      title="Mixer"
      description="Volume of each part of the click and the counting voice. Changes apply instantly."
      headerAction={
        <>
          {mixer.muted && <Badge tone="warning">Muted</Badge>}
          <Button size="sm" variant="ghost" onClick={reset} disabled={isDefaultMixer(mixer)}>
            Reset
          </Button>
        </>
      }
    >
      <div className="mixer-panel__scroller">
        <div className="mixer-panel__strips">
          <VolumeFader
            className="mixer-panel__master"
            label="Master"
            value={mixer.master}
            onChange={(value) => setGain('master', value)}
            dimmed={mixer.muted}
            beside={<LevelMeter active={playing} getLevel={metronome.getLevel} />}
          >
            <Button
              size="sm"
              variant={mixer.muted ? 'danger' : 'secondary'}
              aria-pressed={mixer.muted}
              icon={mixer.muted ? <VolumeMuteIcon size={18} /> : <VolumeIcon size={18} />}
              onClick={() => setMuted(!mixer.muted)}
            >
              Mute
            </Button>
          </VolumeFader>

          <div className="mixer-panel__divider" aria-hidden="true" />

          {CLICK_CHANNELS.map(({ role, label }) => (
            <VolumeFader
              key={role}
              label={label}
              value={mixer[role]}
              onChange={(value) => setGain(role, value)}
              dimmed={mixer.muted}
            >
              <IconButton
                size="sm"
                label={`Play ${label.toLowerCase()} sound`}
                icon={<SpeakerIcon size={18} />}
                onClick={() => quietly(() => metronome.previewSound(settings.sounds[role], role))}
              />
            </VolumeFader>
          ))}

          <VolumeFader
            label="Voice"
            value={mixer.voice}
            onChange={(value) => setGain('voice', value)}
            dimmed={mixer.muted}
          >
            <IconButton
              size="sm"
              label="Play voice"
              icon={<SpeakerIcon size={18} />}
              onClick={() => quietly(() => metronome.previewVoice('1'))}
            />
          </VolumeFader>
        </div>
      </div>
    </Panel>
  )
}
