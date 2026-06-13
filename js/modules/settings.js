import { state } from './state.js';
import { crCancelCustomRhythm, crRenderNotationDisplay } from './custom-rhythm.js';
import { sendStateUpdate } from './remote.js';
import { applyBPM } from './tempo.js';
import { toggleTransport } from './transport.js';


// Initialize settings modal listeners
export function initSettingsListeners() {
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsCloseBtn = document.getElementById('settings-close-btn');
  const timeSignatureSelect = document.getElementById('time-signature');
  const subdivisionSelect = document.getElementById('subdivision');
  const accentCheckbox = document.getElementById('accent-enabled');

  // Open settings modal
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      settingsModal.classList.remove('hidden');
    });
  }

  // Close settings modal
  if (settingsCloseBtn) {
    settingsCloseBtn.addEventListener('click', () => {
      settingsModal.classList.add('hidden');
    });
  }

  // Close modal when clicking outside
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        settingsModal.classList.add('hidden');
      }
    });
  }

  // Time signature change
  if (timeSignatureSelect) {
    timeSignatureSelect.addEventListener('change', (e) => {
      state.beatsPerMeasure = parseInt(e.target.value);
      state.currentBeat = 0; // Reset to beat 1
      updateRockBeatVisibility();
      // Cancel custom rhythm when time signature changes
      crCancelCustomRhythm();
      if (state.animalType === 'score') crRenderNotationDisplay();
      sendStateUpdate();
    });
  }

  // Rock beat toggle
  const rockBeatCheckbox = document.getElementById('rock-beat-enabled');
  const rockBeatGroup = document.getElementById('rock-beat-setting-group');

  // Waltz beat toggle
  const waltzBeatCheckbox = document.getElementById('waltz-beat-enabled');
  const waltzBeatGroup = document.getElementById('waltz-beat-setting-group');

  function updateSwingVisibility() {
    var swingGroup = document.getElementById('swing-group');
    if (swingGroup) {
      swingGroup.style.display = (state.subdivision === '2') ? '' : 'none';
    }
    // Auto-disable swing if subdivision changes away from ÷2
    if (state.subdivision !== '2' && state.swingEnabled) {
      state.swingEnabled = false;
      var swingCb = document.getElementById('swing-enabled');
      if (swingCb) swingCb.checked = false;
    }
  }

  function updateRockBeatVisibility() {
    if (rockBeatGroup) {
      rockBeatGroup.style.display = state.beatsPerMeasure === 4 ? '' : 'none';
    }
    // Auto-disable rock beat if time signature changes away from 4/4
    if (state.beatsPerMeasure !== 4 && state.rockBeatEnabled) {
      state.rockBeatEnabled = false;
      if (rockBeatCheckbox) rockBeatCheckbox.checked = false;
    }

    if (waltzBeatGroup) {
      waltzBeatGroup.style.display = state.beatsPerMeasure === 3 ? '' : 'none';
    }
    // Auto-disable waltz beat if time signature changes away from 3/4
    if (state.beatsPerMeasure !== 3 && state.waltzBeatEnabled) {
      state.waltzBeatEnabled = false;
      if (waltzBeatCheckbox) waltzBeatCheckbox.checked = false;
    }
  }

  if (rockBeatCheckbox) {
    rockBeatCheckbox.addEventListener('change', (e) => {
      state.rockBeatEnabled = e.target.checked;
      sendStateUpdate();
    });
  }

  if (waltzBeatCheckbox) {
    waltzBeatCheckbox.addEventListener('change', (e) => {
      state.waltzBeatEnabled = e.target.checked;
      sendStateUpdate();
    });
  }

  // Show drum machine options for the initial time signature
  updateRockBeatVisibility();

  // Subdivision change
  if (subdivisionSelect) {
    subdivisionSelect.addEventListener('change', (e) => {
      state.subdivision = e.target.value;
      updateSwingVisibility();
      sendStateUpdate();
    });
  }

  // Swing 8th note toggle
  const swingCheckbox = document.getElementById('swing-enabled');
  if (swingCheckbox) {
    swingCheckbox.addEventListener('change', (e) => {
      state.swingEnabled = e.target.checked;
      sendStateUpdate();
    });
  }

  // Animal sound toggle
  const animalSoundCheckbox = document.getElementById('animal-sound-enabled');
  if (animalSoundCheckbox) {
    animalSoundCheckbox.addEventListener('change', (e) => {
      state.animalSoundEnabled = e.target.checked;
      sendStateUpdate();
    });
  }

  // Accent toggle
  if (accentCheckbox) {
    accentCheckbox.addEventListener('change', (e) => {
      state.accentEnabled = e.target.checked;
      sendStateUpdate();
    });
  }

  // Flash toggle
  const flashCheckbox = document.getElementById('flash-enabled');
  if (flashCheckbox) {
    flashCheckbox.addEventListener('change', (e) => {
      state.flashEnabled = e.target.checked;
      sendStateUpdate();
    });
  }

  // Voice count toggle
  const voiceCountCheckbox = document.getElementById('voice-count-enabled');
  if (voiceCountCheckbox) {
    voiceCountCheckbox.addEventListener('change', (e) => {
      state.voiceCountEnabled = e.target.checked;
      sendStateUpdate();
    });
  }


  // Circle color picker
  const circleColorPicker = document.getElementById('circle-color');
  if (circleColorPicker) {
    circleColorPicker.addEventListener('input', (e) => {
      state.circleColor = e.target.value;
      sendStateUpdate();
    });
  }

  // Bluetooth delay slider
  const bluetoothDelaySlider = document.getElementById('bluetooth-delay-slider');
  const bluetoothDelayValue  = document.getElementById('bluetooth-delay-value');
  if (bluetoothDelaySlider) {
    bluetoothDelaySlider.addEventListener('input', (e) => {
      state.bluetoothDelay = parseInt(e.target.value, 10);
      if (bluetoothDelayValue) bluetoothDelayValue.textContent = state.bluetoothDelay;
      sendStateUpdate();
    });
  }

  // Metronome click sound selector
  const metronomeSoundSelect = document.getElementById('metronome-sound-select');
  if (metronomeSoundSelect) {
    metronomeSoundSelect.addEventListener('change', (e) => {
      state.metronomeSound = e.target.value;
    });
  }

  // Spacebar action selector
  const spacebarActionSelect = document.getElementById('spacebar-action-select');
  if (spacebarActionSelect) {
    spacebarActionSelect.addEventListener('change', (e) => {
      state.spacebarAction = e.target.value;
    });
  }
}
// ──────────────────────────────────────────────────────────────────────────

