import { describe, expect, it } from 'vitest'
import { BUILT_IN_SOUNDS } from '../core/constants'
import type { SoundRole } from '../core/types'
import { synthesizeBuiltInSound } from './sounds'

const ROLES: readonly SoundRole[] = ['accent', 'medium', 'beat', 'sub']
const SAMPLE_RATES = [44100, 48000]

function peakOf(samples: Float32Array, from = 0, to = samples.length): number {
  let peak = 0
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples[i]))
  return peak
}

describe('synthesizeBuiltInSound', () => {
  for (const { id } of BUILT_IN_SOUNDS) {
    describe(id, () => {
      for (const sampleRate of SAMPLE_RATES) {
        for (const role of ROLES) {
          it(`${role} @ ${sampleRate} Hz is a short, clean, normalized one-shot`, () => {
            const samples = synthesizeBuiltInSound(id, role, sampleRate)
            expect(samples.length).toBeGreaterThan(0)
            expect(samples.length).toBeLessThanOrEqual(0.5 * sampleRate)
            expect(samples.every(Number.isFinite)).toBe(true)

            const peak = peakOf(samples)
            expect(peak).toBeLessThanOrEqual(1)
            expect(peak).toBeGreaterThan(0.2)
            expect(peak).toBeCloseTo(role === 'sub' ? 0.6 : 0.9, 2)

            // Tight timing: the hit is there right away, not after a swell.
            expect(peakOf(samples, 0, Math.round(0.002 * sampleRate))).toBeGreaterThanOrEqual(0.7 * peak)

            // No click at the tail.
            expect(Math.abs(samples[samples.length - 1])).toBeLessThan(1e-3)
            expect(peakOf(samples, samples.length - Math.round(0.001 * sampleRate))).toBeLessThan(0.01)
          })
        }

        it(`is deterministic @ ${sampleRate} Hz`, () => {
          for (const role of ROLES) {
            expect(synthesizeBuiltInSound(id, role, sampleRate)).toEqual(synthesizeBuiltInSound(id, role, sampleRate))
          }
        })

        it(`accent, sub-accent and sub differ @ ${sampleRate} Hz`, () => {
          const beat = synthesizeBuiltInSound(id, 'beat', sampleRate)
          expect(synthesizeBuiltInSound(id, 'accent', sampleRate)).not.toEqual(beat)
          expect(synthesizeBuiltInSound(id, 'sub', sampleRate)).not.toEqual(beat)
          const medium = synthesizeBuiltInSound(id, 'medium', sampleRate)
          expect(medium).not.toEqual(beat)
          expect(medium).not.toEqual(synthesizeBuiltInSound(id, 'accent', sampleRate))
        })
      }
    })
  }
})
