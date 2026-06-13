import { state } from './state.js';
import { sendStateUpdate } from './remote.js';
import { applyBPM } from './tempo.js';
import { _syncNotationDisplay } from './view-sync.js';


// Calculate responsive canvas size
// Canvas fills available space while maintaining 4:3 aspect ratio
export function getCanvasSize() {
  const wrapper = document.querySelector('.canvas-wrapper');
  if (!wrapper) return { width: 640, height: 480, scale: 1 };

  const maxWidth = wrapper.clientWidth - 32; // Account for padding
  const maxHeight = wrapper.clientHeight - 32; // Account for padding
  const baseWidth = 640;
  const baseHeight = 480;
  const aspectRatio = baseWidth / baseHeight;

  // Start with max available width
  let newWidth = maxWidth;
  let newHeight = newWidth / aspectRatio;

  // If height is constrained, scale down based on height
  if (newHeight > maxHeight && maxHeight > 0) {
    newHeight = maxHeight;
    newWidth = newHeight * aspectRatio;
  }

  // Ensure minimum size for very small screens
  if (newWidth < 200) {
    newWidth = 200;
    newHeight = newWidth / aspectRatio;
  }

  return {
    width: Math.floor(newWidth),
    height: Math.floor(newHeight),
    scale: newWidth / baseWidth
  };
}

// Calculate canvas size for fullscreen mode
export function getFullscreenCanvasSize() {
  const wrapper = document.querySelector('.fullscreen-canvas-wrapper');
  if (!wrapper) return getCanvasSize();

  const maxWidth = wrapper.clientWidth - 40;
  const maxHeight = wrapper.clientHeight - 40;
  const baseWidth = 640;
  const baseHeight = 480;
  const aspectRatio = baseWidth / baseHeight;

  let newWidth = maxWidth;
  let newHeight = newWidth / aspectRatio;

  if (newHeight > maxHeight && maxHeight > 0) {
    newHeight = maxHeight;
    newWidth = newHeight * aspectRatio;
  }

  return {
    width: Math.floor(newWidth),
    height: Math.floor(newHeight),
    scale: newWidth / baseWidth
  };
}

// Store reference to main toggle's original parent and next sibling
var mainToggleParent = null;
var mainToggleNextSibling = null;

// Enter fullscreen mode
export function enterFullscreen() {
  state.isFullscreen = true;
  const overlay = document.getElementById('fullscreen-overlay');
  const canvas = document.querySelector('.canvas-wrapper canvas');
  const fullscreenWrapper = document.querySelector('.fullscreen-canvas-wrapper');
  const playButtonGroup = document.querySelector('.play-button-group');
  const togglePlaceholder = document.getElementById('fullscreen-toggle-placeholder');

  // Move canvas to fullscreen wrapper
  if (canvas && fullscreenWrapper) {
    fullscreenWrapper.appendChild(canvas);
  }

  // Sync notation display so score mode works in fullscreen
  _syncNotationDisplay();

  // Move entire play button group (both play buttons + stop button) to fullscreen controls
  if (playButtonGroup && togglePlaceholder) {
    mainToggleParent = playButtonGroup.parentElement;
    mainToggleNextSibling = playButtonGroup.nextSibling;
    togglePlaceholder.appendChild(playButtonGroup);
  }

  // Show overlay
  overlay.classList.remove('hidden');

  // Sync fullscreen tempo controls with current BPM
  var bpm = Math.round(Tone.Transport.bpm.value);
  var fullscreenSlider = document.getElementById('fullscreen-tempo-slider');
  var fsBpmVal = document.getElementById('fullscreen-bpm-value');
  if (fullscreenSlider) fullscreenSlider.value = bpm;
  if (fsBpmVal) fsBpmVal.textContent = bpm;

  // Resize canvas for fullscreen
  setTimeout(() => {
    const size = getFullscreenCanvasSize();
    state.canvasWidth = size.width;
    state.canvasHeight = size.height;
    state.canvasScale = size.scale;
    resizeCanvas(state.canvasWidth, state.canvasHeight);
  }, 50);

  sendStateUpdate();
}

// Exit fullscreen mode
export function exitFullscreen() {
  state.isFullscreen = false;
  const overlay = document.getElementById('fullscreen-overlay');
  const canvas = document.querySelector('.fullscreen-canvas-wrapper canvas');
  const normalWrapper = document.querySelector('.canvas-wrapper');
  const playButtonGroup = document.querySelector('#fullscreen-toggle-placeholder .play-button-group');

  // Move canvas back to normal wrapper
  if (canvas && normalWrapper) {
    normalWrapper.appendChild(canvas);
  }

  // Sync notation display back to normal mode
  _syncNotationDisplay();

  // Move play button group back to main controls in its original position
  if (playButtonGroup && mainToggleParent) {
    mainToggleParent.insertBefore(playButtonGroup, mainToggleNextSibling);
  }

  // Hide overlay
  overlay.classList.add('hidden');

  // Sync main controls with current BPM
  applyBPM(Math.round(Tone.Transport.bpm.value));

  // Resize canvas for normal mode
  setTimeout(() => {
    const size = getCanvasSize();
    state.canvasWidth = size.width;
    state.canvasHeight = size.height;
    state.canvasScale = size.scale;
    resizeCanvas(state.canvasWidth, state.canvasHeight);
  }, 50);

  sendStateUpdate();
}

