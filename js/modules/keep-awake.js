import { state } from './state.js';
import { screenAwakeStart, screenAwakeStop } from './screen-awake.js';

// Keep the metronome alive on phones (iOS in particular) while it's playing.
//
//  1–2. Screen keep-awake — Wake Lock plus a silent-video fallback, so the
//     screen doesn't dim and lock mid-session (see screen-awake.js).
//  3. Interruption recovery — a call, Siri or an alarm leaves the
//     AudioContext 'interrupted' or 'suspended', and iOS only lets it restart
//     from a tap. We show a "Tap to resume" overlay rather than going silent.
//  4. Audio session — mark our audio as media playback (iOS 17+) so the
//     ring/silent switch doesn't mute the click.

// ── 4. Audio session ─────────────────────────────────────────────────────────
// Must be set before the AudioContext starts producing sound to take effect.
try {
  if (navigator.audioSession) navigator.audioSession.type = 'playback';
} catch (e) {
  console.warn('audioSession type not supported:', e);
}

// Tone.context.resume() is a no-op unless the state is exactly 'suspended',
// so it can't recover from WebKit's 'interrupted' state. Resume the raw
// AudioContext directly.
export function resumeAudio() {
  var raw = Tone.context._context || Tone.context.rawContext;
  if (raw && raw.state !== 'running' && raw.state !== 'closed' && raw.resume) {
    return raw.resume();
  }
  return Promise.resolve();
}

function audioState() {
  var raw = Tone.context._context || Tone.context.rawContext;
  return raw ? raw.state : Tone.context.state;
}

function isPlaying() {
  return Tone.Transport.state === 'started';
}

// Called from toggleTransport so the request happens inside the user's tap.
export function keepAwakeStart() {
  screenAwakeStart();
}

export function keepAwakeStop() {
  screenAwakeStop();
  hideResumeOverlay();
}

// ── 3. Interruption recovery ─────────────────────────────────────────────────
var overlay = null;

function getOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('button');
  overlay.type = 'button';
  overlay.className = 'audio-resume-overlay hidden';
  overlay.innerHTML =
    '<span class="audio-resume-card">' +
      '<span class="audio-resume-title">Sound paused</span>' +
      '<span class="audio-resume-hint">Tap to resume the metronome</span>' +
    '</span>';
  overlay.addEventListener('click', function() {
    resumeAudio().then(function() {
      // Snap the animation clock so it doesn't jump after the gap.
      state.lastBeatTime = Tone.now();
      if (audioState() === 'running') hideResumeOverlay();
    }).catch(function(err) {
      console.warn('Resume after interruption failed:', err);
    });
  });
  document.body.appendChild(overlay);
  return overlay;
}

function showResumeOverlay() {
  getOverlay().classList.remove('hidden');
}

function hideResumeOverlay() {
  if (overlay) overlay.classList.add('hidden');
}

// Show the overlay once audio has been stuck for a moment while playing;
// a short grace period lets automatic resumes succeed without a flash.
var stuckSince = 0;
setInterval(function() {
  if (!isPlaying() || document.hidden) { stuckSince = 0; return; }
  var s = audioState();
  if (s === 'running') {
    stuckSince = 0;
    hideResumeOverlay();
    return;
  }
  if (s === 'interrupted') {
    showResumeOverlay();
    return;
  }
  if (!stuckSince) stuckSince = Date.now();
  else if (Date.now() - stuckSince > 1500) showResumeOverlay();
}, 500);

Tone.context.on('statechange', function() {
  if (audioState() === 'running') hideResumeOverlay();
});
