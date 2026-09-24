import { state } from './state.js';
import { crGetAllNoteXPositions, crGetSubBeats, crIsContinuation } from './custom-rhythm.js';
import { matchHits, scoreResult } from './rhythm-scoring.js';
import { _ensureAudioContext, toggleTransport } from './transport.js';

var crmSourceNode       = null;     // MediaStreamSourceNode
var crmProcessorNode    = null;     // ScriptProcessorNode that inspects every sample block
var crmSinkNode         = null;     // muted GainNode so the processor keeps firing without feedback
var crmDetectedHits     = [];       // AudioContext timestamps of detected onset peaks
var crmSilentStartTime  = 0;        // AudioContext time when silent measure began
var crmSilentEndTime    = 0;        // AudioContext time when silent measure ends
var crmMonitoring       = false;    // true only during the silent measure
var crmLastHitTime      = -999;     // refractory: time of last detected hit
var crmNoiseFloor       = 0;        // running estimate of background level (adaptive threshold)
var crmHpPrevIn         = 0;        // one-pole high-pass filter state (previous input sample)
var crmHpPrevOut        = 0;        // one-pole high-pass filter state (previous output sample)
var crmArmed            = true;     // true when energy is below threshold (ready for next onset)

// Onset-detection tuning constants
var CRM_BLOCK_SIZE   = 512;   // ScriptProcessor block (~11.6 ms @ 44.1 kHz); fires continuously
var CRM_HOP          = 64;    // sub-block analysed for fine onset timing (~1.5 ms @ 44.1 kHz)
var CRM_ABS_MIN_RMS  = 0.018; // absolute energy floor — below this is treated as silence
var CRM_RISE_FACTOR  = 2.5;   // onset must exceed this multiple of the adaptive noise floor
var CRM_REARM_FACTOR = 0.55;  // energy must fall back below threshold*this before another onset
var CRM_REFRACTORY_S = 0.07;  // min seconds between onsets (~214 bpm sixteenth notes)
var CRM_HP_R         = 0.97;  // high-pass coefficient (~210 Hz cutoff) to reject rumble/hum

// ── Check My Rhythm ───────────────────────────────────────────────────────────

export function crmSyncToggleRow() {
  var row = document.getElementById('crm-toggle-row');
  if (!row) return;
  var show = state.practiceRhythmEnabled;
  row.style.display = show ? '' : 'none';
  if (!show && state.checkMyRhythmEnabled) {
    state.checkMyRhythmEnabled = false;
    var cb = document.getElementById('crm-toggle-cb');
    if (cb) cb.checked = false;
    crmReleaseMic();
    crmHideFeedback();
  }
}

function crmInitMic(onDone) {
  if (state.crmMicStream) { if (onDone) onDone(null); return; }
  // Disable the browser's own processing: AGC/noise-suppression distort onset
  // energy and timing, which is exactly what we're measuring.
  navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false
  })
    .then(function(stream) {
      var rawCtx = Tone.context.rawContext;
      var source = rawCtx.createMediaStreamSource(stream);
      // A ScriptProcessorNode fires onaudioprocess for *every* block of samples,
      // so no audio is dropped between animation frames (the old AnalyserNode+rAF
      // approach inspected only ~5.8 ms out of every ~16.7 ms). Route its output
      // through a muted gain node so the graph stays "pulled" without feeding the
      // microphone back to the speakers.
      var processor = rawCtx.createScriptProcessor(CRM_BLOCK_SIZE, 1, 1);
      var sink = rawCtx.createGain();
      sink.gain.value = 0;
      processor.onaudioprocess = crmProcessBlock;
      source.connect(processor);
      processor.connect(sink);
      sink.connect(rawCtx.destination);
      // Only commit state after everything succeeds
      state.crmMicStream     = stream;
      crmSourceNode    = source;
      crmProcessorNode = processor;
      crmSinkNode      = sink;
      if (onDone) onDone(null);
    })
    .catch(function(err) {
      console.warn('CRM: microphone access denied', err);
      if (onDone) onDone(err);
    });
}

