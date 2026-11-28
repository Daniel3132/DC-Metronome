import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_BPM, MAX_TEMPO_PERCENT, MIN_BPM, MIN_TEMPO_PERCENT } from '../core/constants'
import { effectiveBpm } from '../core/settings'
import type { BeatLevel, BeatUnit, Part, PartRef, Rhythm, Settings, SubdivisionId } from '../core/types'
import type { SettingsUpdater } from './useSettings'

export interface RoomCore {
  bpm: number
  tempoPercent: number
  rhythm: Rhythm
}

/** The room's shared state as this device plays it: `startsAt` is already on the local clock. */
export interface RoomPlayback extends RoomCore {
  playing: boolean
  startsAt: number | null
}

export interface RoomSnapshot {
  code: string
  status: 'connecting' | 'connected' | 'reconnecting'
  error: string | null
  inviteUrl: string
}

/** A command for the local engine: stop, or start at `startsAt` (local Date.now() ms). A new eventId means act again. */
export interface RoomTransport {
  playing: boolean
  startsAt: number | null
  barSeconds: number
  eventId: string
}

/**
 * Wire format. `actor` is always the sender. State messages also carry `writer` (who made this revision; revisions
 * are ordered by (revision, writer)) and `source` (whose clock `startsAt` is in), so a state relayed by a third
 * peer still needs only one clock conversion.
 */
export interface RoomMessage {
  kind: 'state' | 'request-state' | 'state-response' | 'clock-probe' | 'clock-reply'
  actor: string
  revision?: number
  writer?: string
  core?: RoomCore
  playing?: boolean
  source?: string
  startsAt?: number | null
  probeId?: string
  sentAt?: number
  remoteTime?: number
}

interface SharedState {
  revision: number
  writer: string
  core: RoomCore
  playing: boolean
  source: string
  /** In `source`'s clock. */
  sourceStartsAt: number | null
}

export interface ClockSample {
  /** Remote clock minus local clock (ms). */
  offset: number
  rtt: number
  at: number
}

const MESSAGE_KINDS: readonly RoomMessage['kind'][] = ['state', 'request-state', 'state-response', 'clock-probe', 'clock-reply']
const BEAT_UNITS: readonly BeatUnit[] = [2, 4, 8, 16]
const BEAT_LEVELS: readonly BeatLevel[] = ['accent', 'medium', 'normal', 'mute']
const SUBDIVISIONS: readonly SubdivisionId[] = [
  'quarter', 'eighths', 'triplets', 'sixteenths', 'quintuplets', 'sextuplets',
  'septuplets', 'thirty-seconds', 'swing', 'gallop', 'reverse-gallop', 'dotted',
]

/** Lead time of a start or a change while playing, so every device can schedule it (ms). */
const START_LEAD_MS = 1800
/** Local edits are broadcast after this pause, so dragging a slider restarts the room once, not per step (ms). */
const EDIT_DEBOUNCE_MS = 250
/** A guest decides "room not found" when no peer answered within this time after joining (ms). */
const JOIN_WAIT_MS = 2500
/** A start from another device waits at most this long for a clock estimate of that device (ms). */
const CLOCK_WAIT_MS = 1500
const CLOCK_BURST = 5
const CLOCK_BURST_GAP_MS = 250
const CLOCK_INTERVAL_MS = 30_000
const CLOCK_SAMPLES_KEPT = 8
const CLOCK_SAMPLE_MAX_AGE_MS = 5 * 60_000
const PROBE_TIMEOUT_MS = 5000
/** Peers that did not write the current state answer a request after this random delay, unless the writer did. */
const FALLBACK_RESPONSE_MS = [400, 900] as const
const RESTORE_KEY = 'dcmetronome:room-restore'

// --- Pure helpers (exported for tests) ---

