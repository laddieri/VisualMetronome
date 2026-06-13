import { state } from './state.js';
import { createAnimals } from './animations.js';
import { initCameraListeners, openCamera } from './camera.js';
import { initCountingTrainerListeners } from './counting-trainer.js';
import { crRenderNotationDisplay, crUpdateNotationBall } from './custom-rhythm.js';
import { initRemoteControl, sendStateUpdate } from './remote.js';
import { initSettingsListeners } from './settings.js';
import {
  getAnimationProgress, getCanvasSize, getFullscreenCanvasSize, getVerticalY, initFullscreenListeners,
} from './stage.js';
import {
  applyBPM, loadTempoPresets, populateTempoMarkingDropdown, renderTempoPresetsList, saveTempoPresets, syncTempoMarkingDropdown,
} from './tempo.js';
import { _syncAnimSize } from './transport.js';
import { _syncNotationDisplay, _syncPracticeRow, updateColorPickerVisibility } from './view-sync.js';

// ─────────────────────────────────────────────────────────────────────────────

// Setup p5.js canvas
function setup() {
  // Calculate responsive canvas size
  const size = getCanvasSize();
  state.canvasWidth = size.width;
  state.canvasHeight = size.height;
  state.canvasScale = size.scale;

  var canvas = createCanvas(state.canvasWidth, state.canvasHeight);
  canvas.parent(document.querySelector('.canvas-wrapper'));
  // Use browser's native refresh rate via requestAnimationFrame (no frameRate throttle)
  // Setting frameRate(120) caused uneven inter-frame timing on 60Hz displays, producing
  // visible tearing at high BPM where the animation arc completes in very few frames.
  state.xpos = state.canvasWidth / 2 + state.rad;

  // Create 2 animal instances
  createAnimals();

  // Initialize camera listeners for selfie feature
  initCameraListeners();

  // Initialize settings modal listeners
  initSettingsListeners();

  // Initialize fullscreen listeners
  initFullscreenListeners();

  // Initialize counting trainer listeners
  initCountingTrainerListeners();

  document.querySelector('#animal-selector').addEventListener('change', e => {
    state.animalType = e.target.value;

    // Show/hide color picker and conductor selfie button based on animation type
    updateColorPickerVisibility();

    createAnimals(); // Recreate animals when selection changes
    // _sync3DConductor(); // disabled
    // _syncWebGPUCanvas(); // disabled
    _syncNotationDisplay();
    _syncAnimSize();
    _syncPracticeRow();
    sendStateUpdate();
  });

  // Animation size slider
  var animSizeSlider = document.getElementById('anim-size-slider');
  if (animSizeSlider) animSizeSlider.addEventListener('input', _syncAnimSize);

  // Score mode: ball colour picker
  document.getElementById('notation-ball-color').addEventListener('input', function(e) {
    state.notationBallColor = e.target.value;
    if (state.animalType === 'score') crRenderNotationDisplay();
  });

  // Shape selector: applies to both Circles and Score animations
  document.getElementById('notation-ball-style').addEventListener('change', function(e) {
    state.notationBallStyle = e.target.value;
    if (state.notationBallStyle === 'selfie') {
      state.cameraTarget = 'selfie';
      openCamera(); // capture/retake selfie photo
    }
    if (state.animalType === 'score') crRenderNotationDisplay();
    if (state.animalType === 'circle') createAnimals();
  });

  // Conductor selfie button — opens camera to capture a face for the conductor
  document.getElementById('conductor-selfie-btn').addEventListener('click', () => {
    state.cameraTarget = 'conductor';
    openCamera();
  });

  // Circle selfie button — sets the circle shape to the user's selfie
  const circleSelfieBtn = document.getElementById('circle-selfie-btn');
  if (circleSelfieBtn) {
    circleSelfieBtn.addEventListener('click', () => {
      state.cameraTarget = 'selfie';
      state.notationBallStyle = 'selfie';
      openCamera();
    });
  }

  // Bounce direction dropdown
  document.querySelector('#bounce-direction').addEventListener('change', e => {
    state.bounceDirection = e.target.value;
    sendStateUpdate();
  });

  // Initial color picker visibility
  updateColorPickerVisibility();

  // Populate tempo presets dropdown from localStorage (or defaults)
  loadTempoPresets();
  populateTempoMarkingDropdown(false);

  // Tempo marking dropdown - sets BPM and keeps the selection visible
  document.querySelector('#tempo-marking').addEventListener('change', e => {
    const bpm = parseInt(e.target.value);
    if (bpm) applyBPM(bpm);
  });

  // Tempo presets edit modal
  var tempoPresetsModal   = document.getElementById('tempo-presets-modal');
  var tempoPresetsEditBtn = document.getElementById('tempo-presets-edit-btn');
  var tempoPresetsCloseBtn = document.getElementById('tempo-presets-close-btn');
  var tempoPresetsResetBtn = document.getElementById('tempo-presets-reset-btn');

  if (tempoPresetsEditBtn) {
    tempoPresetsEditBtn.addEventListener('click', function() {
      renderTempoPresetsList();
      tempoPresetsModal.classList.remove('hidden');
    });
  }
  if (tempoPresetsCloseBtn) {
    tempoPresetsCloseBtn.addEventListener('click', function() {
      tempoPresetsModal.classList.add('hidden');
    });
  }
  if (tempoPresetsResetBtn) {
    tempoPresetsResetBtn.addEventListener('click', function() {
      if (!confirm('Reset all tempo presets to defaults?')) return;
      state.tempoPresets = state.DEFAULT_TEMPO_PRESETS.map(function(p) { return Object.assign({}, p); });
      saveTempoPresets();
      populateTempoMarkingDropdown(false);
      syncTempoMarkingDropdown();
      renderTempoPresetsList();
    });
  }
  if (tempoPresetsModal) {
    tempoPresetsModal.addEventListener('click', function(e) {
      if (e.target === tempoPresetsModal) tempoPresetsModal.classList.add('hidden');
    });
  }

  // Start WebSocket remote control (only active when running from local server)
  initRemoteControl();
}

