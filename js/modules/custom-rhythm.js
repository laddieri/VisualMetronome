import { state } from './state.js';
import { createAnimals } from './animations.js';
import { crmSyncToggleRow } from './check-rhythm.js';
import { sendStateUpdate } from './remote.js';
import { triggerClickSoundVel } from './sounds.js';
import { getAnimationProgress } from './stage.js';
import {
  _sync3DConductor, _syncBeatNoteRow, _syncNotationDisplay, _syncPracticeRow, _syncWebGPUCanvas, crUpdateScoreOptionVisibility,
  updateColorPickerVisibility,
} from './view-sync.js';


// Notation score display state
var notationBeatXPositions = []; // display-space X where ball lands for each beat
var notationBallLandingY = 0;    // display-space Y where ball lands (just above note heads)
var notationBallRadius = 12;       // pixel radius saved from last render (used for shoe sizing)
var customRhythmAccents = []; // array of arrays: per beat, indices of sub-notes that are accented

// ── Custom Rhythm Editor ────────────────────────────────────────────────────

// Available rhythm options per beat. `span` = total beat-slots consumed (incl. this slot).
var CR_OPTIONS = [
  { value: 'q',    label: '♩  Quarter note',              span: 1, subBeats: [1] },
  { value: 'r',    label: '—  Quarter rest',              span: 1, subBeats: [] },
  { value: 'ee',   label: '♫  Two eighths',               span: 1, subBeats: [1, 0.5] },
  { value: 'eee',  label: '3  Eighth triplets',           span: 1, subBeats: [1, 1/3, 2/3] },
  { value: 'er',   label: '♪— Eighth + eighth rest',      span: 1, subBeats: [1] },
  { value: 're',   label: '—♪ Eighth rest + eighth',      span: 1, subBeats: [0.5] },
  { value: 'ssss', label: '♬♬ Four sixteenths',           span: 1, subBeats: [1, 0.75, 0.5, 0.25] },
  { value: 'sse',  label: '♬♪ Two sixteenths + eighth',   span: 1, subBeats: [1, 0.75, 0.5] },
  { value: 'ess',  label: '♪♬ Eighth + two sixteenths',   span: 1, subBeats: [1, 0.5, 0.25] },
  { value: 'des',  label: '♩. Dotted eighth + sixteenth', span: 1, subBeats: [1, 0.25] },
  { value: 'sed',  label: '♬. Sixteenth + dotted eighth', span: 1, subBeats: [1, 0.25] },
  { value: 'ses',  label: '♬♪♬ Sixteenth-eighth-sixteenth', span: 1, subBeats: [1, 0.25, 0.25] },
  { value: 'H',     label: '𝅗𝅥  Half note (1 beat)',         span: 1, subBeats: [1] },
  { value: 'HR',    label: '—  Half rest',                    span: 1, subBeats: [] },
  { value: 'HQQ',   label: '♩♩ Two quarters',                span: 1, subBeats: [1, 0.5] },
  { value: 'HQR',   label: '♩— Quarter + rest',               span: 1, subBeats: [1] },
  { value: 'HRQ',   label: '—♩ Rest + quarter',               span: 1, subBeats: [0.5] },
  { value: 'HEEEE', label: '♫♫ Four eighths',                 span: 1, subBeats: [1, 0.75, 0.5, 0.25] },
  { value: 'HW',    label: '𝅝  Whole note',                   span: 2, subBeats: [1] },
  { value: 'E',     label: '♪  Eighth note (1 beat)',         span: 1, subBeats: [1] },
  { value: 'ER',    label: '—  Eighth rest',                  span: 1, subBeats: [] },
  { value: 'ESS',   label: '♬  Two sixteenths',               span: 1, subBeats: [1, 0.5] },
  { value: 'ESR',   label: '♬— Sixteenth + rest',             span: 1, subBeats: [1] },
  { value: 'ERS',   label: '—♬ Rest + sixteenth',             span: 1, subBeats: [0.5] },
  { value: 'EQ',    label: '♩  Quarter note (2 beats)',       span: 2, subBeats: [1] },
  { value: 'D',     label: '♩. Dotted quarter (1 beat)',      span: 1, subBeats: [1] },
  { value: 'DR',    label: '—. Dotted quarter rest',          span: 1, subBeats: [] },
  { value: 'DEEE',  label: '♫♪ Three eighths (compound)',     span: 1, subBeats: [1, 1/3, 2/3] },
  { value: 'DEER',  label: '♫— Two eighths + rest',           span: 1, subBeats: [1, 1/3] },
  { value: 'DERE',  label: '♪—♪ Eighth, rest, eighth',       span: 1, subBeats: [1, 2/3] },
  { value: 'DREE',  label: '—♫ Rest + two eighths',           span: 1, subBeats: [1/3, 2/3] },
  { value: 'DDH',   label: '𝅗𝅥. Dotted half (2 beats)',      span: 2, subBeats: [1] },
  { value: 'h',    label: '𝅗𝅥  Half note',                span: 2, subBeats: [1] },
  { value: 'dq',   label: '♩. Dotted quarter',            span: 2, subBeats: [1] },
  { value: 'dh',   label: '𝅗𝅥. Dotted half note',        span: 3, subBeats: [1] },
  { value: 'eqe',  label: '♪♩♪ Eighth+quarter+eighth',   span: 2, subBeats: [1, 0.5] },
  { value: 'rqe',  label: '—♩♪ Rest+quarter+eighth',     span: 2, subBeats: [0.5] },
];

// Restricted options shown when a beat is the back-half continuation of a dotted quarter.
var CR_BACK_HALF_OPTIONS = [
  { value: '_e', label: '♪  Eighth note (back half)' },
  { value: '_r', label: '—  Eighth rest  (back half)' },
];

// ── Multi-beat pattern helpers ───────────────────────────────────────────────

// Number of additional beat slots consumed after the slot holding `pat`.
function crContinuationsNeeded(pat) {
  if (pat === 'h' || pat === 'dq' || pat === 'eqe' || pat === 'rqe' || pat === 'eqr' || pat === 'rqr' ||
      pat === 'ssqe' || pat === 'eqss' || pat === 'ssqss' || pat === 'rqss' || pat === 'ssqr' ||
      pat === 'HW' || pat === 'EQ' || pat === 'DDH') return 1;
  if (pat === 'dh') return 2;
  return 0;
}

// Returns the default pattern string for the i-th continuation slot (0-based).
function crDefaultContinuation(originPat) {
  if (originPat === 'dq' || originPat === 'eqe' || originPat === 'rqe' || originPat === 'ssqe') return '_e';
  if (originPat === 'eqr' || originPat === 'rqr' || originPat === 'ssqr') return '_r';
  if (originPat === 'eqss' || originPat === 'rqss' || originPat === 'ssqss') return '_ss';
  if (originPat === 'HW' || originPat === 'EQ' || originPat === 'DDH') return '_';
  return '_';
}

// True when `pat` is a continuation marker (not a primary beat choice).
export function crIsContinuation(pat) {
  return pat === '_' || pat === '_e' || pat === '_r' || pat === '_ss';
}

// True when `pat` itself starts a multi-beat group.
function crIsMultiBeat(pat) {
  return pat === 'h' || pat === 'dq' || pat === 'dh' ||
         pat === 'eqe' || pat === 'rqe' || pat === 'eqr' || pat === 'rqr' ||
         pat === 'ssqe' || pat === 'eqss' || pat === 'ssqss' || pat === 'rqss' || pat === 'ssqr' ||
         pat === 'HW' || pat === 'EQ' || pat === 'DDH';
}

// Set beat at beatIdx to newPat, cascading continuation setup.
// Returns false and does nothing if there is not enough room.
function crSetBeatPattern(beatIdx, newPat) {
  var n = state.customRhythmPattern.length;
  var needed = crContinuationsNeeded(newPat);
  if (beatIdx + needed >= n) return false; // not enough room

  // Release old continuations owned by this slot
  var oldNeeded = crContinuationsNeeded(state.customRhythmPattern[beatIdx]);
  for (var i = 1; i <= oldNeeded; i++) {
    var oi = beatIdx + i;
    if (oi < n && crIsContinuation(state.customRhythmPattern[oi])) {
      state.customRhythmPattern[oi] = 'q';
      customRhythmAccents[oi] = [];
      state.customRhythmNoteTies[oi] = [];
    }
  }

  state.customRhythmPattern[beatIdx] = newPat;
  customRhythmAccents[beatIdx] = [];
  state.customRhythmNoteTies[beatIdx] = [];

  // Set new continuations
  for (var j = 1; j <= needed; j++) {
    state.customRhythmPattern[beatIdx + j] = crDefaultContinuation(newPat);
    customRhythmAccents[beatIdx + j] = [];
    state.customRhythmNoteTies[beatIdx + j] = [];
  }
  return true;
}

// Fix any multi-beat patterns that lost their continuation slots (e.g. after resize),
// and reset orphaned continuation markers to quarter notes.
function crValidatePattern() {
  var n = state.customRhythmPattern.length;
  // Pass 1 — ensure multi-beat patterns have room
  for (var i = 0; i < n; i++) {
    var needed = crContinuationsNeeded(state.customRhythmPattern[i]);
    if (needed > 0 && i + needed >= n) {
      state.customRhythmPattern[i] = 'q';
    }
  }
  // Pass 2 — mark legitimately owned slots
  var owned = {};
  for (var i = 0; i < n; i++) {
    var m = crContinuationsNeeded(state.customRhythmPattern[i]);
    for (var j = 1; j <= m; j++) {
      if (i + j < n) owned[i + j] = true;
    }
  }
  // Pass 3 — reset orphaned continuations
  for (var i = 0; i < n; i++) {
    if (crIsContinuation(state.customRhythmPattern[i]) && !owned[i]) {
      state.customRhythmPattern[i] = 'q';
    }
  }
}

// Map option value to sub-beat positions within the beat (as fractions of beat duration).
// Each entry is {offset: 0-1, velocity: 0-1} where offset is position within beat.
export function crGetSubBeats(patternValue) {
  switch (patternValue) {
    case 'q':    return [{offset: 0, vel: 1.0}];
    case 'r':    return [];
    case 'ee':   return [{offset: 0, vel: 1.0}, {offset: 0.5, vel: 0.7}];
    case 'eee':  return [{offset: 0, vel: 1.0}, {offset: 1/3, vel: 0.7}, {offset: 2/3, vel: 0.7}];
    case 'er':   return [{offset: 0, vel: 1.0}];
    case 're':   return [{offset: 0.5, vel: 0.7}];
    case 'ssss': return [{offset: 0, vel: 1.0}, {offset: 0.25, vel: 0.5}, {offset: 0.5, vel: 0.7}, {offset: 0.75, vel: 0.5}];
    case 'sse':  return [{offset: 0, vel: 1.0}, {offset: 0.25, vel: 0.5}, {offset: 0.5, vel: 0.7}];
    case 'ess':  return [{offset: 0, vel: 1.0}, {offset: 0.5, vel: 0.7}, {offset: 0.75, vel: 0.5}];
    case 'des':  return [{offset: 0, vel: 1.0}, {offset: 0.75, vel: 0.5}];
    case 'sed':  return [{offset: 0, vel: 1.0}, {offset: 0.25, vel: 0.7}];
    case 'ses':  return [{offset: 0, vel: 1.0}, {offset: 0.25, vel: 0.7}, {offset: 0.75, vel: 0.5}];
    case 'eqe':  return [{offset: 0, vel: 1.0}, {offset: 0.5, vel: 0.8}];
    case 'rqe':  return [{offset: 0.5, vel: 0.8}];
    case 'eqr':  return [{offset: 0, vel: 1.0}, {offset: 0.5, vel: 0.8}];
    case 'rqr':  return [{offset: 0.5, vel: 0.8}];
    case 'ssqe':  return [{offset: 0, vel: 1.0}, {offset: 0.25, vel: 0.6}, {offset: 0.5, vel: 0.8}];
    case 'ssqr':  return [{offset: 0, vel: 1.0}, {offset: 0.25, vel: 0.6}, {offset: 0.5, vel: 0.8}];
    case 'ssqss': return [{offset: 0, vel: 1.0}, {offset: 0.25, vel: 0.6}, {offset: 0.5, vel: 0.8}];
    case 'eqss':  return [{offset: 0, vel: 1.0}, {offset: 0.5, vel: 0.8}];
    case 'rqss':  return [{offset: 0.5, vel: 0.8}];
    case '_ss':   return [{offset: 0.5, vel: 0.7}, {offset: 0.75, vel: 0.5}];
    case 'H':     return [{offset: 0, vel: 1.0}];
    case 'HR':    return [];
    case 'HQQ':   return [{offset: 0, vel: 1.0}, {offset: 0.5, vel: 0.7}];
    case 'HQR':   return [{offset: 0, vel: 1.0}];
    case 'HRQ':   return [{offset: 0.5, vel: 0.7}];
    case 'HEEEE': return [{offset: 0, vel: 1.0}, {offset: 0.25, vel: 0.5}, {offset: 0.5, vel: 0.7}, {offset: 0.75, vel: 0.5}];
    case 'HW':    return [{offset: 0, vel: 1.0}];
    case 'E':     return [{offset: 0, vel: 1.0}];
    case 'ER':    return [];
    case 'ESS':   return [{offset: 0, vel: 1.0}, {offset: 0.5, vel: 0.7}];
    case 'ESR':   return [{offset: 0, vel: 1.0}];
    case 'ERS':   return [{offset: 0.5, vel: 0.7}];
    case 'EQ':    return [{offset: 0, vel: 1.0}];
    case 'D':     return [{offset: 0, vel: 1.0}];
    case 'DR':    return [];
    case 'DEEE':  return [{offset: 0, vel: 1.0}, {offset: 1/3, vel: 0.7}, {offset: 2/3, vel: 0.7}];
    case 'DEER':  return [{offset: 0, vel: 1.0}, {offset: 1/3, vel: 0.7}];
    case 'DERE':  return [{offset: 0, vel: 1.0}, {offset: 2/3, vel: 0.7}];
    case 'DREE':  return [{offset: 1/3, vel: 0.7}, {offset: 2/3, vel: 0.7}];
    case 'DDH':   return [{offset: 0, vel: 1.0}];
    case 'h':    return [{offset: 0, vel: 1.0}];
    case 'dq':   return [{offset: 0, vel: 1.0}];
    case 'dh':   return [{offset: 0, vel: 1.0}];
    case '_':    return [];
    case '_e':   return [{offset: 0.5, vel: 0.7}]; // back-half eighth note
    case '_r':   return [];
    default:     return [{offset: 0, vel: 1.0}];
  }
}

