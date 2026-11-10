import { BEAT_UNITS, MAX_BEATS_PER_BAR, SUBDIVISIONS } from '../../core/constants'
import { COMMON_SIGNATURES, resizeBeats } from '../../core/meter'
import { defaultBeats } from '../../core/settings'
import type { BeatUnit, Section, SubdivisionId } from '../../core/types'
import { FlashIcon } from '../icons/icons'
import type { PanelProps } from '../panelTypes'
import { RhythmNotation } from '../RhythmNotation/RhythmNotation'
import { Panel, Segmented, Select, Stepper, Toggle } from '../ui/ui'
import './MeterPanel.css'

const UNIT_NAMES: Readonly<Record<BeatUnit, string>> = {
  2: 'Half note',
  4: 'Quarter note',
  8: 'Eighth note',
  16: 'Sixteenth note',
}

const UNIT_OPTIONS = BEAT_UNITS.map((unit) => ({ value: unit, label: String(unit), title: UNIT_NAMES[unit] }))

const SUBDIVISION_OPTIONS = SUBDIVISIONS.map((sub) => ({
  value: sub.id,
  title: sub.label,
  label: (
    <span className="meter-panel__subdivision">
      <RhythmNotation subdivision={sub.id} height={24} className="meter-panel__notation" />
      <span>{sub.label}</span>
    </span>
  ),
}))

/**
 * Rhythm tab: meter and subdivision of the active section, plus the beat flash. Accents are edited on the stage
 * (tap a beat pad) and with the groupings in the quick controls.
 */
export function MeterPanel({ settings, onChange }: PanelProps) {
  const { sections } = settings
  const index = Math.min(Math.max(0, settings.activeSection), sections.length - 1)
  const section = sections[index]

  function updateSection(fn: (s: Section) => Section) {
    const id = section.id
    onChange((prev) => ({ ...prev, sections: prev.sections.map((s) => (s.id === id ? fn(s) : s)) }))
  }

  const setBeatsPerBar = (count: number) =>
    updateSection((s) => ({ ...s, beatsPerBar: count, beats: resizeBeats(s.beats, count) }))
  const setBeatUnit = (unit: BeatUnit) => updateSection((s) => ({ ...s, beatUnit: unit }))
  // Picking a named meter means "set me up for 6/8", so the accents follow it (6/8: strong 1, medium 4).
  const setSignature = (signature: string) => {
    const [count, unit] = signature.split('/').map(Number) as [number, BeatUnit]
    updateSection((s) => ({ ...s, beatsPerBar: count, beatUnit: unit, beats: defaultBeats(count, unit) }))
  }
  const setSubdivision = (id: SubdivisionId) => updateSection((s) => ({ ...s, subdivision: id }))
  const setFlash = (flash: boolean) => onChange((prev) => ({ ...prev, visual: { ...prev.visual, flash } }))

  const signature = `${section.beatsPerBar}/${section.beatUnit}`

  const sectionOptions = sections.map((s, i) => ({
    value: String(i),
    label: `${i + 1}. ${s.name || 'Section'} (${s.beatsPerBar}/${s.beatUnit})`,
  }))

  return (
    <div className="meter-panel">
      <div className="meter-panel__columns">
        <Panel
          title="Time signature"
          headerAction={
            <span className="meter-panel__signature tabular" aria-hidden="true">
              <span>{section.beatsPerBar}</span>
              <span>{section.beatUnit}</span>
            </span>
          }
        >
          {sections.length > 1 && (
            <Select
              label="Section"
              hideLabel
              value={String(index)}
              options={sectionOptions}
              onChange={(value) => onChange((prev) => ({ ...prev, activeSection: Number(value) }))}
            />
          )}
          <Segmented
            className="meter-panel__common"
            label="Common time signatures"
            size="sm"
            wrap
            value={signature}
            options={COMMON_SIGNATURES.map((sig) => ({ value: sig, label: sig }))}
            onChange={setSignature}
          />
          <div className="meter-panel__meter-row">
            <Stepper
              label="Beats"
              size="sm"
              value={section.beatsPerBar}
              min={1}
              max={MAX_BEATS_PER_BAR}
              onChange={setBeatsPerBar}
            />
            <div className="meter-panel__unit" role="group" aria-label="Beat unit">
              <span className="ui-field-label" aria-hidden="true">
                Beat unit
              </span>
              <Segmented label="Beat unit" size="sm" value={section.beatUnit} options={UNIT_OPTIONS} onChange={setBeatUnit} />
            </div>
          </div>
        </Panel>

        <Panel title="Subdivision" description="Clicks between the beats, written for one beat.">
          <Segmented
            className="meter-panel__subdivisions"
            label="Subdivision"
            size="sm"
            wrap
            value={section.subdivision}
            options={SUBDIVISION_OPTIONS}
            onChange={setSubdivision}
          />
        </Panel>
      </div>

      <div className="meter-panel__flash" title="Flashes the screen on every beat, brighter on accents.">
        <FlashIcon size={18} />
        <Toggle label="Flash on beat" size="sm" checked={settings.visual.flash} onChange={setFlash} />
      </div>
    </div>
  )
}
