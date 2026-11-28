import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { BeatFlash } from './components/BeatFlash/BeatFlash'
import { BeatGrid } from './components/BeatGrid/BeatGrid'
import { MainPanel } from './components/MainPanel/MainPanel'
import { MixerPanel } from './components/MixerPanel/MixerPanel'
import { PresetsPanel } from './components/PresetsPanel/PresetsPanel'
import { ShortcutsHelp } from './components/ShortcutsHelp/ShortcutsHelp'
import { ThemePicker } from './components/ThemePicker/ThemePicker'
import { SoundPanel } from './components/SoundPanel/SoundPanel'
import { StatusBar } from './components/StatusBar/StatusBar'
import { TapTempoButton, type TapTempoHandle } from './components/TapTempoButton/TapTempoButton'
import { TempoControl } from './components/TempoControl/TempoControl'
import { Transport } from './components/Transport/Transport'
import { VoicePanel } from './components/VoicePanel/VoicePanel'
import { RoomMenu } from './components/RoomMenu/RoomMenu'
import { CheckIcon, FlashIcon, MetronomeIcon, SaveIcon, XIcon } from './components/icons/icons'
import { Button, IconButton, Toggle } from './components/ui/ui'
import type { PanelProps } from './components/panelTypes'
import { clampTempoPercent, findPart, practiceAt, selectPart, selectSection, withBpm } from './core/settings'
import type { PartRef, Rhythm, Settings } from './core/types'
import { useKeyboardShortcuts } from './state/useKeyboardShortcuts'
import { useMetronome } from './state/useMetronome'
import { useRoom } from './state/room'
import { presetActions, UNDO_MS, usePresets } from './state/usePresets'
import { useSettings } from './state/useSettings'
import './App.css'

type TabId = 'quick' | 'voice' | 'sound' | 'mixer' | 'presets'

/** The first tab is the main one: rhythm, silence, speed trainer and program. The others hold the less used setup. */
const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'quick', label: 'Quick' },
  { id: 'voice', label: 'Voice' },
  { id: 'sound', label: 'Sound' },
  { id: 'mixer', label: 'Mixer' },
  { id: 'presets', label: 'Presets' },
]
const MAIN_TAB: TabId = 'quick'

/** Anything a click can operate. A click on none of these (empty space, a card's background) clears the selection. */
const CONTROLS = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'label',
  '[role="radio"]',
  '[role="radiogroup"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="listbox"]',
  '[role="dialog"]',
  'dialog',
  '.ui-stepper-control',
  '.ui-slider-control',
  '.ui-select-wrap',
].join(', ')

/** Tabs whose feature is switched on get a dot, so an active trainer is never forgotten. */
function tabIndicator(tab: TabId, settings: Settings): string | null {
  switch (tab) {
    case 'quick':
      return settings.program.enabled ||
        settings.gap.enabled ||
        settings.practice.enabled
        ? 'on'
        : null
    case 'voice':
      return settings.voice.enabled || settings.voice.announceSections ? 'on' : null
    case 'mixer':
      return settings.mixer.muted ? 'muted' : null
    default:
      return null
  }
}

function TabContent({ tab, ...props }: PanelProps & { tab: TabId }) {
  switch (tab) {
    case 'quick':
      return <MainPanel {...props} />
    case 'sound':
      return <SoundPanel {...props} />
    case 'voice':
      return <VoicePanel {...props} />
    case 'mixer':
      return <MixerPanel {...props} />
    case 'presets':
      return <PresetsPanel {...props} />
  }
}

function finishedMessage(settings: Settings): string {
  const practiceStops = settings.practice.enabled && settings.practice.atTarget === 'stop'
  const programStops = settings.program.enabled && !settings.program.loop
  // The snapshot does not say which one ended playback; only name it when there is a single candidate.
  if (practiceStops && !programStops) return 'Practice finished'
  if (programStops && !practiceStops) return 'Program finished'
  return 'Finished'
}