function _syncSubdivisionVisibility() {
  var group = document.getElementById('subdivision-group');
  if (group) group.style.display = state.customRhythmEnabled ? 'none' : '';
}

export function crCancelCustomRhythm() {
  state.customRhythmEnabled = false;
  state.customRhythmPattern = [];
  state.customRhythmNoteTies = [];
  customRhythmAccents = [];
  var cb = document.getElementById('custom-rhythm-enabled');
  if (cb) cb.checked = false;
  var btn = document.getElementById('custom-rhythm-btn');
  if (btn) btn.classList.remove('ct-active');
  crUpdateScoreOptionVisibility();
  _syncSubdivisionVisibility();
  _syncPracticeRow();
  _syncBeatNoteRow();
}

// Build default pattern for current beatsPerMeasure based on beatNoteValue
function crBuildDefaultPattern() {
  var note = { q: 'q', h: 'H', e: 'E', dq: 'D' }[state.beatNoteValue] || 'q';
  var pat = [];
  for (var i = 0; i < state.beatsPerMeasure; i++) pat.push(note);
  return pat;
}

function crSyncNoteTies() {
  while (state.customRhythmNoteTies.length < state.beatsPerMeasure) state.customRhythmNoteTies.push([]);
  state.customRhythmNoteTies.length = state.beatsPerMeasure;
  for (var b = 0; b < state.beatsPerMeasure; b++) {
    var noteCount = crGetAllNoteXPositions(state.customRhythmPattern[b] || 'q', 0, 1).length;
    while (state.customRhythmNoteTies[b].length < noteCount) state.customRhythmNoteTies[b].push(false);
    state.customRhythmNoteTies[b].length = noteCount;
  }
}

// Ensure ties and accents arrays match the current pattern length
function crSyncTiesAndAccents() {
  crSyncNoteTies();
  while (customRhythmAccents.length < state.beatsPerMeasure) customRhythmAccents.push([]);
  customRhythmAccents.length = state.beatsPerMeasure;
}

// Get the number of playable (non-rest) sub-notes in a pattern
function crGetNoteCount(pat) {
  return crGetSubBeats(pat).length;
}

// Render the beat selector dropdowns with tie and accent controls
function crRenderBeatSelectors() {
  var container = document.getElementById('custom-rhythm-beats');
  if (!container) return;
  container.innerHTML = '';

  // Sync pattern length to beatsPerMeasure
  while (state.customRhythmPattern.length < state.beatsPerMeasure) state.customRhythmPattern.push('q');
  if (state.customRhythmPattern.length > state.beatsPerMeasure) state.customRhythmPattern.length = state.beatsPerMeasure;
  crSyncTiesAndAccents();
  crValidatePattern(); // fix multi-beat patterns that lost their continuations after resize

  for (var b = 0; b < state.beatsPerMeasure; b++) {
    (function(beatIdx) {
      var pat = state.customRhythmPattern[beatIdx];
      var group = document.createElement('div');
      group.className = 'cr-beat-group';

      var label = document.createElement('div');
      label.className = 'cr-beat-label';
      label.textContent = 'Beat ' + (beatIdx + 1);
      group.appendChild(label);

      // ── Silent full-beat continuation (_) — locked row ───────────────────
      if (pat === '_') {
        group.classList.add('cr-beat-continuation');
        var held = document.createElement('div');
        held.className = 'cr-beat-held-label';
        held.textContent = '↳ held';
        group.appendChild(held);
        container.appendChild(group);
        return;
      }

      var isPartial = (pat === '_e' || pat === '_r');

      // ── Dropdown ──────────────────────────────────────────────────────────
      var select = document.createElement('select');
      select.className = 'cr-beat-select';
      select.dataset.beat = beatIdx;

      if (isPartial) {
        // Restricted: only back-half eighth note / rest
        for (var o = 0; o < CR_BACK_HALF_OPTIONS.length; o++) {
          var opt = document.createElement('option');
          opt.value = CR_BACK_HALF_OPTIONS[o].value;
          opt.textContent = CR_BACK_HALF_OPTIONS[o].label;
          if (pat === CR_BACK_HALF_OPTIONS[o].value) opt.selected = true;
          select.appendChild(opt);
        }
      } else {
        // Full options list; disable multi-beat options that won't fit
        for (var o = 0; o < CR_OPTIONS.length; o++) {
          var opt = document.createElement('option');
          var op  = CR_OPTIONS[o];
          opt.value = op.value;
          opt.textContent = op.label;
          if (op.span > 1 && beatIdx + op.span - 1 >= state.beatsPerMeasure) opt.disabled = true;
          if (pat === op.value) opt.selected = true;
          select.appendChild(opt);
        }
      }

      select.addEventListener('change', function(e) {
        var bi    = parseInt(e.target.dataset.beat);
        var newPat = e.target.value;
        if (crIsContinuation(newPat)) {
          // Simple toggle between _e and _r
          state.customRhythmPattern[bi] = newPat;
          customRhythmAccents[bi] = [];
        } else {
          if (!crSetBeatPattern(bi, newPat)) {
            e.target.value = state.customRhythmPattern[bi]; // revert on failure
            return;
          }
          if (newPat === 'r') {
            state.customRhythmNoteTies[bi] = [];
            // also clear any tie pointing into this beat from the previous beat
            if (bi > 0 && state.customRhythmNoteTies[bi - 1] && state.customRhythmNoteTies[bi - 1].length > 0) {
              state.customRhythmNoteTies[bi - 1][state.customRhythmNoteTies[bi - 1].length - 1] = false;
            }
          }
        }
        crRenderBeatSelectors();
        crRenderNotation();
      });

      group.appendChild(select);

      // ── Accent buttons (one per playable sub-note) ────────────────────────
      var subBeats = crGetSubBeats(pat);
      if (subBeats.length > 0) {
        var accentRow = document.createElement('div');
        accentRow.className = 'cr-accent-row';

        var accentLabel = document.createElement('div');
        accentLabel.className = 'cr-accent-label';
        accentLabel.textContent = 'Accent';
        accentRow.appendChild(accentLabel);

        var accentBtns = document.createElement('div');
        accentBtns.className = 'cr-accent-btns';

        for (var n = 0; n < subBeats.length; n++) {
          (function(noteIdx) {
            var btn = document.createElement('button');
            btn.className = 'cr-accent-btn';
            btn.textContent = '>';
            btn.title = 'Toggle accent on note ' + (noteIdx + 1);
            if (customRhythmAccents[beatIdx] && customRhythmAccents[beatIdx].indexOf(noteIdx) !== -1) {
              btn.classList.add('active');
            }
            btn.addEventListener('click', function() {
              if (!customRhythmAccents[beatIdx]) customRhythmAccents[beatIdx] = [];
              var idx = customRhythmAccents[beatIdx].indexOf(noteIdx);
              if (idx === -1) {
                customRhythmAccents[beatIdx].push(noteIdx);
                btn.classList.add('active');
              } else {
                customRhythmAccents[beatIdx].splice(idx, 1);
                btn.classList.remove('active');
              }
              crRenderNotation();
            });
            accentBtns.appendChild(btn);
          })(n);
        }
        accentRow.appendChild(accentBtns);
        group.appendChild(accentRow);
      }

      container.appendChild(group);
    })(b);
  }
}

// ── SVG Notation Rendering ──────────────────────────────────────────────────
// Renders a simple staff-like SVG showing the rhythm pattern with standard notation.

// Returns the x-positions of the first and last note heads for a given beat pattern.
// Used for drawing ties between beats.
function crGetNoteXPositions(pat, x, w) {
  switch (pat) {
    case 'q':    return { first: x + w / 2, last: x + w / 2 };
    case 'r':    return null; // rest — no note positions
    case 'ee':   return { first: x + w * 0.25, last: x + w * 0.75 };
    case 'er':   return { first: x + w * 0.25, last: x + w * 0.25 };
    case 're':   return { first: x + w * 0.7,  last: x + w * 0.7 };
    case 'ssss': return { first: x + w * 0.12, last: x + w * 0.87 };
    case 'sse':  return { first: x + w * 0.12, last: x + w * 0.75 };
    case 'ess':  return { first: x + w * 0.15, last: x + w * 0.85 };
    case 'h':    return { first: x + w / 2, last: x + w / 2 };
    case 'dq':   return { first: x + w / 2, last: x + w / 2 };
    case 'dh':   return { first: x + w / 2, last: x + w / 2 };
    case '_':    return null;
    case '_e':   return { first: x + w * 0.5, last: x + w * 0.5 };
    case '_r':   return null;
    default:     return { first: x + w / 2, last: x + w / 2 };
  }
}