function crmReleaseMic() {
  crmMonitoring = false;
  if (crmProcessorNode) { crmProcessorNode.onaudioprocess = null; crmProcessorNode.disconnect(); crmProcessorNode = null; }
  if (crmSinkNode) { crmSinkNode.disconnect(); crmSinkNode = null; }
  if (crmSourceNode) { crmSourceNode.disconnect(); crmSourceNode = null; }
  if (state.crmMicStream) { state.crmMicStream.getTracks().forEach(function(t) { t.stop(); }); state.crmMicStream = null; }
}

// Called for every captured audio block. Detects percussive onsets by tracking
// the rising edge of high-passed energy above an adaptive noise floor, and
// timestamps each onset to the sub-block (~1.5 ms) where the rise occurred.
function crmProcessBlock(e) {
  if (!crmMonitoring) return;
  var rawCtx = Tone.context.rawContext;
  var data   = e.inputBuffer.getChannelData(0);
  var sr     = rawCtx.sampleRate;
  var n      = data.length;
  // Approximate capture time of the block's first sample. The block was just
  // delivered, so its audio spans roughly [now - blockDur, now]; subtract the
  // graph's base latency to compensate for input buffering.
  var blockStart = rawCtx.currentTime - (n / sr) - (rawCtx.baseLatency || 0);

  for (var h = 0; h + CRM_HOP <= n; h += CRM_HOP) {
    // High-pass each sample (one-pole) then accumulate energy for this hop.
    var sumSq = 0;
    for (var i = 0; i < CRM_HOP; i++) {
      var x  = data[h + i];
      var hp = CRM_HP_R * (crmHpPrevOut + x - crmHpPrevIn);
      crmHpPrevIn  = x;
      crmHpPrevOut = hp;
      sumSq += hp * hp;
    }
    var rms     = Math.sqrt(sumSq / CRM_HOP);
    var hopTime = blockStart + h / sr;
    var thresh  = Math.max(CRM_ABS_MIN_RMS, crmNoiseFloor * CRM_RISE_FACTOR);

    if (crmArmed && rms > thresh && hopTime >= crmSilentStartTime && hopTime < crmSilentEndTime
        && (hopTime - crmLastHitTime) > CRM_REFRACTORY_S) {
      crmDetectedHits.push(hopTime);
      crmLastHitTime = hopTime;
      crmArmed = false;
    } else if (!crmArmed && rms < thresh * CRM_REARM_FACTOR) {
      crmArmed = true;
    }

    // Adapt the noise floor: track quiet hops quickly, loud hops slowly so a
    // sustained note doesn't ratchet the threshold up and swallow later notes.
    if (rms < thresh) crmNoiseFloor = crmNoiseFloor * 0.92 + rms * 0.08;
    else              crmNoiseFloor = crmNoiseFloor * 0.995 + rms * 0.005;
  }
}

export function crmBeginMonitoring(silentStart, silentEnd) {
  crmSilentStartTime = silentStart;
  crmSilentEndTime   = silentEnd;
  crmDetectedHits    = [];
  crmLastHitTime     = -999;
  crmNoiseFloor      = 0;
  crmHpPrevIn        = 0;
  crmHpPrevOut       = 0;
  crmArmed           = true;
  crmMonitoring      = true;
}

export function crmEndMonitoring() {
  crmMonitoring = false;
}

function crmComputeExpectedHits() {
  var expected = [];
  var beatDur = Tone.Time("4n").toSeconds();
  var rawCtx = Tone.context.rawContext;
  // The user hears the metronome at T + outputLatency, so their timing reference is
  // shifted later by that amount. Offset expected hits to match their perception.
  var outputLatency = rawCtx.outputLatency || 0;
  for (var b = 0; b < state.customRhythmPattern.length; b++) {
    var pat = state.customRhythmPattern[b];
    if (crIsContinuation(pat)) continue;
    var subs = crGetSubBeats(pat);
    var prevB = (b - 1 + state.beatsPerMeasure) % state.beatsPerMeasure;
    var prevSubs = crGetSubBeats(state.customRhythmPattern[prevB]);
    var tiedFromPrev = b > 0 && prevSubs.length > 0 &&
      state.customRhythmNoteTies[prevB] &&
      state.customRhythmNoteTies[prevB][prevSubs.length - 1] === true;
    for (var i = 0; i < subs.length; i++) {
      var tied = (i === 0) ? tiedFromPrev
               : (state.customRhythmNoteTies[b] && state.customRhythmNoteTies[b][i - 1] === true);
      if (tied) continue;
      expected.push(crmSilentStartTime + outputLatency + b * beatDur + subs[i].offset * beatDur);
    }
  }
  return expected;
}