export function validCore(value: unknown): value is RoomCore {
  if (!value || typeof value !== 'object') return false
  const core = value as RoomCore
  return Number.isInteger(core.bpm) && core.bpm >= MIN_BPM && core.bpm <= MAX_BPM && Number.isInteger(core.tempoPercent) && core.tempoPercent >= MIN_TEMPO_PERCENT && core.tempoPercent <= MAX_TEMPO_PERCENT &&
    !!core.rhythm && Number.isInteger(core.rhythm.beatsPerBar) && core.rhythm.beatsPerBar >= 1 && core.rhythm.beatsPerBar <= 16 &&
    BEAT_UNITS.includes(core.rhythm.beatUnit) && Array.isArray(core.rhythm.beats) && core.rhythm.beats.length === core.rhythm.beatsPerBar &&
    core.rhythm.beats.every((beat) => BEAT_LEVELS.includes(beat)) && SUBDIVISIONS.includes(core.rhythm.subdivision)
}

export function parseMessage(data: unknown): RoomMessage | null {
  if (!data || typeof data !== 'object') return null
  const message = data as RoomMessage
  if (!MESSAGE_KINDS.includes(message.kind) || typeof message.actor !== 'string' || !message.actor) return null
  if (message.kind === 'clock-probe' && (typeof message.probeId !== 'string' || !Number.isFinite(message.sentAt))) return null
  if (message.kind === 'clock-reply' && (typeof message.probeId !== 'string' || !Number.isFinite(message.sentAt) || !Number.isFinite(message.remoteTime))) return null
  if (message.kind === 'state' || message.kind === 'state-response') {
    if (!Number.isInteger(message.revision) || message.revision! < 1) return null
    if (typeof message.writer !== 'string' || typeof message.source !== 'string' || !message.writer || !message.source) return null
    if (!validCore(message.core) || typeof message.playing !== 'boolean') return null
    if (message.startsAt !== null && !Number.isFinite(message.startsAt)) return null
    if (message.playing && message.startsAt === null) return null
  }
  return message
}

/** Length of one bar of `core` (ms). */
export function barMs(core: RoomCore): number {
  return (60_000 * 4 * core.rhythm.beatsPerBar) / (effectiveBpm(core.bpm, core.tempoPercent) * core.rhythm.beatUnit)
}

/** The first bar line of a performance started at `startedAt` that is still ahead of `now` (or `startedAt` itself). */
export function nextBarTime(startedAt: number, core: RoomCore, now = Date.now()): number {
  if (startedAt > now) return startedAt
  const bar = barMs(core)
  return startedAt + (Math.floor((now - startedAt) / bar) + 1) * bar
}

export function compareRevision(a: { revision: number; writer: string }, b: { revision: number; writer: string }): number {
  return a.revision - b.revision || a.writer.localeCompare(b.writer)
}

/** NTP-style estimate from one probe: the remote time is assumed to be read halfway through the round trip. */
export function clockSample(sentAt: number, remoteTime: number, receivedAt: number): ClockSample {
  return { offset: remoteTime - (sentAt + receivedAt) / 2, rtt: receivedAt - sentAt, at: receivedAt }
}

/** The offset of the fastest round trip: relay queueing only ever adds delay, so the shortest trip is the most symmetric. */
export function bestOffset(samples: readonly ClockSample[]): number | null {
  let best: ClockSample | null = null
  for (const sample of samples) if (!best || sample.rtt < best.rtt) best = sample
  return best ? best.offset : null
}

/** A 16-hex room code from a typed code or a pasted invite link; null when there is none. */
export function parseRoomCode(input: string): string | null {
  const text = input.trim()
  let candidate = text
  if (/room=/i.test(text)) {
    try {
      candidate = new URL(text, 'https://invite.invalid').searchParams.get('room') ?? ''
    } catch {
      return null
    }
  }
  const code = candidate.toLowerCase().replace(/[\s-]/g, '')
  return /^[a-f0-9]{16}$/.test(code) ? code : null
}

