// Visual Metronome — application entry point.
// Each module attaches its own listeners / schedules at import time, in
// the same relative order the original monolithic script.js executed.
import './modules/voice.js';
import './modules/stage.js';
import './modules/animations.js';
import './modules/conductor3d.js';
import './modules/camera.js';
import './modules/settings.js';
import './modules/audio-context.js';
import './modules/sounds.js';
import './modules/transport.js';
import './modules/tempo.js';
import './modules/view-sync.js';
import './modules/counting-trainer.js';
import './modules/songs.js';
import './modules/sketch.js';
import './modules/remote.js';
import './modules/custom-rhythm.js';
import './modules/check-rhythm.js';
import './modules/two-measure.js';

import { state } from './modules/state.js';

// Compatibility bridge: layout.js (a classic script) updates
// window.circleColor when the theme changes. The old script.js exposed it
// implicitly as a window property via top-level `var`; as a module it lives
// on `state`, so mirror it here.
Object.defineProperty(window, 'circleColor', {
  get() { return state.circleColor; },
  set(v) { state.circleColor = v; },
});
