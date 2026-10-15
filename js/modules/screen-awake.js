// Keep the screen from dimming and auto-locking while the metronome plays.
// Shared by the main app (keep-awake.js) and Kids mode (kids.js), so it has
// no Tone.js or app-state dependencies.
//
//  1. Screen Wake Lock — stops Auto-Lock from dimming and then locking the
//     screen, which would suspend the page and its audio a few minutes into
//     a practice session.
//  2. Silent-video fallback — where Wake Lock is missing or unreliable (iOS
//     before 16.4, home-screen web apps before iOS 18.4) a tiny muted video
//     playing inline keeps the screen awake instead.

var wanted = false; // true while the metronome is playing

// ── 1. Screen Wake Lock ──────────────────────────────────────────────────────
var wakeLock = null;

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
  // Must stay "visible" (in the layout, not display:none) for iOS to play it.
  video.style.cssText =
    'position:fixed;width:1px;height:1px;bottom:0;left:0;opacity:0;pointer-events:none;';
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

// Call from the Play tap so the requests happen inside the user gesture.
export function screenAwakeStart() {
  wanted = true;
  acquire();
}

export function screenAwakeStop() {
  wanted = false;
  releaseWakeLock();
  pauseVideo();
}

// Wake locks and the video are dropped whenever the page is hidden, so take
// them again when the page comes back into view still playing.
document.addEventListener('visibilitychange', function() {
  if (!document.hidden && wanted) acquire();
});