function crmAnalyze(expectedHits) {
  return matchHits(expectedHits, crmDetectedHits, Tone.Time("4n").toSeconds());
}

function crmGetExpectedNoteVisualXs() {
  var xs = [];
  for (var b = 0; b < state.customRhythmPattern.length; b++) {
    var pat = state.customRhythmPattern[b];
    if (crIsContinuation(pat)) continue;
    var beatBaseX = 40 + b * 70;
    var noteXs = crGetAllNoteXPositions(pat, beatBaseX, 70);
    var subs = crGetSubBeats(pat);
    var prevB = (b - 1 + state.beatsPerMeasure) % state.beatsPerMeasure;
    var prevSubs = crGetSubBeats(state.customRhythmPattern[prevB]);
    var tiedFromPrev = b > 0 && prevSubs.length > 0 &&
      state.customRhythmNoteTies[prevB] &&
      state.customRhythmNoteTies[prevB][prevSubs.length - 1] === true;
    for (var i = 0; i < subs.length; i++) {
      var tied = (i === 0) ? tiedFromPrev
               : (state.customRhythmNoteTies[b] && state.customRhythmNoteTies[b][i - 1] === true);
      if (tied) continue;
      xs.push(noteXs[i]);
    }
  }
  return xs;
}

export function crmClearFeedbackMarkers() {
  var wrapper = document.getElementById('notation-display-wrapper');
  if (!wrapper) return;
  var svg = wrapper.querySelector('svg');
  if (!svg) return;
  var overlay = svg.querySelector('.crm-hit-overlay');
  if (overlay) overlay.parentNode.removeChild(overlay);
}

function crmRenderFeedbackOnStaff(result, visualXs) {
  var wrapper = document.getElementById('notation-display-wrapper');
  if (!wrapper) return;
  var svg = wrapper.querySelector('svg');
  if (!svg) return;
  crmClearFeedbackMarkers();

  var NS  = 'http://www.w3.org/2000/svg';
  var sc  = state.notationScale;
  var g   = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'crm-hit-overlay');

  // Note heads float above the staff line
  var noteY   = state.notationStaffDisplayY - 16 * sc;
  var rx      = (5  * sc).toFixed(2);
  var ry      = (3.5 * sc).toFixed(2);
  var beatDur = Tone.Time("4n").toSeconds();

  function makeHead(cx, cy, color) {
    var el = document.createElementNS(NS, 'ellipse');
    el.setAttribute('cx', cx.toFixed(2));
    el.setAttribute('cy', cy.toFixed(2));
    el.setAttribute('rx', rx);
    el.setAttribute('ry', ry);
    el.setAttribute('fill', color);
    el.setAttribute('transform', 'rotate(-15,' + cx.toFixed(2) + ',' + cy.toFixed(2) + ')');
    return el;
  }

  // Draw one marker per expected note
  result.notes.forEach(function(n, i) {
    var baseX = visualXs[i];
    if (baseX === undefined) return;
    var expectedDispX = state.notationTx + baseX * sc;

    if (n.status === 'missed') {
      // Red × at the expected position
      var sw  = (2 * sc).toFixed(1);
      var x1  = (expectedDispX - 4 * sc).toFixed(1);
      var x2  = (expectedDispX + 4 * sc).toFixed(1);
      var y1  = (noteY - 4 * sc).toFixed(1);
      var y2  = (noteY + 4 * sc).toFixed(1);
      [[[x1,y1],[x2,y2]], [[x2,y1],[x1,y2]]].forEach(function(pts) {
        var l = document.createElementNS(NS, 'line');
        l.setAttribute('x1', pts[0][0]); l.setAttribute('y1', pts[0][1]);
        l.setAttribute('x2', pts[1][0]); l.setAttribute('y2', pts[1][1]);
        l.setAttribute('stroke', '#e74c3c');
        l.setAttribute('stroke-width', sw);
        l.setAttribute('stroke-linecap', 'round');
        g.appendChild(l);
      });
    } else {
      // Shift the note head left/right by how much the user was off
      var pixelShift = (n.diff / beatDur) * 70 * sc;
      var dispX = expectedDispX + pixelShift;
      var color = n.status === 'on' ? '#27ae60' : '#e67e22';
      g.appendChild(makeHead(dispX, noteY, color));
    }
  });

  // Draw extra (unexpected) hits as red marks below the note row. Without this,
  // playing a dense stream of notes (e.g. straight 16ths) would light up every
  // expected note green and hide the spurious in-between hits, making a sloppy
  // performance look perfect. Map each hit's time linearly onto the beat grid.
  var rawCtx = Tone.context.rawContext;
  var outLat = (rawCtx && rawCtx.outputLatency) || 0;
  var dotR   = (2.5 * sc);
  var extraY = noteY + 13 * sc;
  result.extraHits.forEach(function(t) {
    var p = (t - crmSilentStartTime - outLat) / beatDur;       // beats from measure start
    if (p < -0.25 || p > state.beatsPerMeasure + 0.25) return;       // ignore stray edge captures
    var baseX = 40 + p * 70;
    var dispX = state.notationTx + baseX * sc;
    var c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', dispX.toFixed(1));
    c.setAttribute('cy', extraY.toFixed(1));
    c.setAttribute('r', dotR.toFixed(1));
    c.setAttribute('fill', '#e74c3c');
    g.appendChild(c);
  });

  svg.appendChild(g);
}

