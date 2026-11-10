import type { BuiltInSoundId, SoundRole } from '../core/types'

type Samples = Float32Array<ArrayBuffer>
type FilterType = 'lowpass' | 'highpass' | 'bandpass'
type Filter = readonly [type: FilterType, frequency: number, q: number]
type PerRole<T> = readonly [accent: T, beat: T, sub: T]

interface Target {
  readonly sr: number
  readonly out: Samples
}

interface Synth extends Target {
  /** Deterministic white noise in [-1, 1). */
  readonly rand: () => number
}

interface Recipe {
  /** Seconds. */
  duration: number
  /** Raised-cosine fade at the tail, in seconds. */
  fade: number
  render: (s: Synth) => void
}

interface PartialOptions {
  /** Start phase in radians; π/2 starts at full amplitude for a harder transient. */
  phase?: number
  /** Initial pitch as a ratio of the final pitch, settling with `glideTau` (strike pitch drop, kick sweep). */
  glide?: number
  glideTau?: number
}

const TWO_PI = Math.PI * 2
const HALF_PI = Math.PI / 2
const PEAK: Readonly<Record<SoundRole, number>> = { accent: 0.9, medium: 0.9, beat: 0.9, sub: 0.6 }
/** Short enough to keep the onset tight, long enough to avoid a hard step at sample 0. */
const ATTACK = 0.001
/** Partials above this fraction of the sample rate are left out (no aliasing). */
const MAX_FREQUENCY = 0.45

/** The six square-oscillator pitches of the TR-808 cymbal/hi-hat circuit; scaled up they give a metallic cluster. */
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800] as const
/** Free-free bar modes (triangle / glockenspiel-like): [frequency ratio, amplitude, decay factor]. */
const BELL_PARTIALS = [
  [1, 1, 1],
  [1.0034, 0.35, 0.9], // slightly detuned twin: slow shimmer
  [2.756, 0.5, 0.45],
  [5.404, 0.25, 0.22],
  [8.933, 0.12, 0.12],
] as const

/** The value for `role`; the sub-accent sits halfway (geometrically) between accent and beat, e.g. a pitch in between. */
function at(role: SoundRole, values: PerRole<number>): number {
  if (role === 'medium') return Math.sqrt(values[0] * values[1])
  return values[role === 'accent' ? 0 : role === 'beat' ? 1 : 2]
}

/** mulberry32: tiny seeded PRNG so every render is bit-identical. */
function createNoise(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
  }
}

/** FNV-1a. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** In-place RBJ-cookbook biquad (bandpass has 0 dB peak gain). */
function biquad(x: Samples, sr: number, type: FilterType, frequency: number, q: number): void {
  const w0 = (TWO_PI * Math.min(frequency, sr * MAX_FREQUENCY)) / sr
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  let b0: number
  let b1: number
  let b2: number
  if (type === 'lowpass') {
    b0 = (1 - cos) / 2
    b1 = 1 - cos
    b2 = b0
  } else if (type === 'highpass') {
    b0 = (1 + cos) / 2
    b1 = -(1 + cos)
    b2 = b0
  } else {
    b0 = alpha
    b1 = 0
    b2 = -alpha
  }
  const a0 = 1 + alpha
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  b0 /= a0
  b1 /= a0
  b2 /= a0
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i]
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
    x[i] = y0
  }
}

/** Exponentially damped sine (one resonant mode), optionally with a pitch glide. */
function partial(target: Target, frequency: number, amp: number, tau: number, options: PartialOptions = {}): void {
  const { sr, out } = target
  const glide = options.glide ?? 1
  if (frequency * Math.max(1, glide) >= sr * MAX_FREQUENCY) return
  const glideTau = options.glideTau ?? 0.002
  // Past ~16 time constants the mode is below -130 dB.
  const end = Math.min(out.length, Math.ceil(tau * 16 * sr))
  let phase = options.phase ?? 0
  for (let i = 0; i < end; i++) {
    const t = i / sr
    out[i] += amp * Math.exp(-t / tau) * Math.sin(phase)
    phase += (TWO_PI * frequency * (1 + (glide - 1) * Math.exp(-t / glideTau))) / sr
  }
}

/** Band-limited square wave (odd harmonics below `limit` Hz) added to the target. */
function square(target: Target, frequency: number, amp: number, limit: number): void {
  const { sr, out } = target
  const top = Math.min(limit, sr * MAX_FREQUENCY)
  for (let k = 1; k * frequency < top; k += 2) {
    const w = (TWO_PI * k * frequency) / sr
    const a = (amp * 4) / (Math.PI * k)
    for (let i = 0; i < out.length; i++) out[i] += a * Math.sin(w * i)
  }
}

/** Render into a scratch buffer, filter it, and mix it into the synth output. */
function layer(s: Synth, amp: number, filters: readonly Filter[], fill: (target: Target) => void): void {
  const target: Target = { sr: s.sr, out: new Float32Array(s.out.length) }
  fill(target)
  for (const [type, frequency, q] of filters) biquad(target.out, s.sr, type, frequency, q)
  for (let i = 0; i < target.out.length; i++) s.out[i] += amp * target.out[i]
}