function roomCore(settings: Settings): RoomCore {
  const selected = settings.selected
    ? settings.sections.find((section) => section.id === settings.selected?.section)?.parts.find((part) => part.id === settings.selected?.part)
    : undefined
  const rhythm = selected ?? settings.current
  return {
    bpm: settings.bpm,
    tempoPercent: settings.tempoPercent,
    rhythm: {
      beatsPerBar: rhythm.beatsPerBar,
      beatUnit: rhythm.beatUnit,
      beats: [...rhythm.beats],
      subdivision: rhythm.subdivision,
    },
  }
}

function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function inviteUrl(code: string): string {
  const url = new URL(window.location.href)
  url.searchParams.set('room', code)
  return url.toString()
}

function setUrlRoom(code: string | null): void {
  const url = new URL(window.location.href)
  if (code === null ? !url.searchParams.has('room') : url.searchParams.get('room') === code) return
  if (code === null) url.searchParams.delete('room')
  else url.searchParams.set('room', code)
  window.history.replaceState(window.history.state, '', url)
}

/** A guest's own tempo and rhythm, kept per tab while they are in a room so leaving gives them back (also after a reload). */
interface GuestRestore {
  code: string
  bpm: number
  tempoPercent: number
  current: Part
  selected: PartRef | null
}

function readRestore(): GuestRestore | null {
  try {
    const raw = sessionStorage.getItem(RESTORE_KEY)
    return raw ? (JSON.parse(raw) as GuestRestore) : null
  } catch {
    return null
  }
}

function writeRestore(value: GuestRestore | null): void {
  try {
    if (value) sessionStorage.setItem(RESTORE_KEY, JSON.stringify(value))
    else sessionStorage.removeItem(RESTORE_KEY)
  } catch { /* Storage blocked: leaving then keeps the room's tempo. */ }
}

// --- Transport ---

const HEARTBEAT_MS = 15_000
const HEARTBEAT_TIMEOUT_MS = 10_000
const RETRY_MS = 1200

/** Supabase Realtime Phoenix v1 channel client, kept small so the browser uses its native WebSocket API. */
class RealtimeRoom {
  private socket: WebSocket | null = null
  private readonly endpoint: URL
  private readonly topic: string
  private ref = 0
  private joinRef: string | null = null
  private joined = false
  private heartbeat: number | undefined
  private heartbeatTimeout: number | undefined
  private retryTimer: number | undefined
  private closed = false
  private readonly listeners = new Set<(message: RoomMessage) => void>()
  private readonly joinListeners = new Set<(ok: boolean, reason?: string) => void>()
  private readonly disconnectListeners = new Set<() => void>()

  constructor(url: string, key: string, code: string) {
    this.endpoint = new URL('/realtime/v1/websocket', url)
    this.endpoint.protocol = this.endpoint.protocol === 'https:' ? 'wss:' : 'ws:'
    this.endpoint.searchParams.set('apikey', key)
    this.endpoint.searchParams.set('vsn', '1.0.0')
    this.topic = `realtime:dcmetronome-${code}`
    this.open()
  }

  onMessage(listener: (message: RoomMessage) => void): void {
    this.listeners.add(listener)
  }

  onJoin(listener: (ok: boolean, reason?: string) => void): void {
    this.joinListeners.add(listener)
    if (this.joined) listener(true)
  }

  onDisconnect(listener: () => void): void {
    this.disconnectListeners.add(listener)
  }