function crmComputeScore(result) {
  return scoreResult(result, Tone.Time("4n").toSeconds());
}

export function crmShowFeedback() {
  var expected  = crmComputeExpectedHits();
  var visualXs  = crmGetExpectedNoteVisualXs();
  var result    = crmAnalyze(expected);
  var panel     = document.getElementById('crm-feedback-panel');
  var scoreEl   = document.getElementById('crm-feedback-score');
  var pctEl     = document.getElementById('crm-feedback-pct');
  if (!panel) return;

  crmRenderFeedbackOnStaff(result, visualXs);

  var pct       = crmComputeScore(result);
  if (pctEl) {
    pctEl.textContent = pct + '%';
    pctEl.style.color = pct >= 90 ? '#27ae60' : (pct >= 60 ? '#e67e22' : '#e74c3c');
  }

  var onCount   = result.notes.filter(function(n) { return n.status === 'on'; }).length;
  var total     = result.notes.length;
  var scoreText = onCount + ' of ' + total + ' note' + (total !== 1 ? 's' : '') + ' on time';
  if (result.extraHits.length > 0) {
    scoreText += ' · ' + result.extraHits.length + ' extra hit' + (result.extraHits.length !== 1 ? 's' : '');
  }
  scoreEl.textContent = scoreText;
  panel.style.display = '';
}

function crmHideFeedback() {
  var panel = document.getElementById('crm-feedback-panel');
  if (panel) panel.style.display = 'none';
  crmClearFeedbackMarkers();
}

(function() {
  var cb = document.getElementById('crm-toggle-cb');
  if (!cb) return;
  cb.addEventListener('change', function() {
    state.checkMyRhythmEnabled = cb.checked;
    if (state.checkMyRhythmEnabled) {
      crmInitMic(function(err) {
        if (err) {
          state.checkMyRhythmEnabled = false;
          cb.checked = false;
          alert('Microphone access is required for "Check my rhythm". Please allow microphone access and try again.');
        }
      });
    } else {
      crmReleaseMic();
      crmHideFeedback();
    }
  });
})();

// Feedback panel buttons are in HTML after the script tag, so defer until DOM is ready.
(function() {
  function attachCrmPanelListeners() {
    var tryAgainBtn = document.getElementById('crm-try-again-btn');
    if (tryAgainBtn) {
      tryAgainBtn.addEventListener('click', function() {
        crmHideFeedback();
        _ensureAudioContext(function() { toggleTransport(false); });
      });
    }
    var closeBtn = document.getElementById('crm-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() { crmHideFeedback(); });
    }
  }
  // Defer to DOMContentLoaded (module timing; see note in custom-rhythm.js).
  if (document.readyState === 'complete') {
    attachCrmPanelListeners();
  } else {
    document.addEventListener('DOMContentLoaded', attachCrmPanelListeners);
  }
})();
