import { describe, expect, it } from 'vitest'
import { MIN_BPM } from './constants'
import { createDefaultSettings, practiceAt, practiceWithStart, sanitizeSettings, withBpm } from './settings'

describe('speed trainer following the main tempo', () => {
  it('aims the trainer at the main tempo and keeps the start ratio', () => {
    const settings = withBpm(createDefaultSettings(), 150)
    expect(settings.bpm).toBe(150)
    expect(settings.practice).toMatchObject({ startBpm: 100, targetBpm: 150, targetRatio: 1.5 })
  })

  it('does not drift when the tempo is nudged one BPM at a time', () => {
    let settings = withBpm(createDefaultSettings(), 120)
    for (let bpm = 121; bpm <= 300; bpm++) settings = withBpm(settings, bpm)
    for (let bpm = 299; bpm >= 120; bpm--) settings = withBpm(settings, bpm)
    expect(settings.practice).toMatchObject({ startBpm: 80, targetBpm: 120 })
  })

  it('clamps the start at the limit but restores it when the tempo comes back up', () => {
    const low = withBpm(createDefaultSettings(), 70)
    expect(low.practice.startBpm).toBe(MIN_BPM)
    expect(withBpm(low, 120).practice.startBpm).toBe(80)
  })

  it('remembers a new ratio when the start is set', () => {
    const practice = practiceWithStart(createDefaultSettings().practice, 60)
    expect(practice.targetRatio).toBe(2)
    expect(practiceAt(practice, 180)).toMatchObject({ startBpm: 90, targetBpm: 180 })
  })

  it('returns the same settings when nothing changes', () => {
    const settings = createDefaultSettings()
    expect(withBpm(settings, settings.bpm)).toBe(settings)
  })

  it('derives the ratio for settings saved before it existed', () => {
    const settings = sanitizeSettings({ practice: { startBpm: 80, targetBpm: 100, stepBpm: 5, everyBars: 4 } })
    expect(settings.practice.targetRatio).toBe(1.25)
  })
})
