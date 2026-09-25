import { state } from './state.js';

// Practice modes: two-measure pattern, custom rhythm, song sections and the
// counting trainer. Only one runs at a time — picking one turns the others
// off — and a badge on the stage names the active mode, so it's always clear
// why the metronome isn't playing a plain steady beat.
//
// Each mode's own module still owns its "enable" checkbox (now hidden in its
// editor). Modes are switched by setting that checkbox and firing 'change', so
// every existing side effect runs exactly as when the user ticked it.
//
// Each mode's editor (formerly a popup) sits in the Practice panel right
// under its card (moved there by layout.js); only one is open at a time.
//
// The score is custom rhythm's view: choosing Custom rhythm shows it, and
// the Animation menu no longer lists it. Leaving custom rhythm puts back the
// animation that was showing before.

var MODES = [
  { id: 'two-measure',      flag: 'twoMeasurePatternEnabled', checkbox: 'tmp-enabled',
    btn: 'two-measure-btn',      modal: 'two-measure-modal',      emoji: '⚡', name: 'Two-measure pattern' },
  { id: 'custom-rhythm',    flag: 'customRhythmEnabled',      checkbox: 'custom-rhythm-enabled',
    btn: 'custom-rhythm-btn',    modal: 'custom-rhythm-modal',    emoji: '🥁', name: 'Custom rhythm' },
  { id: 'song',             flag: 'songModeEnabled',          checkbox: 'song-mode-enabled',
    btn: 'song-sections-btn',    modal: 'song-sections-modal',    emoji: '🎶', name: 'Song' },
  { id: 'counting-trainer', flag: 'countingTrainerEnabled',   checkbox: 'ct-enabled',
    btn: 'counting-trainer-btn', modal: 'counting-trainer-modal', emoji: '🎯', name: 'Counting trainer' },
];

function _mode(id) {
  return MODES.find(function(m) { return m.id === id; }) || null;
}

function _setCheckbox(mode, on) {
  var cb = document.getElementById(mode.checkbox);
  if (!cb || cb.checked === on) return;
  cb.checked = on;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
}

// ── Score view ⇄ custom rhythm ──────────────────────────────────────────────
var _lastAnimation = 'circle';   // Last non-score animation, restored on leaving the score

