import { editedPart, sanitizeSettings } from '../core/settings'
import type { Settings } from '../core/types'
import type { FactoryPreset } from './factoryPresets'

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** One line about what a preset plays: "120 BPM · 4 sections · gap 2:1 · voice". */
export function describeSettings(s: Settings): string {
  const section = editedPart(s)
  const parts = [
    s.practice.enabled ? `${s.practice.startBpm} → ${s.practice.targetBpm} BPM` : `${s.bpm} BPM`,
    s.program.enabled ? `program, ${plural(s.sections.length, 'section')}` : `${section.beatsPerBar}/${section.beatUnit}`,
  ]
  if (s.tempoPercent !== 100) parts.push(`${s.tempoPercent} %`)
  if (s.gap.enabled) parts.push(`gap ${s.gap.playBars}:${s.gap.muteBars}`)
  if (s.voice.enabled) parts.push('voice')
  return parts.join(' · ')
}

/** The same one-line summary as a saved preset gets, for a factory preset. */
export function describeFactoryPreset(preset: FactoryPreset): string {
  return describeSettings(preset.build())
}

/** Default name for saving the current setup. */
export function suggestedName(s: Settings): string {
  const section = editedPart(s)
  return s.program.enabled
    ? `Program, ${plural(s.sections.length, 'section')}`
    : `${s.bpm} BPM ${section.beatsPerBar}/${section.beatUnit}`
}

/** Settings after loading a saved preset: everything from the preset (program included) but the volumes. */
export function applyPreset(prev: Settings, preset: Settings): Settings {
  // Volumes belong to the room and the headphones, not to the exercise.
  return { ...sanitizeSettings(preset), mixer: prev.mixer }
}

/** Settings after loading a factory preset: it keeps your sounds, voice pack, volumes and flash. */
export function applyFactoryPreset(prev: Settings, preset: FactoryPreset): Settings {
  const built = preset.build()
  return {
    ...built,
    mixer: prev.mixer,
    sounds: prev.sounds,
    voice: { ...built.voice, pack: prev.voice.pack },
    visual: prev.visual,
  }
}