// Returns all note head x-positions in order for a beat pattern (for accent positioning)
export function crGetAllNoteXPositions(pat, x, w) {
  switch (pat) {
    case 'q':    return [x + w / 2];
    case 'r':    return [];
    case 'ee':   return [x + w * 0.25, x + w * 0.75];
    case 'eee':  return [x + w * 0.15, x + w * 0.50, x + w * 0.85];
    case 'des':  return [x + w * 0.22, x + w * 0.78];
    case 'sed':  return [x + w * 0.22, x + w * 0.72];
    case 'ses':  return [x + w * 0.12, x + w * 0.50, x + w * 0.87];
    case 'eqe':  return [x + w * 0.2,  x + w * 0.72];
    case 'rqe':  return [x + w * 0.70];
    case 'eqr':  return [x + w * 0.2,  x + w * 0.72];
    case 'rqr':  return [x + w * 0.70];
    case 'ssqe':  return [x + w * 0.12, x + w * 0.37, x + w * 0.70];
    case 'ssqr':  return [x + w * 0.12, x + w * 0.37, x + w * 0.70];
    case 'ssqss': return [x + w * 0.12, x + w * 0.37, x + w * 0.70];
    case 'eqss':  return [x + w * 0.2,  x + w * 0.72];
    case 'rqss':  return [x + w * 0.70];
    case '_ss':   return [x + w * 0.5,  x + w * 0.75];
    case 'er':   return [x + w * 0.25];
    case 're':   return [x + w * 0.7];
    case 'ssss': return [x + w * 0.12, x + w * 0.37, x + w * 0.62, x + w * 0.87];
    case 'sse':  return [x + w * 0.12, x + w * 0.37, x + w * 0.75];
    case 'ess':  return [x + w * 0.15, x + w * 0.55, x + w * 0.85];
    case 'H':     return [x + w * 0.5];
    case 'HR':    return [];
    case 'HQQ':   return [x + w * 0.25, x + w * 0.75];
    case 'HQR':   return [x + w * 0.25];
    case 'HRQ':   return [x + w * 0.7];
    case 'HEEEE': return [x + w * 0.12, x + w * 0.37, x + w * 0.62, x + w * 0.87];
    case 'HW':    return [x + w * 0.5];
    case 'E':     return [x + w * 0.5];
    case 'ER':    return [];
    case 'ESS':   return [x + w * 0.25, x + w * 0.75];
    case 'ESR':   return [x + w * 0.25];
    case 'ERS':   return [x + w * 0.7];
    case 'EQ':    return [x + w * 0.5];
    case 'D':     return [x + w * 0.5];
    case 'DR':    return [];
    case 'DEEE':  return [x + w * 0.15, x + w * 0.50, x + w * 0.85];
    case 'DEER':  return [x + w * 0.15, x + w * 0.50];
    case 'DERE':  return [x + w * 0.15, x + w * 0.85];
    case 'DREE':  return [x + w * 0.50, x + w * 0.85];
    case 'DDH':   return [x + w * 0.5];
    case 'h':    return [x + w / 2];
    case 'dq':   return [x + w / 2];
    case 'dh':   return [x + w / 2];
    case '_':    return [];
    case '_e':   return [x + w * 0.5];
    case '_r':   return [];
    default:     return [x + w / 2];
  }
}

export function crRenderNotation() {
  var container = document.getElementById('custom-rhythm-notation');
  if (!container) return;

  var beatCount = state.customRhythmPattern.length;
  var beatWidth = 70;
  var totalWidth = beatCount * beatWidth + 40;
  var height = 110;
  var staffY = 55; // middle line of "staff"

  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + totalWidth + '" height="' + height + '" viewBox="0 0 ' + totalWidth + ' ' + height + '">';

  // Staff line (single line for rhythm notation)
  svg += '<line x1="10" y1="' + staffY + '" x2="' + (totalWidth - 10) + '" y2="' + staffY + '" stroke="#999" stroke-width="1"/>';

  // Time signature (stacked: beats on top, beat note value on bottom)
  var bnBottom = { q: '4', h: '2', e: '8', dq: '8' }[state.beatNoteValue] || '4';
  var bnTop = state.beatNoteValue === 'dq' ? beatCount * 3 : beatCount;
  if (bnTop === 4 && bnBottom === '4') {
    svg += '<text x="16" y="' + (staffY + 8) + '" font-size="22" font-weight="bold" fill="currentColor" font-family="serif" text-anchor="middle">C</text>';
    svg += '<text x="16" y="' + (staffY + 22) + '" font-size="9" fill="currentColor" font-family="sans-serif" text-anchor="middle">or 4/4</text>';
  } else if (bnTop === 2 && bnBottom === '2') {
    svg += '<text x="16" y="' + (staffY + 8) + '" font-size="22" font-weight="bold" fill="currentColor" font-family="serif" text-anchor="middle">C</text>';
    svg += '<line x1="16" y1="' + (staffY - 9) + '" x2="16" y2="' + (staffY + 9) + '" stroke="currentColor" stroke-width="1.5"/>';
    svg += '<text x="16" y="' + (staffY + 22) + '" font-size="9" fill="currentColor" font-family="sans-serif" text-anchor="middle">or 2/2</text>';
  } else {
    svg += '<text x="16" y="' + (staffY - 4) + '" font-size="14" font-weight="bold" fill="currentColor" font-family="serif" text-anchor="middle">' + bnTop + '</text>';
    svg += '<text x="16" y="' + (staffY + 13) + '" font-size="14" font-weight="bold" fill="currentColor" font-family="serif" text-anchor="middle">' + bnBottom + '</text>';
  }

  var xStart = 40;

  for (var b = 0; b < beatCount; b++) {
    var x = xStart + b * beatWidth;
    var pat = state.customRhythmPattern[b];

    // Beat number below — aligned under the first note/rest of the beat
    svg += '<text x="' + crGetBeatLabelX(pat, x, beatWidth) + '" y="' + (staffY + 40) + '" text-anchor="middle" font-size="11" fill="currentColor" font-family="sans-serif">' + (b + 1) + '</text>';

    // Draw barline before beat 1 equivalent
    if (b === 0) {
      svg += '<line x1="' + (x - 5) + '" y1="' + (staffY - 20) + '" x2="' + (x - 5) + '" y2="' + (staffY + 20) + '" stroke="currentColor" stroke-width="1.5"/>';
    }

    svg += crDrawBeatPattern(pat, x, staffY, beatWidth);

    // Draw accent marks (>) above accented notes
    if (customRhythmAccents[b] && customRhythmAccents[b].length > 0) {
      var noteXPositions = crGetAllNoteXPositions(pat, x, beatWidth);
      for (var a = 0; a < customRhythmAccents[b].length; a++) {
        var noteIdx = customRhythmAccents[b][a];
        if (noteIdx < noteXPositions.length) {
          var ax = noteXPositions[noteIdx];
          svg += crAccentMark(ax, staffY - 33);
        }
      }
    }

    // Draw note-level tie arcs
    var allNX = crGetAllNoteXPositions(pat, x, beatWidth);
    for (var ni = 0; ni < (state.customRhythmNoteTies[b] || []).length; ni++) {
      if (!state.customRhythmNoteTies[b][ni]) continue;
      var tx1 = allNX[ni];
      var tx2;
      if (ni < allNX.length - 1) {
        tx2 = allNX[ni + 1];
      } else if (b + 1 < beatCount) {
        var nxPat = state.customRhythmPattern[b + 1];
        var nxNotes = crGetAllNoteXPositions(nxPat, xStart + (b + 1) * beatWidth, beatWidth);
        tx2 = nxNotes.length > 0 ? nxNotes[0] : null;
      }
      if (tx2 != null) svg += crTieArc(tx1, tx2, staffY);
    }
  }

  // Final barline
  svg += '<line x1="' + (xStart + beatCount * beatWidth + 2) + '" y1="' + (staffY - 20) + '" x2="' + (xStart + beatCount * beatWidth + 2) + '" y2="' + (staffY + 20) + '" stroke="currentColor" stroke-width="2.5"/>';
  svg += '<line x1="' + (xStart + beatCount * beatWidth - 2) + '" y1="' + (staffY - 20) + '" x2="' + (xStart + beatCount * beatWidth - 2) + '" y2="' + (staffY + 20) + '" stroke="currentColor" stroke-width="1"/>';

  svg += '</svg>';
  container.innerHTML = svg;
  if (state.animalType === 'score') crRenderNotationDisplay();
}

// ── Full-screen score display ─────────────────────────────────────────────────

// Returns the X position (in notation base coordinates) where the ball lands for a beat.
// Always the leftmost / first element of the beat, note or rest.
function crGetBallLandingX(pat, x, w) {
  switch (pat) {
    case 'q':    return x + w / 2;
    case 'r':    return x + w / 2;
    case 'ee':   return x + w * 0.25;
    case 'eee':  return x + w * 0.15;
    case 'er':   return x + w * 0.25;
    case 're':   return x + w * 0.25;
    case 'ssss': return x + w * 0.12;
    case 'sse':  return x + w * 0.12;
    case 'ess':  return x + w * 0.15;
    case 'des':  return x + w * 0.22;
    case 'sed':  return x + w * 0.22;
    case 'ses':  return x + w * 0.12;
    case 'eqe':  return x + w * 0.2;
    case 'rqe':  return x + w * 0.2;
    case 'eqr':  return x + w * 0.2;
    case 'rqr':  return x + w * 0.2;
    case 'ssqe':  return x + w * 0.12;
    case 'ssqr':  return x + w * 0.12;
    case 'ssqss': return x + w * 0.12;
    case 'eqss':  return x + w * 0.2;
    case 'rqss':  return x + w * 0.2;
    case '_ss':   return x + w * 0.5;
    case 'H':  case 'HR': case 'HW': return x + w * 0.5;
    case 'HQQ': case 'HQR': return x + w * 0.25;
    case 'HRQ': return x + w * 0.25;
    case 'HEEEE': return x + w * 0.12;
    case 'E':  case 'ER': case 'EQ': return x + w * 0.5;
    case 'ESS': case 'ESR': return x + w * 0.25;
    case 'ERS': return x + w * 0.25;
    case 'D':  case 'DR': case 'DDH': return x + w * 0.5;
    case 'DEEE': case 'DEER': case 'DERE': return x + w * 0.15;
    case 'DREE': return x + w * 0.25;
    case 'h':    return x + w / 2;
    case 'dq':   return x + w / 2;
    case 'dh':   return x + w / 2;
    case '_':    return x + w / 2;
    case '_e':   return x + w * 0.2;
    case '_r':   return x + w * 0.2;
    default:     return x + w / 2;
  }
}

// Like crGetBallLandingX but for beat number labels — continuation beats label
// slightly before the note so the number doesn't sit directly on top of it.
function crGetBeatLabelX(pat, x, w) {
  if (pat === '_e' || pat === '_r') return x + w * 0.2;
  if (pat === 'eee') return x + w * 0.15;
  return crGetBallLandingX(pat, x, w);
}

// Returns SVG markup for a sneaker silhouette (side view, toe facing right).
// Local coordinate system: 80 wide × 48 tall; sole bottom-centre at (38, 44).
// Heel (left) is ~40 units tall; toe (right) is ~16 units tall — clearly a side view.
// tx, ty, s: the translate/scale transform that places and sizes the shoe.
function crShoeGroupSVG(id, color, tx, ty, s) {
  var light = 'rgba(255,255,255,0.30)';
  var g = '<g id="' + id + '" transform="translate(' + tx + ',' + ty + ') scale(' + s + ')" filter="url(#nd-ball-shadow)">';
  // Sole (thick Chuck Taylor rubber) — drawn first so the upper overlaps the top edge
  g += '<path d="M 2,38 C 0,38 0,42 0,50 L 0,56 Q 0,60 4,60 L 76,60 Q 80,60 80,56 L 80,50 C 80,42 80,38 78,38 L 70,42 L 6,44 Z" fill="#f0f0f0" stroke="rgba(0,0,0,0.18)" stroke-width="0.8"/>';
  // Main upper — heel (left, y=4..44) is ~2.5× taller than toe (right, y=26..42)
  g += '<path d="M 4,42 C 2,20 4,6 14,4 L 52,4 C 66,3 76,14 78,26 L 78,38 Q 76,42 70,42 L 6,44 Q 2,44 2,40 Z" fill="' + color + '" stroke="rgba(0,0,0,0.18)" stroke-width="1"/>';
  // Tongue highlight
  g += '<path d="M 28,4 L 44,4 L 42,22 L 30,22 Z" fill="' + light + '"/>';
  // Lace lines (angled slightly heel→toe)
  g += '<line x1="24" y1="10" x2="50" y2="8" stroke="rgba(255,255,255,0.7)" stroke-width="1.5" stroke-linecap="round"/>';
  g += '<line x1="24" y1="15" x2="50" y2="13" stroke="rgba(255,255,255,0.7)" stroke-width="1.5" stroke-linecap="round"/>';
  g += '<line x1="24" y1="20" x2="50" y2="18" stroke="rgba(255,255,255,0.7)" stroke-width="1.5" stroke-linecap="round"/>';
  g += '</g>';
  return g;
}