/** Exponentially decaying (filtered) noise burst. */
function noise(s: Synth, amp: number, tau: number, filters: readonly Filter[] = []): void {
  layer(s, amp, filters, ({ out }) => {
    for (let i = 0; i < out.length; i++) out[i] = s.rand() * Math.exp(-i / (tau * s.sr))
  })
}

const RECIPES: Readonly<Record<BuiltInSoundId, (role: SoundRole) => Recipe>> = {
  // Short resonant blip with a noise snap; roles a fourth apart.
  click: (role) => {
    const f = at(role, [2133, 1600, 1200])
    const tau = at(role, [0.0045, 0.004, 0.003])
    return {
      duration: at(role, [0.025, 0.022, 0.016]),
      fade: 0.004,
      render(s) {
        partial(s, f, 1, tau, { phase: HALF_PI })
        partial(s, f * 2.13, 0.3, tau * 0.5, { phase: HALF_PI })
        noise(s, 0.5, 0.0008, [['highpass', 3000, 0.7]])
      },
    }
  },

  // Pure sine: accent an octave above the beat, sub a fourth below.
  beep: (role) => ({
    duration: at(role, [0.07, 0.06, 0.045]),
    fade: 0.015,
    render(s) {
      partial(s, at(role, [2000, 1000, 750]), 1, 0.1)
    },
  }),

  woodblock: (role) => {
    const f = at(role, [1200, 950, 800])
    const tau = at(role, [0.026, 0.022, 0.016])
    return {
      duration: at(role, [0.12, 0.1, 0.075]),
      fade: 0.012,
      render(s) {
        partial(s, f, 1, tau, { glide: 1.06 })
        partial(s, f * 2.57, 0.35, tau * 0.3, { glide: 1.03 })
        noise(s, 0.9, 0.001, [['bandpass', f * 3.2, 1]])
      },
    }
  },

  // TR-808 style: two squares at 540 + 800 Hz, a fast initial drop then a short ring.
  cowbell: (role) => {
    const pitch = at(role, [1.189, 1, 0.841]) // minor third up / down
    const tail = at(role, [0.075, 0.06, 0.04])
    return {
      duration: at(role, [0.22, 0.18, 0.12]),
      fade: 0.03,
      render(s) {
        const body: Target = { sr: s.sr, out: new Float32Array(s.out.length) }
        square(body, 540 * pitch, 1, 8000)
        square(body, 800 * pitch, 1, 8000)
        for (let i = 0; i < body.out.length; i++) {
          const t = i / s.sr
          body.out[i] *= 0.6 * Math.exp(-t / 0.005) + 0.4 * Math.exp(-t / tail)
        }
        // A wide band-pass: a narrow one would ring up slowly and smear the onset.
        const ring = body.out.slice()
        biquad(ring, s.sr, 'bandpass', 2000 * pitch, 0.8)
        biquad(body.out, s.sr, 'lowpass', 5000, 0.7)
        for (let i = 0; i < s.out.length; i++) s.out[i] += 0.5 * body.out[i] + ring[i]
      },
    }
  },

  clave: (role) => ({
    duration: at(role, [0.08, 0.065, 0.05]),
    fade: 0.01,
    render(s) {
      partial(s, at(role, [2800, 2500, 2100]), 1, at(role, [0.012, 0.0095, 0.0075]))
      noise(s, 0.25, 0.0006, [['highpass', 5000, 0.7]])
    },
  }),

  // Closed hat: steep high-passed noise plus a faint metallic cluster; the accent opens slightly and is brighter.
  hihat: (role) => {
    const tau = at(role, [0.022, 0.013, 0.008])
    const bright = at(role, [1.1, 1, 0.9])
    return {
      duration: at(role, [0.12, 0.075, 0.05]),
      fade: 0.012,
      render(s) {
        const filters: Filter[] = [
          ['highpass', 7000, 0.7],
          ['highpass', 7000, 0.7],
          ['lowpass', at(role, [16000, 13000, 10000]), 0.7],
        ]
        layer(s, 1, filters, (target) => {
          const { out } = target
          for (let i = 0; i < out.length; i++) out[i] = s.rand() * Math.exp(-i / (tau * s.sr))
          for (const f of METAL) partial(target, f * 19 * bright, 0.18, tau * 0.8, { phase: s.rand() * Math.PI })
        })
      },
    }
  },

  // Cross-stick: stick noise, the ~1.7 kHz rim ring and a little drum-shell body.
  rim: (role) => {
    const pitch = at(role, [1.12, 1, 0.89])
    const tau = at(role, [0.013, 0.011, 0.008])
    return {
      duration: at(role, [0.1, 0.085, 0.06]),
      fade: 0.012,
      render(s) {
        noise(s, at(role, [1.6, 1.3, 0.9]), 0.0015, [['bandpass', 3800 * pitch, 1.1]])
        partial(s, 1700 * pitch, 0.8, tau, { phase: HALF_PI })
        partial(s, 460 * pitch, 0.45, tau * 1.6)
      },
    }
  },

  // Mechanical metronome: the accent is the lower, fuller "tock"; beats are a bright wooden "tick".
  tick: (role) => {
    const tock = role === 'accent'
    const f = at(role, [1450, 2900, 2600])
    const tau = at(role, [0.0065, 0.0045, 0.003])
    return {
      duration: at(role, [0.07, 0.05, 0.035]),
      fade: 0.008,
      render(s) {
        noise(s, 1.2, 0.0008, [tock ? ['bandpass', 1800, 0.8] : ['highpass', 2400, 0.7]])
        partial(s, f, 0.6, tau, { phase: HALF_PI })
        partial(s, f * 1.63, 0.3, tau * 0.6, { phase: HALF_PI })
        partial(s, at(role, [620, 1150, 1000]), at(role, [0.6, 0.3, 0.2]), tau * 1.7)
      },
    }
  },

  // Struck bar/triangle: inharmonic partials, the high ones dying first. Roles a fourth apart (G6, D6, A5).
  bell: (role) => {
    const f = at(role, [1568, 1175, 880])
    const tau = at(role, [0.14, 0.11, 0.07])
    const duration = at(role, [0.48, 0.42, 0.3])
    return {
      duration,
      fade: duration * 0.3,
      render(s) {
        for (const [ratio, amp, decay] of BELL_PARTIALS) partial(s, f * ratio, amp, tau * decay)
        noise(s, 0.3, 0.0008, [['highpass', 4000, 0.7]])
      },
    }
  },

  // Sine sweeping down from a few hundred Hz (audible on small speakers) plus a beater click.
  kick: (role) => {
    const end = at(role, [62, 52, 46])
    return {
      duration: at(role, [0.25, 0.21, 0.15]),
      fade: 0.03,
      render(s) {
        partial(s, end, 1, at(role, [0.08, 0.065, 0.045]), {
          glide: at(role, [420, 340, 280]) / end,
          glideTau: at(role, [0.02, 0.022, 0.016]),
        })
        noise(s, at(role, [0.5, 0.4, 0.25]), 0.001, [['bandpass', 3000, 0.8]])
      },
    }
  },
}