// Handle window resize for responsive canvas
export function windowResized() {
  const size = state.isFullscreen ? getFullscreenCanvasSize() : getCanvasSize();
  state.canvasWidth = size.width;
  state.canvasHeight = size.height;
  state.canvasScale = size.scale;
  resizeCanvas(state.canvasWidth, state.canvasHeight);
  // if (conductor3dInstance && conductor3dInstance.initialized) { // disabled
  //   conductor3dInstance.resize();
  // }
}
// ─────────────────────────────────────────────────────────────────────────────

function draw() {
  // Flash white at beat (when progress is near 0) if enabled
  const progress = getAnimationProgress();
  // Suppress beat flash when counting trainer hides visuals
  const ctHideVisual = state.ctPhase === 'counting' && !state.ctVisualOn;
  const isFlashing = state.flashEnabled && !ctHideVisual && Tone.Transport.state === 'started' && progress < 0.08;
  // Counting trainer "done" flash: green background
  const isDoneFlashing = state.ctPhase === 'done' && Tone.Transport.state === 'started';
  // Compute the base background colour, blending in a warm amber tint
  // when a tempo transition ramp is active.  rampProgress runs 0→1 over
  // the ramp window; inverting it (1 - rampProgress) makes the tint
  // brightest at the first ramp beat and fades to normal as the new tempo
  // is reached.
  const baseColor        = color(window.vmCanvasBg || '#e2e8f0');
  const rampColor        = color(180, 120,  40);   // warm amber for transition ramp
  const ritardandoColor  = color( 40, 140, 180);   // teal blue for ritardando
  const bgColor = (state.ritardandoProgress > 0)
    ? lerpColor(baseColor, ritardandoColor, (1 - state.ritardandoProgress) * 0.45)
    : (state.rampProgress > 0)
      ? lerpColor(baseColor, rampColor, (1 - state.rampProgress) * 0.45)
      : baseColor;

  if (isDoneFlashing && progress < 0.12) {
    background('#48bb78');
  } else if (isFlashing) {
    background('white');
  } else {
    background(bgColor);
  }

  // In fullscreen, also flash the overlay background so the entire screen flashes
  if (state.isFullscreen) {
    const overlay = document.getElementById('fullscreen-overlay');
    if (overlay) {
      if (isDoneFlashing && progress < 0.12) {
        overlay.style.background = '#48bb78';
      } else if (isFlashing) {
        overlay.style.background = 'white';
      } else {
        overlay.style.background = `rgb(${red(bgColor)},${green(bgColor)},${blue(bgColor)})`;
      }
    }
  }

  // Scale all drawing to fit responsive canvas
  push();
  scale(state.canvasScale);

  if (ctHideVisual) {
    // Skip animal rendering — canvas stays blank (just background)
  } else if (state.animalType === 'score') {
    // Notation score display renders in its own SVG overlay; update the bouncing ball
    crUpdateNotationBall();
  // } else if (animalType === 'conductor3d') { // disabled
  //   // 3D conductor rendered by Three.js loop
  } else if (state.animalType === 'conductor') {
    // Conductor mode: both hands move in a 2D beat pattern regardless of direction setting
    state.animal1.pigmove();
    state.animal2.pigmove();
    state.animal1.display();
    state.animal2.display();
  } else if (state.animalType === 'pendulum') {
    // Pendulum metronome: single object, no direction or bounce-line needed
    state.animal1.display();
  } else if (state.bounceDirection === 'vertical') {
    // Vertical mode: one object bouncing against a horizontal line
    const lineY = 420;

    // Draw the horizontal line
    stroke(200);
    strokeWeight(4);
    line(120, lineY, 520, lineY);
    noStroke();

    // Position the single animal at center X, vertical Y
    state.animal1.x = 320; // Center of 640 width
    state.animal1.y = getVerticalY();
    state.animal1.display();
  } else {
    // Horizontal mode: two objects bouncing toward each other
    state.animal1.pigmove();
    state.animal2.pigmove();

    state.animal1.display();
    state.animal2.display();
  }

  // Counting trainer "ready" indicator — shown when armed and not yet playing
  if (state.countingTrainerEnabled && Tone.Transport.state !== 'started') {
    // Semi-transparent banner at top of canvas
    var bannerY = 18;
    var totalBeats = state.ctTargetMeasures * state.beatsPerMeasure + state.ctTargetExtraBeats;
    var label = 'Counting Trainer: ';
    if (state.ctTargetMeasures > 0 && state.ctTargetExtraBeats > 0) {
      label += state.ctTargetMeasures + (state.ctTargetMeasures === 1 ? ' measure' : ' measures') +
        ' + ' + state.ctTargetExtraBeats + (state.ctTargetExtraBeats === 1 ? ' beat' : ' beats');
    } else if (state.ctTargetMeasures > 0) {
      label += state.ctTargetMeasures + (state.ctTargetMeasures === 1 ? ' measure' : ' measures');
    } else {
      label += state.ctTargetExtraBeats + (state.ctTargetExtraBeats === 1 ? ' beat' : ' beats');
    }

    noStroke();
    fill(102, 126, 234, 180);
    rectMode(CENTER);
    var tw = textWidth(label);
    // Set font before measuring so width is accurate
    textFont('Inter, sans-serif');
    textSize(15);
    textStyle(BOLD);
    tw = textWidth(label);
    rect(320, bannerY, tw + 32, 28, 14);

    fill(255);
    textAlign(CENTER, CENTER);
    text(label, 320, bannerY);

    // Second line: sound/visual mode
    var modeLabel = (state.ctSoundOn ? 'Sound ON' : 'Sound OFF') + '  |  ' +
                    (state.ctVisualOn ? 'Visual ON' : 'Visual OFF');
    textSize(12);
    textStyle(NORMAL);
    var modeY = bannerY + 24;
    var mtw = textWidth(modeLabel);
    fill(102, 126, 234, 140);
    rect(320, modeY, mtw + 24, 22, 11);
    fill(255, 255, 255, 220);
    text(modeLabel, 320, modeY);

    // Reset text style
    textStyle(NORMAL);
    rectMode(CORNER);
  }

  // Song mode "ready" indicator — shown when armed and not yet playing
  if (state.songModeEnabled && state.songSections.length > 0 && Tone.Transport.state !== 'started') {
    var songBannerY = state.countingTrainerEnabled ? 66 : 18;
    var totalMeas = 0;
    for (var si = 0; si < state.songSections.length; si++) totalMeas += state.songSections[si].measures;
    var songLabel = 'Song Mode: ' + state.songSections.length +
      (state.songSections.length === 1 ? ' section' : ' sections') +
      ', ' + totalMeas + ' measures';

    noStroke();
    fill(118, 75, 162, 180);
    rectMode(CENTER);
    textFont('Inter, sans-serif');
    textSize(15);
    textStyle(BOLD);
    var stw = textWidth(songLabel);
    rect(320, songBannerY, stw + 32, 28, 14);

    fill(255);
    textAlign(CENTER, CENTER);
    text(songLabel, 320, songBannerY);

    textStyle(NORMAL);
    rectMode(CORNER);
  }

  pop();
}

// p5.js global mode discovers the sketch via window hooks; as an ES
// module our declarations are no longer implicit globals, so attach
// them explicitly before the window load event fires.
window.setup = setup;
window.draw = draw;
window.windowResized = windowResized;