  broadcast(message: RoomMessage): void {
    if (!this.joined) return
    this.send(this.topic, 'broadcast', { type: 'broadcast', event: 'room', payload: message })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer)
    this.stopHeartbeat()
    if (this.joined) this.send(this.topic, 'phx_leave', {})
    this.joined = false
    const socket = this.socket
    this.socket = null
    socket?.close()
  }

  private open(): void {
    if (this.closed) return
    const socket = new WebSocket(this.endpoint)
    this.socket = socket
    socket.addEventListener('open', () => {
      if (socket !== this.socket) return
      this.startHeartbeat()
      this.joinRef = this.send(this.topic, 'phx_join', {
        config: { broadcast: { ack: false, self: false }, presence: { enabled: false }, postgres_changes: [], private: false },
      })
    })
    socket.addEventListener('message', (event) => {
      if (socket === this.socket) this.receive(event.data)
    })
    socket.addEventListener('close', () => this.drop(socket))
  }

  /** Forget `socket` (closed, or presumed dead) and schedule a fresh connection. */
  private drop(socket: WebSocket): void {
    if (socket !== this.socket) return
    this.socket = null
    this.joined = false
    this.joinRef = null
    this.stopHeartbeat()
    this.disconnectListeners.forEach((listener) => listener())
    if (this.closed) return
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer)
    this.retryTimer = window.setTimeout(() => this.open(), RETRY_MS)
  }

  /** Reconnect now; a half-open socket may take minutes to fire its own close event. */
  private reconnect(): void {
    const socket = this.socket
    if (!socket) return
    this.drop(socket)
    socket.close()
  }

  /** Returns the message ref, or null when the socket is not open. */
  private send(topic: string, event: string, payload: unknown): string | null {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return null
    const ref = String(++this.ref)
    const joinRef = event === 'phx_join' ? ref : this.joinRef
    socket.send(JSON.stringify({ topic, event, payload, ref, join_ref: topic === 'phoenix' ? undefined : joinRef }))
    return ref
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeat = window.setInterval(() => {
      if (this.send('phoenix', 'heartbeat', {}) === null || this.heartbeatTimeout !== undefined) return
      this.heartbeatTimeout = window.setTimeout(() => {
        this.heartbeatTimeout = undefined
        this.reconnect()
      }, HEARTBEAT_TIMEOUT_MS)
    }, HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== undefined) window.clearInterval(this.heartbeat)
    if (this.heartbeatTimeout !== undefined) window.clearTimeout(this.heartbeatTimeout)
    this.heartbeat = undefined
    this.heartbeatTimeout = undefined
  }

  private receive(raw: unknown): void {
    let frame: { topic?: string; event?: string; payload?: unknown; ref?: string | null }
    try { frame = JSON.parse(String(raw)) as typeof frame } catch { return }
    if (frame.topic === 'phoenix') {
      if (frame.event === 'phx_reply' && this.heartbeatTimeout !== undefined) {
        window.clearTimeout(this.heartbeatTimeout)
        this.heartbeatTimeout = undefined
      }
      return
    }
    if (frame.topic !== this.topic) return
    if (frame.event === 'phx_reply') {
      // Only the reply to our own join; replies to other pushes must not re-run the join listeners.
      if (this.joined || frame.ref == null || frame.ref !== this.joinRef) return
      const reply = frame.payload as { status?: string; response?: { reason?: string } } | undefined
      const ok = reply?.status === 'ok'
      this.joined = ok
      this.joinListeners.forEach((listener) => listener(ok, reply?.response?.reason))
      return
    }
    if (frame.event === 'phx_error' || frame.event === 'phx_close') {
      // The channel died on a live socket: rejoin from scratch rather than keep sending into nothing.
      if (!this.closed) this.reconnect()
      return
    }
    if (frame.event !== 'broadcast') return
    const envelope = frame.payload as { event?: string; payload?: unknown } | undefined
    if (envelope?.event !== 'room') return
    const message = parseMessage(envelope.payload)
    if (message) this.listeners.forEach((listener) => listener(message))
  }
}

// --- Hook ---

function clearTimer(timer: { current: number | undefined }): void {
  if (timer.current !== undefined) window.clearTimeout(timer.current)
  timer.current = undefined
}

const EMPTY_STATE = (actor: string, core: RoomCore): SharedState => ({
  revision: 0, writer: '', core, playing: false, source: actor, sourceStartsAt: null,
})

