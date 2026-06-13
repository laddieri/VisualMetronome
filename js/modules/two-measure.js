import { state } from './state.js';
import { sendStateUpdate } from './remote.js';


// Calculate M2 BPM from M1 + link mode, clamped to 30–300.
export function tmpCalcM2BPM() {
  var m1 = state.twoMeasurePattern[0];
  var s1 = parseInt(m1.subdivision) || 0;
  var s2 = parseInt(state.twoMeasurePattern[1].subdivision) || 0;
  var b2 = (state.tmpLinkMode === 'subdivision' && s1 > 0 && s2 > 0)
    ? m1.bpm * s1 / s2
    : m1.bpm;
  return Math.max(30, Math.min(300, Math.round(b2)));
}

// Sync M1 BPM from main tempo, recalculate M2, and refresh ♪ readouts.
function tmpSyncAll() {
  // While TMP is actively playing, twoMeasurePattern[0].bpm is the
  // authoritative M1 tempo.  cachedBPM may have been updated to M2's BPM
  // by the Tone.Draw beat callback, so overwriting M1 from it would corrupt
  // the pattern.  Only sync from cachedBPM when TMP is not currently running.
  if (!(state.twoMeasurePatternEnabled && Tone.Transport.state === 'started')) {
    state.twoMeasurePattern[0].bpm = state.cachedBPM;
  }
  state.twoMeasurePattern[1].bpm = tmpCalcM2BPM();
  var r1 = document.getElementById('tmp-m1-eighth-readout');
  if (r1) r1.textContent = '♪ = ' + Math.round(state.twoMeasurePattern[0].bpm * 2) + '/min';
  var r2 = document.getElementById('tmp-m2-eighth-readout');
  if (r2) r2.textContent = '♪ = ' + Math.round(state.twoMeasurePattern[1].bpm * 2) + '/min';
}

// ── Two-Measure Pattern ────────────────────────────────────────────────────

function initTwoMeasurePatternListeners() {
  var tmpBtn      = document.getElementById('two-measure-btn');
  var tmpModal    = document.getElementById('two-measure-modal');
  var tmpCloseBtn = document.getElementById('tmp-close-btn');
  var tmpEnabled  = document.getElementById('tmp-enabled');

  if (!tmpBtn || !tmpModal) return;

  // Open modal: sync dropdowns and ♪ readouts from current state
  tmpBtn.addEventListener('click', function() {
    var m1ts = document.getElementById('tmp-m1-time-sig');
    var m1sd = document.getElementById('tmp-m1-subdivision');
    var m2ts = document.getElementById('tmp-m2-time-sig');
    var m2sd = document.getElementById('tmp-m2-subdivision');
    if (m1ts) m1ts.value = state.twoMeasurePattern[0].beatsPerMeasure;
    if (m1sd) m1sd.value = state.twoMeasurePattern[0].subdivision;
    if (m2ts) m2ts.value = state.twoMeasurePattern[1].beatsPerMeasure;
    if (m2sd) m2sd.value = state.twoMeasurePattern[1].subdivision;
    var linkRadio = document.querySelector('input[name="tmp-link-mode"][value="' + state.tmpLinkMode + '"]');
    if (linkRadio) linkRadio.checked = true;
    if (tmpEnabled) tmpEnabled.checked = state.twoMeasurePatternEnabled;
    tmpSyncAll(); // refresh ♪ readouts with current cachedBPM
    tmpModal.classList.remove('hidden');
  });

  // Close
  if (tmpCloseBtn) tmpCloseBtn.addEventListener('click', function() { tmpModal.classList.add('hidden'); });
  tmpModal.addEventListener('click', function(e) { if (e.target === tmpModal) tmpModal.classList.add('hidden'); });

  // Enable/disable
  if (tmpEnabled) {
    tmpEnabled.addEventListener('change', function(e) {
      state.twoMeasurePatternEnabled = e.target.checked;
      tmpBtn.classList.toggle('ct-active', state.twoMeasurePatternEnabled);
      if (state.twoMeasurePatternEnabled && Tone.Transport.state === 'started' && !state.songModeEnabled) {
        state.twoMeasureCurrentMeasure = 0;
        state.twoMeasurePattern[0].bpm = state.cachedBPM;
        state.twoMeasurePattern[1].bpm = tmpCalcM2BPM();
        state.beatsPerMeasure = state.twoMeasurePattern[0].beatsPerMeasure;
        state.subdivision = state.twoMeasurePattern[0].subdivision;
        // Transport is already at cachedBPM; scheduler will handle M2 at next boundary
      }
      sendStateUpdate();
    });
  }

  // Link-mode radios
  document.querySelectorAll('input[name="tmp-link-mode"]').forEach(function(radio) {
    radio.addEventListener('change', function() {
      state.tmpLinkMode = this.value;
      tmpSyncAll();
    });
  });

  // Measure 1 — beats and subdivision only (BPM comes from main slider)
  var m1TimeSig = document.getElementById('tmp-m1-time-sig');
  if (m1TimeSig) m1TimeSig.addEventListener('change', function() {
    state.twoMeasurePattern[0].beatsPerMeasure = parseInt(this.value);
  });

  var m1Subdiv = document.getElementById('tmp-m1-subdivision');
  if (m1Subdiv) m1Subdiv.addEventListener('change', function() {
    state.twoMeasurePattern[0].subdivision = this.value;
    tmpSyncAll(); // M2 BPM may depend on S1 (subdivision-link mode)
  });

  // Measure 2 — beats and subdivision only (BPM auto-calculated)
  var m2TimeSig = document.getElementById('tmp-m2-time-sig');
  if (m2TimeSig) m2TimeSig.addEventListener('change', function() {
    state.twoMeasurePattern[1].beatsPerMeasure = parseInt(this.value);
  });

  var m2Subdiv = document.getElementById('tmp-m2-subdivision');
  if (m2Subdiv) m2Subdiv.addEventListener('change', function() {
    state.twoMeasurePattern[1].subdivision = this.value;
    tmpSyncAll(); // recalculate M2 BPM and update ♪ readout
  });
}

// As a classic end-of-body script this always deferred to DOMContentLoaded
// (readyState was still 'loading'). Module scripts execute later, with
// readyState 'interactive', so defer explicitly to keep the same timing and
// to guarantee every module in the import graph has finished evaluating.
if (document.readyState === 'complete') {
  initTwoMeasurePatternListeners();
} else {
  document.addEventListener('DOMContentLoaded', initTwoMeasurePatternListeners);
}
