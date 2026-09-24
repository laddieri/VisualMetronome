import { state } from './state.js';
import { sendStateUpdate } from './remote.js';
import { tmpCalcM2BPM } from './two-measure.js';


// Tempo presets
var TEMPO_PRESETS_KEY = 'vm.tempoPresets';

// ── Tempo preset helpers ──────────────────────────────────────────────────

export function loadTempoPresets() {
  try {
    var stored = localStorage.getItem(TEMPO_PRESETS_KEY);
    state.tempoPresets = stored
      ? JSON.parse(stored)
      : state.DEFAULT_TEMPO_PRESETS.map(function(p) { return Object.assign({}, p); });
  } catch (e) {
    state.tempoPresets = state.DEFAULT_TEMPO_PRESETS.map(function(p) { return Object.assign({}, p); });
  }
}

export function saveTempoPresets() {
  try { localStorage.setItem(TEMPO_PRESETS_KEY, JSON.stringify(state.tempoPresets)); } catch (e) {}
}

export function populateTempoMarkingDropdown(preserveValue) {
  var sel = document.getElementById('tempo-marking');
  if (!sel) return;
  var cur = preserveValue ? sel.value : '';
  while (sel.options.length > 1) sel.remove(1);
  state.tempoPresets.forEach(function(p) {
    var opt = document.createElement('option');
    opt.value = String(p.bpm);
    opt.textContent = p.name + ' — ' + p.bpm + ' bpm';
    sel.appendChild(opt);
  });
  sel.value = cur;
}

export function syncTempoMarkingDropdown() {
  var sel = document.getElementById('tempo-marking');
  if (!sel) return;
  for (var i = 1; i < sel.options.length; i++) {
    if (parseInt(sel.options[i].value) === state.cachedBPM) {
      sel.value = sel.options[i].value;
      return;
    }
  }
  sel.value = '';
}

export function renderTempoPresetsList() {
  var list = document.getElementById('tempo-presets-list');
  if (!list) return;
  list.innerHTML = '';
  state.tempoPresets.forEach(function(preset, idx) {
    var row = document.createElement('div');
    row.className = 'tempo-preset-row';

    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'tempo-preset-name-input';
    nameInput.value = preset.name;
    nameInput.maxLength = 24;
    nameInput.addEventListener('change', function() {
      var v = this.value.trim();
      state.tempoPresets[idx].name = v || state.DEFAULT_TEMPO_PRESETS[idx].name;
      this.value = state.tempoPresets[idx].name;
      saveTempoPresets();
      populateTempoMarkingDropdown(true);
      syncTempoMarkingDropdown();
    });

    var bpmInput = document.createElement('input');
    bpmInput.type = 'number';
    bpmInput.className = 'tempo-preset-bpm-input';
    bpmInput.value = preset.bpm;
    bpmInput.min = 20;
    bpmInput.max = 300;
    bpmInput.addEventListener('change', function() {
      var v = Math.max(20, Math.min(300, parseInt(this.value) || state.DEFAULT_TEMPO_PRESETS[idx].bpm));
      state.tempoPresets[idx].bpm = v;
      this.value = v;
      saveTempoPresets();
      populateTempoMarkingDropdown(true);
      syncTempoMarkingDropdown();
    });

    var bpmLabel = document.createElement('span');
    bpmLabel.className = 'tempo-preset-bpm-label';
    bpmLabel.textContent = 'bpm';

    row.appendChild(nameInput);
    row.appendChild(bpmInput);
    row.appendChild(bpmLabel);
    list.appendChild(row);
  });
}

// ── Helper: apply a BPM value to all tempo controls (slider, number input, fullscreen)
export function applyBPM(bpm) {
  bpm = Math.max(30, Math.min(300, Math.round(bpm)));
  Tone.Transport.bpm.value = bpm;
  state.cachedBPM = bpm;
  state.secondsPerBeat = 1 / (bpm / 60);

  // Sync all controls
  var slider = document.getElementById('tempo-slider');
  var numInput = document.getElementById('bpm-input');
  var fsSlider = document.getElementById('fullscreen-tempo-slider');
  var fsBpmVal = document.getElementById('fullscreen-bpm-value');
  if (slider) slider.value = bpm;
  if (numInput) numInput.value = bpm;
  if (fsSlider) fsSlider.value = bpm;
  if (fsBpmVal) fsBpmVal.textContent = bpm;

  // Keep TMP measures in sync with the main tempo
  if (state.twoMeasurePatternEnabled) {
    state.twoMeasurePattern[0].bpm = bpm;
    state.twoMeasurePattern[1].bpm = tmpCalcM2BPM();
  }

  sendStateUpdate();
  syncTempoMarkingDropdown();
}