// Returns the SVG transform string for the notation ball/shape at display position (ballX, ballY).
// ballY is the centre of the arc; radius is notationBallRadius.
// For the shoe, the anchor is the sole bottom-centre, so the shape sits ON the ground.
// For all other shapes the anchor is the visual centre (matching the ball's centre).
function crNotationBallTransform(style, ballX, ballY, radius) {
  var s, tx, ty;
  switch (style) {
    case 'shoe':
      s = radius / 20;
      tx = ballX - 38 * s;
      ty = (ballY + radius) - 60 * s;
      return 'translate(' + tx.toFixed(1) + ',' + ty.toFixed(1) + ') scale(' + s.toFixed(3) + ')';
    case 'heart':  // 50×46 viewbox, visual centre at (25,22)
      s = radius / 22;
      return 'translate(' + (ballX - 25*s).toFixed(1) + ',' + (ballY - 22*s).toFixed(1) + ') scale(' + s.toFixed(3) + ')';
    case 'star':   // 50×44 viewbox, centre at (25,22)
      s = radius / 20;
      return 'translate(' + (ballX - 25*s).toFixed(1) + ',' + (ballY - 22*s).toFixed(1) + ') scale(' + s.toFixed(3) + ')';
    case 'face':   // circle r=22, centre at (25,25)
      s = radius / 22;
      return 'translate(' + (ballX - 25*s).toFixed(1) + ',' + (ballY - 25*s).toFixed(1) + ') scale(' + s.toFixed(3) + ')';
    case 'pig':    // main circle r=20, centre at (25,22)
      s = radius / 20;
      return 'translate(' + (ballX - 25*s).toFixed(1) + ',' + (ballY - 22*s).toFixed(1) + ') scale(' + s.toFixed(3) + ')';
    case 'note':   // notehead+stem, centre at (12,24)
      s = radius / 20;
      return 'translate(' + (ballX - 12*s).toFixed(1) + ',' + (ballY - 24*s).toFixed(1) + ') scale(' + s.toFixed(3) + ')';
    case 'selfie': // circular photo, centre at (0,0)
      return 'translate(' + ballX.toFixed(1) + ',' + ballY.toFixed(1) + ')';
    default: // ball — translate places cx/cy at (ballX,ballY)
      return 'translate(' + ballX.toFixed(1) + ',' + ballY.toFixed(1) + ')';
  }
}

// Returns the complete SVG <g> markup for the notation ball/shape at (ballX, ballY).
function crNotationBallSVG(id, color, style, ballX, ballY, radius) {
  var f = ' filter="url(#nd-ball-shadow)"';
  var t = crNotationBallTransform(style, ballX, ballY, radius);
  var g;
  switch (style) {
    case 'shoe': {
      var s = radius / 20;
      var stx = (ballX - 38*s).toFixed(1);
      var sty = ((ballY + radius) - 60*s).toFixed(1);
      return crShoeGroupSVG(id, color, stx, sty, s.toFixed(3));
    }
    case 'heart':
      g  = '<g id="' + id + '" transform="' + t + '"' + f + '>';
      g += '<path d="M 25,46 C 20,40 2,30 2,18 C 2,8 12,4 25,14 C 38,4 48,8 48,18 C 48,30 30,40 25,46 Z"';
      g += ' fill="' + color + '" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>';
      g += '<path d="M 25,42 C 22,37 6,28 6,18 C 6,11 14,8 25,17" fill="rgba(255,255,255,0.22)"/>';
      return g + '</g>';
    case 'star':
      g  = '<g id="' + id + '" transform="' + t + '"' + f + '>';
      g += '<path d="M 25,2 L 30,17 L 46,17 L 34,27 L 38,42 L 25,33 L 12,42 L 16,27 L 4,17 L 20,17 Z"';
      g += ' fill="' + color + '" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>';
      return g + '</g>';
    case 'face':
      g  = '<g id="' + id + '" transform="' + t + '"' + f + '>';
      g += '<circle cx="25" cy="25" r="22" fill="' + color + '" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>';
      g += '<circle cx="17" cy="20" r="3" fill="rgba(0,0,0,0.72)"/>';
      g += '<circle cx="33" cy="20" r="3" fill="rgba(0,0,0,0.72)"/>';
      g += '<path d="M 16,31 Q 25,40 34,31" stroke="rgba(0,0,0,0.72)" stroke-width="2.5" fill="none" stroke-linecap="round"/>';
      return g + '</g>';
    case 'pig':
      g  = '<g id="' + id + '" transform="' + t + '"' + f + '>';
      g += '<circle cx="8"  cy="9"  r="8" fill="#f9a8c9"/>'; // ears (behind face)
      g += '<circle cx="42" cy="9"  r="8" fill="#f9a8c9"/>';
      g += '<circle cx="8"  cy="8"  r="5" fill="#f06292"/>';
      g += '<circle cx="42" cy="8"  r="5" fill="#f06292"/>';
      g += '<circle cx="25" cy="22" r="20" fill="#f9a8c9" stroke="rgba(0,0,0,0.10)" stroke-width="1"/>'; // face
      g += '<circle cx="18" cy="18" r="3"  fill="currentColor"/>'; // eyes
      g += '<circle cx="32" cy="18" r="3"  fill="currentColor"/>';
      g += '<ellipse cx="25" cy="29" rx="9" ry="7" fill="#f06292"/>'; // snout
      g += '<circle cx="21" cy="29" r="2.5" fill="#c2185b"/>'; // nostrils
      g += '<circle cx="29" cy="29" r="2.5" fill="#c2185b"/>';
      return g + '</g>';
    case 'note':
      g  = '<g id="' + id + '" transform="' + t + '"' + f + '>';
      g += '<line x1="20" y1="6" x2="20" y2="40" stroke="' + color + '" stroke-width="3" stroke-linecap="round"/>';
      g += '<ellipse cx="12" cy="40" rx="9" ry="7" transform="rotate(-20 12 40)" fill="' + color + '"/>';
      return g + '</g>';
    case 'selfie': {
      var r2 = radius.toFixed(1);
      var clipId = 'selfie-clip-' + id;
      g  = '<g id="' + id + '" transform="' + t + '"' + f + '>';
      g += '<defs><clipPath id="' + clipId + '"><circle cx="0" cy="0" r="' + r2 + '"/></clipPath></defs>';
      if (state.selfieImageDataURL) {
        g += '<circle cx="0" cy="0" r="' + r2 + '" fill="#ddd" stroke="rgba(0,0,0,0.2)" stroke-width="1.5"/>';
        g += '<image href="' + state.selfieImageDataURL + '" x="-' + r2 + '" y="-' + r2 + '" width="' + (radius * 2).toFixed(1) + '" height="' + (radius * 2).toFixed(1) + '" clip-path="url(#' + clipId + ')"/>';
      } else {
        // No photo yet — draw the face placeholder
        g += '<circle cx="0" cy="0" r="' + r2 + '" fill="#ccc" stroke="rgba(0,0,0,0.2)" stroke-width="1.5"/>';
        g += '<text x="0" y="5" text-anchor="middle" font-size="' + (radius * 1.2).toFixed(0) + '" fill="#888">📸</text>';
      }
      return g + '</g>';
    }
    default: // ball
      return '<g id="' + id + '" transform="' + t + '"' + f + ' opacity="0.93"><circle cx="0" cy="0" r="' + radius.toFixed(1) + '" fill="' + color + '"/></g>';
  }
}

