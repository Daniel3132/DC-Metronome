import type { PanelProps } from '../panelTypes'
import { ProgramPanel } from '../ProgramPanel/ProgramPanel'
import { QuickControls } from '../QuickControls/QuickControls'
import './MainPanel.css'

/**
 * The main ("Quick") tab: a grid of small cells with everything used while practising, then the program matrix.
 * Random mute, Voice, Sound, Mixer and Presets keep their own tabs.
 */
export function MainPanel(props: PanelProps) {
  const { settings, onChange, metronome } = props
  return (
    <div className="main-panel">
      <QuickControls
        settings={settings}
        onChange={onChange}
        getLevel={metronome.getLevel}
        active={metronome.playback.status !== 'stopped'}
      />
      <ProgramPanel {...props} />
    </div>
  )
}
