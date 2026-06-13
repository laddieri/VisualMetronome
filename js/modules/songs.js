import { state } from './state.js';
import { crCancelCustomRhythm } from './custom-rhythm.js';
import { sendStateUpdate } from './remote.js';

var songTitle = '';              // Current song title (used when saving)
var _VM_SONGS_KEY = 'vm_saved_songs'; // localStorage key for persisted songs
// ─────────────────────────────────────────────────────────────────────────────

// ── Song Mode helpers ────────────────────────────────────────────────────────

// Sync UI controls when a new section starts
export function applySongSectionUI(sec) {
  var slider = document.getElementById('tempo-slider');
  var numInput = document.getElementById('bpm-input');
  var fsSlider = document.getElementById('fullscreen-tempo-slider');
  var fsBpmVal = document.getElementById('fullscreen-bpm-value');
  var tsSel = document.getElementById('time-signature');
  if (slider) slider.value = sec.bpm;
  if (numInput) numInput.value = sec.bpm;
  if (fsSlider) fsSlider.value = sec.bpm;
  if (fsBpmVal) fsBpmVal.textContent = sec.bpm;
  if (tsSel) tsSel.value = sec.beatsPerMeasure;
}

// Show section progress overlay on the canvas
export function updateSongProgressDisplay() {
  if (!state.songModeEnabled || state.songSections.length === 0) return;
  var wrapper = state.isFullscreen
    ? document.querySelector('.fullscreen-canvas-wrapper')
    : document.querySelector('.canvas-wrapper');
  if (!wrapper) return;

  var el = wrapper.querySelector('.song-progress-display');
  if (!el) {
    el = document.createElement('div');
    el.className = 'song-progress-display';
    wrapper.appendChild(el);
  }

  if (state.songCurrentSection < 0 || state.songCurrentSection >= state.songSections.length) {
    el.textContent = 'Song complete';
    el.className = 'song-progress-display done';
    return;
  }

  var sec = state.songSections[state.songCurrentSection];
  el.className = 'song-progress-display active';
  el.textContent = 'Section ' + (state.songCurrentSection + 1) + '/' + state.songSections.length +
    '  |  Measure ' + (state.songMeasureInSection + 1) + '/' + sec.measures +
    '  |  ' + sec.beatsPerMeasure + '/4 at ' + sec.bpm + ' BPM';
}

export function hideSongProgressDisplay() {
  ['.canvas-wrapper', '.fullscreen-canvas-wrapper'].forEach(function(sel) {
    var wrapper = document.querySelector(sel);
    if (!wrapper) return;
    var el = wrapper.querySelector('.song-progress-display');
    if (el) el.remove();
  });
}

// ── Song Sections Modal UI ──────────────────────────────────────────────────
var _songListenersInitialized = false;
// ── Saved Songs (localStorage) ───────────────────────────────────────────────

function getSavedSongs() {
  try { return JSON.parse(localStorage.getItem(_VM_SONGS_KEY)) || []; }
  catch(e) { return []; }
}

function saveSong() {
  if (state.songSections.length === 0) {
    alert('Add at least one section before saving.');
    return;
  }
  var title = (songTitle || '').trim() || 'Untitled Song';
  var songs = getSavedSongs();
  songs.push({
    id: Date.now(),
    title: title,
    sections: JSON.parse(JSON.stringify(state.songSections)),
    savedAt: new Date().toLocaleDateString()
  });
  localStorage.setItem(_VM_SONGS_KEY, JSON.stringify(songs));
  renderSavedSongsList();
}

function loadSavedSong(id) {
  var songs = getSavedSongs();
  var entry = songs.find(function(s) { return s.id === id; });
  if (!entry) return;
  state.songSections = JSON.parse(JSON.stringify(entry.sections));
  songTitle = entry.title;
  var titleInput = document.getElementById('song-title-input');
  if (titleInput) titleInput.value = songTitle;
  renderSongSectionsList();
}

function deleteSavedSong(id) {
  var songs = getSavedSongs().filter(function(s) { return s.id !== id; });
  localStorage.setItem(_VM_SONGS_KEY, JSON.stringify(songs));
  renderSavedSongsList();
}