// Renders the notation as a full-screen SVG inside #notation-display-wrapper and
// pre-computes the display-space ball landing positions for each beat.
export function crRenderNotationDisplay() {
  var targetId = state.isFullscreen ? 'notation-display-fs-wrapper' : 'notation-display-wrapper';
  var otherId  = state.isFullscreen ? 'notation-display-wrapper' : 'notation-display-fs-wrapper';
  // Clear the inactive wrapper so there is never more than one #notation-ball in the DOM.
  // getElementById returns the first match, which would be wrong if both wrappers held SVG.
  var otherWrapper = document.getElementById(otherId);
  if (otherWrapper) otherWrapper.innerHTML = '';

  var wrapper = document.getElementById(targetId);
  if (!wrapper) return;

  // When no custom rhythm is set, default to the beat-unit-appropriate note for every beat
  var defaultBeatNote = { q: 'q', h: 'H', e: 'E', dq: 'D' }[state.beatNoteValue] || 'q';
  var effectivePattern = state.customRhythmPattern.length
    ? state.customRhythmPattern
    : (function() { var p = []; for (var i = 0; i < state.beatsPerMeasure; i++) p.push(defaultBeatNote); return p; }());
  var beatCount = effectivePattern.length;

  // Base (modal-scale) notation dimensions
  var baseBeatWidth = 70;
  var baseXStart    = 40;
  var baseStaffY    = 55;
  var baseHeight    = 110;
  var baseWidth     = beatCount * baseBeatWidth + baseXStart + 10;

  // Display canvas dimensions
  var dispW = 640, dispH = 360;

  // Score-paper rectangle inside the display
  var paperX = 30, paperY = 80, paperW = 580, paperH = 230;
  var paperCX = paperX + paperW / 2;
  var paperCY = paperY + paperH / 2;

  // Scale notation to fit the paper with padding
  var padX = 40, padY = 20;
  var scale = Math.min(
    (paperW - padX * 2) / baseWidth,
    (paperH - padY * 2) / baseHeight,
    3.0
  );
  scale = Math.max(scale, 0.7);
  state.notationScale = scale;

  var tx = paperCX - (baseWidth  * scale) / 2;
  var ty = paperCY - (baseHeight * scale) / 2;

  // Ball radius scales with notation, capped to stay readable
  var ballRadius = Math.max(10, Math.min(18, 10 * scale));

  // Staff line in display space (note-head centres sit here)
  var staffDisplayY = ty + baseStaffY * scale;
  state.notationStaffDisplayY = staffDisplayY;
  state.notationTx = tx;

  // Ball lands so its bottom just touches the top of the note-head ellipse (ry=3.5)
  notationBallLandingY = staffDisplayY - 3.5 * scale - ballRadius - 1;

  // Pre-compute display-space X for each beat's ball landing position
  notationBeatXPositions = [];
  for (var bi = 0; bi < beatCount; bi++) {
    var beatBaseX = baseXStart + bi * baseBeatWidth;
    var landBaseX = crGetBallLandingX(effectivePattern[bi], beatBaseX, baseBeatWidth);
    notationBeatXPositions.push(tx + landBaseX * scale);
  }

  // ── Build SVG ──────────────────────────────────────────────────────────────
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid meet">';

  // Canvas background — changes colour when practice-rhythm silent measure is active
  var _prBg = (state.practiceRhythmEnabled && state.practiceRhythmMeasureIdx % 2 === 1) ? '#3a5c2a' : (window.vmCanvasBg || '#e2e8f0');
  svg += '<rect class="nd-bg-rect" width="640" height="360" fill="' + _prBg + '"/>';

  // Drop-shadow filter — works for both ball and shoe
  svg += '<defs>';
  svg += '<filter id="nd-ball-shadow" x="-40%" y="-40%" width="180%" height="180%">';
  svg += '<feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur"/>';
  svg += '<feOffset dx="0" dy="2" result="offset"/>';
  svg += '<feFlood flood-color="rgba(0,0,0,0.38)" result="color"/>';
  svg += '<feComposite in="color" in2="offset" operator="in" result="shadow"/>';
  svg += '<feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge>';
  svg += '</filter>';
  svg += '</defs>';

  // Score paper — adapts to theme via CSS variable
  svg += '<rect x="' + paperX + '" y="' + paperY + '" width="' + paperW + '" height="' + paperH + '" rx="12" style="fill: var(--vm-bg-panel); stroke: var(--vm-border)" stroke-width="1"/>';

  // Notation content — scaled group, same coordinate system as crRenderNotation
  svg += '<g transform="translate(' + tx.toFixed(2) + ',' + ty.toFixed(2) + ') scale(' + scale.toFixed(4) + ')">';

  // Staff line
  svg += '<line x1="10" y1="' + baseStaffY + '" x2="' + (baseWidth - 10) + '" y2="' + baseStaffY + '" stroke="#999" stroke-width="1"/>';

  // Time signature (stacked: beats on top, beat note value on bottom)
  var bnBottomD = { q: '4', h: '2', e: '8', dq: '8' }[state.beatNoteValue] || '4';
  var bnTopD = state.beatNoteValue === 'dq' ? beatCount * 3 : beatCount;
  if (bnTopD === 4 && bnBottomD === '4') {
    svg += '<text x="16" y="' + (baseStaffY + 8) + '" font-size="22" font-weight="bold" fill="currentColor" font-family="serif" text-anchor="middle">C</text>';
    svg += '<text x="16" y="' + (baseStaffY + 22) + '" font-size="9" fill="currentColor" font-family="sans-serif" text-anchor="middle">or 4/4</text>';
  } else if (bnTopD === 2 && bnBottomD === '2') {
    svg += '<text x="16" y="' + (baseStaffY + 8) + '" font-size="22" font-weight="bold" fill="currentColor" font-family="serif" text-anchor="middle">C</text>';
    svg += '<line x1="16" y1="' + (baseStaffY - 9) + '" x2="16" y2="' + (baseStaffY + 9) + '" stroke="currentColor" stroke-width="1.5"/>';
    svg += '<text x="16" y="' + (baseStaffY + 22) + '" font-size="9" fill="currentColor" font-family="sans-serif" text-anchor="middle">or 2/2</text>';
  } else {
    svg += '<text x="16" y="' + (baseStaffY - 4) + '" font-size="14" font-weight="bold" fill="currentColor" font-family="serif" text-anchor="middle">' + bnTopD + '</text>';
    svg += '<text x="16" y="' + (baseStaffY + 13) + '" font-size="14" font-weight="bold" fill="currentColor" font-family="serif" text-anchor="middle">' + bnBottomD + '</text>';
  }

  // Opening barline
  svg += '<line x1="' + (baseXStart - 5) + '" y1="' + (baseStaffY - 20) + '" x2="' + (baseXStart - 5) + '" y2="' + (baseStaffY + 20) + '" stroke="currentColor" stroke-width="1.5"/>';

  for (var b = 0; b < beatCount; b++) {
    var x = baseXStart + b * baseBeatWidth;
    var pat = effectivePattern[b];

    svg += crDrawBeatPattern(pat, x, baseStaffY, baseBeatWidth);

    // Beat number below staff — aligned under the first note/rest of the beat
    svg += '<text x="' + crGetBeatLabelX(pat, x, baseBeatWidth) + '" y="' + (baseStaffY + 40) + '" text-anchor="middle" font-size="11" fill="currentColor" font-family="sans-serif">' + (b + 1) + '</text>';

    // Accent marks
    if (customRhythmAccents[b] && customRhythmAccents[b].length > 0) {
      var noteXPositions = crGetAllNoteXPositions(pat, x, baseBeatWidth);
      for (var a = 0; a < customRhythmAccents[b].length; a++) {
        var ni = customRhythmAccents[b][a];
        if (ni < noteXPositions.length) {
          svg += crAccentMark(noteXPositions[ni], baseStaffY - 33);
        }
      }
    }

    // Draw note-level tie arcs (inside the scaled notation group)
    var scoreNoteXs = crGetAllNoteXPositions(pat, x, baseBeatWidth);
    for (var sni = 0; sni < (state.customRhythmNoteTies[b] || []).length; sni++) {
      if (!state.customRhythmNoteTies[b][sni]) continue;
      var sn1 = scoreNoteXs[sni];
      var sn2;
      if (sni < scoreNoteXs.length - 1) {
        sn2 = scoreNoteXs[sni + 1];
      } else if (b + 1 < beatCount) {
        var snNextPat = effectivePattern[b + 1];
        var snNextXs = crGetAllNoteXPositions(snNextPat, baseXStart + (b + 1) * baseBeatWidth, baseBeatWidth);
        sn2 = snNextXs.length > 0 ? snNextXs[0] : null;
      }
      if (sn2 != null) svg += crTieArc(sn1, sn2, baseStaffY);
    }
  }

  // Final double barline
  var finalBarX = baseXStart + beatCount * baseBeatWidth;
  svg += '<line x1="' + (finalBarX + 2) + '" y1="' + (baseStaffY - 20) + '" x2="' + (finalBarX + 2) + '" y2="' + (baseStaffY + 20) + '" stroke="currentColor" stroke-width="2.5"/>';
  svg += '<line x1="' + (finalBarX - 2) + '" y1="' + (baseStaffY - 20) + '" x2="' + (finalBarX - 2) + '" y2="' + (baseStaffY + 20) + '" stroke="currentColor" stroke-width="1"/>';

  svg += '</g>'; // end notation group

  // Save radius for use in crUpdateNotationBall
  notationBallRadius = ballRadius;

  // Bouncing ball / shape — drawn in display coordinates, outside the scaled notation group
  var initX = notationBeatXPositions[0] !== undefined ? notationBeatXPositions[0] : dispW / 2;
  svg += crNotationBallSVG('notation-ball', state.notationBallColor, state.notationBallStyle, initX, notationBallLandingY, ballRadius);

  // Beat click targets — transparent overlays for the rhythm picker.
  // Drawn last so they're on top for pointer events; CSS handles hover highlight.
  for (var ci = 0; ci < beatCount; ci++) {
    if (crIsContinuation(effectivePattern[ci])) continue;
    var chx = (tx + (baseXStart + ci * baseBeatWidth) * scale - 2).toFixed(1);
    var chy = (ty + (baseStaffY - 28) * scale).toFixed(1);
    var chw = (baseBeatWidth * scale).toFixed(1);
    var chh = (68 * scale).toFixed(1);
    svg += '<rect class="cr-beat-target" data-beat="' + ci + '"'
         + ' x="' + chx + '" y="' + chy + '" width="' + chw + '" height="' + chh + '"'
         + ' rx="3" pointer-events="all"/>';
  }

  // Note-level tie targets — always rendered in score mode
  for (var nb = 0; nb < beatCount; nb++) {
    var nbPat = effectivePattern[nb];
    if (crIsContinuation(nbPat)) continue;
    var nbBaseX = baseXStart + nb * baseBeatWidth;
    var nbNoteXs = crGetAllNoteXPositions(nbPat, nbBaseX, baseBeatWidth);
    for (var nni = 0; nni < nbNoteXs.length; nni++) {
      // Don't allow a tie target on the very last note of the measure
      if (nb === beatCount - 1 && nni === nbNoteXs.length - 1) continue;
      // Don't allow cross-beat tie to a rest or continuation beat
      if (nni === nbNoteXs.length - 1) {
        var nextNbPat = effectivePattern[nb + 1];
        if (!nextNbPat || crIsContinuation(nextNbPat) || crGetAllNoteXPositions(nextNbPat, 0, 1).length === 0) continue;
      }
      var isTied = state.customRhythmNoteTies[nb] && state.customRhythmNoteTies[nb][nni];
      var ndx = (tx + nbNoteXs[nni] * scale - 8).toFixed(1);
      var ndy = (ty + baseStaffY * scale - 8).toFixed(1);
      svg += '<rect class="cr-note-target' + (isTied ? ' tied' : '') + '"'
           + ' data-beat="' + nb + '" data-note="' + nni + '"'
           + ' x="' + ndx + '" y="' + ndy + '" width="16" height="16"'
           + ' rx="3" pointer-events="all"/>';
    }
  }

  svg += '</svg>';
  wrapper.innerHTML = svg;
  crAttachBeatPickerListeners(wrapper);
  crAttachNoteTargetListeners(wrapper);
  _syncPracticeRow();
  _syncBeatNoteRow();
}

// ── Rhythm picker ─────────────────────────────────────────────────────────────

function crHideRhythmPicker() {
  var picker   = document.getElementById('rhythm-picker');
  var backdrop = document.getElementById('rhythm-picker-backdrop');
  if (picker)   picker.style.display   = 'none';
  if (backdrop) backdrop.style.display = 'none';
}

// Enables custom rhythm (if not yet active), applies the chosen pattern to the
// beat, and re-renders both the score display and the modal notation preview.
function crApplyRhythmOption(beatIdx, pat) {
  if (!state.customRhythmEnabled || state.customRhythmPattern.length === 0) {
    state.customRhythmEnabled = true;
    state.customRhythmPattern = crBuildDefaultPattern();
    crSyncTiesAndAccents();
    var cb  = document.getElementById('custom-rhythm-enabled');
    var btn = document.getElementById('custom-rhythm-btn');
    if (cb)  cb.checked = true;
    if (btn) btn.classList.add('ct-active');
    _syncSubdivisionVisibility();
  }
  crSetBeatPattern(beatIdx, pat);
  crRenderNotationDisplay();
  crRenderNotation();
  sendStateUpdate();
}

// Shows the floating rhythm-picker popover anchored below (or above) the beat.
function crShowRhythmPicker(beatIdx, anchorX, anchorY) {
  var picker    = document.getElementById('rhythm-picker');
  var backdrop  = document.getElementById('rhythm-picker-backdrop');
  var beatNumEl = document.getElementById('rhythm-picker-beat-num');
  var grid      = document.getElementById('rhythm-picker-grid');
  if (!picker || !grid) return;

  if (beatNumEl) beatNumEl.textContent = beatIdx + 1;

  var beatCount  = notationBeatXPositions.length;
  var currentPat = state.customRhythmPattern.length > beatIdx ? state.customRhythmPattern[beatIdx] : 'q';

  var patterns;
  if (state.beatNoteValue === 'h') {
    patterns = [
      { pat: 'H',     label: 'Half' },
      { pat: 'HR',    label: 'Half Rest' },
      { pat: 'HQQ',   label: '2 Quarters' },
      { pat: 'HQR',   label: 'Q + Rest' },
      { pat: 'HRQ',   label: 'Rest + Q' },
      { pat: 'HEEEE', label: '4 Eighths' },
    ];
    if (beatIdx + 1 < beatCount) patterns.push({ pat: 'HW', label: 'Whole Note' });
  } else if (state.beatNoteValue === 'e') {
    patterns = [
      { pat: 'E',   label: 'Eighth' },
      { pat: 'ER',  label: '8th Rest' },
      { pat: 'ESS', label: '2 Sixteenths' },
      { pat: 'ESR', label: '16th + Rest' },
      { pat: 'ERS', label: 'Rest + 16th' },
    ];
    if (beatIdx + 1 < beatCount) patterns.push({ pat: 'EQ', label: 'Quarter (2b)' });
  } else if (state.beatNoteValue === 'dq') {
    patterns = [
      { pat: 'D',    label: 'Dot Quarter' },
      { pat: 'DR',   label: 'Dot Q Rest' },
      { pat: 'DEEE', label: '3 Eighths' },
      { pat: 'DEER', label: '2 8ths+Rest' },
      { pat: 'DERE', label: '8th+Rest+8th' },
      { pat: 'DREE', label: 'Rest+2 Eighths' },
    ];
    if (beatIdx + 1 < beatCount) patterns.push({ pat: 'DDH', label: 'Dot Half (2b)' });
  } else {
    // Quarter note beat (default) — ordered from simplest to most complex
    patterns = [
      { pat: 'q',    label: 'Quarter'         },
      { pat: 'r',    label: 'Rest'            },
      { pat: 'ee',   label: '2 Eighths'       },
      { pat: 'er',   label: 'Eighth + Rest'   },
      { pat: 're',   label: 'Rest + Eighth'   },
      { pat: 'eee',  label: 'Triplets'        },
      { pat: 'ssss', label: '4 Sixteenths'    },
      { pat: 'sse',  label: '2/16 + Eighth'   },
      { pat: 'ess',  label: 'Eighth + 2/16'   },
      { pat: 'des',  label: 'Dotted 8th+16th' },
      { pat: 'sed',  label: '16th+Dotted 8th' },
      { pat: 'ses',  label: '16th+8th+16th'   },
    ];
    if (beatIdx + 1 < beatCount) {
      patterns.push({ pat: 'h',   label: 'Half Note'       });
      patterns.push({ pat: 'dq',  label: 'Dotted Quarter'  });
      patterns.push({ pat: 'eqe',   label: '8th+Q+8th'    });
      patterns.push({ pat: 'rqe',   label: 'Rest+Q+8th'   });
      patterns.push({ pat: 'eqr',   label: '8th+Q+Rest'   });
      patterns.push({ pat: 'rqr',   label: 'Rest+Q+Rest'  });
      patterns.push({ pat: 'ssqe',  label: '2/16+Q+8th'   });
      patterns.push({ pat: 'eqss',  label: '8th+Q+2/16'   });
      patterns.push({ pat: 'ssqss', label: '2/16+Q+2/16'  });
      patterns.push({ pat: 'rqss',  label: 'Rest+Q+2/16'  });
      patterns.push({ pat: 'ssqr',  label: '2/16+Q+Rest'  });
    }
  }

  grid.innerHTML = '';
  patterns.forEach(function(opt) {
    var btn = document.createElement('button');
    btn.className = 'rhythm-option' + (opt.pat === currentPat ? ' active' : '');
    btn.title = opt.label;

    var mW = 56, mH = 44, mY = 30;
    var mini  = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + mW + ' ' + mH + '">';
    mini += '<line x1="2" y1="' + mY + '" x2="' + (mW - 2) + '" y2="' + mY
          + '" stroke="#ccc" stroke-width="0.8"/>';
    mini += crDrawBeatPattern(opt.pat, 0, mY, mW);
    mini += '</svg>';

    var lbl = document.createElement('div');
    lbl.className = 'rhythm-option-label';
    lbl.textContent = opt.label;

    btn.innerHTML = mini;
    btn.appendChild(lbl);
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      crApplyRhythmOption(beatIdx, opt.pat);
      crHideRhythmPicker();
    });
    grid.appendChild(btn);
  });

  var oldAdv = picker.querySelector('.rhythm-advanced-section');
  if (oldAdv) picker.removeChild(oldAdv);

  picker.style.display = 'block';
  if (backdrop) backdrop.style.display = 'block';

  // Defer positioning until the browser has laid the picker out
  requestAnimationFrame(function() {
    var pw = picker.offsetWidth  || 290;
    var ph = picker.offsetHeight || 230;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var left = anchorX - pw / 2;
    var top  = anchorY + 12;
    // Prefer below the anchor; flip above if it would go off-screen
    if (top + ph > vh - 12) top = anchorY - ph - 12;
    // Hard clamp: never let either edge exceed the viewport
    left = Math.max(10, Math.min(left, vw - pw - 10));
    top  = Math.max(10, Math.min(top,  vh - ph - 10));
    picker.style.left = left + 'px';
    picker.style.top  = top  + 'px';
    picker.style.left = left + 'px';
    picker.style.top  = top  + 'px';
  });
}

