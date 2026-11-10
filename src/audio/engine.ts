import type {
  BuiltInSoundId,
  MixerSettings,
  PlaybackSnapshot,
  PulseEvent,
  Settings,
  SoundId,
  SoundRole,
  VoicePackId,
  VoiceWord,
} from '../core/types'
import { BUILT_IN_SOUNDS, CUSTOM_SOUND_PREFIX, getSubdivision } from '../core/constants'
import { createSequencer, type Sequencer } from '../core/sequencer'
import { createDefaultSettings } from '../core/settings'
import { getCustomSoundData } from './customSounds'
import { renderBuiltInSound } from './sounds'
import { loadVoicePack } from './voice'

declare global {
  interface Window {
    /** Development builds only: the shared engine, for debugging and end-to-end tests. */
    __dcMetronome?: MetronomeEngine
  }
}

type Channel = SoundRole | 'voice'
type CustomSoundId = `custom:${string}`

/** A scheduled or playing buffer with its own gain, so it can be faded out instead of cut with a click. */
interface Sounding {
  source: AudioBufferSourceNode
  amp: GainNode
}

interface Graph {
  master: GainNode
  analyser: AnalyserNode
  channels: Record<Channel, GainNode>
}

const ROLES: readonly SoundRole[] = ['accent', 'medium', 'beat', 'sub']
const BUILT_IN_IDS: ReadonlySet<string> = new Set(BUILT_IN_SOUNDS.map((sound) => sound.id))

/** Scheduler wake-up interval (ms). */
const TICK_MS = 25
/** How far ahead pulses are handed to Web Audio (s); covers several ticks of main-thread jank. */
const LOOK_AHEAD = 0.12
/** Lead time before the first pulse (s), so it is never scheduled in the past. */
const START_DELAY = 0.06
/** Pulses later than this (s) are skipped instead of played: the main thread was frozen. */
const STALE_AFTER = 0.2
/** How long start() waits for custom sounds / the voice pack before playing with fallbacks (ms). */
const LOAD_TIMEOUT_MS = 1500
const RESUME_TIMEOUT_MS = 2000
/** Mixer smoothing time constant (s). */
const MIXER_RAMP = 0.015
const PREVIEW_DELAY = 0.01
const MAX_VOICE_RATE = 2
/** Time constant (s) of the fade used to cut a word off, or everything on stop(). */
const CUT_FADE = 0.005
/** Bounds one scheduler pass, including a fast-forward through stale pulses. */
const MAX_PULSES_PER_TICK = 10_000
/** Visual queue length above which already-heard pulses are pruned (rAF does not run in hidden tabs). */
const MAX_QUEUE = 32
/** Suspend the context after this long without sound, so an idle page does not keep the audio device busy (ms). */
const IDLE_SUSPEND_MS = 10_000

const MESSAGES = {
  unsupported: 'Audio is not supported in this browser.',
  blocked: 'The browser did not allow audio to start. Press play again.',
  failed: 'Audio could not be started.',
  internal: 'Playback stopped because of an unexpected error.',
  interrupted: 'Audio was interrupted by the system. Stop and start again if it does not resume.',
  voice: 'The counting voice could not be loaded; clicks are played instead.',
  word: 'This voice sample could not be loaded.',
  sound: 'This sound could not be loaded.',
} as const

/** Runs in a Worker so the timer keeps its pace in background tabs, where main-thread timers are throttled. */
const WORKER_SOURCE = `let timer = null
self.onmessage = (event) => {
  if (event.data === 'start' && timer === null) timer = setInterval(() => self.postMessage('tick'), ${TICK_MS})
  else if (event.data === 'stop' && timer !== null) {
    clearInterval(timer)
    timer = null
  }
}`

const INITIAL_SNAPSHOT: PlaybackSnapshot = Object.freeze({
  status: 'stopped',
  pulse: null,
  serial: 0,
  startTime: null,
  ended: false,
  error: null,
})

/** Errors whose message can be shown to the user as is. */
class EngineError extends Error {}

const isCustom = (id: SoundId): id is CustomSoundId => id.startsWith(CUSTOM_SOUND_PREFIX)
const isBuiltIn = (id: string): id is BuiltInSoundId => BUILT_IN_IDS.has(id)
// A function rather than an inline comparison: TypeScript would keep a stale narrowing of ctx.state across awaits.
const isRunning = (ctx: BaseAudioContext): boolean => ctx.state === 'running'
const clampGain = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const ignore = () => {}

