import { useEffect, useRef, useState } from 'react'
import { VOICE_PACKS } from '../../core/constants'
import type { VoicePackId, VoiceSettings, VoiceWord } from '../../core/types'
import { StopIcon, VoiceIcon } from '../icons/icons'
import type { PanelProps } from '../panelTypes'
import { Button, Field, Panel, Select, Slider, Toggle } from '../ui/ui'
import './VoicePanel.css'

const PREVIEW_WORDS: readonly VoiceWord[] = ['1', '2', '3', '4']
// One bar of 4/4 at about 133 BPM: slow enough to hear each word whole.
const PREVIEW_SPACING_MS = 450

const PACK_OPTIONS = VOICE_PACKS.map((pack) => ({ value: pack.id, label: pack.label }))

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function VoicePanel({ settings, onChange, metronome }: PanelProps) {
  const { voice } = settings
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  // Bumped on every start/stop so callbacks of an abandoned preview do nothing.
  const run = useRef(0)

  useEffect(
    () => () => {
      run.current++
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  function setVoice(patch: Partial<VoiceSettings>) {
    onChange((prev) => ({ ...prev, voice: { ...prev.voice, ...patch } }))
  }

  function setVoiceVolume(value: number) {
    onChange((prev) => (prev.mixer.voice === value ? prev : { ...prev, mixer: { ...prev.mixer, voice: value } }))
  }

  function stopPreview() {
    run.current++
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setPreviewing(false)
  }

  function startPreview() {
    stopPreview()
    const id = run.current
    setPreviewing(true)
    setPreviewError(null)

    const finish = () => {
      timer.current = null
      if (run.current === id) setPreviewing(false)
    }
    const speakFrom = (index: number) => {
      timer.current = null
      if (run.current !== id) return
      void metronome.previewVoice(PREVIEW_WORDS[index]).catch(() => {})
      timer.current = window.setTimeout(
        index + 1 < PREVIEW_WORDS.length ? () => speakFrom(index + 1) : finish,
        PREVIEW_SPACING_MS,
      )
    }

    // The first word is spoken inside the click (it may have to unlock audio and load the pack); the count
    // starts once it is under way so the remaining words keep even spacing.
    let first: Promise<void>
    try {
      first = metronome.previewVoice(PREVIEW_WORDS[0])
    } catch (err) {
      first = Promise.reject(err)
    }
    first.then(
      () => {
        if (run.current !== id) return
        timer.current = window.setTimeout(() => speakFrom(1), PREVIEW_SPACING_MS)
      },
      () => {
        if (run.current !== id) return
        setPreviewing(false)
        setPreviewError('Could not play the voice. Please try again.')
      },
    )
  }

  return (
    <Panel
      className="voice-panel"
      title="Voice count"
      description="Speaks the count out loud: “one, two, three, four”."
      headerAction={
        <Toggle hideLabel label="Voice counting" checked={voice.enabled} onChange={(enabled) => setVoice({ enabled })} />
      }
    >
      <Select<VoicePackId>
        label="Voice"
        value={voice.pack}
        options={PACK_OPTIONS}
        onChange={(pack) => setVoice({ pack })}
      />

      <div className="voice-panel__options">
        <Field inline label="Count subdivisions" hint="“1 e and a”, “1 trip let”">
          <Toggle
            hideLabel
            label="Count subdivisions"
            checked={voice.subdivisions}
            onChange={(subdivisions) => setVoice({ subdivisions })}
          />
        </Field>
        <Field inline label="Keep clicks" hint="Off: the voice replaces the click.">
          <Toggle hideLabel label="Keep clicks" checked={voice.clicks} onChange={(clicks) => setVoice({ clicks })} />
        </Field>
      </div>

      <Slider
        label="Voice volume"
        value={settings.mixer.voice}
        min={0}
        max={1}
        step={0.01}
        format={formatPercent}
        onChange={setVoiceVolume}
      />

      <div className="voice-panel__preview">
        <Button
          icon={previewing ? <StopIcon size={18} /> : <VoiceIcon size={18} />}
          onClick={previewing ? stopPreview : startPreview}
        >
          {previewing ? 'Stop preview' : 'Preview'}
        </Button>
        <p
          className={previewError ? 'voice-panel__preview-status is-error' : 'voice-panel__preview-status'}
          role="status"
        >
          {previewError ?? (previewing ? 'Counting 1 2 3 4…' : '')}
        </p>
      </div>

      <ul className="voice-panel__notes">
        <li>At fast tempos the words are sped up to fit.</li>
        <li>Counts up to 16 beats per bar.</li>
        <li>Muted and silent beats are not spoken.</li>
      </ul>
    </Panel>
  )
}
