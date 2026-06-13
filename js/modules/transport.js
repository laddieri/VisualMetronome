import { state } from './state.js';
import { crmBeginMonitoring, crmClearFeedbackMarkers, crmEndMonitoring, crmShowFeedback } from './check-rhythm.js';
import { hideCtDisplay, showCtDoneFeedback, updateCtDisplay, updateCtDisplayWith } from './counting-trainer.js';
import { triggerCustomRhythmBeat } from './custom-rhythm.js';
import { sendStateUpdate } from './remote.js';
import { windowResized } from './sketch.js';
import { applySongSectionUI, hideSongProgressDisplay, updateSongProgressDisplay } from './songs.js';
import { triggerRockBeat, triggerSound, triggerWaltzBeat } from './sounds.js';
import { tmpCalcM2BPM } from './two-measure.js';
import { speakBeatNumber, speakWord } from './voice.js';

var countInBeatsRemaining = 0; // Counts down during the count-in phase
var countInMeasures = 0;       // How many count-in measures were requested (1 or 2)

// Subdivision event IDs (to cancel when settings change)
var subdivisionEvents = [];

// Schedule main beat sound
function scheduleMainBeat() {
  Tone.Transport.scheduleRepeat(function(time) {
    // ── Count-in phase ──────────────────────────────────────────────────────
    if (countInBeatsRemaining > 0) {
      const totalCountIn = countInMeasures * state.beatsPerMeasure;
      const beatIndex = totalCountIn - countInBeatsRemaining; // 0-based position in count-in
      const isCountInAccent = beatIndex % state.beatsPerMeasure === 0;

      // Simple click for every count-in beat
      state.accentSynth.triggerAttackRelease(isCountInAccent ? "G5" : "A4", "16n", time);

      // Voice cues during count-in (pass audio time for precise scheduling)
      if (countInBeatsRemaining === 2) {
        speakWord("ready", time);
      } else if (countInBeatsRemaining === 1) {
        speakWord("go", time);
        // Trigger the conductor's big upswing so the baton rises on "go"
        // and can come straight down on beat 1 of the real metronome.
        // animBeat=0 makes lastFiredBeatIndex = n-1 (last waypoint), which
        // selects the 140px bounce amplitude used between the final beat and beat 1.
        Tone.Draw.schedule(function() {
          state.t = 0;
          state.lastBeatTime = Tone.now();
          state.animBeat = 0;
        }, time);
      } else if (state.beatsPerMeasure === 4 && beatIndex < state.beatsPerMeasure && countInMeasures >= 2) {
        // 4/4 first count-in measure of a 2-bar count-in: speak only on beats 1 & 3 ("one", "two"),
        // leave beats 2 & 4 silent so the pattern is "one – two – | one two ready go".
        if (beatIndex % 2 === 0) {
          speakWord(String(beatIndex / 2 + 1), time); // beatIndex 0→"1", 2→"2"
        }
      } else {
        speakWord(String((beatIndex % state.beatsPerMeasure) + 1), time);
      }

      countInBeatsRemaining--;

      // ── Counting Trainer: transition to silent counting when count-in ends ──
      if (countInBeatsRemaining === 0 && state.countingTrainerEnabled && state.ctPhase === 'idle') {
        state.ctPhase = 'counting';
        // +1 so the "done" chime lands one beat AFTER the last counted beat
        // (e.g. 1 measure in 4/4 → student counts beats 1-2-3-4, done on next beat 1)
        state.ctBeatsRemaining = state.ctTargetMeasures * state.beatsPerMeasure + state.ctTargetExtraBeats + 1;
        state.ctMeasuresCompleted = 0;
        state.ctCurrentBeatInMeasure = 0;
        Tone.Draw.schedule(function() {
          updateCtDisplay();
        }, time);
      }

      return; // Skip normal beat processing during count-in
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Practice Rhythm: track measure boundaries ──────────────────────────
    if (state.currentBeat === 0 && state.practiceRhythmEnabled) {
      state.practiceRhythmMeasureIdx++;

      // Check My Rhythm: stop after silent measure ends (would-be idx 2)
      if (state.checkMyRhythmEnabled && state.practiceRhythmMeasureIdx === 2) {
        const _t2 = time;
        Tone.Draw.schedule(function() {
          crmEndMonitoring();
          try { crmShowFeedback(); } catch(e) { console.warn('CRM feedback error', e); }
          toggleTransport(false);
        }, _t2);
        state.currentBeat = (state.currentBeat + 1) % state.beatsPerMeasure;
        return;
      }

      const _prSilent = state.practiceRhythmMeasureIdx % 2 === 1;
      const _prColor  = _prSilent ? '#3a5c2a' : (window.vmCanvasBg || '#e2e8f0');

      // Check My Rhythm: begin mic monitoring when the silent measure starts
      if (state.checkMyRhythmEnabled && _prSilent && state.crmMicStream) {
        const _silentT    = time;
        const _beatDurS   = Tone.Time("4n").toSeconds();
        const _silentEndT = _silentT + state.beatsPerMeasure * _beatDurS;
        Tone.Draw.schedule(function() {
          crmBeginMonitoring(_silentT, _silentEndT);
        }, _silentT);
      }

      Tone.Draw.schedule(function() {
        document.querySelectorAll('.nd-bg-rect').forEach(function(r) { r.setAttribute('fill', _prColor); });
        var prRow = document.getElementById('practice-rhythm-row');
        if (prRow) prRow.className = 'practice-rhythm-row' + (_prSilent ? ' your-turn' : '');
      }, time);
    } else if (state.currentBeat === 0 && !state.practiceRhythmEnabled && state.practiceRhythmMeasureIdx !== -1) {
      // Feature was just disabled mid-session — reset colour
      state.practiceRhythmMeasureIdx = -1;
      Tone.Draw.schedule(function() {
        document.querySelectorAll('.nd-bg-rect').forEach(function(r) { r.setAttribute('fill', window.vmCanvasBg || '#e2e8f0'); });
        var prRow = document.getElementById('practice-rhythm-row');
        if (prRow) prRow.className = 'practice-rhythm-row';
      }, time);
    }
    // ──────────────────────────────────────────────────────────────────────────

    // ── Two-measure pattern: apply measure settings at start of each measure ─
    if (state.twoMeasurePatternEnabled && !state.songModeEnabled && state.currentBeat === 0) {
      var mpCfg = state.twoMeasurePattern[state.twoMeasureCurrentMeasure];
      state.beatsPerMeasure = mpCfg.beatsPerMeasure;
      state.subdivision = mpCfg.subdivision;
      Tone.Transport.bpm.value = mpCfg.bpm;
    }
    // ──────────────────────────────────────────────────────────────────────────

    // ── Song mode: check for section transition BEFORE playing the beat ────
    if (state.songModeEnabled && state.songCurrentSection >= 0 && state.songCurrentSection < state.songSections.length) {
      var curSec = state.songSections[state.songCurrentSection];
      // After the post-beat tracker ran last time, songMeasureInSection may
      // have reached curSec.measures — meaning the section is done and we
      // need to advance before playing this beat.
      if (state.songMeasureInSection >= curSec.measures) {
        state.songCurrentSection++;
        state.songMeasureInSection = 0;
        state.songBeatInMeasure = 0;
        if (state.songCurrentSection < state.songSections.length) {
          var next = state.songSections[state.songCurrentSection];
          state.beatsPerMeasure = next.beatsPerMeasure;
          state.currentBeat = 0;
          // Snap to the exact target BPM — the end-of-section ramp (below)
          // should have already brought us here; this ensures precision.
          Tone.Transport.bpm.setValueAtTime(next.bpm, time);
          state.cachedBPM = next.bpm;
          state.secondsPerBeat = 1 / (next.bpm / 60);
          Tone.Draw.schedule(function() {
            applySongSectionUI(next);
            updateSongProgressDisplay();
          }, time);
        } else {
          // Song finished — stop
          Tone.Draw.schedule(function() {
            toggleTransport(false);
            updateSongProgressDisplay();
          }, time);
          return; // Don't play a beat after song ends
        }
      } else {
        // Still within the current section — check for ritardando and/or
        // a transition ramp toward the next section's BPM.
        var totalBeatsInSection = curSec.measures * curSec.beatsPerMeasure;
        var currentBeatIndex = state.songMeasureInSection * curSec.beatsPerMeasure + state.songBeatInMeasure;
        var beatsRemaining = totalBeatsInSection - currentBeatIndex; // incl. this beat

        // ── Ritardando: smooth slowdown at the end of this section ──────────
        var ritardandoApplied = false;
        if (curSec.ritardandoEnabled && (curSec.ritardandoBeats || 0) > 0) {
          var ritUnit = curSec.ritardandoUnit || 'beats';
          var totalRitBeats = (ritUnit === 'measures')
            ? curSec.ritardandoBeats * curSec.beatsPerMeasure
            : curSec.ritardandoBeats;
          // Never let the ritardando be longer than the section itself
          totalRitBeats = Math.min(totalRitBeats, totalBeatsInSection);
          if (beatsRemaining <= totalRitBeats) {
            var beatsIntoRit = totalRitBeats - beatsRemaining; // 0-indexed step
            // Target BPM = section BPM reduced by ritardandoPercent
            var ritTargetBPM = curSec.bpm * (1 - (curSec.ritardandoPercent || 30) / 100);
            ritTargetBPM = Math.max(30, ritTargetBPM);
            var ritBPM = curSec.bpm + (ritTargetBPM - curSec.bpm) * (beatsIntoRit + 1) / totalRitBeats;
            ritBPM = Math.max(30, Math.min(300, ritBPM));
            Tone.Transport.bpm.setValueAtTime(ritBPM, time);
            // Do NOT update cachedBPM here — same reason as for transition ramp;
            // Tone.Draw.schedule updates it atomically with lastBeatTime.
            ritardandoApplied = true;
          }
        }

        // ── Transition ramp: only when no ritardando is active ──────────────
        if (!ritardandoApplied) {
          var nextSec = state.songSections[state.songCurrentSection + 1];
          if (nextSec) {
            var transCount = nextSec.transitionBeats || 0;
            if (transCount > 0 && nextSec.bpm !== curSec.bpm) {
              var transUnit = nextSec.transitionUnit || 'beats';
              var totalTransBeats = (transUnit === 'measures')
                ? transCount * nextSec.beatsPerMeasure
                : transCount;
              // Never let the ramp be longer than the section itself
              totalTransBeats = Math.min(totalTransBeats, totalBeatsInSection);
              if (beatsRemaining <= totalTransBeats) {
                // This beat falls inside the ramp window — interpolate BPM
                var beatsIntoRamp = totalTransBeats - beatsRemaining; // 0-indexed step
                var rampBPM = curSec.bpm +
                  (nextSec.bpm - curSec.bpm) * (beatsIntoRamp + 1) / totalTransBeats;
                rampBPM = Math.max(30, Math.min(300, rampBPM));
                Tone.Transport.bpm.setValueAtTime(rampBPM, time);
                // Do NOT update cachedBPM here: the scheduler fires look-ahead
                // (~100ms early) so updating cachedBPM now changes beatDuration
                // while lastBeatTime still belongs to the previous beat.  When
                // slowing down this makes progress jump backward, causing a
                // visible stutter.  Tone.Draw.schedule updates cachedBPM
                // atomically with lastBeatTime at the correct moment.
              }
            }
          }
        }
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    // ── Counting Trainer: counting phase ────────────────────────────────────
    if (state.ctPhase === 'counting') {
      // Play sound if user opted to keep it on
      if (state.ctSoundOn) {
        if (state.rockBeatEnabled && state.beatsPerMeasure === 4) {
          triggerRockBeat(time, state.currentBeat);
        } else if (state.waltzBeatEnabled && state.beatsPerMeasure === 3) {
          triggerWaltzBeat(time, state.currentBeat);
        } else {
          var isAccentCt = state.currentBeat === 0;
          triggerSound(time, isAccentCt);
          scheduleSubdivisionsForBeat(time);
        }
        speakBeatNumber(state.currentBeat + 1, time);
      }
      state.ctBeatsRemaining--;

      // Capture current measure/beat for display BEFORE incrementing
      var ctBeatForDisplay = state.ctCurrentBeatInMeasure;
      var ctMeasureForDisplay = state.ctMeasuresCompleted;

      // Advance the counters
      state.ctCurrentBeatInMeasure++;
      if (state.ctCurrentBeatInMeasure >= state.beatsPerMeasure) {
        state.ctCurrentBeatInMeasure = 0;
        state.ctMeasuresCompleted++;
      }

      if (state.ctBeatsRemaining <= 0) {
        // Target reached — trigger "done" feedback
        state.ctPhase = 'done';
        state.ctDoneTime = Tone.now();
        // Play a distinctive "done" sound: two quick rising tones
        state.accentSynth.triggerAttackRelease("C6", "16n", time);
        state.accentSynth.triggerAttackRelease("E6", "16n", time + 0.12);

        Tone.Draw.schedule(function() {
          showCtDoneFeedback();
        }, time);

        // Auto-stop after 2 beats so the student hears the confirmation
        var autoStopDelay = (60 / Tone.Transport.bpm.value) * 2;
        Tone.Transport.schedule(function() {
          if (state.ctPhase === 'done') {
            toggleTransport(false);
          }
        }, '+' + autoStopDelay);
      } else {
        // Use captured values so the display shows the beat that just fired,
        // not the already-incremented next beat
        var totalTarget = state.ctTargetMeasures * state.beatsPerMeasure + state.ctTargetExtraBeats;
        // ctBeatsRemaining includes the +1 landing beat, so subtract 1 for display
        var elapsed = totalTarget - (state.ctBeatsRemaining - 1);
        Tone.Draw.schedule(function() {
          updateCtDisplayWith(ctMeasureForDisplay + 1, ctBeatForDisplay + 1, elapsed, totalTarget);
        }, time);
      }

      // Continue with animation sync (fall through to Draw schedule below)
    } else if (state.ctPhase !== 'done') {
      // ── Normal sound playback (not in counting trainer) ──────────────────
      const _prIsSilent = state.practiceRhythmEnabled && state.practiceRhythmMeasureIdx % 2 === 1;
      if (!_prIsSilent) {
        // Custom rhythm mode: play the user-defined pattern
        if (state.customRhythmEnabled && state.customRhythmPattern.length > 0) {
          triggerCustomRhythmBeat(time, state.currentBeat);
        // Drum machine modes: play drum pattern instead of normal click sounds
        } else if (state.rockBeatEnabled && state.beatsPerMeasure === 4) {
          triggerRockBeat(time, state.currentBeat);
        } else if (state.waltzBeatEnabled && state.beatsPerMeasure === 3) {
          triggerWaltzBeat(time, state.currentBeat);
        } else {
          // Determine if this is beat 1 (accented)
          const isAccent = state.currentBeat === 0;
          triggerSound(time, isAccent);

          // Schedule subdivisions for this beat
          scheduleSubdivisionsForBeat(time);
        }

        // Store beat number before it gets incremented
        const beatToSpeak = state.currentBeat + 1; // 1-indexed for speaking

        // Schedule speech with precise look-ahead compensation so it lands on the beat
        speakBeatNumber(beatToSpeak, time);
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    // Capture beat index before incrementing so Draw callback can use it
    const thisBeat = state.currentBeat;

    // Compute ramp/ritardando fraction for this beat so the Draw callback can
    // expose it to the animation loop for the background tint.
    var thisRampProgress = 0;
    var thisRitardandoProgress = 0;
    if (state.songModeEnabled && state.songCurrentSection >= 0) {
      var _curSec  = state.songSections[state.songCurrentSection];
      if (_curSec) {
        var _totalBeats = _curSec.measures * _curSec.beatsPerMeasure;
        var _beatIdx = state.songMeasureInSection * _curSec.beatsPerMeasure + state.songBeatInMeasure;
        var _remaining = _totalBeats - _beatIdx;

        // Ritardando progress (takes priority over transition ramp for tint)
        if (_curSec.ritardandoEnabled && (_curSec.ritardandoBeats || 0) > 0) {
          var _ritUnit = _curSec.ritardandoUnit || 'beats';
          var _totalRit = (_ritUnit === 'measures')
            ? _curSec.ritardandoBeats * _curSec.beatsPerMeasure
            : _curSec.ritardandoBeats;
          _totalRit = Math.min(_totalRit, _totalBeats);
          if (_remaining <= _totalRit) {
            thisRitardandoProgress = (_totalRit - _remaining + 1) / _totalRit;
          }
        }

        // Transition ramp progress (only when not in ritardando)
        if (thisRitardandoProgress === 0) {
          var _nextSec = state.songSections[state.songCurrentSection + 1];
          if (_nextSec) {
            var _transCount = _nextSec.transitionBeats || 0;
            if (_transCount > 0 && _nextSec.bpm !== _curSec.bpm) {
              var _unit = _nextSec.transitionUnit || 'beats';
              var _totalTrans = (_unit === 'measures')
                ? _transCount * _nextSec.beatsPerMeasure
                : _transCount;
              _totalTrans = Math.min(_totalTrans, _totalBeats);
              if (_remaining <= _totalTrans) {
                thisRampProgress = (_totalTrans - _remaining + 1) / _totalTrans;
              }
            }
          }
        }
      }
    }

    // Reset animation timer to sync with beat
    Tone.Draw.schedule(function(){
      state.t = 0;
      // Record when this beat fired for animation sync
      state.lastBeatTime = Tone.now();
      // Advance animBeat here so it changes atomically with lastBeatTime,
      // preventing the conductor hand from jumping when progress resets to 0.
      state.animBeat = (thisBeat + 1) % state.beatsPerMeasure;
      // Update secondsPerBeat every beat for accurate animation timing.
      // Only update cachedBPM when TMP is not active — while TMP cycles between
      // M1 and M2, the transport BPM alternates and must not overwrite the
      // user-facing main (M1) tempo stored in cachedBPM.
      const currentBPM = Tone.Transport.bpm.value;
      state.secondsPerBeat = 1 / (currentBPM / 60);
      if (!state.twoMeasurePatternEnabled && state.cachedBPM !== currentBPM) {
        state.cachedBPM = currentBPM;
      }
      state.rampProgress = thisRampProgress;
      state.ritardandoProgress = thisRitardandoProgress;
    }, time);

    // Advance beat counter
    state.currentBeat = (state.currentBeat + 1) % state.beatsPerMeasure;

    // ── Two-measure pattern: advance to next measure when this one wraps ──
    if (state.twoMeasurePatternEnabled && !state.songModeEnabled && state.currentBeat === 0) {
      state.twoMeasureCurrentMeasure = (state.twoMeasureCurrentMeasure + 1) % 2;
    }
    // ──────────────────────────────────────────────────────────────────────

    // ── Song mode: advance measure/beat tracking after playing ────────────
    if (state.songModeEnabled && state.songCurrentSection >= 0 && state.songCurrentSection < state.songSections.length) {
      state.songBeatInMeasure++;
      if (state.songBeatInMeasure >= state.beatsPerMeasure) {
        state.songBeatInMeasure = 0;
        state.songMeasureInSection++;
        // Check if we've reached the end of this section — the pre-beat
        // check at the top of the next callback will handle the transition.
      }
      Tone.Draw.schedule(function() {
        updateSongProgressDisplay();
      }, time);
    }
    // ──────────────────────────────────────────────────────────────────────
  }, "4n");
}

// Schedule subdivisions for a single beat.
// `subdivision` is a numeric string '2'–'7': the beat is divided into that many equal parts.
// Swing only applies when subdivision === '2' (shifts the single midpoint click to 2/3).
function scheduleSubdivisionsForBeat(beatTime) {
  var n = parseInt(state.subdivision);
  if (!n || n < 2) return;

  var beatDuration = Tone.Time("4n").toSeconds();
  for (var i = 1; i < n; i++) {
    var offset = (n === 2 && state.swingEnabled && i === 1)
      ? (beatDuration * 2) / 3   // Swing: 66.7% instead of 50%
      : beatDuration * i / n;
    state.subdivisionSynth.triggerAttackRelease("C5", "32n", beatTime + offset);
  }
}

// Initialize the main beat schedule
scheduleMainBeat();


//start/stop the transport
const _playToggleEl      = document.querySelector('tone-play-toggle');
const _countIn1Btn       = document.getElementById('count-in-1-play-btn');
const _countInBtn        = document.getElementById('count-in-play-btn');
const _stopBtn           = document.getElementById('stop-btn');
const _playBtnsContainer = document.getElementById('play-buttons-container');

// Show/hide the combined stop button vs. the two individual play buttons.
// The play-buttons-container uses visibility (not display) so it always
// holds its layout space, preventing the tempo slider from shifting.
function _updatePlayStopUI(playing) {
  if (playing) {
    _playBtnsContainer.style.visibility = 'hidden';
    _playBtnsContainer.style.pointerEvents = 'none';
    _stopBtn.classList.remove('hidden');
  } else {
    _playBtnsContainer.style.visibility = '';
    _playBtnsContainer.style.pointerEvents = '';
    _stopBtn.classList.add('hidden');
  }
}

// tone-play-toggle fires 'change' whenever its 'playing' property changes,
// including when set programmatically. Use this flag to ignore those synthetic
// events so we don't double-call toggleTransport.
let _bypassPlayToggle = false;

function _setPlayTogglePlaying(val) {
  _bypassPlayToggle = true;
  _playToggleEl.playing = val;
  // LitElement dispatches 'change' asynchronously via updated(); clear the
  // flag after a microtask flush so the event is absorbed before we reset.
  Promise.resolve().then(() => { _bypassPlayToggle = false; });
}

export function _ensureAudioContext(fn) {
  if (Tone.context.state !== 'running') {
    Tone.context.resume().then(fn);
  } else {
    fn();
  }
}

// Normal play button: start without count-in
_playToggleEl.addEventListener('change', () => {
  if (_bypassPlayToggle) return;
  _ensureAudioContext(() => toggleTransport(false));
});

// +1 button: start with 1-measure count-in
_countIn1Btn.addEventListener('click', () => {
  _ensureAudioContext(() => toggleTransport(1));
});

// +2 button: start with 2-measure count-in
_countInBtn.addEventListener('click', () => {
  _ensureAudioContext(() => toggleTransport(2));
});

// Stop button: stop the metronome and restore the two play buttons
_stopBtn.addEventListener('click', () => {
  toggleTransport(false);
});

// Spacebar starts/stops the metronome on desktop, unless focus is in a
// text field, button, or other element where space has its own meaning.
document.addEventListener('keydown', function(e) {
  if (e.key !== ' ') return;
  var tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
  if (document.activeElement && document.activeElement.isContentEditable) return;
  e.preventDefault(); // stop page scroll
  var withCountIn = state.spacebarAction === 'count-in-1' ? 1
                  : state.spacebarAction === 'count-in-2' ? 2
                  : false;
  _ensureAudioContext(() => toggleTransport(withCountIn));
});

// Animation size slider — scales the animation area up/down; controls scale inversely.
// Only shown on desktop (≥768px); slider value 1–9 maps to factor 0.75–1.25.
export function _syncAnimSize() {
  var slider = document.getElementById('anim-size-slider');
  if (!slider) return;
  var val = parseInt(slider.value, 10);
  // Two-segment mapping keeps val=5 as exactly 1.0:
  //   lower half (1–5): 0.75 → 1.0  (step 0.0625)
  //   upper half (5–9): 1.0  → 1.75 (step 0.1875)
  var f;
  if (val <= 5) {
    f = 0.75 + (val - 1) * 0.0625;
  } else {
    f = 1.0 + (val - 5) * 0.1875;
  }
  var ctrlF = Math.max(0.7, Math.min(1.125, 1.0 + (1.0 - f) * 0.5));

  var controls = document.querySelector('.controls');
  if (controls) controls.style.zoom = ctrlF;

  var ndw = document.getElementById('notation-display-wrapper');
  if (state.animalType === 'score') {
    if (ndw) {
      ndw.style.transform = 'scale(' + f.toFixed(4) + ')';
      ndw.style.transformOrigin = 'top center';
      ndw.style.marginBottom = Math.round((f - 1) * ndw.offsetHeight) + 'px';
    }
  } else {
    if (ndw) { ndw.style.transform = ''; ndw.style.marginBottom = ''; }
    requestAnimationFrame(function() { windowResized(); });
  }
}

export function toggleTransport(withCountIn) {
  if (Tone.Transport.state === 'started') {
    // Stopping: reset state for clean restart
    Tone.Transport.stop();
    state.currentBeat = 0;
    state.lastBeatTime = 0;
    state.animBeat = 0;
    countInBeatsRemaining = 0;
    countInMeasures = 0;
    // Reset counting trainer state
    state.ctPhase = 'idle';
    state.ctBeatsRemaining = 0;
    state.ctMeasuresCompleted = 0;
    state.ctCurrentBeatInMeasure = 0;
    hideCtDisplay();
    // Reset song mode state
    state.songCurrentSection = -1;
    state.songMeasureInSection = 0;
    state.songBeatInMeasure = 0;
    hideSongProgressDisplay();
    // Reset two-measure pattern state
    state.twoMeasureCurrentMeasure = 0;
    state.practiceRhythmMeasureIdx = -1;
    if (state.checkMyRhythmEnabled) crmEndMonitoring();
    _countIn1Btn.classList.remove('active');
    _countInBtn.classList.remove('active');
    _setPlayTogglePlaying(false);
    _updatePlayStopUI(false);
  } else {
    // Starting: reset beat counter and start fresh
    state.currentBeat = 0;
    state.lastBeatTime = 0;
    state.animBeat = 0;
    crmClearFeedbackMarkers();
    // Reset counting trainer for fresh start
    state.ctPhase = 'idle';
    state.ctBeatsRemaining = 0;
    state.ctMeasuresCompleted = 0;
    state.ctCurrentBeatInMeasure = 0;
    hideCtDisplay();
    // Initialize song mode if enabled and has sections
    if (state.songModeEnabled && state.songSections.length > 0) {
      state.songCurrentSection = 0;
      state.songMeasureInSection = 0;
      state.songBeatInMeasure = 0;
      var firstSec = state.songSections[0];
      state.beatsPerMeasure = firstSec.beatsPerMeasure;
      state.currentBeat = 0;
      Tone.Transport.bpm.value = firstSec.bpm;
      state.cachedBPM = firstSec.bpm;
      state.secondsPerBeat = 1 / (firstSec.bpm / 60);
      applySongSectionUI(firstSec);
      updateSongProgressDisplay();
    } else {
      state.songCurrentSection = -1;
      state.songMeasureInSection = 0;
      state.songBeatInMeasure = 0;
      hideSongProgressDisplay();
    }
    // Reset two-measure pattern to start from measure 1
    state.twoMeasureCurrentMeasure = 0;
    state.practiceRhythmMeasureIdx = -1;
    // If two-measure mode is active, apply measure 1 settings immediately
    if (state.twoMeasurePatternEnabled && !state.songModeEnabled) {
      state.twoMeasurePattern[0].bpm = state.cachedBPM;
      state.twoMeasurePattern[1].bpm = tmpCalcM2BPM();
      state.beatsPerMeasure = state.twoMeasurePattern[0].beatsPerMeasure;
      state.subdivision = state.twoMeasurePattern[0].subdivision;
      // Explicitly reset transport to M1 BPM — a previous session may have left
      // it at M2's BPM, which would make the count-in play at the wrong speed.
      Tone.Transport.bpm.value = state.cachedBPM;
      state.secondsPerBeat = 1 / (state.cachedBPM / 60);
    }
    // withCountIn: false/0 = no count-in, 1 = 1-bar, 2/true = 2-bar
    countInMeasures = withCountIn ? (withCountIn === 1 ? 1 : 2) : 0;
    countInBeatsRemaining = countInMeasures * state.beatsPerMeasure;
    // If counting trainer is enabled and there's no count-in, start
    // the silent counting phase immediately
    if (state.countingTrainerEnabled && !withCountIn) {
      state.ctPhase = 'counting';
      // +1 so the "done" chime lands one beat AFTER the last counted beat
      state.ctBeatsRemaining = state.ctTargetMeasures * state.beatsPerMeasure + state.ctTargetExtraBeats + 1;
      updateCtDisplay();
    }
    Tone.Transport.start();
    // Always sync the play-toggle visual — needed when called from remote
    // (clicking tone-play-toggle directly already updates it before firing 'change',
    // so setting .playing = true again is a safe no-op in that path).
    _setPlayTogglePlaying(true);
    if (countInMeasures === 1) {
      _countIn1Btn.classList.add('active');
    } else if (countInMeasures === 2) {
      _countInBtn.classList.add('active');
    }
    _updatePlayStopUI(true);
  }
  sendStateUpdate();
}