/** Attack ramp, tail fade (last sample exactly 0) and peak normalization. */
function finish(out: Samples, sr: number, peak: number, fadeSeconds: number): void {
  const n = out.length
  const attack = Math.min(n, Math.max(1, Math.round(ATTACK * sr)))
  for (let i = 0; i < attack; i++) out[i] *= Math.sin(HALF_PI * (i / attack))
  const fade = Math.min(n - attack, Math.max(1, Math.round(fadeSeconds * sr)))
  for (let k = 0; k < fade; k++) out[n - 1 - k] *= 0.5 - 0.5 * Math.cos((Math.PI * k) / fade)
  let max = 0
  for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(out[i]))
  if (max > 0) {
    const gain = peak / max
    for (let i = 0; i < n; i++) out[i] *= gain
  }
}

function synthesize(id: BuiltInSoundId, role: SoundRole, sampleRate: number): Samples {
  const recipe = (RECIPES[id] ?? RECIPES.click)(role)
  const out = new Float32Array(Math.max(1, Math.round(recipe.duration * sampleRate)))
  recipe.render({ sr: sampleRate, out, rand: createNoise(hash(`${id}:${role}`)) })
  finish(out, sampleRate, PEAK[role], recipe.fade)
  return out
}

/**
 * Synthesize a built-in click as mono samples in -1..1 (pure DSP, no Web Audio, so it is unit-testable).
 * Each sound has four variants: 'accent' is brighter/higher and punchier, 'medium' (sub-accent) sits between
 * accent and beat, 'beat' is the base sound,
 * 'sub' is softer/lower and shorter, so the roles are distinguishable even at the same volume.
 * Sounds are short (≤ 0.5 s; most ≤ 0.15 s), start with energy within the first millisecond (tight timing),
 * end with a fade to 0 (no click at the tail), contain no NaN, and peak at about 0.9 for 'accent' / 'medium' / 'beat'.
 */
export function synthesizeBuiltInSound(id: BuiltInSoundId, role: SoundRole, sampleRate: number): Float32Array {
  return synthesize(id, role, sampleRate)
}

/** Wrap synthesizeBuiltInSound into an AudioBuffer for the given context (mono, ctx.sampleRate). */
export function renderBuiltInSound(ctx: BaseAudioContext, id: BuiltInSoundId, role: SoundRole): AudioBuffer {
  const samples = synthesize(id, role, ctx.sampleRate)
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
  buffer.copyToChannel(samples, 0)
  return buffer
}