function _setAnimation(value) {
  var sel = document.getElementById('animal-selector');
  if (!sel || sel.value === value) return;
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

function _syncScoreView() {
  if (state.animalType === 'score' && !state.customRhythmEnabled) _setAnimation(_lastAnimation);
}

// ── Editors ─────────────────────────────────────────────────────────────────
function _hideEditors(exceptId) {
  MODES.forEach(function(m) {
    if (m.id === exceptId) return;
    var editor = document.getElementById(m.modal);
    if (editor) editor.classList.add('hidden');
  });
}

// The active mode's id, or null for a plain steady beat.
export function activeMode() {
  var m = MODES.find(function(mode) { return state[mode.flag]; });
  return m ? m.id : null;
}

// Turn off every mode except `id`. Called whenever a mode switches on, from
// whichever path turned it on (its checkbox, score editing, the remote, …).
export function claimMode(id) {
  MODES.forEach(function(m) {
    if (m.id !== id && state[m.flag]) _setCheckbox(m, false);
  });
  syncModeUI();
}

// Switch to mode `id`, or back to a steady beat with null.
export function setMode(id) {
  var target = _mode(id);
  claimMode(id);
  if (target && !state[target.flag]) _setCheckbox(target, true);
  // Picking Custom rhythm again brings back its score if the user had
  // switched to another animation meanwhile
  if (id === 'custom-rhythm') _setAnimation('score');
  syncModeUI();
}

function _detail(mode) {
  switch (mode.id) {
    case 'two-measure': {
      var p = state.twoMeasurePattern;
      return p[0].beatsPerMeasure + ' beats, then ' + p[1].beatsPerMeasure;
    }
    case 'song': {
      var n = state.songSections.length;
      return n === 0 ? 'no sections yet' : n + (n === 1 ? ' section' : ' sections');
    }
    case 'counting-trainer': {
      var parts = [];
      if (state.ctTargetMeasures) parts.push(state.ctTargetMeasures + (state.ctTargetMeasures === 1 ? ' bar' : ' bars'));
      if (state.ctTargetExtraBeats) parts.push(state.ctTargetExtraBeats + (state.ctTargetExtraBeats === 1 ? ' beat' : ' beats'));
      return 'count ' + parts.join(' + ');
    }
    default:
      return '';
  }
}

// Refresh the stage badge and the Practice panel's selected card.
export function syncModeUI() {
  _syncScoreView();
  var id = activeMode();
  var mode = _mode(id);

  MODES.forEach(function(m) {
    var btn = document.getElementById(m.btn);
    if (!btn) return;
    btn.classList.toggle('ct-active', m.id === id);
    btn.setAttribute('aria-pressed', String(m.id === id));
  });
  var steadyBtn = document.getElementById('steady-beat-btn');
  if (steadyBtn) {
    steadyBtn.classList.toggle('ct-active', !id);
    steadyBtn.setAttribute('aria-pressed', String(!id));
  }

  var badge = document.getElementById('mode-badge');
  if (!badge) return;
  badge.hidden = !mode;
  if (!mode) return;
  var detail = _detail(mode);
  badge.querySelector('.mode-badge-emoji').textContent = mode.emoji;
  badge.querySelector('.mode-badge-name').textContent = mode.name;
  badge.querySelector('.mode-badge-detail').textContent = detail ? '· ' + detail : '';
  var editBtn = badge.querySelector('.mode-badge-edit');
  editBtn.title = 'Edit ' + mode.name.toLowerCase();
  badge.querySelector('.mode-badge-off').setAttribute('aria-label', 'Turn off ' + mode.name.toLowerCase());
}

function initModes() {
  MODES.forEach(function(m) {
    // Any path that ticks a mode's checkbox turns the other modes off. The
    // mode's own listener may run after this one (the counting trainer's is
    // attached in p5's setup()), so refresh the UI once it has updated state.
    var cb = document.getElementById(m.checkbox);
    if (cb) {
      cb.addEventListener('change', function() {
        if (cb.checked) claimMode(m.id);
        Promise.resolve().then(syncModeUI);
      });
    }

    // Choosing a mode in the Practice panel turns it on; its own click
    // handler opens its editor, so close the others and bring it into view
    var modal = document.getElementById(m.modal);
    var btn = document.getElementById(m.btn);
    if (btn) {
      btn.addEventListener('click', function() {
        _hideEditors(m.id);
        setMode(m.id);
        // Scroll the card to the top so it and its settings are in view
        requestAnimationFrame(function() {
          if (modal && !modal.classList.contains('hidden')) {
            btn.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }
        });
      });
    }

    // "Turn off" in the mode's editor goes back to a steady beat
    if (modal) {
      var offBtn = modal.querySelector('.mode-off-btn');
      if (offBtn) {
        offBtn.addEventListener('click', function() {
          setMode(null);
          modal.classList.add('hidden');
        });
      }
      // Editing changes the badge's details (sections, bars, …); refresh it
      // after the editor's own handlers have run
      var refresh = function() { Promise.resolve().then(syncModeUI); };
      modal.addEventListener('click', refresh);
      modal.addEventListener('change', refresh);
    }
  });

  var steadyBtn = document.getElementById('steady-beat-btn');
  if (steadyBtn) {
    steadyBtn.addEventListener('click', function() {
      _hideEditors(null);
      setMode(null);
    });
  }

  // Remember the animation to return to when leaving the score, and treat
  // choosing the score (e.g. restoring saved settings) as choosing Custom rhythm
  var animSel = document.getElementById('animal-selector');
  if (animSel) {
    if (animSel.value !== 'score') _lastAnimation = animSel.value;
    animSel.addEventListener('change', function() {
      if (animSel.value !== 'score') _lastAnimation = animSel.value;
      else if (!state.customRhythmEnabled) setMode('custom-rhythm');
    });
  }

  var badge = document.getElementById('mode-badge');
  if (badge) {
    // Open the Practice panel (layout.js) on the active mode's editor
    badge.querySelector('.mode-badge-edit').addEventListener('click', function() {
      var mode = _mode(activeMode());
      var btn = mode && document.getElementById(mode.btn);
      if (!btn) return;
      if (window.vmShowPanel) window.vmShowPanel('rhythm');
      btn.click();
    });
    badge.querySelector('.mode-badge-off').addEventListener('click', function() { setMode(null); });
  }

  syncModeUI();
}

// Wait for DOMContentLoaded like the mode modules do, so their checkbox
// listeners are attached before ours.
if (document.readyState === 'complete') {
  initModes();
} else {
  document.addEventListener('DOMContentLoaded', initModes);
}