function outputLatency(ctx: AudioContext): number {
  return ctx.outputLatency || ctx.baseLatency || 0
}

function sameMixer(a: MixerSettings, b: MixerSettings): boolean {
  return (
    a === b ||
    (a.master === b.master &&
      a.accent === b.accent &&
      a.medium === b.medium &&
      a.beat === b.beat &&
      a.sub === b.sub &&
      a.voice === b.voice &&
      a.muted === b.muted)
  )
}

function audioContextClass(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  return w.AudioContext ?? w.webkitAudioContext
}

/**
 * Seconds a spoken word may last: until the next spoken pulse when subdivisions are spoken, otherwise the beat.
 * Computed from the section's subdivision pattern so unspoken pulses (e.g. odd 32nds) do not shorten the window.
 */
function voiceWindow(pulse: PulseEvent, settings: Settings): number {
  if (!settings.voice.subdivisions || pulse.pulsesInBeat < 2) return pulse.beatDuration
  const section = settings.sections[pulse.sectionIndex]
  const pattern = section ? getSubdivision(section.subdivision) : null
  if (!pattern || pattern.pulses.length !== pulse.pulsesInBeat) return pulse.duration
  let next = 1
  for (let i = pulse.pulse + 1; i < pattern.pulses.length; i++) {
    if (pattern.words[i] !== null) {
      next = pattern.pulses[i]
      break
    }
  }
  return (next - pattern.pulses[pulse.pulse]) * pulse.beatDuration
}

/**
 * Uploaded files often start with silence, which would make every click late. Cut everything before the onset
 * (first sample within -30 dB of the peak), keeping a faded-in millisecond so the attack stays intact.
 */
function trimLeadingSilence(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
  let peak = 0
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
  }
  if (peak === 0) return buffer
  const threshold = peak * 0.03
  let onset = buffer.length
  for (const data of channels) {
    for (let i = 0; i < onset; i++) {
      if (Math.abs(data[i]) >= threshold) {
        onset = i
        break
      }
    }
  }
  const lead = Math.max(1, Math.round(buffer.sampleRate * 0.001))
  const start = onset - lead
  if (start < lead) return buffer
  const trimmed = ctx.createBuffer(buffer.numberOfChannels, buffer.length - start, buffer.sampleRate)
  channels.forEach((data, c) => {
    const out = trimmed.getChannelData(c)
    out.set(data.subarray(start))
    for (let i = 0; i < lead; i++) out[i] *= i / lead
  })
  return trimmed
}

/** Decoded, trimmed custom sound; null when it no longer exists or cannot be decoded. Never rejects. */
async function decodeCustomSound(ctx: BaseAudioContext, id: CustomSoundId): Promise<AudioBuffer | null> {
  try {
    const data = await getCustomSoundData(id.slice(CUSTOM_SOUND_PREFIX.length))
    return data ? trimLeadingSilence(ctx, await ctx.decodeAudioData(data)) : null
  } catch (error) {
    console.warn(`Custom sound ${id} could not be loaded`, error)
    return null
  }
}

/**
 * Web Audio metronome engine ("two clocks" look-ahead scheduling).
 *
 * - A timer running in a Web Worker (created from an inline Blob so background tabs keep ticking) wakes the
 *   scheduler every ~25 ms; the scheduler asks the Sequencer for every pulse whose time falls within the
 *   look-ahead window (~0.12 s) and schedules AudioBufferSourceNodes at exact AudioContext times.
 * - Audio graph: per-role channel gains (accent, medium, beat, sub, voice) → master gain → AnalyserNode → destination.
 *   Mixer changes apply immediately with a short ramp (setTargetAtTime) to avoid zipper noise; `muted` sets the
 *   master to 0.
 * - Click buffers: built-in sounds rendered once per (id, role) via renderBuiltInSound; custom sounds decoded from
 *   IndexedDB (getCustomSoundData) and cached; while a buffer is missing or failed, 'click' is used instead.
 * - Voice: the selected pack is loaded with loadVoicePack (cached per pack). A spoken word is sped up when it is
 *   longer than the time available (the beat, or the pulse when subdivisions are spoken) by setting playbackRate
 *   up to 2×, and the previous word is stopped when the next one starts. If the voice buffer for a pulse that
 *   replaces its click (click === false) is missing, the click plays instead so no beat is lost.
 * - Visual sync: scheduled pulses are queued; a requestAnimationFrame loop publishes each one in the snapshot
 *   once ctx.currentTime ≥ pulse.time + output latency. When the sequencer returns null, the engine stops by
 *   itself after the last pulse has sounded and publishes `ended: true`.
 * - Holds a screen wake lock while playing when the browser supports it.
 */
