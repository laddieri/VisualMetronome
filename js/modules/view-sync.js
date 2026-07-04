import { state } from './state.js';
import { crmSyncToggleRow } from './check-rhythm.js';
import { crRenderNotationDisplay } from './custom-rhythm.js';
import { start3DConductor, stop3DConductor } from './conductor3d.js';


// Show/hide color picker based on animation type
export function updateColorPickerVisibility() {
  // Original circle color picker — shown only for Circles animation
  const colorPickerGroup = document.getElementById('color-picker-group');
  if (colorPickerGroup) colorPickerGroup.style.display = (state.animalType === 'circle') ? '' : 'none';

  const isConductor = (state.animalType === 'conductor');
  const isCircle = (state.animalType === 'circle');
  const conductorSelfieBtn = document.getElementById('conductor-selfie-btn');
  if (conductorSelfieBtn) {
    // Both conductors (2D and 3D) can wear the user's face
    conductorSelfieBtn.style.display =
      (isConductor || state.animalType === 'conductor3d') ? '' : 'none';
  }
  const circleSelfieBtn = document.getElementById('circle-selfie-btn');
  if (circleSelfieBtn) {
    circleSelfieBtn.style.display = isCircle ? '' : 'none';
  }
  // Hide the selfie option from the shape dropdown in circle mode — the button handles it there
  const selfieShapeOption = document.getElementById('selfie-shape-option');
  if (selfieShapeOption) {
    selfieShapeOption.hidden = isCircle;
  }
  const directionGroup = document.getElementById('direction-group');
  if (directionGroup) {
    directionGroup.style.display = (isConductor || state.animalType === 'conductor3d' || state.animalType === 'score' || state.animalType === 'pendulum') ? 'none' : '';
  }
  // Notation ball color picker — shown only for Score animation
  const notationBallColorGroup = document.getElementById('notation-ball-color-group');
  if (notationBallColorGroup) notationBallColorGroup.style.display = (state.animalType === 'score') ? '' : 'none';
  // Shape selector — shown for both Circles and Score
  const notationBallGroup = document.getElementById('notation-ball-group');
  if (notationBallGroup) notationBallGroup.style.display = (state.animalType === 'circle' || state.animalType === 'score') ? '' : 'none';
}

// ── WebGPU canvas lifecycle (disabled) ──────────────────────────────────────
// Re-enable by restoring webgpu-ball.js script tag in index.html
export function _syncWebGPUCanvas() {
  // const webgpuWrapper = document.getElementById('webgpu-ball-wrapper');
  // const canvasWrapper = document.querySelector('.canvas-wrapper');
  // const isWebGPU = animalType === 'webgpu';
  // if (webgpuWrapper) webgpuWrapper.style.display = isWebGPU ? 'flex' : 'none';
  // if (canvasWrapper) canvasWrapper.style.display  = isWebGPU ? 'none' : '';
}

// ── 3D Conductor lifecycle ───────────────────────────────────────────────────
// Start the Three.js render loop only while the 3D conductor is selected; stop
// it (and hide its overlay) otherwise so it costs nothing in other modes.
export function _sync3DConductor() {
  if (state.animalType === 'conductor3d') {
    start3DConductor();
  } else {
    stop3DConductor();
  }
}

// ── Notation Score Display lifecycle ─────────────────────────────────────────
export function _syncNotationDisplay() {
  var isScore = (state.animalType === 'score');

  // Normal-mode elements (outside the fullscreen overlay)
  var wrapper = document.getElementById('notation-display-wrapper');
  var canvasWrapper = document.querySelector('.canvas-wrapper');
  if (wrapper) wrapper.style.display = (!state.isFullscreen && isScore) ? 'block' : 'none';
  if (canvasWrapper) canvasWrapper.style.display = (!state.isFullscreen && isScore) ? 'none' : '';

  // Fullscreen-mode elements (inside the fullscreen overlay)
  var fsWrapper = document.getElementById('notation-display-fs-wrapper');
  var fsCanvas = document.querySelector('.fullscreen-canvas-wrapper canvas');
  if (fsWrapper) fsWrapper.style.display = (state.isFullscreen && isScore) ? 'block' : 'none';
  if (fsCanvas) fsCanvas.style.display = (state.isFullscreen && isScore) ? 'none' : '';

  if (isScore) crRenderNotationDisplay();
}

export function crUpdateScoreOptionVisibility() {
  // Score is always available; nothing to hide or force-switch.
}

export function _syncPracticeRow() {
  var row = document.getElementById('practice-rhythm-row');
  if (!row) return;
  var visible = state.animalType === 'score' && state.customRhythmEnabled;
  row.style.display = visible ? '' : 'none';
  if (!visible && state.practiceRhythmEnabled) {
    // Auto-disable when the row is hidden (left score mode or disabled custom rhythm)
    state.practiceRhythmEnabled = false;
    state.practiceRhythmMeasureIdx = -1;
    var cb = document.getElementById('practice-rhythm-cb');
    if (cb) cb.checked = false;
    document.querySelectorAll('.nd-bg-rect').forEach(function(r) { r.setAttribute('fill', window.vmCanvasBg || '#e2e8f0'); });
  }
  crmSyncToggleRow();
  _syncBeatNoteRow();
}

export function _syncBeatNoteRow() {
  var row = document.getElementById('beat-note-row');
  if (!row) return;
  row.style.display = (state.animalType === 'score') ? '' : 'none';
  var sel = document.getElementById('beat-note-select');
  if (sel) sel.value = state.beatNoteValue;
}
