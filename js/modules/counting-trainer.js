import { state } from './state.js';
import { sendStateUpdate } from './remote.js';


// ── Counting Trainer UI ──────────────────────────────────────────────────────
export function initCountingTrainerListeners() {
  var ctBtn = document.getElementById('counting-trainer-btn');
  var ctModal = document.getElementById('counting-trainer-modal');
  var ctCloseBtn = document.getElementById('ct-close-btn');
  var ctEnabledCheckbox = document.getElementById('ct-enabled');
  var ctSoundCheckbox = document.getElementById('ct-sound-on');
  var ctVisualCheckbox = document.getElementById('ct-visual-on');
  var ctMeasuresInput = document.getElementById('ct-measures');
  var ctExtraBeatsInput = document.getElementById('ct-extra-beats');

  // Open modal
  if (ctBtn) {
    ctBtn.addEventListener('click', function() {
      ctModal.classList.remove('hidden');
    });
  }

  // Close modal
  if (ctCloseBtn) {
    ctCloseBtn.addEventListener('click', function() {
      ctModal.classList.add('hidden');
    });
  }

  // Close on backdrop click
  if (ctModal) {
    ctModal.addEventListener('click', function(e) {
      if (e.target === ctModal) ctModal.classList.add('hidden');
    });
  }

  // Enable/disable toggle
  if (ctEnabledCheckbox) {
    ctEnabledCheckbox.checked = state.countingTrainerEnabled;
    ctEnabledCheckbox.addEventListener('change', function(e) {
      state.countingTrainerEnabled = e.target.checked;
      if (ctBtn) {
        ctBtn.classList.toggle('ct-active', state.countingTrainerEnabled);
      }
      sendStateUpdate();
    });
  }

  // Sound on/off during counting
  if (ctSoundCheckbox) {
    ctSoundCheckbox.checked = state.ctSoundOn;
    ctSoundCheckbox.addEventListener('change', function(e) {
      state.ctSoundOn = e.target.checked;
      sendStateUpdate();
    });
  }

  // Visual on/off during counting
  if (ctVisualCheckbox) {
    ctVisualCheckbox.checked = state.ctVisualOn;
    ctVisualCheckbox.addEventListener('change', function(e) {
      state.ctVisualOn = e.target.checked;
      sendStateUpdate();
    });
  }

  // Measures input
  if (ctMeasuresInput) {
    ctMeasuresInput.value = state.ctTargetMeasures;
    ctMeasuresInput.addEventListener('change', function(e) {
      state.ctTargetMeasures = Math.max(0, Math.min(99, parseInt(e.target.value) || 0));
      // Ensure at least 1 total beat (0 measures requires extra beats > 0)
      if (state.ctTargetMeasures === 0 && state.ctTargetExtraBeats === 0) state.ctTargetExtraBeats = 1;
      if (ctExtraBeatsInput) ctExtraBeatsInput.value = state.ctTargetExtraBeats;
      e.target.value = state.ctTargetMeasures;
      sendStateUpdate();
    });
  }

  // Extra beats input
  if (ctExtraBeatsInput) {
    ctExtraBeatsInput.value = state.ctTargetExtraBeats;
    ctExtraBeatsInput.addEventListener('change', function(e) {
      state.ctTargetExtraBeats = Math.max(0, Math.min(state.beatsPerMeasure - 1, parseInt(e.target.value) || 0));
      // Ensure at least 1 total beat
      if (state.ctTargetMeasures === 0 && state.ctTargetExtraBeats === 0) state.ctTargetExtraBeats = 1;
      e.target.value = state.ctTargetExtraBeats;
      sendStateUpdate();
    });
  }

  // Stepper buttons
  var measMinus = document.getElementById('ct-measures-minus');
  var measPlus = document.getElementById('ct-measures-plus');
  var beatsMinus = document.getElementById('ct-beats-minus');
  var beatsPlus = document.getElementById('ct-beats-plus');

  if (measMinus) {
    measMinus.addEventListener('click', function() {
      state.ctTargetMeasures = Math.max(0, state.ctTargetMeasures - 1);
      // Ensure at least 1 total beat
      if (state.ctTargetMeasures === 0 && state.ctTargetExtraBeats === 0) {
        state.ctTargetExtraBeats = 1;
        if (ctExtraBeatsInput) ctExtraBeatsInput.value = state.ctTargetExtraBeats;
      }
      if (ctMeasuresInput) ctMeasuresInput.value = state.ctTargetMeasures;
      sendStateUpdate();
    });
  }
  if (measPlus) {
    measPlus.addEventListener('click', function() {
      state.ctTargetMeasures = Math.min(99, state.ctTargetMeasures + 1);
      if (ctMeasuresInput) ctMeasuresInput.value = state.ctTargetMeasures;
      sendStateUpdate();
    });
  }
  if (beatsMinus) {
    beatsMinus.addEventListener('click', function() {
      var minBeats = state.ctTargetMeasures === 0 ? 1 : 0;
      state.ctTargetExtraBeats = Math.max(minBeats, state.ctTargetExtraBeats - 1);
      if (ctExtraBeatsInput) ctExtraBeatsInput.value = state.ctTargetExtraBeats;
      sendStateUpdate();
    });
  }
  if (beatsPlus) {
    beatsPlus.addEventListener('click', function() {
      state.ctTargetExtraBeats = Math.min(state.beatsPerMeasure - 1, state.ctTargetExtraBeats + 1);
      if (ctExtraBeatsInput) ctExtraBeatsInput.value = state.ctTargetExtraBeats;
      sendStateUpdate();
    });
  }

  // Set initial button state
  if (ctBtn && state.countingTrainerEnabled) {
    ctBtn.classList.add('ct-active');
  }
}


