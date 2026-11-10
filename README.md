# DC Metronome

A practice metronome for the browser. Its clicks are scheduled on the Web Audio clock, so timing holds steady up to 300 BPM even when the page is busy. Everything runs locally: settings and presets stay in `localStorage`, and uploaded sounds in IndexedDB.

## Features

- **Tempo** from 60 to 300 BPM: type it, drag the slider, use the ±1 and ±5 buttons (they repeat while held), or use the arrow keys. The Italian tempo marking (Adagio, Allegro …) is shown above the number.
- **Tap tempo**: the Tap button or the `T` key. A long pause starts a new measurement.
- **Tempo percentage** (25–200 %): practise at a fraction of the set tempo without losing it.
- **Time signatures**: 1–16 beats over 2, 4, 8 or 16, with grouping chips for odd meters (2+2+3 …).
- **Subdivisions**: eighths, triplets, sixteenths, quintuplets, sextuplets, swing, gallop, reverse gallop and dotted.
- **Accents and silent beats**: one-tap accent patterns (Plain = accent on 1 only, or groupings like 3+3, 2+2+3), and a beat pad click cycles it through accent, sub-accent, normal and mute. The sub-accent (beat 4 of 6/8 as 3+3) has its own sound and mixer fader.
- **Program mode**: a matrix of sections (time signature and bars at a glance), each with its own bars and optional tempo. Signature, accents and subdivision come from the quick controls: picking a section loads its rhythm there, and **Save section** writes your changes back, so editing never changes a section by accident. Outside program mode the rhythm in the quick controls plays. It plays once or loops, and **templates** save and load whole programs (sections and loop).
- **Silence**:
  - a gap trainer (e.g. 2 bars played, 1 bar silent)
  - random mute (a percentage of beats is dropped)
- **Speed trainer**: raises or lowers the tempo by a step every N bars, from a start tempo to a target. At the target it holds, restarts, turns around (ping-pong) or stops. A ramp preview shows the whole path.
- **Sounds**:
  - 10 synthesized kits (click, beep, woodblock, cowbell, clave, hi-hat, rimshot, mechanical, bell, kick), chosen separately for accent, sub-accent, beat and subdivision
  - your own uploaded files (WAV, MP3 or OGG, up to 5 MB and 4 s each)
- **Voice counting** ("one two three four"): English male, English female or Spanish female. It can also count subdivisions ("1 e and a", "1 trip let"), and you can keep or drop the clicks underneath. Words speed up at fast tempos.
- **Mixer**: master volume with a mute button and an output meter, plus faders for accent, sub-accent, beat, subdivision and voice.
- **Quick tab**: the main settings tab is a grid of small cells with everything used while practising: time signature and subdivision (most-used choices as chips, a picker for the rest), accents, rest bar (gap trainer `2:1` … plus random mute), speed trainer, voice, master volume, and the program matrix below (it can be minimized). Voice, Sound, Mixer and Presets have their own tabs; the flash switch sits in the header.
- **Presets**: save, rename, overwrite, delete, and import or export them as JSON. There are also 10 factory presets (waltz, 6/8, 7/8, song form …).
- **Visual feedback**: the playing beat lights up on the beat grid, the status bar shows bar, beat, time, section and trainers, and you can turn on a screen flash on every beat.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Start / stop |
| `T` | Tap tempo |
| `↑` / `↓` | Tempo ±1 BPM |
| `Shift` + `↑` / `↓` | Tempo ±10 BPM |
| `+` / `−` | Tempo % ±5 |
| `M` | Mute / unmute |
| `S` | Rest bar (gap trainer) on / off |
| `R` | Random mute on / off |
| `V` | Voice counting on / off |
| `P` | Program mode on / off |
| `A` | Speed trainer on / off |
| `F` | Screen flash on / off |
| `[` / `]` | Previous / next section |
| `1` – `5` | Open a settings tab (`1` = Quick) |
| `Esc` | Back to the Quick tab |

Shortcuts are ignored while you type in a text field or a select, and while Ctrl, Alt or Meta is held. Sliders, radio groups and tabs keep their own arrow keys. The **Shortcuts** button in the header lists them all.

## Running it

Requires Node 20+ and Yarn 1.

```sh
yarn          # install dependencies
yarn dev      # start the dev server (http://localhost:5173)
yarn test     # run the unit tests (Vitest)
yarn build    # type-check (tsc -b) and build to dist/
yarn preview  # serve the production build
yarn lint     # ESLint (see the note below)
```

> **Lint and TypeScript 7.** The project compiles with TypeScript 7, which has no JavaScript compiler API yet, and `typescript-eslint` refuses to load with it. To fix `yarn lint`, follow the [TypeScript 7 side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0): in `devDependencies`, alias `"typescript": "npm:@typescript/typescript6@^6.0.2"` and add `"@typescript/native": "npm:typescript@~7.0.2"`, then run `yarn`.

## Voice samples

The spoken counts are pre-rendered WAV files in `public/voices/<pack>/<word>.wav`. Each pack has the words 1–16 plus `e`, `and`, `a`, `trip` and `let`. To regenerate them on Windows, using the built-in SAPI voices (David, Zira and Helena):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/generate-voices.ps1
node scripts/trim-voices.mjs
```

The second step cuts the leading and trailing silence, so each word starts exactly on the beat it is scheduled for.

## Architecture

```
src/
  core/        Pure TypeScript, no DOM, fully unit-tested
    types.ts, constants.ts   The shared data model (Settings, Section, PulseEvent …)
    settings.ts              Defaults, clamping, sanitizeSettings, effectiveBpm
    meter.ts                 Default accents, groupings, resizing, tempo markings
    tapTempo.ts              Tap tempo detector
    sequencer.ts             Turns Settings into a stream of timed PulseEvents (program, gap,
                             random mute, speed trainer, voice words); drift-free timing
  audio/       Web Audio
    sounds.ts                Synthesized built-in sounds (deterministic DSP)
    customSounds.ts          IndexedDB storage for uploaded sounds
    voice.ts                 Loads voice packs
    engine.ts                MetronomeEngine singleton: look-ahead scheduler on a worker timer,
                             mixer, previews, wake lock; publishes a PlaybackSnapshot
  state/       React glue
    useSettings.ts           Settings state, always sanitized, debounced save to localStorage
    useMetronome.ts          Pushes settings to the engine, subscribes to its snapshot
    useCustomSounds.ts       Uploaded-sound list and its actions
    useKeyboardShortcuts.ts  Global shortcuts
    storage.ts, factoryPresets.ts
  components/  The UI
    ui.tsx, icons.tsx        Small accessible UI kit (Slider, Stepper, Segmented, Toggle …)
    TempoControl, BeatGrid, Transport, MasterVolume, StatusBar, BeatFlash   The stage
    *Panel.tsx               One panel per settings tab, all taking PanelProps
                             { settings, onChange, metronome }
```

Data flows one way. `useSettings` holds the settings, panels change them through `onChange(prev => next)`, `useMetronome` pushes every change to the engine, and the engine asks the sequencer for the next pulses ahead of time. While playing, the engine reports each pulse back through `useSyncExternalStore` so the screen can follow it. The React Compiler handles memoization, so there are no manual `useMemo`/`useCallback` calls for performance.

In development, `window.__dcMetronome` exposes the engine for debugging (`getSnapshot()`, `start()`, `stop()` …).
