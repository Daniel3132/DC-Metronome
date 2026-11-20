import type { PlaybackSettings, PulseEvent } from './types'

/**
 * What the voice should announce on this pulse, or null. With `voice.announceSections` on in program mode, the downbeat
 * of a section's last bar announces the section that follows (wrapping to the first when the program loops), so the
 * player hears what is coming before it starts. The first bar of playback announces the section it starts with.
 * Nothing is announced for a program of one section, or after the last section of a program that does not loop.
 * Unnamed sections are announced as "Section N".
 */
export function sectionAnnouncement(pulse: PulseEvent, settings: PlaybackSettings): string | null {
  if (!settings.voice.announceSections || !settings.program.enabled || pulse.sectionBars === null) return null
  if (pulse.beat !== 0 || pulse.pulse !== 0) return null

  const count = settings.sections.reduce((max, step) => (step.origin ? Math.max(max, step.origin.section + 1) : max), 0)
  if (count < 2 && pulse.totalBar > 0) return null

  let index: number
  if (pulse.totalBar === 0) {
    index = pulse.sectionIndex
  } else if (pulse.sectionBar === pulse.sectionBars - 1) {
    index = pulse.sectionIndex + 1
    if (index >= count) {
      if (!settings.program.loop) return null
      index = 0
    }
  } else {
    return null
  }

  const step = settings.sections.find((s) => s.origin?.section === index)
  if (!step) return null
  return step.name.trim() || `Section ${index + 1}`
}