// Attaches click listeners to the beat hit-areas generated by crRenderNotationDisplay.
function crAttachBeatPickerListeners(wrapper) {
  if (!wrapper) return;
  wrapper.querySelectorAll('.cr-beat-target').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      var beatIdx = parseInt(el.getAttribute('data-beat'), 10);
      var svgEl   = wrapper.querySelector('svg');
      if (!svgEl || !notationBeatXPositions.length) return;
      var r   = svgEl.getBoundingClientRect();
      var sx  = r.width  / 640;
      var sy  = r.height / 360;
      var screenX = r.left + notationBeatXPositions[beatIdx] * sx;
      var screenY = r.top  + (notationBallLandingY + notationBallRadius + 6) * sy;
      crShowRhythmPicker(beatIdx, screenX, screenY);
    });
  });
}

function crToggleNoteTie(beatIdx, noteIdx) {
  // Auto-initialize custom rhythm with default quarter notes on first tie click
  if (!state.customRhythmEnabled || !state.customRhythmPattern.length) {
    state.customRhythmEnabled = true;
    state.customRhythmPattern = crBuildDefaultPattern();
    crSyncTiesAndAccents();
    var _cb = document.getElementById('custom-rhythm-enabled');
    if (_cb) _cb.checked = true;
    var _btn = document.getElementById('custom-rhythm-btn');
    if (_btn) _btn.classList.add('ct-active');
    _syncSubdivisionVisibility();
    _syncPracticeRow();
  }
  if (!state.customRhythmNoteTies[beatIdx]) state.customRhythmNoteTies[beatIdx] = [];
  state.customRhythmNoteTies[beatIdx][noteIdx] = !state.customRhythmNoteTies[beatIdx][noteIdx];
  crRenderNotationDisplay();
  crRenderNotation();
  sendStateUpdate();
}

function crAttachNoteTargetListeners(wrapper) {
  wrapper.querySelectorAll('.cr-note-target').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      var b  = parseInt(el.getAttribute('data-beat'), 10);
      var ni = parseInt(el.getAttribute('data-note'), 10);
      crToggleNoteTie(b, ni);
    });
  });
}

// Updates the bouncing ball position on each animation frame when score mode is active.
export function crUpdateNotationBall() {
  var ball = document.getElementById('notation-ball');
  if (!ball || !notationBeatXPositions.length) return;

  var beatCount = notationBeatXPositions.length;
  var progress  = getAnimationProgress();
  var ballX, ballY;

  if (Tone.Transport.state !== 'started' || state.lastBeatTime <= 0) {
    // Stopped: rest on beat 1's note head
    ballX = notationBeatXPositions[0];
    ballY = notationBallLandingY;
  } else {
    // animBeat is the NEXT beat index (set when the previous beat fired).
    // currentIdx = the beat that just fired; nextIdx = where the ball is heading.
    var currentIdx = ((state.animBeat - 1) % beatCount + beatCount) % beatCount;
    var nextIdx    = state.animBeat % beatCount;

    var x0 = notationBeatXPositions[currentIdx];
    var x1 = notationBeatXPositions[nextIdx];

    ballX = x0 + (x1 - x0) * progress;

    // Parabolic arc: lands (progress=0,1) at notationBallLandingY, peaks (progress=0.5) 110px above
    ballY = notationBallLandingY - 110 * 4 * progress * (1 - progress);
  }

  ball.setAttribute('transform', crNotationBallTransform(state.notationBallStyle, ballX, ballY, notationBallRadius));
}