export class MetronomeEngine {
  private ctx: AudioContext | null = null
  private graph: Graph | null = null
  /** The context that already received the silent unlock buffer (iOS). */
  private unlocked: AudioContext | null = null
  private settings: Settings | null = null
  private snapshot: PlaybackSnapshot = INITIAL_SNAPSHOT
  private readonly listeners = new Set<() => void>()

  private sequencer: Sequencer | null = null
  private sequenceEnded = false
  private lastPulse: PulseEvent | null = null
  /** Scheduled pulses not yet shown, oldest first. */
  private queue: PulseEvent[] = []
  /** Bumped by stop(), so a start() still waiting for audio knows it was cancelled. */
  private startToken = 0

  private worker: Worker | null = null
  private workerFailed = false
  private interval: ReturnType<typeof setInterval> | null = null
  private frameId: number | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  private readonly sounding = new Set<Sounding>()
  private lastWord: Sounding | null = null

  /** Built-in buffers keyed `${soundId}|${role}`. */
  private readonly builtIns = new Map<string, AudioBuffer>()
  /** Decoded custom sounds (one buffer serves every role); null = missing or undecodable, so 'click' is used. */
  private readonly customs = new Map<CustomSoundId, AudioBuffer | null>()
  private readonly customLoads = new Map<CustomSoundId, Promise<void>>()
  private readonly voicePacks = new Map<VoicePackId, Map<VoiceWord, AudioBuffer>>()
  private readonly voiceLoads = new Map<VoicePackId, Promise<void>>()
  /** Packs that failed to load; retried on the next start(), preview or when the voice is re-enabled. */
  private readonly voiceFailed = new Set<VoicePackId>()

  private wakeLock: WakeLockSentinel | null = null
  private wakeLockPending = false
  private levelData: Float32Array<ArrayBuffer> | null = null
  private visibilityBound = false

  /** Replace the live settings. Cheap when nothing relevant changed; starts loading sounds/voices the settings need. */
  setSettings(settings: Settings): void {
    const previous = this.settings
    if (previous === settings) return
    this.settings = settings
    // Without a context, start() loads whatever the settings need by then.
    if (!this.ctx) return
    if (!previous || !sameMixer(previous.mixer, settings.mixer)) this.applyMixer(false)
    const { voice } = settings
    if (voice.enabled && (!previous?.voice.enabled || previous.voice.pack !== voice.pack)) {
      this.voiceFailed.delete(voice.pack)
    }
    try {
      void this.prepare(settings)
    } catch (error) {
      console.error(error)
    }
  }

  /**
   * Start playback (no-op when already playing). Must be called from a user gesture the first time: creates or
   * resumes the AudioContext, waits (max ~1.5 s) for the needed buffers, then schedules the first pulse a few
   * tens of milliseconds ahead. Errors are reported through the snapshot's `error`, not thrown.
   */
  start = async (): Promise<void> => {
    if (this.snapshot.status !== 'stopped') return
    const token = ++this.startToken
    this.publish({ status: 'starting', pulse: null, startTime: null, ended: false, error: null })
    try {
      // Everything before the first await runs inside the user gesture, which autoplay policies require.
      const ctx = this.ensureContext()
      const running = this.resume(ctx)
      // Retry what failed before (offline, storage hiccup).
      this.voiceFailed.clear()
      for (const [id, buffer] of this.customs) if (buffer === null) this.customs.delete(id)
      const loaded = this.prepare(this.currentSettings())
      if (!(await running)) throw new EngineError(MESSAGES.blocked)
      await Promise.race([loaded, delay(LOAD_TIMEOUT_MS)])
      if (token !== this.startToken) return

      const startTime = ctx.currentTime + START_DELAY
      this.sequencer = createSequencer(this.currentSettings(), startTime)
      this.sequenceEnded = false
      this.lastPulse = null
      this.queue = []
      this.publish({ status: 'playing', startTime })
      this.startTimer()
      this.frameId = requestAnimationFrame(this.frame)
      void this.acquireWakeLock()
      this.schedule()
    } catch (error) {
      if (token !== this.startToken) return
      this.halt(true)
      this.publish({ status: 'stopped', pulse: null, startTime: null, error: this.messageFor(error) })
    }
  }