// Update BPM from range slider
document.getElementById('tempo-slider').addEventListener('input', function(e) {
  applyBPM(parseInt(e.target.value));
});

// Update BPM from number input
document.getElementById('bpm-input').addEventListener('change', function(e) {
  applyBPM(parseInt(e.target.value) || 96);
});

// Also update live while typing in the number input (on Enter key)
document.getElementById('bpm-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    e.target.blur();
  }
});

// ── Fine tempo adjustment ─────────────────────────────────────────────────
// The slider is great for big jumps but fiddly for ±1 changes, so the BPM
// readout gets −/+ buttons (hold to repeat), arrow-key shortcuts, and
// scroll-wheel nudging.

export function nudgeBPM(delta) {
  applyBPM(state.cachedBPM + delta);
}

// −/+ buttons: tap = ±1, Shift+click = ±5, hold = repeat (speeding up).
function setupStepButton(btn) {
  var delta = parseInt(btn.dataset.step, 10) || 0;
  var delayTimer = null, repeatTimer = null;
  var pointerStepped = false;

  function stop() {
    clearTimeout(delayTimer);
    clearTimeout(repeatTimer);
    delayTimer = repeatTimer = null;
    btn.classList.remove('is-pressed');
  }

  function repeat(interval) {
    nudgeBPM(delta);
    repeatTimer = setTimeout(function() {
      repeat(Math.max(40, interval * 0.9));
    }, interval);
  }

  btn.addEventListener('pointerdown', function(e) {
    if (e.button !== 0) return;
    e.preventDefault(); // keep focus/selection where it was
    stop();
    pointerStepped = true;
    btn.classList.add('is-pressed');
    nudgeBPM(e.shiftKey ? delta * 5 : delta);
    delayTimer = setTimeout(function() { repeat(120); }, 400);
  });
  ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(function(type) {
    btn.addEventListener(type, stop);
  });
  btn.addEventListener('contextmenu', function(e) { e.preventDefault(); });

  // Keyboard activation (Enter/Space on a focused button) arrives as a bare
  // click; clicks that follow a pointerdown were already handled above.
  btn.addEventListener('click', function(e) {
    if (pointerStepped) { pointerStepped = false; return; }
    nudgeBPM(e.shiftKey ? delta * 5 : delta);
  });
}

document.querySelectorAll('.bpm-step-btn').forEach(setupStepButton);

// ↑/↓ in the BPM box change the tempo immediately (instead of waiting for
// blur); Shift steps by 5.
document.getElementById('bpm-input').addEventListener('keydown', function(e) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  var step = e.shiftKey ? 5 : 1;
  nudgeBPM(e.key === 'ArrowUp' ? step : -step);
});

// Global shortcuts: ↑/↓ or +/− nudge by 1 (Shift = 5) when focus isn't in a
// form field and no modal is open.
document.addEventListener('keydown', function(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  var up = e.key === 'ArrowUp' || e.key === '+' || e.key === '=';
  var down = e.key === 'ArrowDown' || e.key === '-' || e.key === '_';
  if (!up && !down) return;
  var el = document.activeElement;
  var tag = el && el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (el && el.isContentEditable) return;
  if (document.querySelector('.settings-modal:not(.hidden)')) return;
  e.preventDefault();
  var step = e.shiftKey ? 5 : 1;
  nudgeBPM(up ? step : -step);
});

// Scroll wheel over the tempo controls nudges by 1 per notch. Trackpads send
// many small deltas, so accumulate until a notch's worth has built up.
function setupWheelNudge(el) {
  if (!el) return;
  var accum = 0;
  el.addEventListener('wheel', function(e) {
    e.preventDefault();
    var dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
    accum += dy;
    var notches = Math.trunc(accum / 40);
    if (notches !== 0) {
      accum -= notches * 40;
      nudgeBPM(-notches); // scroll up = faster
    }
  }, { passive: false });
}

setupWheelNudge(document.querySelector('.tempo-controls .tempo-slider-row'));
setupWheelNudge(document.querySelector('.fullscreen-tempo-row'));