function crDrawBeatPattern(pat, x, y, w) {
  var svg = '';
  switch (pat) {
    case 'q': // Quarter note
      svg += crNoteHead(x + w / 2, y, false);
      svg += crStem(x + w / 2, y);
      break;

    case 'r': // Quarter rest
      svg += crQuarterRest(x + w / 2, y);
      break;

    case 'ee': // Two eighths
      var x1 = x + w * 0.25, x2 = x + w * 0.75;
      svg += crNoteHead(x1, y, false);
      svg += crStem(x1, y);
      svg += crNoteHead(x2, y, false);
      svg += crStem(x2, y);
      svg += crBeam(x1, x2, y - 25);
      break;

    case 'eee': { // Three eighth-note triplets
      var t1 = x + w * 0.15, t2 = x + w * 0.50, t3 = x + w * 0.85;
      // Shorter stems leave room for the triplet "3" above the beam
      var beamY = y - 20;
      svg += crNoteHead(t1, y, false);
      svg += '<line x1="' + (t1+4.5).toFixed(1) + '" y1="' + y + '" x2="' + (t1+4.5).toFixed(1) + '" y2="' + beamY + '" stroke="currentColor" stroke-width="1.5"/>';
      svg += crNoteHead(t2, y, false);
      svg += '<line x1="' + (t2+4.5).toFixed(1) + '" y1="' + y + '" x2="' + (t2+4.5).toFixed(1) + '" y2="' + beamY + '" stroke="currentColor" stroke-width="1.5"/>';
      svg += crNoteHead(t3, y, false);
      svg += '<line x1="' + (t3+4.5).toFixed(1) + '" y1="' + y + '" x2="' + (t3+4.5).toFixed(1) + '" y2="' + beamY + '" stroke="currentColor" stroke-width="1.5"/>';
      svg += '<line x1="' + (t1+4.5).toFixed(1) + '" y1="' + beamY + '" x2="' + (t3+4.5).toFixed(1) + '" y2="' + beamY + '" stroke="currentColor" stroke-width="3"/>';
      var tmx = ((t1 + t3) / 2 + 4.5).toFixed(1);
      svg += '<text x="' + tmx + '" y="' + (beamY - 3) + '" text-anchor="middle" font-size="8" fill="currentColor" font-family="serif" font-style="italic">3</text>';
      break;
    }

    case 'er': // Eighth + eighth rest
      svg += crNoteHead(x + w * 0.25, y, false);
      svg += crStem(x + w * 0.25, y);
      svg += crFlag(x + w * 0.25, y);
      svg += crEighthRest(x + w * 0.7, y);
      break;

    case 're': // Eighth rest + eighth
      svg += crEighthRest(x + w * 0.25, y);
      svg += crNoteHead(x + w * 0.7, y, false);
      svg += crStem(x + w * 0.7, y);
      svg += crFlag(x + w * 0.7, y);
      break;

    case 'ssss': // Four sixteenths
      var positions = [0.12, 0.37, 0.62, 0.87];
      for (var i = 0; i < 4; i++) {
        var px = x + w * positions[i];
        svg += crNoteHead(px, y, false);
        svg += crStem(px, y);
      }
      svg += crBeam(x + w * 0.12, x + w * 0.87, y - 25);
      svg += crBeam(x + w * 0.12, x + w * 0.87, y - 21);
      break;

    case 'sse': // Two sixteenths + eighth
      var s1 = x + w * 0.12, s2 = x + w * 0.37, e1 = x + w * 0.75;
      svg += crNoteHead(s1, y, false);
      svg += crStem(s1, y);
      svg += crNoteHead(s2, y, false);
      svg += crStem(s2, y);
      svg += crNoteHead(e1, y, false);
      svg += crStem(e1, y);
      // Single beam across all three
      svg += crBeam(s1, e1, y - 25);
      // Double beam only on first two (sixteenths)
      svg += crBeam(s1, s2, y - 21);
      break;

    case 'ess': // Eighth + two sixteenths
      var e0 = x + w * 0.15, s3 = x + w * 0.55, s4 = x + w * 0.85;
      svg += crNoteHead(e0, y, false);
      svg += crStem(e0, y);
      svg += crNoteHead(s3, y, false);
      svg += crStem(s3, y);
      svg += crNoteHead(s4, y, false);
      svg += crStem(s4, y);
      // Single beam across all three
      svg += crBeam(e0, s4, y - 25);
      // Double beam only on last two (sixteenths)
      svg += crBeam(s3, s4, y - 21);
      break;

    case 'des': { // Dotted eighth + sixteenth
      var dp1 = x + w * 0.22, dp2 = x + w * 0.78;
      svg += crNoteHead(dp1, y, false);
      svg += crStem(dp1, y);
      svg += crDot(dp1 + 8, y);
      svg += crNoteHead(dp2, y, false);
      svg += crStem(dp2, y);
      svg += crBeam(dp1, dp2, y - 25);
      svg += crBeam((dp1 + dp2) / 2, dp2, y - 21);
      break;
    }

    case 'sed': { // Sixteenth + dotted eighth
      var sp1 = x + w * 0.22, sp2 = x + w * 0.72;
      svg += crNoteHead(sp1, y, false);
      svg += crStem(sp1, y);
      svg += crNoteHead(sp2, y, false);
      svg += crStem(sp2, y);
      svg += crDot(sp2 + 8, y);
      svg += crBeam(sp1, sp2, y - 25);
      svg += crBeam(sp1, (sp1 + sp2) / 2, y - 21);
      break;
    }

    case 'ses': { // Sixteenth + eighth + sixteenth
      var ssp1 = x + w * 0.12, ssp2 = x + w * 0.50, ssp3 = x + w * 0.87;
      svg += crNoteHead(ssp1, y, false);
      svg += crStem(ssp1, y);
      svg += crNoteHead(ssp2, y, false);
      svg += crStem(ssp2, y);
      svg += crNoteHead(ssp3, y, false);
      svg += crStem(ssp3, y);
      svg += crBeam(ssp1, ssp3, y - 25);
      svg += crBeam(ssp1, (ssp1 + ssp2) / 2, y - 21);
      svg += crBeam((ssp2 + ssp3) / 2, ssp3, y - 21);
      break;
    }

    case 'eqe': { // Eighth + syncopated quarter + eighth (2-beat syncopation: ♪♩♪)
      var qe1 = x + w * 0.2,  qqx = x + w * 0.72;
      svg += crNoteHead(qe1, y, false);
      svg += crStem(qe1, y);
      svg += crFlag(qe1, y);
      svg += crNoteHead(qqx, y, false);
      svg += crStem(qqx, y);
      break;
    }

    case 'rqe': { // Rest + syncopated quarter + eighth (2-beat syncopation: —♩♪)
      var qrx = x + w * 0.18, rqx = x + w * 0.70;
      svg += crEighthRest(qrx, y);
      svg += crNoteHead(rqx, y, false);
      svg += crStem(rqx, y);
      break;
    }

    case 'eqr': { // Eighth + syncopated quarter + rest (2-beat syncopation: ♪♩𝄾)
      var eqr1 = x + w * 0.2, eqrq = x + w * 0.72;
      svg += crNoteHead(eqr1, y, false);
      svg += crStem(eqr1, y);
      svg += crFlag(eqr1, y);
      svg += crNoteHead(eqrq, y, false);
      svg += crStem(eqrq, y);
      break;
    }

    case 'rqr': { // Rest + syncopated quarter + rest (2-beat syncopation: 𝄾♩𝄾)
      var rqrr = x + w * 0.18, rqrq = x + w * 0.70;
      svg += crEighthRest(rqrr, y);
      svg += crNoteHead(rqrq, y, false);
      svg += crStem(rqrq, y);
      break;
    }

    case 'ssqe':  // Two 16ths + syncopated quarter + eighth (♬♩♪)
    case 'ssqr':  // Two 16ths + syncopated quarter + rest  (♬♩𝄾)
    case 'ssqss': { // Two 16ths + syncopated quarter + two 16ths (♬♩♬)
      var sq1 = x + w * 0.12, sq2 = x + w * 0.37, sqq = x + w * 0.70;
      svg += crNoteHead(sq1, y, false);
      svg += crStem(sq1, y);
      svg += crNoteHead(sq2, y, false);
      svg += crStem(sq2, y);
      svg += crBeam(sq1, sq2, y - 25);
      svg += crBeam(sq1, sq2, y - 21);
      svg += crNoteHead(sqq, y, false);
      svg += crStem(sqq, y);
      break;
    }

    case 'eqss': { // Eighth + syncopated quarter + two 16ths (♪♩♬)
      var eqs1 = x + w * 0.2, eqsq = x + w * 0.72;
      svg += crNoteHead(eqs1, y, false);
      svg += crStem(eqs1, y);
      svg += crFlag(eqs1, y);
      svg += crNoteHead(eqsq, y, false);
      svg += crStem(eqsq, y);
      break;
    }

    case 'rqss': { // Rest + syncopated quarter + two 16ths (𝄾♩♬)
      var rqsrx = x + w * 0.18, rqsq = x + w * 0.70;
      svg += crEighthRest(rqsrx, y);
      svg += crNoteHead(rqsq, y, false);
      svg += crStem(rqsq, y);
      break;
    }

    case 'H': // Half note, 1 beat
      svg += crNoteHead(x + w * 0.5, y, true);
      svg += crStem(x + w * 0.5, y);
      break;

    case 'HR': // Half rest, 1 beat
      svg += crHalfRest(x + w * 0.5, y);
      break;

    case 'HQQ': { // 2 quarter notes filling 1 half-note beat
      var hq1 = x + w * 0.25, hq2 = x + w * 0.75;
      svg += crNoteHead(hq1, y, false); svg += crStem(hq1, y);
      svg += crNoteHead(hq2, y, false); svg += crStem(hq2, y);
      break;
    }

    case 'HQR': // Quarter + quarter rest
      svg += crNoteHead(x + w * 0.25, y, false); svg += crStem(x + w * 0.25, y);
      svg += crQuarterRest(x + w * 0.72, y);
      break;

    case 'HRQ': // Quarter rest + quarter
      svg += crQuarterRest(x + w * 0.25, y);
      svg += crNoteHead(x + w * 0.72, y, false); svg += crStem(x + w * 0.72, y);
      break;

    case 'HEEEE': { // 4 eighth notes filling 1 half-note beat (single beam)
      var he = [x + w*0.12, x + w*0.37, x + w*0.62, x + w*0.87];
      for (var i = 0; i < 4; i++) { svg += crNoteHead(he[i], y, false); svg += crStem(he[i], y); }
      svg += crBeam(he[0], he[3], y - 25);
      break;
    }

    case 'HW': // Whole note (2 half-note beats)
      svg += crWholeNote(x + w * 0.5, y);
      break;

    case 'E': // Eighth note, 1 beat
      svg += crNoteHead(x + w * 0.5, y, false);
      svg += crStem(x + w * 0.5, y);
      svg += crFlag(x + w * 0.5, y);
      break;

    case 'ER': // Eighth rest, 1 beat
      svg += crEighthRest(x + w * 0.5, y);
      break;

    case 'ESS': { // 2 sixteenth notes (double beam)
      var es1 = x + w * 0.25, es2 = x + w * 0.75;
      svg += crNoteHead(es1, y, false); svg += crStem(es1, y);
      svg += crNoteHead(es2, y, false); svg += crStem(es2, y);
      svg += crBeam(es1, es2, y - 25);
      svg += crBeam(es1, es2, y - 21);
      break;
    }

    case 'ESR': // Sixteenth + sixteenth rest
      svg += crNoteHead(x + w * 0.25, y, false);
      svg += crStem(x + w * 0.25, y);
      svg += crDoubleFlag(x + w * 0.25, y);
      svg += crSixteenthRest(x + w * 0.72, y);
      break;

    case 'ERS': // Sixteenth rest + sixteenth
      svg += crSixteenthRest(x + w * 0.22, y);
      svg += crNoteHead(x + w * 0.72, y, false);
      svg += crStem(x + w * 0.72, y);
      svg += crDoubleFlag(x + w * 0.72, y);
      break;

    case 'EQ': // Quarter note (2 eighth-note beats)
      svg += crNoteHead(x + w * 0.5, y, false);
      svg += crStem(x + w * 0.5, y);
      break;

    case 'D': // Dotted quarter, 1 beat
      svg += crNoteHead(x + w * 0.5, y, false);
      svg += crStem(x + w * 0.5, y);
      svg += crDot(x + w * 0.5 + 9, y);
      break;

    case 'DR': // Dotted quarter rest
      svg += crDottedQuarterRest(x + w * 0.5, y);
      break;

    case 'DEEE': { // 3 eighths (compound subdivision, no "3" label needed)
      var de1 = x + w*0.15, de2 = x + w*0.50, de3 = x + w*0.85;
      svg += crNoteHead(de1, y, false); svg += crStem(de1, y);
      svg += crNoteHead(de2, y, false); svg += crStem(de2, y);
      svg += crNoteHead(de3, y, false); svg += crStem(de3, y);
      svg += crBeam(de1, de3, y - 25);
      break;
    }

    case 'DEER': { // 2 eighths + eighth rest
      var dr1 = x + w*0.15, dr2 = x + w*0.50;
      svg += crNoteHead(dr1, y, false); svg += crStem(dr1, y);
      svg += crNoteHead(dr2, y, false); svg += crStem(dr2, y);
      svg += crBeam(dr1, dr2, y - 25);
      svg += crEighthRest(x + w * 0.82, y);
      break;
    }

    case 'DERE': // Eighth + rest + eighth
      svg += crNoteHead(x + w*0.15, y, false); svg += crStem(x + w*0.15, y); svg += crFlag(x + w*0.15, y);
      svg += crEighthRest(x + w * 0.50, y);
      svg += crNoteHead(x + w*0.85, y, false); svg += crStem(x + w*0.85, y); svg += crFlag(x + w*0.85, y);
      break;

    case 'DREE': { // Rest + 2 eighths
      var drr2 = x + w*0.50, drr3 = x + w*0.85;
      svg += crEighthRest(x + w * 0.15, y);
      svg += crNoteHead(drr2, y, false); svg += crStem(drr2, y);
      svg += crNoteHead(drr3, y, false); svg += crStem(drr3, y);
      svg += crBeam(drr2, drr3, y - 25);
      break;
    }

    case 'DDH': // Dotted half (2 dotted-quarter beats)
      svg += crNoteHead(x + w * 0.5, y, true);
      svg += crStem(x + w * 0.5, y);
      svg += crDot(x + w * 0.5 + 9, y);
      break;

    case 'h':  // Half note — open note head + stem (no beam)
      svg += crNoteHead(x + w / 2, y, true);
      svg += crStem(x + w / 2, y);
      break;

    case 'dq': // Dotted quarter — filled note head + stem + dot
      svg += crNoteHead(x + w / 2, y, false);
      svg += crStem(x + w / 2, y);
      svg += crDot(x + w / 2 + 9, y);
      break;

    case 'dh': // Dotted half — open note head + stem + dot
      svg += crNoteHead(x + w / 2, y, true);
      svg += crStem(x + w / 2, y);
      svg += crDot(x + w / 2 + 9, y);
      break;

    case '_':  // Silent full-beat continuation — nothing drawn
      break;

    case '_e': // Back-half eighth note (continuation of dotted quarter)
      svg += crNoteHead(x + w * 0.5, y, false);
      svg += crStem(x + w * 0.5, y);
      svg += crFlag(x + w * 0.5, y);
      break;

    case '_r': // Back-half eighth rest (continuation of dotted quarter)
      svg += crEighthRest(x + w * 0.5, y);
      break;

    case '_ss': { // Back-half two sixteenth notes
      var ss1 = x + w * 0.5, ss2 = x + w * 0.75;
      svg += crNoteHead(ss1, y, false);
      svg += crStem(ss1, y);
      svg += crNoteHead(ss2, y, false);
      svg += crStem(ss2, y);
      svg += crBeam(ss1, ss2, y - 25);
      svg += crBeam(ss1, ss2, y - 21);
      break;
    }
  }
  return svg;
}

function crNoteHead(cx, cy, open) {
  if (open) {
    return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="5" ry="3.5" fill="none" stroke="currentColor" stroke-width="1.5" transform="rotate(-15,' + cx + ',' + cy + ')"/>';
  }
  return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="5" ry="3.5" fill="currentColor" transform="rotate(-15,' + cx + ',' + cy + ')"/>';
}

function crStem(x, y) {
  return '<line x1="' + (x + 4.5) + '" y1="' + y + '" x2="' + (x + 4.5) + '" y2="' + (y - 25) + '" stroke="currentColor" stroke-width="1.5"/>';
}

function crBeam(x1, x2, y) {
  return '<line x1="' + (x1 + 4.5) + '" y1="' + y + '" x2="' + (x2 + 4.5) + '" y2="' + y + '" stroke="currentColor" stroke-width="3"/>';
}

function crFlag(x, y) {
  // Flag for a single eighth note — a curved pennant extending right from the stem top.
  // Starts at the top of the stem and sweeps outward and downward.
  var sx = x + 4.5, sy = y - 25;
  return '<path d="M' + sx + ',' + sy +
    ' c1,3 8,5 6,14' +   // outward curve down
    ' c-2,-2 -5,-4 -6,-6' + // inward curve back
    '" fill="currentColor" stroke="none"/>';
}

function crQuarterRest(cx, cy) {
  // Quarter rest — the classic zigzag lightning-bolt shape used in music notation.
  // Drawn as a filled path so it reads as a solid glyph at small sizes.
  var x = cx;
  return '<path d="' +
    'M' + (x - 2) + ',' + (cy - 12) +       // top-left start
    ' l5,5' +                                  // slash down-right
    ' l-5,5' +                                 // slash down-left to middle
    ' c2,0 5,2 3,6' +                         // curve into lower bump
    ' c-1,2 -3,4 -1,6' +                      // curve to bottom
    '" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
}

function crEighthRest(cx, cy) {
  // Eighth rest — leftward arm with dot at tip, curving body descending to the right.
  var jx = cx + 3, jy = cy - 5;  // top of curving body
  var dx = cx - 4, dy = cy - 7;  // dot at left tip of arm
  return '<circle cx="' + dx + '" cy="' + dy + '" r="2.2" fill="currentColor"/>' +
    '<path d="M' + dx + ',' + dy + ' L' + jx + ',' + jy +
    ' c-1,3 -4,7 -5,12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
}

function crDot(x, y) {
  // Augmentation dot to the right of a note head (slightly above the staff line)
  return '<circle cx="' + x.toFixed(1) + '" cy="' + (y - 2) + '" r="2.2" fill="currentColor"/>';
}

function crHalfRest(cx, cy) {
  // Filled rectangle sitting ON the staff line (like a hat)
  return '<rect x="' + (cx - 5.5).toFixed(1) + '" y="' + (cy - 5) + '" width="11" height="4.5" fill="currentColor"/>';
}

function crWholeNote(cx, cy) {
  return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="6.5" ry="4.5" fill="none" stroke="currentColor" stroke-width="1.8"/>';
}

