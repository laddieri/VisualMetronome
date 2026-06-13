import { state } from './state.js';


// Robust AudioContext resume handling
// Browsers require a user gesture to start audio. We listen on multiple event
// types to catch the first interaction reliably across desktop and mobile.
var audioContextResumed = false;

function resumeAudioContext() {
  if (audioContextResumed && Tone.context.state === 'running') return;

  if (Tone.context.state !== 'running') {
    Tone.context.resume().then(function() {
      audioContextResumed = true;
      Tone.Transport.bpm.value = state.cachedBPM || 96;
    }).catch(function(err) {
      console.warn('AudioContext resume failed, will retry on next interaction:', err);
    });
  } else {
    audioContextResumed = true;
  }
}

['mousedown', 'touchstart', 'keydown'].forEach(function(eventType) {
  document.documentElement.addEventListener(eventType, resumeAudioContext, { once: false });
});

// Audio context state monitoring
// Browsers can suspend the AudioContext at any time (e.g., after inactivity,
// power-saving). We periodically check and attempt recovery when the transport
// is supposed to be playing.
setInterval(function() {
  if (Tone.Transport.state === 'started' && Tone.context.state !== 'running') {
    console.warn('AudioContext suspended while playing, attempting resume...');
    Tone.context.resume();
  }
}, 1000);

// Tab visibility handling
// When the tab is backgrounded, browsers throttle timers and may suspend the
// AudioContext. We track this so we can resync animation state when returning.
var wasPlayingBeforeHidden = false;
var tabHiddenTime = 0;

document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    // Tab is going to background
    tabHiddenTime = Date.now();
    wasPlayingBeforeHidden = Tone.Transport.state === 'started';
  } else {
    // Tab is returning to foreground
    var hiddenDuration = Date.now() - tabHiddenTime;

    // Re-resume AudioContext (browsers may suspend it while backgrounded)
    if (Tone.context.state !== 'running') {
      Tone.context.resume();
    }

    // If we were playing and were hidden for more than 500ms, resync the
    // animation by snapping lastBeatTime to now. This prevents a huge
    // timeSinceLastBeat value that would cause animation glitches.
    if (wasPlayingBeforeHidden && hiddenDuration > 500) {
      state.lastBeatTime = Tone.now();
    }
  }
});
