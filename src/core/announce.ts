import type { PlaybackSettings, PlaySection, PulseEvent } from './types'

/**
 * The beat of a section's last bar that announces the next section: its last sub-accent (6/8 → beat 4, 2+2+3 → beat
 * 5), so the name falls on the bar's last group; without one, the last beat, one beat before the next section.
 */
export function cueBeat(step: Pick<PlaySection, 'beats'>): number {
  const lastMedium = step.beats.lastIndexOf('medium')
  return lastMedium > 0 ? lastMedium : Math.max(0, step.beats.length - 1)
}

/**
 * What the voice should announce on this pulse, or null. With `voice.announceSections` on in program mode, a section's
 * last bar announces the section that follows (wrapping to the first when the program loops) on its cue beat
 * (cueBeat), so the player hears what is coming right before it starts. The first beat of playback announces the
 * section it starts with. Nothing is announced for a program of one section, or after the last section of a program
 * that does not loop. Unnamed sections are announced as "Section N".
 */
export function sectionAnnouncement(pulse: PulseEvent, settings: PlaybackSettings): string | null {
  if (!settings.voice.announceSections || !settings.program.enabled || pulse.sectionBars === null) return null
  if (pulse.pulse !== 0) return null

  const count = settings.sections.reduce((max, step) => (step.origin ? Math.max(max, step.origin.section + 1) : max), 0)
  const nameOf = (index: number): string | null => {
    const step = settings.sections.find((s) => s.origin?.section === index)
    return step ? step.name.trim() || `Section ${index + 1}` : null
  }

  if (pulse.totalBar === 0 && pulse.beat === 0) return nameOf(pulse.sectionIndex)
  if (count < 2 || pulse.sectionBar !== pulse.sectionBars - 1) return null

  // The last bar belongs to the section's last step (its last part, last repeat).
  const last = settings.sections.findLast((s) => s.origin?.section === pulse.sectionIndex)
  if (!last || pulse.beat !== cueBeat(last)) return null

  let index = pulse.sectionIndex + 1
  if (index >= count) {
    if (!settings.program.loop) return null
    index = 0
  }
  return nameOf(index)
}