function crDoubleFlag(x, y) {
  // Two flags for a standalone sixteenth note
  var sx = x + 4.5, sy = y - 25;
  return '<path d="M' + sx + ',' + sy + ' c1,3 8,5 6,14 c-2,-2 -5,-4 -6,-6" fill="currentColor" stroke="none"/>' +
         '<path d="M' + sx + ',' + (sy + 7) + ' c1,3 7,4 5,12 c-2,-2 -4,-4 -5,-5" fill="currentColor" stroke="none"/>';
}

function crSixteenthRest(cx, cy) {
  var dx = cx + 3, dy = cy - 5;
  return '<circle cx="' + dx + '" cy="' + dy + '" r="2.2" fill="currentColor"/>' +
    '<path d="M' + (dx + 0.5) + ',' + (dy + 1) + ' c-1,3 -4,7 -5,12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '<circle cx="' + (dx - 2.5) + '" cy="' + (dy + 13) + '" r="1.8" fill="currentColor"/>';
}

function crDottedQuarterRest(cx, cy) {
  return crQuarterRest(cx, cy) + crDot(cx + 9, cy - 3);
}

function crTieArc(x1, x2, staffY) {
  // Curved arc below the note heads connecting tied notes
  var midX = (x1 + x2) / 2;
  var arcY = staffY + 10; // below the staff
  var cpY = staffY + 18;  // control point further below for a nice curve
  return '<path d="M' + x1 + ',' + arcY +
    ' Q' + midX + ',' + cpY + ' ' + x2 + ',' + arcY +
    '" fill="none" stroke="currentColor" stroke-width="1.5"/>';
}

function crAccentMark(cx, cy) {
  // Standard accent mark: > shape above the note
  return '<text x="' + (cx - 4) + '" y="' + (cy + 4) + '" font-size="14" font-weight="bold" fill="#c0392b" font-family="serif">&gt;</text>';
}

// ── Custom Rhythm Playback ──────────────────────────────────────────────────
// Called from scheduleMainBeat instead of normal triggerSound when enabled.
export function triggerCustomRhythmBeat(time, beatIndex) {
  if (!state.customRhythmPattern || beatIndex >= state.customRhythmPattern.length) return;

  var pat = state.customRhythmPattern[beatIndex];
  var subBeats = crGetSubBeats(pat);
  var beatDuration = Tone.Time("4n").toSeconds();
  var isFirstBeat = beatIndex === 0;

  // Check if the previous beat's last note ties into this beat's first note
  var prevBeat = (beatIndex - 1 + state.beatsPerMeasure) % state.beatsPerMeasure;
  var prevSubs = crGetSubBeats(state.customRhythmPattern[prevBeat]);
  var prevLastNI = prevSubs.length - 1;
  var tiedFromPrev = prevLastNI >= 0 &&
    state.customRhythmNoteTies[prevBeat] &&
    state.customRhythmNoteTies[prevBeat][prevLastNI] === true;

  // Get accent list for this beat
  var beatAccents = (customRhythmAccents && customRhythmAccents[beatIndex]) || [];

  for (var i = 0; i < subBeats.length; i++) {
    // Determine if this note is tied over from the preceding note
    var isTiedOver = (i === 0) ? tiedFromPrev
                   : (state.customRhythmNoteTies[beatIndex] && state.customRhythmNoteTies[beatIndex][i - 1] === true);
    if (isTiedOver) continue;

    var sb = subBeats[i];
    var t = time + sb.offset * beatDuration;

    // Check if this specific sub-note is user-accented
    var isUserAccent = beatAccents.indexOf(i) !== -1;
    // Default beat-1 accent
    var isBeat1Accent = isFirstBeat && sb.offset === 0;

    if ((isBeat1Accent && state.accentEnabled) || isUserAccent) {
      state.accentSynth.triggerAttackRelease("G5", "16n", t);
    }

    if (state.animalSoundEnabled) {
      if (isUserAccent) {
        triggerClickSoundVel(t, 1.0, false);
      } else if (sb.vel < 1.0) {
        triggerClickSoundVel(t, sb.vel, true);
      } else {
        triggerClickSoundVel(t, 1.0, false);
      }
    }
  }
}

// ── Custom Rhythm UI Listeners ──────────────────────────────────────────────
// ── Custom Rhythm Save / Load ─────────────────────────────────────────────────
var _VM_RHYTHMS_KEY = 'vm_saved_rhythms';

function crGetSavedRhythms() {
  try { return JSON.parse(localStorage.getItem(_VM_RHYTHMS_KEY)) || []; }
  catch(e) { return []; }
}

function crSaveRhythm() {
  var nameInput = document.getElementById('cr-rhythm-name');
  var name = (nameInput ? nameInput.value : '').trim() || 'Untitled Rhythm';
  var rhythms = crGetSavedRhythms();
  rhythms.push({
    id: Date.now(),
    name: name,
    pattern: state.customRhythmPattern.slice(),
    noteTies: state.customRhythmNoteTies.map(function(bt) { return bt ? bt.slice() : []; }),
    accents: customRhythmAccents.map(function(a) { return a ? a.slice() : []; }),
    beats: state.beatsPerMeasure,
    savedAt: new Date().toLocaleDateString()
  });
  localStorage.setItem(_VM_RHYTHMS_KEY, JSON.stringify(rhythms));
  if (nameInput) nameInput.value = '';
  crRenderSavedRhythmsList();
}

function crLoadRhythm(id) {
  var rhythms = crGetSavedRhythms();
  var entry = rhythms.find(function(r) { return r.id === id; });
  if (!entry) return;
  state.customRhythmPattern = entry.pattern.slice();
  // Load note ties; migrate from old per-beat ties format if needed
  if (entry.noteTies) {
    state.customRhythmNoteTies = entry.noteTies.map(function(bt) { return bt ? bt.slice() : []; });
  } else if (entry.ties) {
    state.customRhythmNoteTies = entry.pattern.map(function(pat, b) {
      var noteCount = crGetAllNoteXPositions(pat, 0, 1).length;
      var bt = [];
      for (var ni = 0; ni < noteCount; ni++) bt.push(false);
      if (entry.ties[b] && noteCount > 0) bt[noteCount - 1] = true;
      return bt;
    });
  } else {
    state.customRhythmNoteTies = [];
  }
  customRhythmAccents = entry.accents.map(function(a) { return a ? a.slice() : []; });
  crSyncTiesAndAccents();
  crRenderBeatSelectors();
  crRenderNotation();
}

function crDeleteRhythm(id) {
  var rhythms = crGetSavedRhythms().filter(function(r) { return r.id !== id; });
  localStorage.setItem(_VM_RHYTHMS_KEY, JSON.stringify(rhythms));
  crRenderSavedRhythmsList();
}

function crRenderSavedRhythmsList() {
  var container = document.getElementById('cr-saved-list');
  if (!container) return;
  var rhythms = crGetSavedRhythms();
  container.innerHTML = '';
  if (rhythms.length === 0) {
    container.innerHTML = '<p class="cr-saved-empty">No saved rhythms yet.</p>';
    return;
  }
  rhythms.slice().reverse().forEach(function(entry) {
    var row = document.createElement('div');
    row.className = 'cr-saved-row';

    var nameEl = document.createElement('span');
    nameEl.className = 'cr-saved-name';
    nameEl.textContent = entry.name;
    nameEl.title = entry.name;

    var metaEl = document.createElement('span');
    metaEl.className = 'cr-saved-meta';
    metaEl.textContent = entry.beats + ' beats · ' + entry.savedAt;

    var loadBtn = document.createElement('button');
    loadBtn.className = 'cr-saved-load-btn';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', function() { crLoadRhythm(entry.id); });

    var delBtn = document.createElement('button');
    delBtn.className = 'cr-saved-del-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', function() { crDeleteRhythm(entry.id); });

    row.appendChild(nameEl);
    row.appendChild(metaEl);
    row.appendChild(loadBtn);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

function initCustomRhythmListeners() {
  var crBtn = document.getElementById('custom-rhythm-btn');
  var crModal = document.getElementById('custom-rhythm-modal');
  var crCloseBtn = document.getElementById('custom-rhythm-close-btn');
  var crEnabledCheckbox = document.getElementById('custom-rhythm-enabled');

  if (crBtn) {
    crBtn.addEventListener('click', function() {
      // Initialize pattern if empty
      if (state.customRhythmPattern.length === 0 || state.customRhythmPattern.length !== state.beatsPerMeasure) {
        state.customRhythmPattern = crBuildDefaultPattern();
        state.customRhythmNoteTies = [];
        customRhythmAccents = [];
      }
      crSyncTiesAndAccents();
      crRenderBeatSelectors();
      crRenderNotation();
      crRenderSavedRhythmsList();
      crModal.classList.remove('hidden');
    });
  }

  var crSaveBtn = document.getElementById('cr-save-btn');
  if (crSaveBtn) {
    crSaveBtn.addEventListener('click', crSaveRhythm);
  }

  if (crCloseBtn) {
    crCloseBtn.addEventListener('click', function() {
      crModal.classList.add('hidden');
    });
  }

  if (crModal) {
    crModal.addEventListener('click', function(e) {
      if (e.target === crModal) crModal.classList.add('hidden');
    });
  }

  if (crEnabledCheckbox) {
    crEnabledCheckbox.checked = state.customRhythmEnabled;
    crEnabledCheckbox.addEventListener('change', function(e) {
      state.customRhythmEnabled = e.target.checked;
      if (crBtn) crBtn.classList.toggle('ct-active', state.customRhythmEnabled);
      if (state.customRhythmEnabled && state.customRhythmPattern.length === 0) {
        state.customRhythmPattern = crBuildDefaultPattern();
      }
      crUpdateScoreOptionVisibility();
      _syncSubdivisionVisibility();
      if (state.customRhythmEnabled) {
        // Auto-switch to Score animation when custom rhythm is turned on
        state.animalType = 'score';
        var sel = document.getElementById('animal-selector');
        if (sel) sel.value = 'score';
        createAnimals();
        _sync3DConductor();
        _syncWebGPUCanvas();
        updateColorPickerVisibility();
      }
      if (state.animalType === 'score') crRenderNotationDisplay();
      _syncNotationDisplay();
      sendStateUpdate();
    });
  }
  // Rhythm picker: close on backdrop click or Escape key
  var rpBackdrop = document.getElementById('rhythm-picker-backdrop');
  if (rpBackdrop) rpBackdrop.addEventListener('click', crHideRhythmPicker);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') crHideRhythmPicker();
  });

  // Sync on initial load in case customRhythmEnabled was restored from state
  _syncSubdivisionVisibility();
}

// Initialize custom rhythm listeners
// As a classic end-of-body script this always deferred to DOMContentLoaded
// (readyState was still 'loading'). Module scripts execute later, with
// readyState 'interactive', so defer explicitly to keep the same timing and
// to guarantee every module in the import graph has finished evaluating.
if (document.readyState === 'complete') {
  initCustomRhythmListeners();
} else {
  document.addEventListener('DOMContentLoaded', initCustomRhythmListeners);
}

// ── Beat Note Dropdown ────────────────────────────────────────────────────────
(function() {
  var sel = document.getElementById('beat-note-select');
  if (!sel) return;
  sel.value = state.beatNoteValue;
  sel.addEventListener('change', function() {
    state.beatNoteValue = sel.value;
    crCancelCustomRhythm();
    if (state.animalType === 'score') {
      crRenderNotationDisplay();
      crRenderNotation();
    }
    sendStateUpdate();
  });
})();

// ── Practice Rhythm ───────────────────────────────────────────────────────────
(function() {
  var cb = document.getElementById('practice-rhythm-cb');
  if (!cb) return;
  cb.checked = state.practiceRhythmEnabled;
  cb.addEventListener('change', function() {
    state.practiceRhythmEnabled = cb.checked;
    state.practiceRhythmMeasureIdx = -1;
    // Reset background to gray immediately when disabled
    if (!state.practiceRhythmEnabled) {
      document.querySelectorAll('.nd-bg-rect').forEach(function(r) { r.setAttribute('fill', window.vmCanvasBg || '#e2e8f0'); });
      var row = document.getElementById('practice-rhythm-row');
      if (row) row.className = 'practice-rhythm-row';
    }
    crmSyncToggleRow();
  });
})();