// Initialize fullscreen listeners
export function initFullscreenListeners() {
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const exitBtn = document.getElementById('fullscreen-exit-btn');
  const fullscreenSlider = document.getElementById('fullscreen-tempo-slider');

  // Enter fullscreen
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', enterFullscreen);
  }

  // Exit fullscreen
  if (exitBtn) {
    exitBtn.addEventListener('click', exitFullscreen);
  }

  // Fullscreen tempo slider
  if (fullscreenSlider) {
    fullscreenSlider.addEventListener('input', function(e) {
      applyBPM(parseInt(e.target.value));
    });
  }

  // ESC key to exit fullscreen
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.isFullscreen) {
      exitFullscreen();
    }
  });
}

// Smoothed animation progress for fluid motion
var smoothedProgress = 0;
var lastFrameTime = 0;

// Calculate animation position based on time since last beat fired
// This stays in sync even when BPM changes mid-playback
export function getAnimationProgress() {
  if (Tone.Transport.state !== 'started') {
    return 0; // At center when stopped
  }

  // Guard against uninitialized lastBeatTime (first beat hasn't fired yet)
  if (state.lastBeatTime <= 0) {
    return 0;
  }

  const now = Tone.now();
  // Use secondsPerBeat (set atomically with lastBeatTime in Tone.Draw.schedule)
  // so the beat duration matches the BPM that was active when the last beat
  // fired.  Using the live transport BPM during a tempo ramp or TMP M2 cycle
  // causes a mismatch that makes progress jump, especially in the Bluetooth
  // delay window.
  const beatDuration = state.secondsPerBeat || (60 / (Tone.Transport.bpm.value || 96));
  // bluetoothDelay is in ms; subtract it so the animation reaches the beat
  // position exactly when the sound arrives at the speaker.
  const timeSinceLastBeat = now - state.lastBeatTime - (state.bluetoothDelay / 1000);

  if (timeSinceLastBeat < 0) {
    // We're inside the Bluetooth delay window: the audio-context beat has fired
    // but the sound hasn't reached the speaker yet.  Rather than snapping the
    // animation back to position 0, continue from the tail of the previous beat
    // cycle so motion stays fluid.
    const prevProgress = (timeSinceLastBeat + beatDuration) / beatDuration;
    // Safety: out-of-range means delay > one full beat duration — hold at 0.
    if (prevProgress < 0) return 0;
    return prevProgress; // always < 1 since timeSinceLastBeat < 0
  }

  // If timeSinceLastBeat exceeds 2 beat durations (tab was backgrounded, or
  // scheduling hiccup), clamp to avoid visual glitches.
  if (timeSinceLastBeat > beatDuration * 2) {
    return 0;
  }

  // Clamp to 0-1 range for normal operation
  return Math.min(timeSinceLastBeat / beatDuration, 1);
}

export function getAnimalX(direction) {
  const rawProgress = getAnimationProgress();

  // Apply easing for smoother acceleration/deceleration
  // Using sine easing which naturally smooths the motion
  const easedProgress = rawProgress;

  // Sine wave: 0 at start, peaks at 0.5, returns to 0 at 1
  // This creates smooth motion where animals meet at center on the beat
  // Use base coordinate system (640x480) - scale() handles actual sizing
  const baseWidth = 640;
  const baseDisplacement = 200;
  const displacement = Math.sin(easedProgress * Math.PI) * baseDisplacement;
  return direction * displacement + (baseWidth / 2);
}

// Get Y position for vertical bounce mode
export function getVerticalY() {
  const rawProgress = getAnimationProgress();
  const lineY = 420; // Where the horizontal line is (lowered)
  const bounceBottom = 350; // Object center at lowest point (~20% below line)
  const maxHeight = 260; // How high the object bounces from bottom

  // Object center is at bounceBottom when progress = 0 (on the beat)
  // About 20% of object passes below the line
  const displacement = Math.sin(rawProgress * Math.PI) * maxHeight;
  return bounceBottom - displacement;
}

// Easing functions for smooth animations
const Easing = {
  // Exponential ease out - perfect for gravity/falling
  easeOutExpo: function(t) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  },

  // Bounce ease out - realistic bouncing effect
  easeOutBounce: function(t) {
    const n1 = 7.5625;
    const d1 = 2.75;

    if (t < 1 / d1) {
      return n1 * t * t;
    } else if (t < 2 / d1) {
      return n1 * (t -= 1.5 / d1) * t + 0.75;
    } else if (t < 2.5 / d1) {
      return n1 * (t -= 2.25 / d1) * t + 0.9375;
    } else {
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }
  },

  // Quadratic ease in-out for smooth acceleration
  easeInOutQuad: function(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  },

  // Cubic ease in-out — stronger contrast: lingers at endpoints, fast in the middle
  easeInOutCubic: function(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
};
