import { state } from './state.js';
import { readJSON, writeJSON } from './storage.js';
import { applyBPM } from './tempo.js';

// Remembers the user's metronome settings across reloads.
//
// Settings are snapshotted from the controls themselves (not `state`),
// because song mode and two-measure patterns rewrite state.beatsPerMeasure
// etc. while they play. Restoring sets each control's value and fires the
// event its existing handler listens for, so all the side effects
// (visibility toggles, re-rendering, remote sync) run exactly as if the
// user had made the change.

var SETTINGS_KEY = 'vm.settings';

// Restore order matters: time signature before rock/waltz beat (which only
// apply to 4/4 and 3/4), subdivision before swing (÷2 only), animation
// before its colour/shape controls.
var CONTROLS = [
  { id: 'time-signature',         event: 'change' },
  { id: 'beat-note-select',       event: 'change' },
  { id: 'animal-selector',        event: 'change' },
  { id: 'subdivision',            event: 'change' },
  { id: 'swing-enabled',          event: 'change', checkbox: true },
  { id: 'bounce-direction',       event: 'change' },
  { id: 'circle-color',           event: 'input' },
  { id: 'notation-ball-color',    event: 'input' },
  { id: 'notation-ball-style',    event: 'change' },
  { id: 'anim-size-slider',       event: 'input' },
  { id: 'animal-sound-enabled',   event: 'change', checkbox: true },
  { id: 'metronome-sound-select', event: 'change' },
  { id: 'accent-enabled',         event: 'change', checkbox: true },
  { id: 'flash-enabled',          event: 'change', checkbox: true },
  { id: 'voice-count-enabled',    event: 'change', checkbox: true },
  { id: 'rock-beat-enabled',      event: 'change', checkbox: true },
  { id: 'waltz-beat-enabled',     event: 'change', checkbox: true },
  { id: 'spacebar-action-select', event: 'change' },
  { id: 'bluetooth-delay-slider', event: 'input' },
  { id: 'mirror-selfies',         event: 'change', checkbox: true },
];

// Song mode drives tempo (below) and meter itself; don't let its values
// overwrite the user's own.
var SONG_DRIVEN = { 'time-signature': true };

var restored = false;
var saveTimer = null;

function snapshot() {
  var saved = readJSON(SETTINGS_KEY, {}) || {};
  var songDriven = state.songModeEnabled;
  var out = {};
  if (!songDriven) out.bpm = state.cachedBPM;
  else if (saved.bpm != null) out.bpm = saved.bpm;
  CONTROLS.forEach(function(c) {
    if (songDriven && SONG_DRIVEN[c.id]) {
      if (saved[c.id] != null) out[c.id] = saved[c.id];
      return;
    }
    var el = document.getElementById(c.id);
    if (!el) return;
    var value = c.checkbox ? el.checked : el.value;
    // Selfie shape needs a fresh camera capture, so don't bring it back.
    if (c.id === 'notation-ball-style' && value === 'selfie') value = saved[c.id];
    if (value != null) out[c.id] = value;
  });
  return out;
}

export function saveSettingsNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  // Never save before the restore, or the defaults would clobber it.
  if (!restored) return;
  writeJSON(SETTINGS_KEY, snapshot(), null);
}

export function saveSettingsSoon() {
  if (!restored) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettingsNow, 300);
}

function setControl(c, value) {
  var el = document.getElementById(c.id);
  if (!el) return;
  if (c.checkbox) {
    if (typeof value !== 'boolean' || el.checked === value) return;
    el.checked = value;
  } else {
    value = String(value);
    if (el.value === value) return;
    if (el.tagName === 'SELECT' &&
        !Array.prototype.some.call(el.options, function(o) { return o.value === value; })) {
      return; // option no longer exists
    }
    el.value = value;
    if (el.value !== value) return; // rejected by the input (e.g. bad colour)
  }
  el.dispatchEvent(new Event(c.event, { bubbles: true }));
}

// Call once, after every control's listener has been attached.
export function restoreSettings() {
  var saved = readJSON(SETTINGS_KEY, null);
  if (saved && typeof saved === 'object') {
    CONTROLS.forEach(function(c) {
      if (!(c.id in saved)) return;
      try { setControl(c, saved[c.id]); }
      catch (e) { console.warn('Could not restore ' + c.id, e); }
    });
    var bpm = parseInt(saved.bpm, 10);
    if (bpm) applyBPM(bpm);
  }
  restored = true;

  var ids = {};
  CONTROLS.forEach(function(c) { ids[c.id] = true; });
  ['change', 'input'].forEach(function(type) {
    document.addEventListener(type, function(e) {
      if (e.target && ids[e.target.id]) saveSettingsSoon();
    }, true);
  });
  // Catch anything changed programmatically (e.g. from the phone remote).
  window.addEventListener('pagehide', saveSettingsNow);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') saveSettingsNow();
  });
}
