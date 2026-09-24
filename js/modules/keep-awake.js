import { state } from './state.js';

// Keep the metronome alive on phones (iOS in particular) while it's playing.
//
//  1. Screen Wake Lock — stops Auto-Lock from locking the screen, which would
//     suspend the page and its audio a few minutes into a practice session.
//  2. Silent-video fallback — where Wake Lock is missing or unreliable (iOS
//     before 16.4, home-screen web apps before iOS 18.4) a tiny muted video
//     playing inline keeps the screen awake instead.
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

// ── 1. Screen Wake Lock ──────────────────────────────────────────────────────
var wakeLock = null;
var wanted = false; // true while the metronome is playing

function requestWakeLock() {
  if (!('wakeLock' in navigator)) return Promise.reject(new Error('unsupported'));
  if (wakeLock && !wakeLock.released) return Promise.resolve();
  return navigator.wakeLock.request('screen').then(function(lock) {
    // Stopped while the request was in flight — let it go straight away.
    if (!wanted) { lock.release(); return; }
    wakeLock = lock;
    lock.addEventListener('release', function() {
      if (wakeLock === lock) wakeLock = null;
    });
  });
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(function() {});
    wakeLock = null;
  }
}

// ── 2. Silent-video fallback ─────────────────────────────────────────────────
// Home-screen web apps on iOS expose navigator.wakeLock before it actually
// works there (fixed in iOS 18.4), so run the video alongside it in that case.
// assets/keep-awake.mp4 is the blank clip from NoSleep.js (MIT, Rich Tibbett).
var isIOSStandalone = window.navigator.standalone === true;
var video = null;

function getVideo() {
  if (video) return video;
  video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.setAttribute('aria-hidden', 'true');
  video.muted = true;
  video.src = './assets/keep-awake.mp4';
  video.className = 'keep-awake-video';
  // The clip is a few seconds long; jumping back before it ends keeps it
  // playing without the gap a loop restart can leave (as NoSleep.js does).
  video.addEventListener('timeupdate', function() {
    if (video.currentTime > 0.5) video.currentTime = Math.random();
  });
  document.body.appendChild(video);
  return video;
}

function playVideo() {
  var v = getVideo();
  var p = v.play();
  if (p && p.catch) p.catch(function(err) { console.warn('Keep-awake video failed:', err); });
}

function pauseVideo() {
  if (video) video.pause();
}

function acquire() {
  requestWakeLock().catch(function() {
    if (wanted) playVideo();
  });
  if (isIOSStandalone || !('wakeLock' in navigator)) playVideo();
}

// Called from toggleTransport so the request happens inside the user's tap.
export function keepAwakeStart() {
  wanted = true;
  acquire();
}

export function keepAwakeStop() {
  wanted = false;
  releaseWakeLock();
  pauseVideo();
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

// Wake locks and the video are dropped whenever the page is hidden, so take
// them again when the metronome comes back into view still playing.
document.addEventListener('visibilitychange', function() {
  if (!document.hidden && wanted && isPlaying()) acquire();
});