  /** Stop immediately, silencing already-scheduled pulses. */
  stop = (): void => {
    this.startToken++
    if (this.snapshot.status === 'stopped') return
    this.halt(true)
    this.publish({ status: 'stopped', pulse: null, startTime: null, ended: false })
  }

  /** start() when stopped, stop() otherwise. */
  toggle = async (): Promise<void> => {
    if (this.snapshot.status === 'stopped') return this.start()
    this.stop()
  }

  /** useSyncExternalStore subscribe. Bound, so it can be passed directly. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** useSyncExternalStore getSnapshot: returns the same object until something changes. Bound. */
  getSnapshot = (): PlaybackSnapshot => this.snapshot

  /** Play one sound immediately through its role's channel (for auditioning in the sound picker). Bound. */
  previewSound = async (id: SoundId, role: SoundRole): Promise<void> => {
    try {
      const ctx = this.ensureContext()
      if (!(await this.resume(ctx))) throw new EngineError(MESSAGES.blocked)
      let buffer: AudioBuffer | null
      if (isCustom(id)) {
        // Auditioning retries a sound that failed before (it may have been re-uploaded).
        if (this.customs.get(id) === null) this.customs.delete(id)
        await this.loadCustom(id)
        buffer = this.customs.get(id) ?? null
        if (!buffer) throw new EngineError(MESSAGES.sound)
      } else {
        buffer = this.builtIn(isBuiltIn(id) ? id : 'click', role)
      }
      if (buffer) this.play(buffer, role, ctx.currentTime + PREVIEW_DELAY, 1)
      this.clearPreviewError()
      this.suspendWhenIdle()
    } catch (error) {
      this.publish({ error: this.messageFor(error) })
    }
  }

  /** Speak one word of the current voice pack immediately. Bound. */
  previewVoice = async (word: VoiceWord): Promise<void> => {
    try {
      const ctx = this.ensureContext()
      if (!(await this.resume(ctx))) throw new EngineError(MESSAGES.blocked)
      const pack = this.currentSettings().voice.pack
      this.voiceFailed.delete(pack)
      await this.loadVoice(pack)
      const buffer = this.voicePacks.get(pack)?.get(word)
      if (!buffer) throw new EngineError(MESSAGES.word)
      this.playWord(buffer, ctx.currentTime + PREVIEW_DELAY, 1, Infinity)
      this.clearPreviewError()
      this.suspendWhenIdle()
    } catch (error) {
      this.publish({ error: this.messageFor(error) })
    }
  }

  /** Forget the cached buffer of a custom sound (after it was replaced or deleted). Bound. */
  invalidateCustomSound = (id: string): void => {
    const soundId: CustomSoundId = `${CUSTOM_SOUND_PREFIX}${id}`
    this.customs.delete(soundId)
    // An in-flight load sees it was dropped from the map and discards its result.
    this.customLoads.delete(soundId)
    const settings = this.settings
    if (this.ctx && settings && ROLES.some((role) => settings.sounds[role] === soundId)) {
      void this.loadCustom(soundId)
    }
  }

  /** Current output peak level in 0..1 from the analyser (0 when no audio context yet). Bound; poll it from rAF. */
  getLevel = (): number => {
    const analyser = this.graph?.analyser
    if (!analyser) return 0
    const data = (this.levelData ??= new Float32Array(analyser.fftSize))
    analyser.getFloatTimeDomainData(data)
    let peak = 0
    for (let i = 0; i < data.length; i++) {
      const value = Math.abs(data[i])
      if (value > peak) peak = value
    }
    return Math.min(1, peak)
  }

