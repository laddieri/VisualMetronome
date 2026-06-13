# VisualMetronome
Javascript metronome

## Architecture

The app has no build step — it ships as native ES modules. `index.html` loads
`js/main.js` (`type="module"`), which imports the feature modules under
`js/modules/`:

| Module | Responsibility |
| --- | --- |
| `state.js` | Shared mutable state read/written across modules (tempo, meter, feature flags, …) |
| `transport.js` | Tone.Transport beat scheduling, count-in, play/stop UI, spacebar |
| `sounds.js` | Click/woodblock/drum synths and per-beat sound triggering |
| `voice.js` | Recorded voice counting with SpeechSynthesis fallback |
| `tempo.js` | BPM controls and editable tempo presets |
| `sketch.js` | p5.js `setup()` / `draw()` / `windowResized()` entry points |
| `animations.js` | Circle / conductor / pendulum / selfie animation classes |
| `stage.js` | Canvas sizing, fullscreen mode, beat-animation easing |
| `camera.js` | Selfie capture, sound recording, saved selfies |
| `settings.js` | Advanced-settings modal and the reset button |
| `audio-context.js` | AudioContext resume/recovery and tab-visibility handling |
| `view-sync.js` | Visibility syncing between animation modes and controls |
| `counting-trainer.js` | Silent-counting exercise |
| `songs.js` | Multi-section songs with tempo ramps and ritardando |
| `two-measure.js` | Alternating two-measure patterns |
| `custom-rhythm.js` | Rhythm builder and SVG notation rendering (score mode) |
| `check-rhythm.js` | Microphone onset detection and rhythm-accuracy feedback |
| `remote.js` | Phone remote control (WebSocket relay or WebRTC/PeerJS) |

Single-module state lives as module-level variables in its owning module;
anything shared across modules lives on the `state` object from `state.js`.
`js/layout.js` (theme + responsive shell) and `js/tonejs-ui.js` stay classic
scripts; they interact with the app only through the DOM, `window.vmCanvasBg`,
and the `window.circleColor` bridge defined in `main.js`.

Because the app uses ES modules it must be served over HTTP (e.g.
`npm start`, or any static server) — opening `index.html` directly from the
filesystem won't load modules.

## Running locally

```
npm install
npm start    # serves on http://localhost:9090 and enables the phone remote
```