function renderSavedSongsList() {
  var container = document.getElementById('song-saved-list');
  if (!container) return;
  var songs = getSavedSongs();
  container.innerHTML = '';
  if (songs.length === 0) {
    container.innerHTML = '<p class="song-saved-empty">No saved songs yet.</p>';
    return;
  }
  songs.slice().reverse().forEach(function(entry) {
    var row = document.createElement('div');
    row.className = 'song-saved-row';

    var info = document.createElement('div');
    info.className = 'song-saved-info';
    var name = document.createElement('span');
    name.className = 'song-saved-name';
    name.textContent = entry.title;
    var meta = document.createElement('span');
    meta.className = 'song-saved-meta';
    meta.textContent = entry.sections.length + (entry.sections.length === 1 ? ' section' : ' sections') + ' · ' + entry.savedAt;
    info.appendChild(name);
    info.appendChild(meta);

    var loadBtn = document.createElement('button');
    loadBtn.className = 'song-saved-load-btn';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', function() { loadSavedSong(entry.id); });

    var delBtn = document.createElement('button');
    delBtn.className = 'song-saved-del-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', function() { deleteSavedSong(entry.id); });

    row.appendChild(info);
    row.appendChild(loadBtn);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

function initSongSectionsListeners() {
  if (_songListenersInitialized) return;
  _songListenersInitialized = true;
  var songBtn = document.getElementById('song-sections-btn');
  var songModal = document.getElementById('song-sections-modal');
  var songCloseBtn = document.getElementById('song-sections-close-btn');
  var songEnabledCheckbox = document.getElementById('song-mode-enabled');
  var songAddBtn = document.getElementById('song-add-section-btn');
  var songListEl = document.getElementById('song-sections-list');

  var songTitleInput = document.getElementById('song-title-input');
  var songSaveBtn = document.getElementById('song-save-btn');

  if (songTitleInput) {
    songTitleInput.value = songTitle;
    songTitleInput.addEventListener('input', function() {
      songTitle = songTitleInput.value;
    });
  }

  if (songSaveBtn) {
    songSaveBtn.addEventListener('click', saveSong);
  }

  if (songBtn) {
    songBtn.addEventListener('click', function() {
      songModal.classList.remove('hidden');
      if (songTitleInput) songTitleInput.value = songTitle;
      renderSongSectionsList();
      renderSavedSongsList();
    });
  }

  if (songCloseBtn) {
    songCloseBtn.addEventListener('click', function() {
      songModal.classList.add('hidden');
    });
  }

  if (songModal) {
    songModal.addEventListener('click', function(e) {
      if (e.target === songModal) songModal.classList.add('hidden');
    });
  }

  if (songEnabledCheckbox) {
    songEnabledCheckbox.checked = state.songModeEnabled;
    songEnabledCheckbox.addEventListener('change', function(e) {
      state.songModeEnabled = e.target.checked;
      if (songBtn) songBtn.classList.toggle('ct-active', state.songModeEnabled);
      // Cancel custom rhythm when entering song mode
      if (state.songModeEnabled) {
        crCancelCustomRhythm();
      }
      sendStateUpdate();
    });
  }

  if (songAddBtn) {
    songAddBtn.addEventListener('click', function() {
      // Default: current settings or 4 measures, 4/4, 120 BPM
      state.songSections.push({
        measures: 16,
        beatsPerMeasure: state.beatsPerMeasure,
        bpm: state.cachedBPM,
        transitionBeats: 0,
        transitionUnit: 'beats',
        ritardandoEnabled: false,
        ritardandoBeats: 4,
        ritardandoUnit: 'beats',
        ritardandoPercent: 30
      });
      renderSongSectionsList();
    });
  }
}

function renderSongSectionsList() {
  var listEl = document.getElementById('song-sections-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (state.songSections.length === 0) {
    var empty = document.createElement('p');
    empty.className = 'setting-hint';
    empty.style.textAlign = 'center';
    empty.textContent = 'No sections yet. Click + to add one.';
    listEl.appendChild(empty);
    return;
  }

  state.songSections.forEach(function(sec, idx) {
    var row = document.createElement('div');
    row.className = 'song-section-row';

    // Section number label
    var label = document.createElement('span');
    label.className = 'song-section-label';
    label.textContent = (idx + 1) + '.';
    row.appendChild(label);

    // Measures input
    var measGroup = document.createElement('div');
    measGroup.className = 'song-section-field';
    var measLabel = document.createElement('label');
    measLabel.textContent = 'Meas.';
    measLabel.className = 'song-field-label';
    var measInput = document.createElement('input');
    measInput.type = 'number';
    measInput.className = 'song-section-input';
    measInput.min = 1;
    measInput.max = 999;
    measInput.value = sec.measures;
    measInput.addEventListener('change', (function(i) {
      return function(e) {
        state.songSections[i].measures = Math.max(1, Math.min(999, parseInt(e.target.value) || 1));
        e.target.value = state.songSections[i].measures;
      };
    })(idx));
    measGroup.appendChild(measLabel);
    measGroup.appendChild(measInput);
    row.appendChild(measGroup);

    // Beats per measure input
    var bpmGroup = document.createElement('div');
    bpmGroup.className = 'song-section-field';
    var bpmLabel = document.createElement('label');
    bpmLabel.textContent = 'Beats';
    bpmLabel.className = 'song-field-label';
    var bpmSelect = document.createElement('select');
    bpmSelect.className = 'song-section-select';
    for (var b = 1; b <= 9; b++) {
      var opt = document.createElement('option');
      opt.value = b;
      opt.textContent = b;
      if (b === sec.beatsPerMeasure) opt.selected = true;
      bpmSelect.appendChild(opt);
    }
    bpmSelect.addEventListener('change', (function(i) {
      return function(e) {
        state.songSections[i].beatsPerMeasure = parseInt(e.target.value);
      };
    })(idx));
    bpmGroup.appendChild(bpmLabel);
    bpmGroup.appendChild(bpmSelect);
    row.appendChild(bpmGroup);

    // Tempo (BPM) input
    var tempoGroup = document.createElement('div');
    tempoGroup.className = 'song-section-field';
    var tempoLabel = document.createElement('label');
    tempoLabel.textContent = 'BPM';
    tempoLabel.className = 'song-field-label';
    var tempoInput = document.createElement('input');
    tempoInput.type = 'number';
    tempoInput.className = 'song-section-input';
    tempoInput.min = 30;
    tempoInput.max = 300;
    tempoInput.value = sec.bpm;
    tempoInput.addEventListener('change', (function(i) {
      return function(e) {
        state.songSections[i].bpm = Math.max(30, Math.min(300, parseInt(e.target.value) || 120));
        e.target.value = state.songSections[i].bpm;
      };
    })(idx));
    tempoGroup.appendChild(tempoLabel);
    tempoGroup.appendChild(tempoInput);
    row.appendChild(tempoGroup);

    // Delete button
    var delBtn = document.createElement('button');
    delBtn.className = 'song-section-delete';
    delBtn.textContent = '\u00D7';
    delBtn.title = 'Remove section';
    delBtn.addEventListener('click', (function(i) {
      return function() {
        state.songSections.splice(i, 1);
        renderSongSectionsList();
      };
    })(idx));
    row.appendChild(delBtn);

    // Transition ramp row — shown above every section except the first
    if (idx > 0) {
      var rampRow = document.createElement('div');
      rampRow.className = 'song-section-ramp-row';

      var rampIcon = document.createElement('span');
      rampIcon.className = 'song-ramp-icon';
      rampIcon.textContent = '\u21D7'; // ⇗
      rampRow.appendChild(rampIcon);

      var rampLabel = document.createElement('span');
      rampLabel.className = 'song-ramp-label';
      rampLabel.textContent = 'Transition:';
      rampRow.appendChild(rampLabel);

      var rampInput = document.createElement('input');
      rampInput.type = 'number';
      rampInput.className = 'song-ramp-input';
      rampInput.min = 0;
      rampInput.max = 999;
      rampInput.value = sec.transitionBeats || 0;
      rampInput.title = '0 = instant tempo change';
      rampInput.addEventListener('change', (function(i) {
        return function(e) {
          state.songSections[i].transitionBeats = Math.max(0, Math.min(999, parseInt(e.target.value) || 0));
          e.target.value = state.songSections[i].transitionBeats;
        };
      })(idx));
      rampRow.appendChild(rampInput);

      var rampSelect = document.createElement('select');
      rampSelect.className = 'song-ramp-select';
      ['beats', 'measures'].forEach(function(unit) {
        var o = document.createElement('option');
        o.value = unit;
        o.textContent = unit;
        if (unit === (sec.transitionUnit || 'beats')) o.selected = true;
        rampSelect.appendChild(o);
      });
      rampSelect.addEventListener('change', (function(i) {
        return function(e) {
          state.songSections[i].transitionUnit = e.target.value;
        };
      })(idx));
      rampRow.appendChild(rampSelect);

      var rampHint = document.createElement('span');
      rampHint.className = 'song-ramp-hint';
      rampHint.textContent = 'at end of prev. section (0 = instant)';
      rampRow.appendChild(rampHint);

      listEl.appendChild(rampRow);
    }

    listEl.appendChild(row);

    // ── Ritardando row — shown for every section ──────────────────────────
    var ritRow = document.createElement('div');
    ritRow.className = 'song-section-rit-row';

    var ritCheckbox = document.createElement('input');
    ritCheckbox.type = 'checkbox';
    ritCheckbox.className = 'song-rit-checkbox';
    ritCheckbox.checked = sec.ritardandoEnabled || false;
    ritCheckbox.title = 'Enable ritardando at end of this section';
    ritCheckbox.addEventListener('change', (function(i) {
      return function(e) {
        state.songSections[i].ritardandoEnabled = e.target.checked;
        var fields = e.target.closest('.song-section-rit-row').querySelector('.song-rit-fields');
        if (fields) fields.classList.toggle('disabled', !e.target.checked);
      };
    })(idx));
    ritRow.appendChild(ritCheckbox);

    var ritIcon = document.createElement('span');
    ritIcon.className = 'song-rit-icon';
    ritIcon.textContent = '\u21D8'; // ⇘ — slowing-down arrow
    ritRow.appendChild(ritIcon);

    var ritLabel = document.createElement('span');
    ritLabel.className = 'song-rit-label';
    ritLabel.textContent = 'Ritardando:';
    ritRow.appendChild(ritLabel);

    // Fields container (visually disabled when checkbox is off)
    var ritFields = document.createElement('div');
    ritFields.className = 'song-rit-fields' + (sec.ritardandoEnabled ? '' : ' disabled');

    var ritDurationInput = document.createElement('input');
    ritDurationInput.type = 'number';
    ritDurationInput.className = 'song-rit-input';
    ritDurationInput.min = 1;
    ritDurationInput.max = 999;
    ritDurationInput.value = sec.ritardandoBeats || 4;
    ritDurationInput.title = 'Duration of slowdown in beats or measures';
    ritDurationInput.addEventListener('change', (function(i) {
      return function(e) {
        state.songSections[i].ritardandoBeats = Math.max(1, Math.min(999, parseInt(e.target.value) || 4));
        e.target.value = state.songSections[i].ritardandoBeats;
      };
    })(idx));
    ritFields.appendChild(ritDurationInput);

    var ritUnitSelect = document.createElement('select');
    ritUnitSelect.className = 'song-rit-select';
    ['beats', 'measures'].forEach(function(unit) {
      var o = document.createElement('option');
      o.value = unit;
      o.textContent = unit;
      if (unit === (sec.ritardandoUnit || 'beats')) o.selected = true;
      ritUnitSelect.appendChild(o);
    });
    ritUnitSelect.addEventListener('change', (function(i) {
      return function(e) {
        state.songSections[i].ritardandoUnit = e.target.value;
      };
    })(idx));
    ritFields.appendChild(ritUnitSelect);

    var ritSlowByLabel = document.createElement('span');
    ritSlowByLabel.className = 'song-rit-label';
    ritSlowByLabel.textContent = 'slow by';
    ritFields.appendChild(ritSlowByLabel);

    var ritPercentInput = document.createElement('input');
    ritPercentInput.type = 'number';
    ritPercentInput.className = 'song-rit-input';
    ritPercentInput.min = 1;
    ritPercentInput.max = 99;
    ritPercentInput.value = sec.ritardandoPercent || 30;
    ritPercentInput.title = 'How much to slow down (%)';
    ritPercentInput.addEventListener('change', (function(i) {
      return function(e) {
        state.songSections[i].ritardandoPercent = Math.max(1, Math.min(99, parseInt(e.target.value) || 30));
        e.target.value = state.songSections[i].ritardandoPercent;
      };
    })(idx));
    ritFields.appendChild(ritPercentInput);

    var ritPctLabel = document.createElement('span');
    ritPctLabel.className = 'song-rit-label';
    ritPctLabel.textContent = '%';
    ritFields.appendChild(ritPctLabel);

    ritRow.appendChild(ritFields);
    listEl.appendChild(ritRow);
  });
}

// Initialize song sections listeners immediately (not dependent on p5.js setup)
// As a classic end-of-body script this always deferred to DOMContentLoaded
// (readyState was still 'loading'). Module scripts execute later, with
// readyState 'interactive', so defer explicitly to keep the same timing and
// to guarantee every module in the import graph has finished evaluating.
if (document.readyState === 'complete') {
  initSongSectionsListeners();
} else {
  document.addEventListener('DOMContentLoaded', initSongSectionsListeners);
}
