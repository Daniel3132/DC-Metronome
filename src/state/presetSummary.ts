import { createSection, editedPart, sanitizeSettings } from '../core/settings'
import type { Settings } from '../core/types'

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

/** Default name for saving the current setup. */
export function suggestedName(s: Settings): string {
  const section = editedPart(s)
  return s.program.enabled
    ? `Program, ${plural(s.sections.length, 'section')}`
    : `${s.bpm} BPM ${section.beatsPerBar}/${section.beatUnit}`
}

/**
 * Settings after loading a saved preset: everything from the preset but the volumes. The program is bound to the
 * preset: its sections replace the current ones, and a preset saved without program mode leaves a single section
 * with the preset's rhythm (signature, accents, subdivision).
 */
export function applyPreset(prev: Settings, preset: Settings): Settings {
  const loaded = sanitizeSettings(preset)
  // Volumes belong to the room and the headphones, not to the exercise.
  const next = { ...loaded, mixer: prev.mixer }
  if (loaded.program.enabled) return next
  const { beatsPerBar, beatUnit, beats, subdivision } = loaded.current
  const section = createSection({ name: 'Section 1', beatsPerBar, beatUnit, beats: [...beats], subdivision })
  return { ...next, sections: [section], selected: null, loopSections: [] }
}
