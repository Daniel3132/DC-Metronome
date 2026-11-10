import type { Settings } from '../core/types'
import type { SettingsUpdater } from '../state/useSettings'
import type { MetronomeControls } from '../state/useMetronome'

/** Props every settings panel receives from App. */
export interface PanelProps {
  settings: Settings
  onChange: SettingsUpdater
  metronome: MetronomeControls
}