// ── Reset settings button ──────────────────────────────────────────────────
document.getElementById('reset-settings-btn').addEventListener('click', function() {
  // Stop transport first so changes don't jar mid-playback
  if (Tone.Transport.state === 'started') {
    toggleTransport(false);
  }

  // BPM → 96
  applyBPM(96);
  var tempoMarking = document.getElementById('tempo-marking');
  if (tempoMarking) tempoMarking.value = '';

  // Time signature → 4
  state.beatsPerMeasure = 4;
  state.currentBeat = 0;
  var tsSel = document.getElementById('time-signature');
  if (tsSel) tsSel.value = '4';

  // Subdivision → none
  state.subdivision = 'none';
  var subSel = document.getElementById('subdivision');
  if (subSel) subSel.value = 'none';

  // Swing (requires subdivision ÷2 to be active, so clear it)
  state.swingEnabled = false;
  var swingCb = document.getElementById('swing-enabled');
  if (swingCb) swingCb.checked = false;
  var swingGrp = document.getElementById('swing-group');
  if (swingGrp) swingGrp.style.display = 'none';

  // Rock beat → off; show its group since we're back to 4/4
  state.rockBeatEnabled = false;
  var rockCb = document.getElementById('rock-beat-enabled');
  if (rockCb) rockCb.checked = false;
  var rockGroup = document.getElementById('rock-beat-setting-group');
  if (rockGroup) rockGroup.style.display = '';

  // Waltz beat → off; hide its group (not 3/4)
  state.waltzBeatEnabled = false;
  var waltzCb = document.getElementById('waltz-beat-enabled');
  if (waltzCb) waltzCb.checked = false;
  var waltzGroup = document.getElementById('waltz-beat-setting-group');
  if (waltzGroup) waltzGroup.style.display = 'none';

  // Voice count → off
  state.voiceCountEnabled = false;
  var voiceCb = document.getElementById('voice-count-enabled');
  if (voiceCb) voiceCb.checked = false;

  // Two-measure pattern → disabled, restore defaults
  state.twoMeasurePatternEnabled = false;
  state.twoMeasurePattern[0] = { beatsPerMeasure: 4, subdivision: 'none', bpm: 96 };
  state.twoMeasurePattern[1] = { beatsPerMeasure: 3, subdivision: '2',    bpm: 96 };
  state.tmpLinkMode = 'beat';
  state.twoMeasureCurrentMeasure = 0;
  var tmpBtn    = document.getElementById('two-measure-btn');
  var tmpEnabledCb = document.getElementById('tmp-enabled');
  if (tmpBtn)    tmpBtn.classList.remove('ct-active');
  if (tmpEnabledCb) tmpEnabledCb.checked = false;

  // Custom rhythm → off; re-render score so it reverts to default quarter notes
  crCancelCustomRhythm();
  if (state.animalType === 'score') crRenderNotationDisplay();

  // Counting trainer → off
  state.countingTrainerEnabled = false;
  var ctCb  = document.getElementById('ct-enabled');
  var ctBtn = document.getElementById('counting-trainer-btn');
  if (ctCb)  ctCb.checked = false;
  if (ctBtn) ctBtn.classList.remove('ct-active');

  // Spacebar action → default (play/stop)
  state.spacebarAction = 'play';
  var spacebarSel = document.getElementById('spacebar-action-select');
  if (spacebarSel) spacebarSel.value = 'play';

  sendStateUpdate();
});
// ──────────────────────────────────────────────────────────────────────────