  /** Stop and release the AudioContext, timer worker and listeners (HMR, tests). The engine can be started again. */
  dispose(): void {
    this.stop()
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    this.idleTimer = null
    this.worker?.terminate()
    this.worker = null
    if (this.visibilityBound) {
      document.removeEventListener('visibilitychange', this.handleVisibility)
      this.visibilityBound = false
    }
    const ctx = this.ctx
    if (ctx) {
      ctx.removeEventListener('statechange', this.handleStateChange)
      this.forgetContext()
      ctx.close().catch(ignore)
    }
  }

  // --- Snapshot ---

  private publish(patch: Partial<PlaybackSnapshot>): void {
    const current = this.snapshot
    const keys = Object.keys(patch) as (keyof PlaybackSnapshot)[]
    if (keys.every((key) => patch[key] === current[key])) return
    this.snapshot = Object.freeze({ ...current, ...patch })
    for (const listener of Array.from(this.listeners)) listener()
  }

  private messageFor(error: unknown): string {
    if (error instanceof EngineError) return error.message
    console.error(error)
    return MESSAGES.failed
  }

  private clearPreviewError(): void {
    const { error } = this.snapshot
    if (error === MESSAGES.blocked || error === MESSAGES.sound || error === MESSAGES.word) this.publish({ error: null })
  }

  private currentSettings(): Settings {
    this.settings ??= createDefaultSettings()
    return this.settings
  }

  // --- Audio context ---

  private ensureContext(): AudioContext {
    const existing = this.ctx
    if (existing && existing.state !== 'closed') return existing
    const AudioContextClass = audioContextClass()
    if (!AudioContextClass) throw new EngineError(MESSAGES.unsupported)
    if (existing) {
      existing.removeEventListener('statechange', this.handleStateChange)
      this.forgetContext()
    }
    const ctx = new AudioContextClass({ latencyHint: 'interactive' })
    const master = ctx.createGain()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    master.connect(analyser)
    analyser.connect(ctx.destination)
    const channel = () => {
      const gain = ctx.createGain()
      gain.connect(master)
      return gain
    }
    this.graph = { master, analyser, channels: { accent: channel(), medium: channel(), beat: channel(), sub: channel(), voice: channel() } }
    this.ctx = ctx
    ctx.addEventListener('statechange', this.handleStateChange)
    this.listenForVisibility()
    this.applyMixer(true)
    return ctx
  }

  /** Drop everything tied to the current context (buffers are resampled to its rate). */
  private forgetContext(): void {
    this.ctx = null
    this.graph = null
    this.unlocked = null
    this.levelData = null
    this.builtIns.clear()
    this.customs.clear()
    this.customLoads.clear()
    this.voicePacks.clear()
    this.voiceLoads.clear()
    this.voiceFailed.clear()
    this.sounding.clear()
    this.lastWord = null
  }

  /** Resolves true once the context runs. Starts resume() synchronously, so call it inside the user gesture. */
  private async resume(ctx: AudioContext): Promise<boolean> {
    this.unlock(ctx)
    if (isRunning(ctx)) return true
    try {
      // resume() can stay pending (no user activation yet) or reject (iOS 'interrupted'); do not hang on it.
      await Promise.race([ctx.resume(), delay(RESUME_TIMEOUT_MS)])
    } catch (error) {
      console.warn('AudioContext.resume() failed', error)
    }
    return isRunning(ctx)
  }

  /** iOS only enables Web Audio output after something was played inside a user gesture: play one silent sample. */
  private unlock(ctx: AudioContext): void {
    if (this.unlocked === ctx && isRunning(ctx)) return
    this.unlocked = ctx
    try {
      const source = ctx.createBufferSource()
      source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
      source.connect(ctx.destination)
      source.onended = () => source.disconnect()
      source.start()
    } catch {
      // Not needed outside iOS anyway.
    }
  }

  private applyMixer(immediate: boolean): void {
    const ctx = this.ctx
    const graph = this.graph
    if (!ctx || !graph) return
    const mixer = this.currentSettings().mixer
    const now = ctx.currentTime
    const set = (param: AudioParam, value: number) => {
      if (immediate) param.value = clampGain(value)
      else param.setTargetAtTime(clampGain(value), now, MIXER_RAMP)
    }
    set(graph.master.gain, mixer.muted ? 0 : mixer.master)
    for (const role of ROLES) set(graph.channels[role].gain, mixer[role])
    set(graph.channels.voice.gain, mixer.voice)
  }