/*
 * App re-renders on every pulse (useMetronome subscribes here), but the React Compiler caches every element whose
 * props did not change, so only the parts that receive pulse data (beat grid, status bar, flash, the open panel)
 * actually re-render. Keep the props of the other stage components to slow-changing primitives.
 */
export default function App() {
  const [settings, update] = useSettings()
  const roomSession = useRoom(settings, update)
  const metronome = useMetronome(settings, roomSession.playback)
  const { playback } = metronome
  const [tab, setTab] = useState<TabId>(MAIN_TAB)
  const { activeName, deleted } = usePresets()
  // Briefly true after the header save button overwrote the active preset (its icon turns into a check).
  const [presetSaved, setPresetSaved] = useState(false)
  const tapTempo = useRef<TapTempoHandle>(null)
  const tabList = useRef<HTMLDivElement>(null)
  const idBase = useId()

  const togglePlayback = () => {
    // The room is playing but this device is silent (audio blocked, or it failed to start): join in instead of
    // stopping everyone, since the button here shows "stopped".
    if (roomSession.room?.status === 'connected' && roomSession.playback?.playing && playback.status === 'stopped') {
      enableRoomAudio()
      return Promise.resolve()
    }
    if (roomSession.toggleTransport()) return Promise.resolve()
    return metronome.toggle()
  }

  const { start: startMetronome, stop: stopMetronome, keepAwake } = metronome
  useEffect(() => {
    const command = roomSession.transport
    if (!command) return
    stopMetronome()
    if (command.playing) void startMetronome(command.startsAt ?? undefined, command.barSeconds)
  }, [startMetronome, stopMetronome, roomSession.transport])

  const inRoom = !!roomSession.room && !roomSession.room.error
  useEffect(() => {
    keepAwake(inRoom)
  }, [keepAwake, inRoom])

  function createRoom() {
    void metronome.prepareAudio()
    void roomSession.create()
  }

  function joinRoom(code: string) {
    void metronome.prepareAudio()
    void roomSession.join(code)
  }

  function leaveRoom() {
    roomSession.leave()
    metronome.stop()
  }

  function enableRoomAudio() {
    void metronome.prepareAudio().then((ready) => {
      if (ready) roomSession.resync()
    })
  }

  const pulse = playback.status === 'playing' ? playback.pulse : null
  const { sections } = settings
  const selected = findPart(settings, settings.selected)
  // While sections play (program mode, or the selected section looping) the stage follows the playing part; otherwise
  // it shows what the quick controls edit: the selected part, or the free rhythm.
  const sectionsPlaying = pulse !== null && (settings.program.enabled || selected !== null)
  const playingSection = sectionsPlaying ? sections[pulse.sectionIndex] : undefined
  const playingPart = playingSection?.parts[pulse?.partIndex ?? 0]
  const shownFrom = playingSection && playingPart
    ? { section: playingSection, sectionIndex: pulse?.sectionIndex ?? 0, part: playingPart, partIndex: pulse?.partIndex ?? 0 }
    : selected
  const shownRhythm: Rhythm = shownFrom?.part ?? settings.current
  const shownTarget: PartRef | null = shownFrom ? { section: shownFrom.section.id, part: shownFrom.part.id } : null
  const shownName = shownFrom
    ? [
        shownFrom.section.name.trim() || `Section ${shownFrom.sectionIndex + 1}`,
        shownFrom.section.parts.length > 1 ? `part ${shownFrom.partIndex + 1}/${shownFrom.section.parts.length}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : null
  const playingBpm = pulse !== null ? Math.round(pulse.bpm * 10) / 10 : null
  const playingBaseBpm = pulse !== null ? pulse.baseBpm : null
  const playingSectionName = settings.program.enabled && playingSection ? playingSection.name : null

  const setBpm = (bpm: number) => update((prev) => withBpm(prev, bpm))

  function saveActivePreset() {
    if (presetActions.saveActive(settings)) setPresetSaved(true)
  }

  useEffect(() => {
    if (!presetSaved) return
    const timer = window.setTimeout(() => setPresetSaved(false), 1500)
    return () => window.clearTimeout(timer)
  }, [presetSaved])

  useKeyboardShortcuts({
    togglePlay: () => void togglePlayback(),
    tap: () => tapTempo.current?.tap(),
    nudgeBpm: (delta) => update((prev) => withBpm(prev, prev.bpm + delta)),
    nudgeTempoPercent: (delta) =>
      update((prev) => ({ ...prev, tempoPercent: clampTempoPercent(prev.tempoPercent + delta) })),
    toggleMute: () => update((prev) => ({ ...prev, mixer: { ...prev.mixer, muted: !prev.mixer.muted } })),
    toggleSilence: () => update((prev) => ({ ...prev, gap: { ...prev.gap, enabled: !prev.gap.enabled } })),
    toggleVoice: () => update((prev) => ({ ...prev, voice: { ...prev.voice, enabled: !prev.voice.enabled } })),
    toggleProgram: () => update((prev) => ({ ...prev, program: { ...prev.program, enabled: !prev.program.enabled } })),
    toggleSpeedTrainer: () =>
      update((prev) => ({
        ...prev,
        practice: { ...practiceAt(prev.practice, prev.bpm), enabled: !prev.practice.enabled },
      })),
    toggleFlash: () => update((prev) => ({ ...prev, visual: { ...prev.visual, flash: !prev.visual.flash } })),
    openTab: (index) => {
      const next = TABS[index]
      if (next) setTab(next.id)
    },
    closeTab: () => setTab(MAIN_TAB),
    // From no selection, "next" selects the first section and "previous" the last.
    stepSection: (delta) =>
      update((prev) => {
        const current = findPart(prev, prev.selected)?.sectionIndex
        const index =
          current === undefined
            ? delta > 0
              ? 0
              : prev.sections.length - 1
            : Math.min(Math.max(0, current + delta), prev.sections.length - 1)
        return selectSection(prev, index)
      }),
  })

  // Clicking outside every control clears the section selection (the controls go back to the free rhythm). Only
  // listened for while something is selected, since every update makes new settings.
  const hasSelection = settings.selected !== null
  useEffect(() => {
    if (!hasSelection) return
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || !(e.target instanceof Element) || e.target.closest(CONTROLS)) return
      // The end of a text selection is not a click on empty space.
      if (!window.getSelection()?.isCollapsed) return
      update((prev) => selectPart(prev, null))
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [hasSelection, update])

  // Keep the selected tab visible in the horizontally scrolling tab bar (phones), also after a reload.
  useEffect(() => {
    const list = tabList.current
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!list || !selected || list.scrollWidth <= list.clientWidth) return
    list.scrollLeft = selected.offsetLeft - (list.clientWidth - selected.offsetWidth) / 2
  }, [tab])

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    switch (e.key) {
      case 'ArrowRight':
        next = (index + 1) % TABS.length
        break
      case 'ArrowLeft':
        next = (index - 1 + TABS.length) % TABS.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = TABS.length - 1
        break
      default:
        return
    }
    e.preventDefault()
    setTab(TABS[next].id)
    tabList.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  const tabId = (id: TabId) => `${idBase}-tab-${id}`
  const panelId = (id: TabId) => `${idBase}-panel-${id}`

  return (
    <div className="app">
      <BeatFlash pulse={settings.visual.flash ? pulse : null} />

      <header className="app__header">
        <div className="app__brand">
          <MetronomeIcon size={20} className="app__logo" />
          <h1 className="app__title">DC Metronome</h1>
        </div>
        <div className="app__header-actions">
          <span className="app__flash" title="Flash the screen on every beat, brighter on accents (F)">
            <FlashIcon size={14} />
            <Toggle
              size="sm"
              hideLabel
              label="Flash"
              checked={settings.visual.flash}
              onChange={(flash) => update((prev) => ({ ...prev, visual: { ...prev.visual, flash } }))}
            />
          </span>
          <ThemePicker />
          <RoomMenu room={roomSession.room} onCreate={createRoom} onJoin={joinRoom} onLeave={leaveRoom} onEnableAudio={enableRoomAudio} />
          <ShortcutsHelp />
        </div>
      </header>

      <main className="app__main">
        <section className="app__stage" aria-label="Metronome">
          <TempoControl
            settings={settings}
            onChange={update}
            playingBpm={playingBpm}
            playingBaseBpm={playingBaseBpm}
          />
          <Transport
            status={playback.status}
            error={playback.error}
            finished={playback.ended ? finishedMessage(settings) : null}
            onToggle={togglePlayback}
            aside={<TapTempoButton ref={tapTempo} onTempo={setBpm} />}
          />
          <BeatGrid rhythm={shownRhythm} target={shownTarget} name={shownName} onChange={update} pulse={pulse} />
          <StatusBar
            pulse={pulse}
            startTime={playback.startTime}
            sectionName={playingSectionName}
            programEnabled={settings.program.enabled}
            gap={settings.gap}
          />
        </section>

        <section className="app__settings" aria-label="Settings">
          <div className="app__tabbar">
            <div ref={tabList} className="app__tabs" role="tablist" aria-label="Settings">
              {TABS.map((t, index) => {
                const selected = t.id === tab
                const indicator = tabIndicator(t.id, settings)
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={tabId(t.id)}
                    className="app__tab"
                    aria-selected={selected}
                    aria-controls={panelId(t.id)}
                    aria-keyshortcuts={String(index + 1)}
                    title={`${t.label} (${index + 1})`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setTab(t.id)}
                    onKeyDown={(e) => onTabKeyDown(e, index)}
                  >
                    {t.label}
                    {/* The dot always takes its space, so switching a feature on never resizes the tab bar. */}
                    <span
                      className={`app__tab-dot${indicator !== null ? ` app__tab-dot--${indicator}` : ' app__tab-dot--off'}`}
                      aria-hidden="true"
                    />
                    {indicator !== null && <span className="sr-only">({indicator})</span>}
                  </button>
                )
              })}
            </div>
            {activeName !== null && (
              <div className="app__preset">
                <button
                  type="button"
                  className="app__active-preset"
                  title={`Active preset: ${activeName}. Open the presets`}
                  onClick={() => setTab('presets')}
                >
                  <span className="app__active-preset-label">Preset</span>
                  <span className="app__active-preset-name">{activeName}</span>
                </button>
                <IconButton
                  size="sm"
                  variant="ghost"
                  className={`app__preset-save${presetSaved ? ' is-saved' : ''}`}
                  label={presetSaved ? `Saved to ${activeName}` : `Save the current setup to ${activeName}`}
                  icon={presetSaved ? <CheckIcon size={16} /> : <SaveIcon size={16} />}
                  onClick={saveActivePreset}
                />
                <span className="sr-only" role="status">
                  {presetSaved ? `Saved to ${activeName}.` : ''}
                </span>
              </div>
            )}
          </div>
          {TABS.map((t) => (
            <div
              key={t.id}
              id={panelId(t.id)}
              className={t.id === MAIN_TAB ? 'app__tabpanel app__tabpanel--main' : 'app__tabpanel'}
              role="tabpanel"
              aria-labelledby={tabId(t.id)}
              hidden={t.id !== tab}
            >
              {/* Only the open tab is mounted: panels that read playback re-render on every pulse. */}
              {t.id === tab && <TabContent tab={t.id} settings={settings} onChange={update} metronome={metronome} />}
            </div>
          ))}
        </section>
      </main>

      {deleted !== null && (
        // Keyed per deletion, so the countdown line restarts when another preset is deleted.
        <div key={deleted.preset.id} className="app__undo" role="status" style={{ '--undo-ms': `${UNDO_MS}ms` } as CSSProperties}>
          <span className="app__undo-text">
            Deleted <strong>{deleted.preset.name}</strong>
          </span>
          <Button size="sm" variant="secondary" onClick={() => presetActions.undoRemove()}>
            Undo
          </Button>
          <IconButton size="sm" variant="ghost" label="Dismiss" icon={<XIcon size={16} />} onClick={() => presetActions.dismissUndo()} />
          <span className="app__undo-countdown" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}
