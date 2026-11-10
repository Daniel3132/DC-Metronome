import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { BeatFlash } from './components/BeatFlash/BeatFlash'
import { BeatGrid } from './components/BeatGrid/BeatGrid'
import { MainPanel } from './components/MainPanel/MainPanel'
import { MixerPanel } from './components/MixerPanel/MixerPanel'
import { PresetsPanel } from './components/PresetsPanel/PresetsPanel'
import { ShortcutsHelp } from './components/ShortcutsHelp/ShortcutsHelp'
import { SoundPanel } from './components/SoundPanel/SoundPanel'
import { StatusBar } from './components/StatusBar/StatusBar'
import { TapTempoButton, type TapTempoHandle } from './components/TapTempoButton/TapTempoButton'
import { TempoControl } from './components/TempoControl/TempoControl'
import { Transport } from './components/Transport/Transport'
import { VoicePanel } from './components/VoicePanel/VoicePanel'
import { FlashIcon, MetronomeIcon } from './components/icons/icons'
import { Toggle } from './components/ui/ui'
import type { PanelProps } from './components/panelTypes'
import { clampBpm, clampTempoPercent, selectSection } from './core/settings'
import type { Settings } from './core/types'
import { useKeyboardShortcuts } from './state/useKeyboardShortcuts'
import { useMetronome } from './state/useMetronome'
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

/** Tabs whose feature is switched on get a dot, so an active trainer is never forgotten. */
function tabIndicator(tab: TabId, settings: Settings): string | null {
  switch (tab) {
    case 'quick':
      return settings.program.enabled ||
        settings.gap.enabled ||
        settings.randomMute.enabled ||
        settings.practice.enabled
        ? 'on'
        : null
    case 'voice':
      return settings.voice.enabled ? 'on' : null
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
  const metronome = useMetronome(settings)
  const { playback } = metronome
  const [tab, setTab] = useState<TabId>(MAIN_TAB)
  const tapTempo = useRef<TapTempoHandle>(null)
  const tabList = useRef<HTMLDivElement>(null)
  const idBase = useId()

  const pulse = playback.status === 'playing' ? playback.pulse : null
  const { sections } = settings
  // While a program plays, the stage follows the playing section; otherwise it shows the working rhythm (what the
  // quick controls edit and what plays outside program mode).
  const programPlaying = pulse !== null && settings.program.enabled
  const shownSection = programPlaying
    ? (sections[Math.min(pulse.sectionIndex, sections.length - 1)] ?? sections[0])
    : settings.current
  const gridPulse = pulse
  const playingBpm = pulse !== null ? Math.round(pulse.bpm * 10) / 10 : null
  const playingBaseBpm = pulse !== null ? pulse.baseBpm : null
  const playingSectionName = programPlaying ? (sections[pulse.sectionIndex]?.name ?? null) : null

  const setBpm = (bpm: number) => update((prev) => ({ ...prev, bpm: clampBpm(bpm) }))

  useKeyboardShortcuts({
    togglePlay: () => void metronome.toggle(),
    tap: () => tapTempo.current?.tap(),
    nudgeBpm: (delta) => update((prev) => ({ ...prev, bpm: clampBpm(prev.bpm + delta) })),
    nudgeTempoPercent: (delta) =>
      update((prev) => ({ ...prev, tempoPercent: clampTempoPercent(prev.tempoPercent + delta) })),
    toggleMute: () => update((prev) => ({ ...prev, mixer: { ...prev.mixer, muted: !prev.mixer.muted } })),
    toggleSilence: () => update((prev) => ({ ...prev, gap: { ...prev.gap, enabled: !prev.gap.enabled } })),
    toggleRandomMute: () =>
      update((prev) => ({ ...prev, randomMute: { ...prev.randomMute, enabled: !prev.randomMute.enabled } })),
    toggleVoice: () => update((prev) => ({ ...prev, voice: { ...prev.voice, enabled: !prev.voice.enabled } })),
    toggleProgram: () => update((prev) => ({ ...prev, program: { ...prev.program, enabled: !prev.program.enabled } })),
    toggleSpeedTrainer: () =>
      update((prev) => ({ ...prev, practice: { ...prev.practice, enabled: !prev.practice.enabled } })),
    toggleFlash: () => update((prev) => ({ ...prev, visual: { ...prev.visual, flash: !prev.visual.flash } })),
    openTab: (index) => {
      const next = TABS[index]
      if (next) setTab(next.id)
    },
    closeTab: () => setTab(MAIN_TAB),
    stepSection: (delta) =>
      update((prev) => {
        const activeSection = Math.min(Math.max(0, prev.activeSection + delta), prev.sections.length - 1)
        return activeSection === prev.activeSection ? prev : selectSection(prev, activeSection)
      }),
  })

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
              label="Flash"
              checked={settings.visual.flash}
              onChange={(flash) => update((prev) => ({ ...prev, visual: { ...prev.visual, flash } }))}
            />
          </span>
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
            onToggle={metronome.toggle}
            aside={<TapTempoButton ref={tapTempo} onTempo={setBpm} />}
          />
          <BeatGrid section={shownSection} showName={programPlaying} onChange={update} pulse={gridPulse} />
          <StatusBar
            pulse={pulse}
            startTime={playback.startTime}
            sectionName={playingSectionName}
            programEnabled={settings.program.enabled}
            gap={settings.gap}
            practice={settings.practice}
          />
        </section>

        <section className="app__settings" aria-label="Settings">
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
                  {indicator !== null && (
                    <>
                      <span className={`app__tab-dot app__tab-dot--${indicator}`} aria-hidden="true" />
                      <span className="sr-only">({indicator})</span>
                    </>
                  )}
                </button>
              )
            })}
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
    </div>
  )
}