  /** (Re)arm the idle timer; start() and the previews resume the context inside their user gesture. */
  private suspendWhenIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      const ctx = this.ctx
      if (!ctx || !isRunning(ctx) || this.snapshot.status !== 'stopped') return
      // Something is still ringing (a preview, the last bell of a finished program): check again later.
      if (this.sounding.size > 0) this.suspendWhenIdle()
      else ctx.suspend().catch(ignore)
    }, IDLE_SUSPEND_MS)
  }

  private handleStateChange = (): void => {
    const ctx = this.ctx
    if (!ctx || this.snapshot.status !== 'playing') return
    if (ctx.state === 'closed') {
      this.halt(false)
      this.publish({ status: 'stopped', pulse: null, startTime: null, error: MESSAGES.failed })
    } else if (isRunning(ctx)) {
      if (this.snapshot.error === MESSAGES.interrupted) this.publish({ error: null })
    } else {
      // 'suspended' / 'interrupted' (phone call, another app took audio). currentTime freezes, so the schedule simply
      // continues where it was once the context runs again.
      this.publish({ error: MESSAGES.interrupted })
      ctx.resume().catch(ignore)
    }
  }

  private listenForVisibility(): void {
    if (this.visibilityBound || typeof document === 'undefined') return
    this.visibilityBound = true
    document.addEventListener('visibilitychange', this.handleVisibility)
  }

  private handleVisibility = (): void => {
    if (document.visibilityState !== 'visible' || this.snapshot.status !== 'playing') return
    // Browsers release wake locks while the page is hidden.
    void this.acquireWakeLock()
    const ctx = this.ctx
    if (ctx && !isRunning(ctx)) ctx.resume().catch(ignore)
  }

  // --- Buffers ---

  /** Start loading (and render built-ins) for everything the settings use. Never rejects. */
  private prepare(settings: Settings): Promise<unknown> {
    const loads: Promise<void>[] = []
    for (const role of ROLES) {
      const id = settings.sounds[role]
      if (isCustom(id)) {
        loads.push(this.loadCustom(id))
        this.builtIn('click', role) // the fallback while it loads
      } else {
        this.builtIn(isBuiltIn(id) ? id : 'click', role)
      }
    }
    if (settings.voice.enabled) loads.push(this.loadVoice(settings.voice.pack))
    return Promise.all(loads)
  }

  private builtIn(id: BuiltInSoundId, role: SoundRole): AudioBuffer | null {
    const ctx = this.ctx
    if (!ctx) return null
    const key = `${id}|${role}`
    let buffer = this.builtIns.get(key)
    if (!buffer) {
      buffer = renderBuiltInSound(ctx, id, role)
      this.builtIns.set(key, buffer)
    }
    return buffer
  }

  private clickBuffer(id: SoundId, role: SoundRole): AudioBuffer | null {
    if (isCustom(id)) {
      const custom = this.customs.get(id)
      if (custom) return custom
      if (custom === undefined) void this.loadCustom(id)
      return this.builtIn('click', role)
    }
    return this.builtIn(isBuiltIn(id) ? id : 'click', role)
  }

  private loadCustom(id: CustomSoundId): Promise<void> {
    const pending = this.customLoads.get(id)
    if (pending) return pending
    const ctx = this.ctx
    if (!ctx || this.customs.has(id)) return Promise.resolve()
    const load: Promise<void> = decodeCustomSound(ctx, id).then((buffer) => {
      // Invalidated (or the context was replaced) meanwhile: the result is stale.
      if (this.customLoads.get(id) !== load) return
      this.customLoads.delete(id)
      this.customs.set(id, buffer)
    })
    this.customLoads.set(id, load)
    return load
  }

  private loadVoice(pack: VoicePackId): Promise<void> {
    const pending = this.voiceLoads.get(pack)
    if (pending) return pending
    const ctx = this.ctx
    if (!ctx || this.voicePacks.has(pack) || this.voiceFailed.has(pack)) return Promise.resolve()
    const settle = (words: Map<VoiceWord, AudioBuffer> | null) => {
      if (this.voiceLoads.get(pack) !== load) return
      this.voiceLoads.delete(pack)
      if (words) {
        this.voicePacks.set(pack, words)
      } else {
        this.voiceFailed.add(pack)
        this.publish({ error: MESSAGES.voice })
      }
    }
    const load: Promise<void> = loadVoicePack(ctx, pack).then(settle, (error: unknown) => {
      console.warn(error)
      settle(null)
    })
    this.voiceLoads.set(pack, load)
    return load
  }

  // --- Scheduling ---

  private startTimer(): void {
    const worker = this.ensureWorker()
    if (worker) worker.postMessage('start')
    else this.interval ??= setInterval(this.schedule, TICK_MS)
  }

  private stopTimer(): void {
    this.worker?.postMessage('stop')
    if (this.interval !== null) clearInterval(this.interval)
    this.interval = null
  }

  private ensureWorker(): Worker | null {
    if (this.worker || this.workerFailed) return this.worker
    try {
      // The object URL is kept for the page's lifetime: revoking it right away can race the worker's script fetch.
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
      const worker = new Worker(url)
      worker.onmessage = this.schedule
      worker.onerror = () => {
        // e.g. a Content-Security-Policy without blob: workers: fall back to a main-thread timer.
        worker.terminate()
        this.worker = null
        this.workerFailed = true
        if (this.snapshot.status === 'playing') this.interval ??= setInterval(this.schedule, TICK_MS)
      }
      this.worker = worker
    } catch {
      this.workerFailed = true
    }
    return this.worker
  }

  private schedule = (): void => {
    const ctx = this.ctx
    const sequencer = this.sequencer
    if (!ctx || !sequencer || this.snapshot.status !== 'playing') return
    try {
      const settings = this.currentSettings()
      const now = ctx.currentTime
      if (!this.sequenceEnded) this.fill(sequencer, settings, now)
      if (this.queue.length > MAX_QUEUE) this.pruneQueue(now)
      if (this.sequenceEnded) {
        const last = this.lastPulse
        if (!last || now >= last.time + last.duration + outputLatency(ctx)) this.finish()
      }
    } catch (error) {
      console.error(error)
      this.halt(true)
      this.publish({ status: 'stopped', pulse: null, startTime: null, error: MESSAGES.internal })
    }
  }

  private fill(sequencer: Sequencer, settings: Settings, now: number): void {
    const horizon = now + LOOK_AHEAD
    for (let count = 0; count < MAX_PULSES_PER_TICK; count++) {
      const time = sequencer.peekTime(settings)
      if (time === null) {
        this.sequenceEnded = true
        return
      }
      if (time >= horizon) return
      const pulse = sequencer.next(settings)
      if (!pulse) {
        this.sequenceEnded = true
        return
      }
      this.lastPulse = pulse
      // Resync after the main thread was frozen (suspended tab, debugger, long GC) while audio time kept running:
      // instead of firing a burst of stale pulses, fast-forward through them silently. The sequencer keeps
      // counting, so the beat grid, program position and practice tempo stay where they would have been.
      if (pulse.time < now - STALE_AFTER) continue
      this.playPulse(pulse, settings)
      this.queue.push(pulse)
    }
  }

  private playPulse(pulse: PulseEvent, settings: Settings): void {
    if (pulse.silent) return
    let spoken = false
    if (pulse.voice !== null && pulse.voiceGain > 0) {
      const buffer = this.voicePacks.get(settings.voice.pack)?.get(pulse.voice)
      if (buffer) {
        this.playWord(buffer, pulse.time, pulse.voiceGain, voiceWindow(pulse, settings))
        spoken = true
      }
    }
    // A pulse whose click the voice replaces still clicks when its word is not available.
    const click = pulse.click || (pulse.voice !== null && !spoken)
    if (!click || pulse.role === null || pulse.gain <= 0) return
    const buffer = this.clickBuffer(settings.sounds[pulse.role], pulse.role)
    if (buffer) this.play(buffer, pulse.role, pulse.time, pulse.gain)
  }

  private play(buffer: AudioBuffer, channel: Channel, when: number, gain: number, rate = 1): Sounding | null {
    const ctx = this.ctx
    const graph = this.graph
    if (!ctx || !graph) return null
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = rate
    const amp = ctx.createGain()
    // A non-finite AudioParam value throws; never let one bad pulse kill the scheduler.
    amp.gain.value = Number.isFinite(gain) ? Math.max(0, gain) : 0
    source.connect(amp)
    amp.connect(graph.channels[channel])
    const node: Sounding = { source, amp }
    this.sounding.add(node)
    source.onended = () => {
      this.sounding.delete(node)
      if (this.lastWord === node) this.lastWord = null
      source.disconnect()
      amp.disconnect()
    }
    source.start(when)
    return node
  }

  /** Speak a word, cutting off the previous one, sped up (≤ 2×) when it would not fit in `available` seconds. */
  private playWord(buffer: AudioBuffer, when: number, gain: number, available: number): void {
    // 0.9: leave a little air before the next word. NaN (bad window) plays at normal speed, no window at most speed.
    const rate = Math.min(MAX_VOICE_RATE, Math.max(1, buffer.duration / (available * 0.9) || 1))
    if (this.lastWord) this.cut(this.lastWord, when)
    this.lastWord = this.play(buffer, 'voice', when, gain, rate)
  }

  /** Fade a sound out from `when` (a hard stop would click) and stop it once silent. */
  private cut(node: Sounding, when: number): void {
    try {
      node.amp.gain.cancelScheduledValues(when)
      node.amp.gain.setTargetAtTime(0, when, CUT_FADE)
      node.source.stop(when + CUT_FADE * 8)
    } catch {
      // Already stopped.
    }
  }

  /** Keep only the newest already-heard pulse (and everything after it) so a hidden tab does not grow the queue. */
  private pruneQueue(now: number): void {
    let heard = 0
    while (heard < this.queue.length && this.queue[heard].time <= now) heard++
    if (heard > 1) this.queue.splice(0, heard - 1)
  }

  private frame = (): void => {
    this.frameId = null
    const ctx = this.ctx
    if (!ctx || this.snapshot.status !== 'playing') return
    // Show a pulse when it is heard, not when it is scheduled: output latency can be large (Bluetooth).
    const heard = ctx.currentTime - outputLatency(ctx)
    let count = 0
    while (count < this.queue.length && this.queue[count].time <= heard) count++
    if (count > 0) {
      // After a hidden period several pulses may have passed: jump straight to the latest.
      const pulse = this.queue[count - 1]
      this.queue.splice(0, count)
      this.publish({ pulse, serial: this.snapshot.serial + 1 })
    }
    this.frameId = requestAnimationFrame(this.frame)
  }

  /** The sequence ended by itself: let the last sounds ring out. */
  private finish(): void {
    this.halt(false)
    this.publish({ status: 'stopped', pulse: null, startTime: null, ended: true })
  }

  private halt(silence: boolean): void {
    this.stopTimer()
    if (this.frameId !== null) cancelAnimationFrame(this.frameId)
    this.frameId = null
    this.sequencer = null
    this.sequenceEnded = false
    this.lastPulse = null
    this.queue = []
    if (silence && this.ctx) {
      const now = this.ctx.currentTime
      for (const node of this.sounding) this.cut(node, now)
      this.lastWord = null
    }
    this.releaseWakeLock()
    this.suspendWhenIdle()
  }

  // --- Wake lock ---

  private async acquireWakeLock(): Promise<void> {
    if (this.wakeLock || this.wakeLockPending || this.snapshot.status !== 'playing') return
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return
    this.wakeLockPending = true
    try {
      const lock = await navigator.wakeLock.request('screen')
      if (this.snapshot.status === 'playing') {
        this.wakeLock = lock
        lock.addEventListener('release', () => {
          if (this.wakeLock === lock) this.wakeLock = null
        })
      } else {
        lock.release().catch(ignore)
      }
    } catch {
      // Denied (battery saver, permissions policy): the metronome works without it.
    } finally {
      this.wakeLockPending = false
    }
  }

  private releaseWakeLock(): void {
    const lock = this.wakeLock
    this.wakeLock = null
    lock?.release().catch(ignore)
  }
}

let shared: MetronomeEngine | null = null

/** The app-wide engine instance (one AudioContext per page; survives React StrictMode double mounting). */
export function getEngine(): MetronomeEngine {
  if (!shared) {
    shared = new MetronomeEngine()
    if (import.meta.env.DEV && typeof window !== 'undefined') window.__dcMetronome = shared
  }
  return shared
}

// When this module is hot-replaced, a new engine takes over: make sure the old one goes quiet.
import.meta.hot?.dispose(() => {
  shared?.dispose()
  shared = null
})