/**
 * Temporary rooms over Supabase Realtime broadcast. Everyone can change the shared tempo, rhythm and transport;
 * the highest (revision, writer) wins. Starts are scheduled START_LEAD_MS ahead on the starter's clock and
 * converted with a per-peer clock offset (fastest of several probes), so every device starts on the same instant.
 */
export function useRoom(settings: Settings, update: SettingsUpdater) {
  const [room, setRoom] = useState<RoomSnapshot | null>(null)
  const [playback, setPlayback] = useState<RoomPlayback | null>(null)
  const [transport, setTransport] = useState<RoomTransport | null>(null)
  const socketRef = useRef<RealtimeRoom | null>(null)
  // Lazy initialisers: render must stay pure, so the id is drawn once and refs are not read while rendering.
  const [actor] = useState(() => crypto.randomUUID() as string)
  const actorRef = useRef(actor)
  const sharedRef = useRef<SharedState>(EMPTY_STATE(actor, roomCore(settings)))
  const settingsRef = useRef(settings)
  const lastBroadcastCore = useRef('')
  const lastTransportKey = useRef('')
  const probePending = useRef(new Map<string, number>())
  const clockSamples = useRef(new Map<string, ClockSample[]>())
  const clockTimers = useRef<number[]>([])
  const clockInterval = useRef<number | undefined>(undefined)
  const pendingTransport = useRef<number | undefined>(undefined)
  const editTimer = useRef<number | undefined>(undefined)
  const responseTimer = useRef<number | undefined>(undefined)
  const roomRef = useRef<RoomSnapshot | null>(null)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const showRoom = useCallback((next: RoomSnapshot | null) => {
    roomRef.current = next
    setRoom(next)
  }, [])

  const offsetFor = useCallback((actor: string): number | null => {
    if (actor === actorRef.current) return 0
    return bestOffset(clockSamples.current.get(actor) ?? [])
  }, [])

  const localStartsAt = useCallback((state: SharedState): number | null => {
    if (state.sourceStartsAt === null) return null
    return state.sourceStartsAt - (offsetFor(state.source) ?? 0)
  }, [offsetFor])

  const stopClock = useCallback(() => {
    clockTimers.current.forEach((timer) => window.clearTimeout(timer))
    clockTimers.current = []
    if (clockInterval.current !== undefined) window.clearInterval(clockInterval.current)
    clockInterval.current = undefined
  }, [])

  /** Push the shared state to the local engine; restarts only when the transport itself changed. */
  const commitTransport = useCallback(() => {
    clearTimer(pendingTransport)
    const state = sharedRef.current
    const startsAt = localStartsAt(state)
    setPlayback({ ...state.core, playing: state.playing, startsAt })
    const key = `${state.playing}:${state.source}:${state.sourceStartsAt ?? ''}`
    if (key === lastTransportKey.current) return
    lastTransportKey.current = key
    setTransport({
      playing: state.playing,
      startsAt: state.playing && startsAt !== null ? nextBarTime(startsAt, state.core) : null,
      barSeconds: barMs(state.core) / 1000,
      eventId: key,
    })
  }, [localStartsAt])

  const applyTransport = useCallback(() => {
    const state = sharedRef.current
    const key = `${state.playing}:${state.source}:${state.sourceStartsAt ?? ''}`
    const needsClock = state.playing && key !== lastTransportKey.current && offsetFor(state.source) === null
    if (!needsClock) return commitTransport()
    // Starting on another device's clock without an estimate of it could be off by seconds: wait for one.
    setPlayback({ ...state.core, playing: false, startsAt: null })
    clearTimer(pendingTransport)
    pendingTransport.current = window.setTimeout(commitTransport, CLOCK_WAIT_MS)
  }, [commitTransport, offsetFor])

  const sendState = useCallback((kind: 'state' | 'state-response') => {
    const state = sharedRef.current
    socketRef.current?.broadcast({
      kind,
      actor: actorRef.current,
      revision: state.revision,
      writer: state.writer,
      core: state.core,
      playing: state.playing,
      source: state.source,
      startsAt: state.sourceStartsAt,
    })
  }, [])

  /** A local change: bump the revision, broadcast it and play it here. */
  const write = useCallback((patch: Partial<Pick<SharedState, 'core' | 'playing' | 'source' | 'sourceStartsAt'>>) => {
    const prev = sharedRef.current
    sharedRef.current = { ...prev, ...patch, revision: prev.revision + 1, writer: actorRef.current }
    lastBroadcastCore.current = JSON.stringify(sharedRef.current.core)
    sendState('state')
    applyTransport()
  }, [applyTransport, sendState])

  const sendClockProbe = useCallback(() => {
    if (!socketRef.current) return
    const probeId = crypto.randomUUID()
    const sentAt = Date.now()
    probePending.current.set(probeId, sentAt)
    window.setTimeout(() => probePending.current.delete(probeId), PROBE_TIMEOUT_MS)
    socketRef.current.broadcast({ kind: 'clock-probe', actor: actorRef.current, probeId, sentAt })
  }, [])

  const startClock = useCallback(() => {
    stopClock()
    for (let i = 0; i < CLOCK_BURST; i++) clockTimers.current.push(window.setTimeout(sendClockProbe, i * CLOCK_BURST_GAP_MS))
    clockInterval.current = window.setInterval(sendClockProbe, CLOCK_INTERVAL_MS)
  }, [sendClockProbe, stopClock])

  /** Close the connection and forget the room. Leaves the URL and the guest's saved settings alone. */
  const teardown = useCallback(() => {
    socketRef.current?.close()
    socketRef.current = null
    stopClock()
    clearTimer(pendingTransport)
    clearTimer(editTimer)
    clearTimer(responseTimer)
    probePending.current.clear()
    clockSamples.current.clear()
    sharedRef.current = EMPTY_STATE(actorRef.current, roomCore(settingsRef.current))
    lastBroadcastCore.current = ''
    lastTransportKey.current = ''
    showRoom(null)
    setPlayback(null)
    setTransport(null)
  }, [showRoom, stopClock])

  const leave = useCallback(() => {
    teardown()
    setUrlRoom(null)
    const restore = readRestore()
    writeRestore(null)
    if (restore) {
      update((prev) => ({
        ...prev,
        bpm: restore.bpm,
        tempoPercent: restore.tempoPercent,
        current: restore.current,
        selected: restore.selected,
      }))
    }
  }, [teardown, update])

  const connect = useCallback(async (mode: 'create' | 'join', requestedCode?: string): Promise<boolean> => {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
    const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined
    const fail = (code: string, error: string) => {
      showRoom({ code, status: 'connecting', error, inviteUrl: '' })
      return false
    }
    if (!url || !key) {
      return fail(requestedCode ?? '', 'Room sync is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to the Vercel project.')
    }
    const code = mode === 'create' ? makeCode() : parseRoomCode(requestedCode ?? '')
    if (!code) return fail(requestedCode ?? '', 'Enter a valid 16-character room code or paste an invite link.')

    // Leaving a previous room gives a guest their own settings back. That update only lands on the next render,
    // so a guest moving on to another room carries the earlier snapshot over instead of the room's settings.
    const prior = readRestore()
    const wasInRoom = !!roomRef.current && !roomRef.current.error
    if (roomRef.current) leave()
    else teardown()
    if (mode === 'create') {
      writeRestore(null)
    } else if (prior?.code === code) {
      writeRestore(prior)
    } else {
      const own = wasInRoom && prior ? prior : settingsRef.current
      writeRestore({ code, bpm: own.bpm, tempoPercent: own.tempoPercent, current: own.current, selected: own.selected })
    }

    const realtime = new RealtimeRoom(url, key, code)
    socketRef.current = realtime
    const me = actorRef.current
    const base: RoomSnapshot = { code, status: 'connecting', error: null, inviteUrl: inviteUrl(code) }
    showRoom(base)
    let peerFound = false
    let resolved = false
    let joinTimer: number | undefined
    const current = () => socketRef.current === realtime

    return await new Promise<boolean>((resolve) => {
      const finish = (ok: boolean, error?: string) => {
        if (resolved) return
        resolved = true
        window.clearTimeout(joinTimer)
        window.clearTimeout(connectionTimer)
        if (!current()) return resolve(false)
        if (ok) {
          showRoom({ ...base, status: 'connected' })
          setUrlRoom(code)
        } else {
          realtime.close()
          socketRef.current = null
          stopClock()
          sharedRef.current = EMPTY_STATE(me, roomCore(settingsRef.current))
          lastTransportKey.current = ''
          showRoom({ ...base, error: error ?? 'Could not join the room.' })
          setUrlRoom(null)
          writeRestore(null)
        }
        resolve(ok)
      }

      const connectionTimer = window.setTimeout(() => {
        finish(false, 'Could not connect to the room service. Check the Supabase configuration and try again.')
      }, 15_000)

      realtime.onJoin((ok, reason) => {
        if (!current()) return
        if (!ok) return finish(false, reason ? `Could not join the room: ${reason}` : undefined)
        startClock()
        // Also after a reconnect: whoever wrote the latest state answers, so missed changes arrive.
        realtime.broadcast({ kind: 'request-state', actor: me })
        if (resolved) {
          showRoom({ ...base, status: 'connected' })
          return
        }
        if (mode === 'create') {
          const core = roomCore(settingsRef.current)
          sharedRef.current = { revision: 1, writer: me, core, playing: false, source: me, sourceStartsAt: null }
          lastBroadcastCore.current = JSON.stringify(core)
          sendState('state')
          commitTransport()
          finish(true)
          return
        }
        joinTimer = window.setTimeout(() => {
          if (!peerFound) return finish(false, 'Room not found or everyone has left.')
          // Peers answered the clock but nobody holds a state (its writer left mid-answer): seed it from here.
          if (sharedRef.current.revision === 0) write({ core: roomCore(settingsRef.current) })
          finish(true)
        }, JOIN_WAIT_MS)
      })

      realtime.onDisconnect(() => {
        if (!current() || !roomRef.current) return
        stopClock()
        if (resolved) showRoom({ ...base, status: 'reconnecting' })
      })

      realtime.onMessage((message) => {
        if (!current() || message.actor === me) return
        peerFound = true

        if (message.kind === 'clock-probe') {
          realtime.broadcast({ kind: 'clock-reply', actor: me, probeId: message.probeId, sentAt: message.sentAt, remoteTime: Date.now() })
          return
        }

        if (message.kind === 'clock-reply') {
          const sentAt = probePending.current.get(message.probeId!)
          if (sentAt === undefined || sentAt !== message.sentAt) return
          const now = Date.now()
          const samples = (clockSamples.current.get(message.actor) ?? []).filter((sample) => now - sample.at < CLOCK_SAMPLE_MAX_AGE_MS)
          samples.push(clockSample(sentAt, message.remoteTime!, now))
          clockSamples.current.set(message.actor, samples.slice(-CLOCK_SAMPLES_KEPT))
          const state = sharedRef.current
          if (message.actor !== state.source) return
          if (pendingTransport.current !== undefined) {
            commitTransport()
          } else if (state.playing) {
            // A better estimate only refines the stored start (used by "resync" and the next start); restarting
            // audio for a few milliseconds would be far more noticeable than the error.
            setPlayback((prev) => (prev ? { ...prev, startsAt: localStartsAt(state) } : prev))
          }
          return
        }

        const state = sharedRef.current
        if (message.kind === 'request-state') {
          if (state.revision === 0) return
          clearTimer(responseTimer)
          if (state.writer === me) return sendState('state-response')
          const [min, max] = FALLBACK_RESPONSE_MS
          responseTimer.current = window.setTimeout(() => {
            responseTimer.current = undefined
            sendState('state-response')
          }, min + Math.random() * (max - min))
          return
        }

        const incoming = { revision: message.revision!, writer: message.writer! }
        const order = compareRevision(incoming, state)
        // Someone already answered with this state (or a newer one): no fallback answer needed.
        if (order >= 0) clearTimer(responseTimer)
        if (order <= 0) return
        sharedRef.current = {
          revision: incoming.revision,
          writer: incoming.writer,
          core: message.core!,
          playing: message.playing!,
          source: message.source!,
          sourceStartsAt: message.startsAt ?? null,
        }
        lastBroadcastCore.current = JSON.stringify(message.core)
        update((prev) => ({
          ...prev,
          bpm: message.core!.bpm,
          tempoPercent: message.core!.tempoPercent,
          current: { ...prev.current, ...message.core!.rhythm },
          selected: null,
        }))
        applyTransport()
        if (mode === 'join') finish(true)
      })
    })
  }, [applyTransport, commitTransport, leave, localStartsAt, sendState, showRoom, startClock, stopClock, teardown, update, write])

  // Invite links are consumed once per app load (and survive a reload, since the URL keeps ?room=).
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('room')
    if (code && !roomRef.current) void connect('join', code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Local edits: broadcast once the user pauses, and restart a playing room on a fresh shared bar.
  useEffect(() => {
    if (!room || room.status !== 'connected') return
    if (JSON.stringify(roomCore(settings)) === lastBroadcastCore.current) return
    clearTimer(editTimer)
    editTimer.current = window.setTimeout(() => {
      editTimer.current = undefined
      if (roomRef.current?.status !== 'connected') return
      const core = roomCore(settingsRef.current)
      if (JSON.stringify(core) === lastBroadcastCore.current) return
      if (sharedRef.current.playing) write({ core, source: actorRef.current, sourceStartsAt: Date.now() + START_LEAD_MS })
      else write({ core })
    }, EDIT_DEBOUNCE_MS)
  }, [settings, room, write])

  /** In a room: returns true and handles play/stop for everyone (a no-op while reconnecting). Outside: false. */
  const toggleTransport = useCallback((): boolean => {
    const current = roomRef.current
    if (!current || current.error) return false
    if (current.status !== 'connected') return true
    const playing = !sharedRef.current.playing
    write({ playing, source: actorRef.current, sourceStartsAt: playing ? Date.now() + START_LEAD_MS : null })
    return true
  }, [write])

  /** Restart local audio on the room's next bar (after enabling audio, or to fix drift). */
  const resync = useCallback(() => {
    const state = sharedRef.current
    const startsAt = localStartsAt(state)
    if (!state.playing || startsAt === null) return
    setPlayback({ ...state.core, playing: true, startsAt })
    setTransport({
      playing: true,
      startsAt: nextBarTime(startsAt, state.core),
      barSeconds: barMs(state.core) / 1000,
      eventId: `resync:${Date.now()}`,
    })
  }, [localStartsAt])

  // Unmount (also StrictMode's simulated one): close the socket but keep ?room= so the remount rejoins.
  useEffect(() => () => teardown(), [teardown])

  return {
    room,
    playback,
    transport,
    create: () => connect('create'),
    join: (code: string) => connect('join', code),
    leave,
    toggleTransport,
    resync,
  }
}

export function settingsForRoom(settings: Settings, playback: RoomPlayback | null): Settings {
  if (!playback) return settings
  return {
    ...settings,
    bpm: playback.bpm,
    tempoPercent: playback.tempoPercent,
    current: { ...settings.current, ...playback.rhythm },
    selected: null,
    loopSections: [],
    program: { ...settings.program, enabled: false },
    gap: { ...settings.gap, enabled: false },
    randomMute: { ...settings.randomMute, enabled: false },
    practice: { ...settings.practice, enabled: false },
  }
}