// ── Counting Trainer display helpers ──────────────────────────────────────────

// Show the counting overlay with pre-computed values (avoids race with async Draw)
export function updateCtDisplayWith(measDisplay, beatDisplay, elapsed, totalTarget) {
  var wrapper = state.isFullscreen
    ? document.querySelector('.fullscreen-canvas-wrapper')
    : document.querySelector('.canvas-wrapper');
  if (!wrapper) return;

  var el = wrapper.querySelector('.ct-measure-display');
  if (!el) {
    el = document.createElement('div');
    el.className = 'ct-measure-display counting';
    wrapper.appendChild(el);
  }
  el.className = 'ct-measure-display counting';
  // Hide the beat/measure text when visual is off so it doesn't
  // give a visual rhythm cue by updating each beat
  if (!state.ctVisualOn) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = 'Measure ' + measDisplay + ', Beat ' + beatDisplay +
    '  |  ' + elapsed + ' / ' + totalTarget + ' beats';
  el.classList.remove('hidden');
}

// Initial display when counting phase begins (beat 1 of measure 1, 0 elapsed)
export function updateCtDisplay() {
  var totalTarget = state.ctTargetMeasures * state.beatsPerMeasure + state.ctTargetExtraBeats;
  updateCtDisplayWith(1, 1, 0, totalTarget);
}

export function showCtDoneFeedback() {
  var wrapper = state.isFullscreen
    ? document.querySelector('.fullscreen-canvas-wrapper')
    : document.querySelector('.canvas-wrapper');
  if (!wrapper) return;

  // Update measure display to show "Done!"
  var el = wrapper.querySelector('.ct-measure-display');
  if (!el) {
    el = document.createElement('div');
    el.className = 'ct-measure-display';
    wrapper.appendChild(el);
  }
  el.className = 'ct-measure-display done';
  el.textContent = 'Time is up!';
  el.classList.remove('hidden');

  // Add green flash overlay
  var overlay = wrapper.querySelector('.ct-canvas-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'ct-canvas-overlay';
    wrapper.appendChild(overlay);
  }
  overlay.className = 'ct-canvas-overlay ct-done-flash';
}

export function hideCtDisplay() {
  // Clean up from both wrappers (normal + fullscreen)
  ['.canvas-wrapper', '.fullscreen-canvas-wrapper'].forEach(function(sel) {
    var wrapper = document.querySelector(sel);
    if (!wrapper) return;
    var el = wrapper.querySelector('.ct-measure-display');
    if (el) el.remove();
    var overlay = wrapper.querySelector('.ct-canvas-overlay');
    if (overlay) overlay.remove();
  });
}
