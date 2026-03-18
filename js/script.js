var xpos=0;
var rad=50;
var t=0;
var secondsPerBeat = 1;
var cachedBPM = 96;
var animal1;
var animal2;
var animalType = 'circle'; // 'circle', 'pig', 'cat', 'dog', 'bird', etc.
var circleColor = '#000000'; // Color for circle animation

// Selfie capture variables
var selfieImage = null;
var conductorSelfieImage = null; // Selfie for the conductor's face (optional)
var cameraTarget = 'selfie'; // 'selfie' or 'conductor' — controls where capturePhoto() stores the result
var cameraStream = null;
var recordedSoundURL = null; // URL for recorded selfie sound
var recordedSoundPlayer = null; // Tone.js Player for recorded sound
var mediaRecorder = null;
var audioChunks = [];
var mirrorSelfies = true; // When true, selfie images face each other

// Advanced metronome settings
var beatsPerMeasure = 4;
var currentBeat = 0;
var subdivision = 'none'; // 'none', 'eighth', 'triplet', 'sixteenth'
var swingEnabled = false; // Swing 8th notes (shifts subdivision from 50% to 66.7% of beat)
var animalSoundEnabled = true; // Play animal sound on beat
var accentEnabled = true;
var flashEnabled = false; // Flash background on beat
var voiceCountEnabled = false; // Count beats aloud
var rockBeatEnabled = false; // Rock beat drum machine (4/4 only)
var waltzBeatEnabled = false; // Waltz beat drum machine (3/4 only)
var countInBeatsRemaining = 0; // Counts down during the count-in phase
var countInMeasures = 0;       // How many count-in measures were requested (1 or 2)
var lastBeatTime = 0;   // Track when last beat fired for animation sync
var animBeat = 0;       // Beat index for conductor animation, updated in Draw callback
var rampProgress = 0;         // 0 = not in a tempo ramp; 0–1 = fraction through ramp window
var ritardandoProgress = 0;   // 0 = not in a ritardando; 0–1 = fraction through ritardando zone
var bounceDirection = 'horizontal'; // 'horizontal' or 'vertical'
var isFullscreen = false; // Fullscreen mode state
var bluetoothDelay = 0; // Bluetooth audio delay compensation in milliseconds (0 = no offset)

// Counting Trainer state
var countingTrainerEnabled = false;  // Whether counting trainer mode is active
var ctTargetMeasures = 4;            // Number of full measures to count
var ctTargetExtraBeats = 0;          // Extra beats beyond full measures
var ctPhase = 'idle';                // 'idle' | 'counting' | 'done'
var ctBeatsRemaining = 0;            // Beats left to count in the silent phase
var ctMeasuresCompleted = 0;         // Measures completed so far (for display)
var ctCurrentBeatInMeasure = 0;      // Current beat within the measure (for display)
var ctDoneTime = 0;                  // Tone.now() when "done" was triggered
var ctSoundOn = false;               // Keep metronome sound on during counting phase
var ctVisualOn = true;               // Keep visual animation on during counting phase

// Song Sections (multi-section playback)
var songSections = [];           // Array of {measures, beatsPerMeasure, bpm, transitionBeats, transitionUnit, ritardandoEnabled, ritardandoBeats, ritardandoUnit, ritardandoPercent}
var songTitle = '';              // Current song title (used when saving)
var songModeEnabled = false;     // Whether song mode is active
var songCurrentSection = -1;     // Index of currently playing section (-1 = not playing)
var songMeasureInSection = 0;    // Current measure within the current section (0-based)
var songBeatInMeasure = 0;       // Current beat within the current measure (0-based, for section tracking)
var _VM_SONGS_KEY = 'vm_saved_songs'; // localStorage key for persisted songs

// Custom Rhythm state
// Each beat in the measure is represented by a pattern string:
//   'q'        = quarter note
//   'r'        = quarter rest
//   'ee'       = two eighth notes
//   'er'       = eighth note + eighth rest
//   're'       = eighth rest + eighth note
//   'rr8'      = two eighth rests (same as quarter rest, but notated differently)
//   'ssss'     = four sixteenth notes
//   'sse'      = two sixteenths + eighth
//   'ess'      = eighth + two sixteenths
//   'sr'       = sixteenth + sixteenth rest + sixteenth + sixteenth rest (not used, simplified)
// The customRhythmPattern array has one entry per beat.
var customRhythmEnabled = false;
var customRhythmPattern = []; // e.g. ['q', 'ee', 'ssss', 'q'] for 4/4


// Voice counting — pre-recorded samples played through Tone.js Players for
// sample-accurate timing.  Unlike the Web Speech API (which goes through a
// separate, high-latency audio pipeline), these samples are scheduled on
// the same Web Audio graph as the metronome clicks.
//
// To use your own recordings:
//   1. Record short audio clips for each number (1-9) plus "ready" and "go"
//   2. Save them as mp3 or wav files in  sounds/voice/
//      (e.g.  sounds/voice/1.mp3, sounds/voice/2.mp3, … sounds/voice/ready.mp3, sounds/voice/go.mp3)
//   3. The app auto-detects the format — mp3, wav, and ogg are all supported.
//
// If files are missing, the app falls back to the browser's built-in
// SpeechSynthesis (which may lag at faster tempos).

var voicePlayers = {};         // word → Tone.Player (populated after load)
var voiceSamplesLoaded = false; // true once at least one sample loaded successfully
var VOICE_WORDS = ['1','2','3','4','5','6','7','8','9','ready','go'];
var VOICE_FORMATS = ['mp3', 'wav', 'ogg']; // tried in order

// Try loading voice samples in the preferred format order.
// The first format that successfully loads for a given word wins.
(function() {
  var loaded = 0;
  var failed = 0;
  var total = VOICE_WORDS.length;

  VOICE_WORDS.forEach(function(w) {
    tryLoadVoice(w, 0);
  });

  function tryLoadVoice(word, fmtIndex) {
    if (fmtIndex >= VOICE_FORMATS.length) {
      // All formats failed for this word — leave it out of voicePlayers
      failed++;
      checkDone();
      return;
    }
    var url = "./sounds/voice/" + word + "." + VOICE_FORMATS[fmtIndex];
    var player = new Tone.Player(url, function() {
      // success callback
      voicePlayers[word] = player;
      player.toMaster();
      loaded++;
      checkDone();
    });
    // Tone.Player doesn't fire an error callback in the constructor, but the
    // underlying buffer emits an error we can catch via a one-shot listener.
    player.buffer._xhr && player.buffer._xhr.addEventListener &&
      player.buffer._xhr.addEventListener('error', function() {
        tryLoadVoice(word, fmtIndex + 1);
      });
    // Fallback: if the buffer stays unloaded after a reasonable timeout, try next format
    setTimeout(function() {
      if (!voicePlayers[word]) {
        tryLoadVoice(word, fmtIndex + 1);
      }
    }, 3000);
  }

  function checkDone() {
    if (loaded + failed === total) {
      voiceSamplesLoaded = loaded > 0;
      if (voiceSamplesLoaded) {
        console.log("Voice samples loaded: " + loaded + "/" + total);
      } else {
        console.log("No voice samples found in sounds/voice/ — using SpeechSynthesis fallback");
      }
    }
  }
})();

// ── SpeechSynthesis fallback ────────────────────────────────────────────────
// Used only when pre-recorded voice samples are unavailable.
var utteranceCache = {};
(function() {
  if (!('speechSynthesis' in window)) return;
  VOICE_WORDS.forEach(function(word) {
    var u = new SpeechSynthesisUtterance(word);
    u.rate = 1.5;
    u.pitch = 1.0;
    u.volume = 1.0;
    utteranceCache[word] = u;
  });
})();

function speechFallback(word) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  var utterance = utteranceCache[word];
  if (!utterance) {
    utterance = new SpeechSynthesisUtterance(word);
    utterance.rate = 1.5;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utteranceCache[word] = utterance;
  }
  window.speechSynthesis.speak(utterance);
}
// ─────────────────────────────────────────────────────────────────────────────

// Trigger a voice sample at a precise audio-thread time.
// Falls back to SpeechSynthesis if the sample isn't available.
function triggerVoice(word, time) {
  var player = voicePlayers[word];
  if (player && player.loaded) {
    if (player.state === 'started') {
      player.stop(time);
    }
    player.start(time);
  } else {
    // Fallback: Web Speech API (may lag at fast tempos)
    speechFallback(word);
  }
}

function speakBeatNumber(beatNumber, audioTime) {
  if (!voiceCountEnabled) return;
  triggerVoice(String(beatNumber), audioTime);
}

// Speak any word at a precise audio time (used for count-in cues).
function speakWord(word, audioTime) {
  triggerVoice(word, audioTime);
}

// Canvas dimensions (will be set dynamically)
var canvasWidth = 640;
var canvasHeight = 480;
var canvasScale = 1;

// Calculate responsive canvas size
// Canvas fills available space while maintaining 4:3 aspect ratio
function getCanvasSize() {
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
function getFullscreenCanvasSize() {
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
function enterFullscreen() {
  isFullscreen = true;
  const overlay = document.getElementById('fullscreen-overlay');
  const canvas = document.querySelector('.canvas-wrapper canvas');
  const fullscreenWrapper = document.querySelector('.fullscreen-canvas-wrapper');
  const playButtonGroup = document.querySelector('.controls .play-button-group');
  const togglePlaceholder = document.getElementById('fullscreen-toggle-placeholder');

  // Move canvas to fullscreen wrapper
  if (canvas && fullscreenWrapper) {
    fullscreenWrapper.appendChild(canvas);
  }

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
    canvasWidth = size.width;
    canvasHeight = size.height;
    canvasScale = size.scale;
    resizeCanvas(canvasWidth, canvasHeight);
  }, 50);

  sendStateUpdate();
}

// Exit fullscreen mode
function exitFullscreen() {
  isFullscreen = false;
  const overlay = document.getElementById('fullscreen-overlay');
  const canvas = document.querySelector('.fullscreen-canvas-wrapper canvas');
  const normalWrapper = document.querySelector('.canvas-wrapper');
  const playButtonGroup = document.querySelector('#fullscreen-toggle-placeholder .play-button-group');

  // Move canvas back to normal wrapper
  if (canvas && normalWrapper) {
    normalWrapper.appendChild(canvas);
  }

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
    canvasWidth = size.width;
    canvasHeight = size.height;
    canvasScale = size.scale;
    resizeCanvas(canvasWidth, canvasHeight);
  }, 50);

  sendStateUpdate();
}

// Initialize fullscreen listeners
function initFullscreenListeners() {
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
    if (e.key === 'Escape' && isFullscreen) {
      exitFullscreen();
    }
  });
}

// Smoothed animation progress for fluid motion
var smoothedProgress = 0;
var lastFrameTime = 0;

// Calculate animation position based on time since last beat fired
// This stays in sync even when BPM changes mid-playback
function getAnimationProgress() {
  if (Tone.Transport.state !== 'started') {
    return 0; // At center when stopped
  }

  // Guard against uninitialized lastBeatTime (first beat hasn't fired yet)
  if (lastBeatTime <= 0) {
    return 0;
  }

  const now = Tone.now();
  // Use cachedBPM (set atomically with lastBeatTime) so the beat duration
  // matches the BPM that was active when the last beat fired.  Using the
  // live transport BPM during a tempo ramp causes a mismatch that makes
  // progress jump, especially in the Bluetooth delay window.
  const beatDuration = 60 / (cachedBPM || Tone.Transport.bpm.value);
  // bluetoothDelay is in ms; subtract it so the animation reaches the beat
  // position exactly when the sound arrives at the speaker.
  const timeSinceLastBeat = now - lastBeatTime - (bluetoothDelay / 1000);

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

function getAnimalX(direction) {
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
function getVerticalY() {
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

class Circle {
  constructor(direction){
    this.direction = direction;
    this.x = 100;
    this.y = 240;
    this.baseY = 240;
    this.size = 180; // Diameter of the circle
  }

  pigmove(){
    this.x = getAnimalX(this.direction);
    this.y = this.baseY;
  }

  display(){
    var bodyX = this.x;
    var bodyY = this.y;

    // Draw a simple filled circle
    noStroke();
    fill(circleColor);
    ellipse(bodyX, bodyY, this.size, this.size);
  }
}

class Pig {
  constructor(direction){
    this.direction=direction;
    this.x = 100;
    this.y = 240; // Base Y position
    this.baseY = 240;
  }

  pigmove(){
    this.x = getAnimalX(this.direction);
    this.y = this.baseY;
  }

  display(){
      var bodyX = this.x; // variables
      var bodyY = this.y;
      fill(250, 192, 196); //legs
    rect(bodyX+18, bodyY+73, 18, 68);
    rect(bodyX-47, bodyY+71, 18, 68);

    ellipse(bodyX, bodyY, 245, 245); // body

    fill(163, 124, 127);//lefteare
    triangle(bodyX, bodyY-54, bodyX-70, bodyY+15, bodyX-66,bodyY-87);

    //rightears
    triangle(bodyX+65, bodyY+24, bodyX+70, bodyY-85, bodyX-8,bodyY-58);
    fill(13, 13, 13); // earefill

    triangle(bodyX+26, bodyY+62, bodyX+65, bodyY-77, bodyX-38,bodyY-24); // earefill
    triangle(bodyX, bodyY-31, bodyX-52, bodyY+38, bodyX-59,bodyY-77);
    fill(217, 165, 169);
    ellipse(bodyX, bodyY, 155, 144); //head

    fill(224, 107, 117); //nose
    ellipse(bodyX, bodyY+13, 71, 60);

    fill(0, 0, 0); //nosefill
    ellipse(bodyX-10, bodyY+12, 11, 19);
    ellipse(bodyX+10, bodyY+12, 11, 19);

    ellipse(bodyX-17, bodyY-24, 6, 15); //pupils
    ellipse(bodyX+17, bodyY-24, 6, 15);

    fill(259, 192, 196); //legs
    rect(bodyX-81, bodyY+78, 18, 68);
    rect(bodyX+51, bodyY+72, 18, 68);
    fill(8, 8, 8);
    ellipse(bodyX-72, bodyY+141, 21, 11);
    ellipse(bodyX+60, bodyY+141, 21, 11);
    ellipse(bodyX-38, bodyY+138, 18, 10);
    ellipse(bodyX+28, bodyY+138, 18, 10);
  }
}

class Selfie {
  constructor(direction){
    this.direction = direction;
    this.x = 100;
    this.y = 240;
    this.baseY = 240;
    this.size = 280; // Size of the circular face (larger for better visibility)
  }

  pigmove(){
    this.x = getAnimalX(this.direction);
    this.y = this.baseY;
  }

  display(){
    var bodyX = this.x;
    var bodyY = this.y;

    if (selfieImage) {
      // Draw the selfie image in a circle
      push();

      // Create circular clipping mask
      imageMode(CENTER);

      // Draw circular border/background
      fill(255);
      stroke(102, 126, 234); // Purple border
      strokeWeight(4);
      ellipse(bodyX, bodyY, this.size + 8, this.size + 8);

      // Clip to circle and draw image
      // Use a graphics buffer for circular mask
      let diameter = this.size;

      // Draw the image
      noStroke();

      // Create circular clip using drawingContext
      drawingContext.save();
      drawingContext.beginPath();
      drawingContext.arc(bodyX, bodyY, diameter / 2, 0, Math.PI * 2);
      drawingContext.clip();

      // Draw the selfie image
      // When mirrorSelfies is true, mirror based on direction so images face each other
      // direction 1 = right side, direction -1 = left side
      push();
      translate(bodyX, bodyY);
      if (mirrorSelfies) {
        // Mirror the right image (direction 1) so they face each other
        if (this.direction === 1) {
          scale(-1, 1);
        }
      } else {
        // When not mirroring, show both images with same orientation (mirrored for natural selfie look)
        scale(-1, 1);
      }
      image(selfieImage, 0, 0, diameter, diameter);
      pop();

      drawingContext.restore();

      pop();
    } else {
      // Placeholder when no selfie is captured
      fill(200);
      stroke(150);
      strokeWeight(3);
      ellipse(bodyX, bodyY, this.size, this.size);

      // Draw camera icon placeholder
      noStroke();
      fill(120);
      textAlign(CENTER, CENTER);
      textSize(40);
      text("📸", bodyX, bodyY);

      textSize(14);
      fill(100);
      text("Select Selfie", bodyX, bodyY + 50);
    }
  }
}

class Conductor {
  constructor(direction) {
    this.direction = direction; // 1 = right hand, -1 = left hand
    this.x = direction === 1 ? 450 : 190;
    this.y = 200;
    this.handSize = 32;
  }

  // Conducting patterns using Bezier curves for realistic motion.
  // Each beat is defined by an ictus point (the precise beat location) and a
  // control point (the rebound peak after the beat). The hand follows a quadratic
  // Bezier curve: ictus → rebound peak → next ictus, with ease-in timing so the
  // hand lingers at the rebound and accelerates into each ictus — just like a
  // real conductor's baton.
  //
  // Standard conducting patterns (right hand, viewer's perspective):
  //   2-beat: Down, Up                     (J-arc)
  //   3-beat: Down, Right, Up              (triangle)
  //   4-beat: Down, Left, Right, Up        (cross / t-shape)
  //   5-beat: Down, Left, Center, Right, Up (3+2 subdivision)
  //   6-beat: Down, Left-low, Left, Right, Right, Up (German six)
  //
  // All ictus x-values are >= 320 so hands never cross the center line.
  // Left hand is mirrored around x = 320.

  getRightHandPattern() {
    const n = beatsPerMeasure;

    // { ictus: [x,y] = where the beat lands, control: [x,y] = rebound peak after }
    const patterns = {
      1: [
        { ictus: [465, 440], control: [465, 175] }
      ],
      2: [
        { ictus: [465, 442], control: [478, 330] },   // beat 1 (down) → rebound up-right
        { ictus: [478, 365], control: [465, 175] }     // beat 2 (up)   → BIG rebound (prep)
      ],
      3: [
        { ictus: [458, 442], control: [505, 325] },   // beat 1 (down)  → rebound up-right
        { ictus: [535, 435], control: [502, 320] },    // beat 2 (right) → rebound up
        { ictus: [478, 360], control: [460, 175] }     // beat 3 (up)    → BIG rebound
      ],
      4: [
        { ictus: [462, 445], control: [418, 330] },   // beat 1 (down)  → rebound up-left
        { ictus: [385, 438], control: [460, 325] },    // beat 2 (left)  → rebound up-right
        { ictus: [538, 435], control: [512, 320] },    // beat 3 (right) → rebound up
        { ictus: [480, 358], control: [462, 175] }     // beat 4 (up)    → BIG rebound
      ],
      5: [
        { ictus: [460, 445], control: [412, 335] },   // beat 1 (down)  → rebound up-left
        { ictus: [385, 440], control: [462, 330] },    // beat 2 (left)  → rebound up-center
        { ictus: [465, 442], control: [510, 328] },    // beat 3 (center)→ rebound up-right
        { ictus: [535, 434], control: [510, 320] },    // beat 4 (right) → rebound up
        { ictus: [480, 358], control: [462, 175] }     // beat 5 (up)    → BIG rebound
      ],
      6: [
        { ictus: [462, 445], control: [420, 340] },   // beat 1 (down)      → rebound up-left
        { ictus: [392, 442], control: [396, 345] },    // beat 2 (left-low)  → rebound up
        { ictus: [402, 438], control: [468, 328] },    // beat 3 (left)      → rebound up-right
        { ictus: [530, 440], control: [522, 335] },    // beat 4 (right)     → rebound up
        { ictus: [512, 434], control: [496, 322] },    // beat 5 (right-in)  → rebound up
        { ictus: [478, 358], control: [462, 175] }     // beat 6 (up)        → BIG rebound
      ]
    };

    if (patterns[n]) return patterns[n];

    // Fallback for 7+ beats: alternate inner/outer ictus positions with
    // proportional rebound heights; last beat gets the big preparatory rebound.
    const pts = [{ ictus: [462, 445], control: [420, 335] }];
    for (let i = 1; i < n - 1; i++) {
      const isInner = i % 2 === 1;
      const ix = isInner ? 390 : 535;
      const iy = 440 - i * 0.5;               // subtle staircase up
      const cx = isInner ? 440 : 510;
      const cy = 330 - i * 0.5;
      pts.push({ ictus: [ix, iy], control: [cx, cy] });
    }
    pts.push({ ictus: [478, 358], control: [462, 175] });
    return pts;
  }

  getPattern() {
    const rightPattern = this.getRightHandPattern();
    if (this.direction === 1) return rightPattern;
    // Mirror x around canvas center (320) for left hand
    return rightPattern.map(({ ictus, control }) => ({
      ictus:   [640 - ictus[0],   ictus[1]],
      control: [640 - control[0], control[1]]
    }));
  }

  getConductorPosition() {
    const pattern = this.getPattern();
    const n = pattern.length;
    if (n === 0) return [this.x, this.y];

    // When stopped, rest at a comfortable preparatory position — hands at
    // moderate height, not as high as the rebound peak during active conducting.
    if (Tone.Transport.state !== 'started' || lastBeatTime <= 0) {
      const lastCtrl = pattern[n - 1].control;
      const lastIctus = pattern[n - 1].ictus;
      // Rest halfway between the last ictus and its rebound peak
      return [(lastCtrl[0] + lastIctus[0]) / 2, (lastCtrl[1] + lastIctus[1]) / 2];
    }

    // Compute progress and segment selection independently of getAnimationProgress()
    // so we can handle the Bluetooth delay window correctly for Bezier animation.
    // During the delay window, animBeat has already incremented but the audio hasn't
    // reached the speaker yet — we must keep the previous segment so the hand
    // arrives at the ictus exactly when the sound plays (not when it fires).
    const beatDuration = 60 / (cachedBPM || Tone.Transport.bpm.value);
    const timeSinceLastBeat = Tone.now() - lastBeatTime - (bluetoothDelay / 1000);

    let progress, effectiveAnimBeat;
    if (timeSinceLastBeat < 0) {
      // Bluetooth delay window: continue on the previous segment.
      progress = (timeSinceLastBeat + beatDuration) / beatDuration;
      if (progress < 0) progress = 0;
      effectiveAnimBeat = animBeat - 1;
    } else {
      progress = Math.min(timeSinceLastBeat / beatDuration, 1);
      effectiveAnimBeat = animBeat;
    }

    const lastFiredBeatIndex = (effectiveAnimBeat - 1 + beatsPerMeasure) % beatsPerMeasure;
    const fromIdx = lastFiredBeatIndex % n;
    const toIdx = (fromIdx + 1) % n;

    // Bezier endpoints: current ictus → rebound peak → next ictus
    const p0 = pattern[fromIdx].ictus;
    const p1 = pattern[fromIdx].control;
    const p2 = pattern[toIdx].ictus;

    // Ease-in timing: hand lingers at rebound peak, accelerates into the ictus.
    // Stronger ease for the large preparatory rebound (last beat → downbeat)
    // so the conductor visibly "hangs" at the top before sweeping down.
    const easePower = fromIdx === n - 1 ? 2.2 : 1.6;
    const t = Math.pow(progress, easePower);

    // Quadratic Bezier: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
    const mt = 1 - t;
    return [
      mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
      mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]
    ];
  }

  pigmove() {
    const [x, y] = this.getConductorPosition();
    this.x = x;
    this.y = y;
  }

  display() {
    // Silhouette geometry — shared with arm anchor so arms connect to the shoulders
    const headX = 320;
    const headY = 144;
    const headDiam = 259;
    const neckW = 40;
    const neckTop = headY + headDiam / 2 - 10;
    const torsoTop = neckTop + 30;
    const shoulderW = 200;

    // Arm originates from the outer shoulder edge of the silhouette torso
    const shoulderX = this.direction === 1 ? headX + shoulderW / 2 : headX - shoulderW / 2;
    const shoulderY = torsoTop;

    // Draw silhouette and head — once only from the direction===1 instance
    if (this.direction === 1) {
      // Body silhouette (always shown)
      push();
      noStroke();
      fill(0, 0, 0, 60);

      ellipse(headX, headY, headDiam, headDiam);
      rect(headX - neckW / 2, neckTop, neckW, 35);

      const torsoBot = 465;
      const waistW = 130;
      beginShape();
      vertex(headX - shoulderW / 2, torsoTop);
      vertex(headX + shoulderW / 2, torsoTop);
      vertex(headX + waistW / 2, torsoBot);
      vertex(headX - waistW / 2, torsoBot);
      endShape(CLOSE);

      pop();

      if (conductorSelfieImage) {
        // Purple border ring matching the selfie mode style
        noStroke();
        fill(102, 126, 234);
        ellipse(headX, headY, headDiam + 8, headDiam + 8);

        // Circular clip and draw selfie
        drawingContext.save();
        drawingContext.beginPath();
        drawingContext.arc(headX, headY, headDiam / 2, 0, Math.PI * 2);
        drawingContext.clip();

        push();
        imageMode(CENTER);
        noStroke();
        image(conductorSelfieImage, headX, headY, headDiam, headDiam);
        pop();

        drawingContext.restore();
      }
    }

    if (conductorSelfieImage) {
      // Draw arm from silhouette shoulder to hand
      stroke(180, 130, 80);
      strokeWeight(6);
      line(shoulderX, shoulderY, this.x, this.y);
    }

    // Conductor's right hand (direction === -1, left side of canvas from viewer) holds the baton
    // Baton always angles inward toward center and slightly downward, using a fixed
    // direction so it doesn't flip when the hand moves during conducting.
    if (this.direction === -1) {
      const batonLen = 60;
      // Fixed angle: point toward center-right and slightly down (~20° below horizontal)
      const batonAngle = Math.PI * 0.11;  // ~20° below horizontal, pointing right (inward)
      const batonX = this.x + Math.cos(batonAngle) * batonLen;
      const batonY = this.y + Math.sin(batonAngle) * batonLen;
      stroke(230, 220, 200);
      strokeWeight(3);
      line(this.x, this.y, batonX, batonY);
    }

    // Draw hand
    noStroke();
    fill(255, 210, 170);
    ellipse(this.x, this.y, this.handSize, this.handSize);
    // Subtle highlight
    fill(255, 235, 210, 160);
    ellipse(this.x - 4, this.y - 5, 10, 10);
  }
}

// Camera functions
function openCamera() {
  const modal = document.getElementById('camera-modal');
  const video = document.getElementById('camera-video');

  modal.classList.remove('hidden');

  // Request camera access
  navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      width: { ideal: 640 },
      height: { ideal: 480 }
    }
  })
  .then(stream => {
    cameraStream = stream;
    video.srcObject = stream;
  })
  .catch(err => {
    console.error('Camera access denied:', err);
    alert('Could not access camera. Please allow camera access and try again.');
    closeCamera();
  });
}

function closeCamera() {
  const modal = document.getElementById('camera-modal');
  const video = document.getElementById('camera-video');

  modal.classList.add('hidden');

  // Stop camera stream
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  video.srcObject = null;
}

function capturePhoto() {
  const video = document.getElementById('camera-video');

  // Create a canvas to capture the frame
  const captureCanvas = document.createElement('canvas');
  const size = Math.min(video.videoWidth, video.videoHeight);
  captureCanvas.width = size;
  captureCanvas.height = size;

  const ctx = captureCanvas.getContext('2d');

  // Calculate crop to get square from center
  const offsetX = (video.videoWidth - size) / 2;
  const offsetY = (video.videoHeight - size) / 2;

  // Draw the center square of the video
  ctx.drawImage(video, offsetX, offsetY, size, size, 0, 0, size, size);

  // Convert to p5.js image and route to the right target
  const dataURL = captureCanvas.toDataURL('image/png');
  if (cameraTarget === 'conductor') {
    conductorSelfieImage = loadImage(dataURL);
  } else {
    selfieImage = loadImage(dataURL, () => {
      // Image loaded, recreate animals to use it
      createAnimals();
    });
  }

  closeCamera();
}

// Sound recording functions
var isCountingDown = false; // Track if countdown is in progress

function startRecording() {
  const recordBtn = document.getElementById('record-sound-btn');
  const recordingStatus = document.getElementById('recording-status');

  // Prevent starting if already counting down
  if (isCountingDown) return;

  // Start countdown
  isCountingDown = true;
  recordBtn.disabled = true;
  recordBtn.textContent = '3...';
  recordingStatus.textContent = 'Get ready...';
  recordingStatus.classList.add('recording');

  setTimeout(() => {
    recordBtn.textContent = '2...';
  }, 1000);

  setTimeout(() => {
    recordBtn.textContent = '1...';
  }, 2000);

  // After 3 seconds, start actual recording
  setTimeout(() => {
    isCountingDown = false;
    recordBtn.disabled = false;
    actuallyStartRecording();
  }, 3000);
}

// Trim silence from beginning and end of audio buffer
async function trimSilence(audioBlob) {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0); // Get first channel
    const sampleRate = audioBuffer.sampleRate;

    // Find first non-silent sample (threshold-based)
    const threshold = 0.01; // Adjust sensitivity
    let startSample = 0;
    let endSample = channelData.length - 1;

    // Find start (first sample above threshold)
    for (let i = 0; i < channelData.length; i++) {
      if (Math.abs(channelData[i]) > threshold) {
        // Add small buffer before sound (50ms)
        startSample = Math.max(0, i - Math.floor(sampleRate * 0.05));
        break;
      }
    }

    // Find end (last sample above threshold)
    for (let i = channelData.length - 1; i >= 0; i--) {
      if (Math.abs(channelData[i]) > threshold) {
        // Add small buffer after sound (100ms)
        endSample = Math.min(channelData.length - 1, i + Math.floor(sampleRate * 0.1));
        break;
      }
    }

    // Create trimmed buffer
    const trimmedLength = endSample - startSample + 1;
    const trimmedBuffer = audioContext.createBuffer(
      audioBuffer.numberOfChannels,
      trimmedLength,
      sampleRate
    );

    // Copy trimmed data to new buffer
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel);
      const destData = trimmedBuffer.getChannelData(channel);
      for (let i = 0; i < trimmedLength; i++) {
        destData[i] = sourceData[startSample + i];
      }
    }

    // Convert back to blob (WAV format for better compatibility)
    const wavBlob = audioBufferToWav(trimmedBuffer);
    audioContext.close();
    return wavBlob;
  } catch (err) {
    console.error('Error trimming audio:', err);
    audioContext.close();
    return audioBlob; // Return original if trimming fails
  }
}

// Convert AudioBuffer to WAV Blob
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const dataLength = buffer.length * blockAlign;
  const bufferLength = 44 + dataLength;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  // Write WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write audio data
  const offset = 44;
  const channelData = [];
  for (let i = 0; i < numChannels; i++) {
    channelData.push(buffer.getChannelData(i));
  }

  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset + (i * blockAlign) + (channel * bytesPerSample), intSample, true);
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function actuallyStartRecording() {
  const recordBtn = document.getElementById('record-sound-btn');
  const recordingStatus = document.getElementById('recording-status');

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e) => {
        audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop the audio stream
        stream.getTracks().forEach(track => track.stop());

        recordingStatus.textContent = 'Processing...';

        // Create audio blob and trim silence
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const trimmedBlob = await trimSilence(audioBlob);

        // Revoke old URL if exists
        if (recordedSoundURL) {
          URL.revokeObjectURL(recordedSoundURL);
        }

        recordedSoundURL = URL.createObjectURL(trimmedBlob);

        // Create Tone.js Player with recorded sound
        if (recordedSoundPlayer) {
          recordedSoundPlayer.dispose();
        }
        recordedSoundPlayer = new Tone.Player(recordedSoundURL).toMaster();

        recordingStatus.textContent = '✓ Sound recorded & trimmed!';
        recordingStatus.classList.remove('recording');
      };

      mediaRecorder.start();
      recordBtn.textContent = '⏹ Stop Recording';
      recordBtn.classList.add('recording');
      recordingStatus.textContent = 'Recording...';
      recordingStatus.classList.add('recording');

      // Auto-stop after 2 seconds for a short sound
      setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          stopRecording();
        }
      }, 2000);
    })
    .catch(err => {
      console.error('Microphone access denied:', err);
      recordingStatus.textContent = 'Microphone access denied';
    });
}

function stopRecording() {
  const recordBtn = document.getElementById('record-sound-btn');

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    recordBtn.textContent = '🎤 Record Sound';
    recordBtn.classList.remove('recording');
  }
}

function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    startRecording();
  }
}

// Initialize camera button listeners
function initCameraListeners() {
  const captureBtn = document.getElementById('capture-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const recordBtn = document.getElementById('record-sound-btn');

  if (captureBtn) {
    captureBtn.addEventListener('click', capturePhoto);
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      closeCamera();
      // Revert to previous animal if no selfie was taken
      if (!selfieImage) {
        document.getElementById('animal-selector').value = 'pig';
        animalType = 'pig';
        createAnimals();
      }
    });
  }
  if (recordBtn) {
    recordBtn.addEventListener('click', toggleRecording);
  }

  // Mirror selfies checkbox
  const mirrorCheckbox = document.getElementById('mirror-selfies');
  if (mirrorCheckbox) {
    mirrorCheckbox.addEventListener('change', (e) => {
      mirrorSelfies = e.target.checked;
    });
  }
}

// Initialize settings modal listeners
function initSettingsListeners() {
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
      beatsPerMeasure = parseInt(e.target.value);
      currentBeat = 0; // Reset to beat 1
      updateRockBeatVisibility();
      // Cancel custom rhythm when time signature changes
      crCancelCustomRhythm();
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
      swingGroup.style.display = (subdivision === 'eighth') ? '' : 'none';
    }
    // Auto-disable swing if subdivision changes away from eighth
    if (subdivision !== 'eighth' && swingEnabled) {
      swingEnabled = false;
      var swingCb = document.getElementById('swing-enabled');
      if (swingCb) swingCb.checked = false;
    }
  }

  function updateRockBeatVisibility() {
    if (rockBeatGroup) {
      rockBeatGroup.style.display = beatsPerMeasure === 4 ? '' : 'none';
    }
    // Auto-disable rock beat if time signature changes away from 4/4
    if (beatsPerMeasure !== 4 && rockBeatEnabled) {
      rockBeatEnabled = false;
      if (rockBeatCheckbox) rockBeatCheckbox.checked = false;
    }

    if (waltzBeatGroup) {
      waltzBeatGroup.style.display = beatsPerMeasure === 3 ? '' : 'none';
    }
    // Auto-disable waltz beat if time signature changes away from 3/4
    if (beatsPerMeasure !== 3 && waltzBeatEnabled) {
      waltzBeatEnabled = false;
      if (waltzBeatCheckbox) waltzBeatCheckbox.checked = false;
    }
  }

  if (rockBeatCheckbox) {
    rockBeatCheckbox.addEventListener('change', (e) => {
      rockBeatEnabled = e.target.checked;
      sendStateUpdate();
    });
  }

  if (waltzBeatCheckbox) {
    waltzBeatCheckbox.addEventListener('change', (e) => {
      waltzBeatEnabled = e.target.checked;
      sendStateUpdate();
    });
  }

  // Show drum machine options for the initial time signature
  updateRockBeatVisibility();

  // Subdivision change
  if (subdivisionSelect) {
    subdivisionSelect.addEventListener('change', (e) => {
      subdivision = e.target.value;
      updateSwingVisibility();
      sendStateUpdate();
    });
  }

  // Swing 8th note toggle
  const swingCheckbox = document.getElementById('swing-enabled');
  if (swingCheckbox) {
    swingCheckbox.addEventListener('change', (e) => {
      swingEnabled = e.target.checked;
      sendStateUpdate();
    });
  }

  // Animal sound toggle
  const animalSoundCheckbox = document.getElementById('animal-sound-enabled');
  if (animalSoundCheckbox) {
    animalSoundCheckbox.addEventListener('change', (e) => {
      animalSoundEnabled = e.target.checked;
      sendStateUpdate();
    });
  }

  // Accent toggle
  if (accentCheckbox) {
    accentCheckbox.addEventListener('change', (e) => {
      accentEnabled = e.target.checked;
      sendStateUpdate();
    });
  }

  // Flash toggle
  const flashCheckbox = document.getElementById('flash-enabled');
  if (flashCheckbox) {
    flashCheckbox.addEventListener('change', (e) => {
      flashEnabled = e.target.checked;
      sendStateUpdate();
    });
  }

  // Voice count toggle
  const voiceCountCheckbox = document.getElementById('voice-count-enabled');
  if (voiceCountCheckbox) {
    voiceCountCheckbox.addEventListener('change', (e) => {
      voiceCountEnabled = e.target.checked;
      sendStateUpdate();
    });
  }


  // Circle color picker
  const circleColorPicker = document.getElementById('circle-color');
  if (circleColorPicker) {
    circleColorPicker.addEventListener('input', (e) => {
      circleColor = e.target.value;
      sendStateUpdate();
    });
  }

  // Bluetooth delay slider
  const bluetoothDelaySlider = document.getElementById('bluetooth-delay-slider');
  const bluetoothDelayValue  = document.getElementById('bluetooth-delay-value');
  if (bluetoothDelaySlider) {
    bluetoothDelaySlider.addEventListener('input', (e) => {
      bluetoothDelay = parseInt(e.target.value, 10);
      if (bluetoothDelayValue) bluetoothDelayValue.textContent = bluetoothDelay;
      sendStateUpdate();
    });
  }
}

// Robust AudioContext resume handling
// Browsers require a user gesture to start audio. We listen on multiple event
// types to catch the first interaction reliably across desktop and mobile.
var audioContextResumed = false;

function resumeAudioContext() {
  if (audioContextResumed && Tone.context.state === 'running') return;

  if (Tone.context.state !== 'running') {
    Tone.context.resume().then(function() {
      audioContextResumed = true;
      Tone.Transport.bpm.value = cachedBPM || 96;
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
      lastBeatTime = Tone.now();
    }
  }
});

// Create sound players and synthesizers for different animals
var pigPlayer = new Tone.Player("./sounds/oink.wav").toMaster();
pigPlayer.volume.value = 6;

// Selfie clap synth - snappy percussive sound
var selfieSynth = new Tone.NoiseSynth({
  noise: { type: "white" },
  envelope: {
    attack: 0.001,
    decay: 0.15,
    sustain: 0,
    release: 0.1
  }
}).toMaster();
selfieSynth.volume.value = 6;

// Circle click synth - clean metronome tick
var circleSynth = new Tone.Synth({
  oscillator: { type: "sine" },
  envelope: {
    attack: 0.001,
    decay: 0.1,
    sustain: 0,
    release: 0.05
  }
}).toMaster();
circleSynth.volume.value = 6;

// Subdivision click synth - soft tick for subdivisions
var subdivisionSynth = new Tone.Synth({
  oscillator: { type: "triangle" },
  envelope: {
    attack: 0.001,
    decay: 0.05,
    sustain: 0,
    release: 0.05
  }
}).toMaster();
subdivisionSynth.volume.value = -6; // Quieter than main beat

// Accent synth - louder, higher-pitched click for beat 1
var accentSynth = new Tone.Synth({
  oscillator: { type: "triangle" },
  envelope: {
    attack: 0.001,
    decay: 0.1,
    sustain: 0,
    release: 0.05
  }
}).toMaster();
accentSynth.volume.value = 6; // Audible accent level

// Rock beat drum synthesizers (used when rockBeatEnabled is true in 4/4 time)
var kickSynth = new Tone.MembraneSynth({
  pitchDecay: 0.05,
  octaves: 6,
  envelope: {
    attack: 0.001,
    decay: 0.3,
    sustain: 0,
    release: 0.1
  }
}).toMaster();
kickSynth.volume.value = 9;

var snareSynth = new Tone.NoiseSynth({
  noise: { type: "white" },
  envelope: {
    attack: 0.001,
    decay: 0.12,
    sustain: 0,
    release: 0.05
  }
}).toMaster();
snareSynth.volume.value = 2;

var hihatSynth = new Tone.MetalSynth({
  frequency: 400,
  envelope: {
    attack: 0.001,
    decay: 0.06,
    release: 0.01
  },
  harmonicity: 5.1,
  modulationIndex: 32,
  resonance: 4000,
  octaves: 1.5
}).toMaster();
hihatSynth.volume.value = -6;

// TriggerSound Play - switches based on animal type
function triggerSound(time, isAccent = false){
  // Play accent on beat 1 if enabled (higher pitched click)
  if (isAccent && accentEnabled) {
    accentSynth.triggerAttackRelease("G5", "16n", time);
  }

  // Play animal sound if enabled
  if (!animalSoundEnabled) return;

  switch(animalType) {
    case 'circle':
      circleSynth.triggerAttackRelease("A4", "16n", time);
      break;
    case 'pig':
      // Stop any currently playing instance before retriggering to prevent
      // overlapping playback at fast tempos
      if (pigPlayer.state === 'started') {
        pigPlayer.stop(time);
      }
      pigPlayer.start(time);
      break;
    case 'selfie':
      // Use recorded sound if available, otherwise use default synth
      if (recordedSoundPlayer && recordedSoundPlayer.loaded) {
        if (recordedSoundPlayer.state === 'started') {
          recordedSoundPlayer.stop(time);
        }
        recordedSoundPlayer.start(time);
      } else {
        selfieSynth.triggerAttackRelease("8n", time);
      }
      break;
    case 'conductor':
      circleSynth.triggerAttackRelease("A4", "16n", time);
      break;
    default:
      if (pigPlayer.state === 'started') {
        pigPlayer.stop(time);
      }
      pigPlayer.start(time);
  }
}

// Play subdivision sound
function triggerSubdivision(time) {
  subdivisionSynth.triggerAttackRelease("C5", "32n", time);
}

// Play rock beat pattern for the given beat index (0-3 in 4/4)
// Pattern: kick on 1 & 3, snare on 2 & 4, hi-hat on every 8th note
function triggerRockBeat(time, beat) {
  const beatDuration = Tone.Time("4n").toSeconds();

  // Hi-hat on the downbeat (quarter note)
  hihatSynth.triggerAttackRelease("16n", time);

  // Kick drum on beats 1 and 3 (indices 0 and 2)
  if (beat === 0 || beat === 2) {
    kickSynth.triggerAttackRelease("C1", "8n", time);
  }

  // Snare drum on beats 2 and 4 (indices 1 and 3)
  if (beat === 1 || beat === 3) {
    snareSynth.triggerAttackRelease("8n", time);
  }

  // Hi-hat on the "and" (upbeat 8th note)
  hihatSynth.triggerAttackRelease("16n", time + beatDuration / 2);
}

// Play waltz pattern for the given beat index (0-2 in 3/4)
// Pattern: kick on beat 1, hi-hat on beats 2 & 3 ("oom-pah-pah")
function triggerWaltzBeat(time, beat) {
  const beatDuration = Tone.Time("4n").toSeconds();

  if (beat === 0) {
    // Beat 1: kick drum (the "oom")
    kickSynth.triggerAttackRelease("C1", "8n", time);
  } else {
    // Beats 2 & 3: hi-hat (the "pah")
    hihatSynth.triggerAttackRelease("16n", time);
    snareSynth.triggerAttackRelease("16n", time);
  }
}

// Subdivision event IDs (to cancel when settings change)
var subdivisionEvents = [];

// Schedule main beat sound
function scheduleMainBeat() {
  Tone.Transport.scheduleRepeat(function(time) {
    // ── Count-in phase ──────────────────────────────────────────────────────
    if (countInBeatsRemaining > 0) {
      const totalCountIn = countInMeasures * beatsPerMeasure;
      const beatIndex = totalCountIn - countInBeatsRemaining; // 0-based position in count-in
      const isCountInAccent = beatIndex % beatsPerMeasure === 0;

      // Simple click for every count-in beat
      accentSynth.triggerAttackRelease(isCountInAccent ? "G5" : "A4", "16n", time);

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
          t = 0;
          lastBeatTime = Tone.now();
          animBeat = 0;
        }, time);
      } else if (beatsPerMeasure === 4 && beatIndex < beatsPerMeasure && countInMeasures >= 2) {
        // 4/4 first count-in measure of a 2-bar count-in: speak only on beats 1 & 3 ("one", "two"),
        // leave beats 2 & 4 silent so the pattern is "one – two – | one two ready go".
        if (beatIndex % 2 === 0) {
          speakWord(String(beatIndex / 2 + 1), time); // beatIndex 0→"1", 2→"2"
        }
      } else {
        speakWord(String((beatIndex % beatsPerMeasure) + 1), time);
      }

      countInBeatsRemaining--;

      // ── Counting Trainer: transition to silent counting when count-in ends ──
      if (countInBeatsRemaining === 0 && countingTrainerEnabled && ctPhase === 'idle') {
        ctPhase = 'counting';
        // +1 so the "done" chime lands one beat AFTER the last counted beat
        // (e.g. 1 measure in 4/4 → student counts beats 1-2-3-4, done on next beat 1)
        ctBeatsRemaining = ctTargetMeasures * beatsPerMeasure + ctTargetExtraBeats + 1;
        ctMeasuresCompleted = 0;
        ctCurrentBeatInMeasure = 0;
        Tone.Draw.schedule(function() {
          updateCtDisplay();
        }, time);
      }

      return; // Skip normal beat processing during count-in
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Song mode: check for section transition BEFORE playing the beat ────
    if (songModeEnabled && songCurrentSection >= 0 && songCurrentSection < songSections.length) {
      var curSec = songSections[songCurrentSection];
      // After the post-beat tracker ran last time, songMeasureInSection may
      // have reached curSec.measures — meaning the section is done and we
      // need to advance before playing this beat.
      if (songMeasureInSection >= curSec.measures) {
        songCurrentSection++;
        songMeasureInSection = 0;
        songBeatInMeasure = 0;
        if (songCurrentSection < songSections.length) {
          var next = songSections[songCurrentSection];
          beatsPerMeasure = next.beatsPerMeasure;
          currentBeat = 0;
          // Snap to the exact target BPM — the end-of-section ramp (below)
          // should have already brought us here; this ensures precision.
          Tone.Transport.bpm.setValueAtTime(next.bpm, time);
          cachedBPM = next.bpm;
          secondsPerBeat = 1 / (next.bpm / 60);
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
        var currentBeatIndex = songMeasureInSection * curSec.beatsPerMeasure + songBeatInMeasure;
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
          var nextSec = songSections[songCurrentSection + 1];
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
    if (ctPhase === 'counting') {
      // Play sound if user opted to keep it on
      if (ctSoundOn) {
        if (rockBeatEnabled && beatsPerMeasure === 4) {
          triggerRockBeat(time, currentBeat);
        } else if (waltzBeatEnabled && beatsPerMeasure === 3) {
          triggerWaltzBeat(time, currentBeat);
        } else {
          var isAccentCt = currentBeat === 0;
          triggerSound(time, isAccentCt);
          scheduleSubdivisionsForBeat(time);
        }
        speakBeatNumber(currentBeat + 1, time);
      }
      ctBeatsRemaining--;

      // Capture current measure/beat for display BEFORE incrementing
      var ctBeatForDisplay = ctCurrentBeatInMeasure;
      var ctMeasureForDisplay = ctMeasuresCompleted;

      // Advance the counters
      ctCurrentBeatInMeasure++;
      if (ctCurrentBeatInMeasure >= beatsPerMeasure) {
        ctCurrentBeatInMeasure = 0;
        ctMeasuresCompleted++;
      }

      if (ctBeatsRemaining <= 0) {
        // Target reached — trigger "done" feedback
        ctPhase = 'done';
        ctDoneTime = Tone.now();
        // Play a distinctive "done" sound: two quick rising tones
        accentSynth.triggerAttackRelease("C6", "16n", time);
        accentSynth.triggerAttackRelease("E6", "16n", time + 0.12);

        Tone.Draw.schedule(function() {
          showCtDoneFeedback();
        }, time);

        // Auto-stop after 2 beats so the student hears the confirmation
        var autoStopDelay = (60 / Tone.Transport.bpm.value) * 2;
        Tone.Transport.schedule(function() {
          if (ctPhase === 'done') {
            toggleTransport(false);
          }
        }, '+' + autoStopDelay);
      } else {
        // Use captured values so the display shows the beat that just fired,
        // not the already-incremented next beat
        var totalTarget = ctTargetMeasures * beatsPerMeasure + ctTargetExtraBeats;
        // ctBeatsRemaining includes the +1 landing beat, so subtract 1 for display
        var elapsed = totalTarget - (ctBeatsRemaining - 1);
        Tone.Draw.schedule(function() {
          updateCtDisplayWith(ctMeasureForDisplay + 1, ctBeatForDisplay + 1, elapsed, totalTarget);
        }, time);
      }

      // Continue with animation sync (fall through to Draw schedule below)
    } else if (ctPhase !== 'done') {
      // ── Normal sound playback (not in counting trainer) ──────────────────
      // Custom rhythm mode: play the user-defined pattern
      if (customRhythmEnabled && customRhythmPattern.length > 0) {
        triggerCustomRhythmBeat(time, currentBeat);
      // Drum machine modes: play drum pattern instead of normal click sounds
      } else if (rockBeatEnabled && beatsPerMeasure === 4) {
        triggerRockBeat(time, currentBeat);
      } else if (waltzBeatEnabled && beatsPerMeasure === 3) {
        triggerWaltzBeat(time, currentBeat);
      } else {
        // Determine if this is beat 1 (accented)
        const isAccent = currentBeat === 0;
        triggerSound(time, isAccent);

        // Schedule subdivisions for this beat
        scheduleSubdivisionsForBeat(time);
      }

      // Store beat number before it gets incremented
      const beatToSpeak = currentBeat + 1; // 1-indexed for speaking

      // Schedule speech with precise look-ahead compensation so it lands on the beat
      speakBeatNumber(beatToSpeak, time);
    }
    // ────────────────────────────────────────────────────────────────────────

    // Capture beat index before incrementing so Draw callback can use it
    const thisBeat = currentBeat;

    // Compute ramp/ritardando fraction for this beat so the Draw callback can
    // expose it to the animation loop for the background tint.
    var thisRampProgress = 0;
    var thisRitardandoProgress = 0;
    if (songModeEnabled && songCurrentSection >= 0) {
      var _curSec  = songSections[songCurrentSection];
      if (_curSec) {
        var _totalBeats = _curSec.measures * _curSec.beatsPerMeasure;
        var _beatIdx = songMeasureInSection * _curSec.beatsPerMeasure + songBeatInMeasure;
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
          var _nextSec = songSections[songCurrentSection + 1];
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
      t = 0;
      // Record when this beat fired for animation sync
      lastBeatTime = Tone.now();
      // Advance animBeat here so it changes atomically with lastBeatTime,
      // preventing the conductor hand from jumping when progress resets to 0.
      animBeat = (thisBeat + 1) % beatsPerMeasure;
      // Update cached BPM only if it changed
      const currentBPM = Tone.Transport.bpm.value;
      if (cachedBPM !== currentBPM) {
        cachedBPM = currentBPM;
        secondsPerBeat = 1 / (currentBPM / 60);
      }
      rampProgress = thisRampProgress;
      ritardandoProgress = thisRitardandoProgress;
    }, time);

    // Advance beat counter
    currentBeat = (currentBeat + 1) % beatsPerMeasure;

    // ── Song mode: advance measure/beat tracking after playing ────────────
    if (songModeEnabled && songCurrentSection >= 0 && songCurrentSection < songSections.length) {
      songBeatInMeasure++;
      if (songBeatInMeasure >= beatsPerMeasure) {
        songBeatInMeasure = 0;
        songMeasureInSection++;
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

// Schedule subdivisions for a single beat
// Uses direct synth triggering with audio context time for precise timing
function scheduleSubdivisionsForBeat(beatTime) {
  if (subdivision === 'none') return;

  const beatDuration = Tone.Time("4n").toSeconds();

  switch(subdivision) {
    case 'eighth':
      // One subdivision — straight at 50%, or swung to 66.7% (triplet feel)
      var eighthOffset = swingEnabled ? (beatDuration * 2) / 3 : beatDuration / 2;
      subdivisionSynth.triggerAttackRelease("C5", "32n", beatTime + eighthOffset);
      break;

    case 'triplet':
      // Two subdivisions dividing beat into thirds
      subdivisionSynth.triggerAttackRelease("C5", "32n", beatTime + beatDuration / 3);
      subdivisionSynth.triggerAttackRelease("C5", "32n", beatTime + (beatDuration * 2) / 3);
      break;

    case 'sixteenth':
      // Three subdivisions dividing beat into quarters
      subdivisionSynth.triggerAttackRelease("C5", "32n", beatTime + beatDuration / 4);
      subdivisionSynth.triggerAttackRelease("C5", "32n", beatTime + beatDuration / 2);
      subdivisionSynth.triggerAttackRelease("C5", "32n", beatTime + (beatDuration * 3) / 4);
      break;
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

function _ensureAudioContext(fn) {
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

function toggleTransport(withCountIn) {
  if (Tone.Transport.state === 'started') {
    // Stopping: reset state for clean restart
    Tone.Transport.stop();
    currentBeat = 0;
    lastBeatTime = 0;
    animBeat = 0;
    countInBeatsRemaining = 0;
    countInMeasures = 0;
    // Reset counting trainer state
    ctPhase = 'idle';
    ctBeatsRemaining = 0;
    ctMeasuresCompleted = 0;
    ctCurrentBeatInMeasure = 0;
    hideCtDisplay();
    // Reset song mode state
    songCurrentSection = -1;
    songMeasureInSection = 0;
    songBeatInMeasure = 0;
    hideSongProgressDisplay();
    _countIn1Btn.classList.remove('active');
    _countInBtn.classList.remove('active');
    _setPlayTogglePlaying(false);
    _updatePlayStopUI(false);
  } else {
    // Starting: reset beat counter and start fresh
    currentBeat = 0;
    lastBeatTime = 0;
    animBeat = 0;
    // Reset counting trainer for fresh start
    ctPhase = 'idle';
    ctBeatsRemaining = 0;
    ctMeasuresCompleted = 0;
    ctCurrentBeatInMeasure = 0;
    hideCtDisplay();
    // Initialize song mode if enabled and has sections
    if (songModeEnabled && songSections.length > 0) {
      songCurrentSection = 0;
      songMeasureInSection = 0;
      songBeatInMeasure = 0;
      var firstSec = songSections[0];
      beatsPerMeasure = firstSec.beatsPerMeasure;
      currentBeat = 0;
      Tone.Transport.bpm.value = firstSec.bpm;
      cachedBPM = firstSec.bpm;
      secondsPerBeat = 1 / (firstSec.bpm / 60);
      applySongSectionUI(firstSec);
      updateSongProgressDisplay();
    } else {
      songCurrentSection = -1;
      songMeasureInSection = 0;
      songBeatInMeasure = 0;
      hideSongProgressDisplay();
    }
    // withCountIn: false/0 = no count-in, 1 = 1-bar, 2/true = 2-bar
    countInMeasures = withCountIn ? (withCountIn === 1 ? 1 : 2) : 0;
    countInBeatsRemaining = countInMeasures * beatsPerMeasure;
    // If counting trainer is enabled and there's no count-in, start
    // the silent counting phase immediately
    if (countingTrainerEnabled && !withCountIn) {
      ctPhase = 'counting';
      // +1 so the "done" chime lands one beat AFTER the last counted beat
      ctBeatsRemaining = ctTargetMeasures * beatsPerMeasure + ctTargetExtraBeats + 1;
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

// Helper: apply a BPM value to all tempo controls (slider, number input, fullscreen)
function applyBPM(bpm) {
  bpm = Math.max(30, Math.min(300, Math.round(bpm)));
  Tone.Transport.bpm.value = bpm;
  cachedBPM = bpm;
  secondsPerBeat = 1 / (bpm / 60);

  // Sync all controls
  var slider = document.getElementById('tempo-slider');
  var numInput = document.getElementById('bpm-input');
  var fsSlider = document.getElementById('fullscreen-tempo-slider');
  var fsBpmVal = document.getElementById('fullscreen-bpm-value');
  if (slider) slider.value = bpm;
  if (numInput) numInput.value = bpm;
  if (fsSlider) fsSlider.value = bpm;
  if (fsBpmVal) fsBpmVal.textContent = bpm;

  sendStateUpdate();
}

// Update BPM from range slider
document.getElementById('tempo-slider').addEventListener('input', function(e) {
  applyBPM(parseInt(e.target.value));
});

// Update BPM from number input
document.getElementById('bpm-input').addEventListener('change', function(e) {
  applyBPM(parseInt(e.target.value) || 96);
});

// Also update live while typing in the number input (on Enter key)
document.getElementById('bpm-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    e.target.blur();
  }
});

// Show/hide color picker based on animation type
function updateColorPickerVisibility() {
  const colorPickerGroup = document.getElementById('color-picker-group');
  if (colorPickerGroup) {
    colorPickerGroup.style.display = (animalType === 'circle') ? '' : 'none';
  }
  const conductorSelfieBtn = document.getElementById('conductor-selfie-btn');
  if (conductorSelfieBtn) {
    conductorSelfieBtn.style.display = (animalType === 'conductor') ? '' : 'none';
  }
  const directionGroup = document.getElementById('direction-group');
  if (directionGroup) {
    directionGroup.style.display = (animalType === 'conductor') ? 'none' : '';
  }
}

// Function to create animals based on selected type
function createAnimals() {
  switch(animalType) {
    case 'circle':
      animal1 = new Circle(1);
      animal2 = new Circle(-1);
      break;
    case 'pig':
      animal1 = new Pig(1);
      animal2 = new Pig(-1);
      break;
    case 'selfie':
      animal1 = new Selfie(1);
      animal2 = new Selfie(-1);
      break;
    case 'conductor':
      animal1 = new Conductor(1);  // right hand
      animal2 = new Conductor(-1); // left hand
      break;
    default:
      animal1 = new Circle(1);
      animal2 = new Circle(-1);
      break;
  }
}

// ── Counting Trainer UI ──────────────────────────────────────────────────────
function initCountingTrainerListeners() {
  var ctBtn = document.getElementById('counting-trainer-btn');
  var ctModal = document.getElementById('counting-trainer-modal');
  var ctCloseBtn = document.getElementById('ct-close-btn');
  var ctEnabledCheckbox = document.getElementById('ct-enabled');
  var ctSoundCheckbox = document.getElementById('ct-sound-on');
  var ctVisualCheckbox = document.getElementById('ct-visual-on');
  var ctMeasuresInput = document.getElementById('ct-measures');
  var ctExtraBeatsInput = document.getElementById('ct-extra-beats');

  // Open modal
  if (ctBtn) {
    ctBtn.addEventListener('click', function() {
      ctModal.classList.remove('hidden');
    });
  }

  // Close modal
  if (ctCloseBtn) {
    ctCloseBtn.addEventListener('click', function() {
      ctModal.classList.add('hidden');
    });
  }

  // Close on backdrop click
  if (ctModal) {
    ctModal.addEventListener('click', function(e) {
      if (e.target === ctModal) ctModal.classList.add('hidden');
    });
  }

  // Enable/disable toggle
  if (ctEnabledCheckbox) {
    ctEnabledCheckbox.checked = countingTrainerEnabled;
    ctEnabledCheckbox.addEventListener('change', function(e) {
      countingTrainerEnabled = e.target.checked;
      if (ctBtn) {
        ctBtn.classList.toggle('ct-active', countingTrainerEnabled);
      }
      sendStateUpdate();
    });
  }

  // Sound on/off during counting
  if (ctSoundCheckbox) {
    ctSoundCheckbox.checked = ctSoundOn;
    ctSoundCheckbox.addEventListener('change', function(e) {
      ctSoundOn = e.target.checked;
      sendStateUpdate();
    });
  }

  // Visual on/off during counting
  if (ctVisualCheckbox) {
    ctVisualCheckbox.checked = ctVisualOn;
    ctVisualCheckbox.addEventListener('change', function(e) {
      ctVisualOn = e.target.checked;
      sendStateUpdate();
    });
  }

  // Measures input
  if (ctMeasuresInput) {
    ctMeasuresInput.value = ctTargetMeasures;
    ctMeasuresInput.addEventListener('change', function(e) {
      ctTargetMeasures = Math.max(0, Math.min(99, parseInt(e.target.value) || 0));
      // Ensure at least 1 total beat (0 measures requires extra beats > 0)
      if (ctTargetMeasures === 0 && ctTargetExtraBeats === 0) ctTargetExtraBeats = 1;
      if (ctExtraBeatsInput) ctExtraBeatsInput.value = ctTargetExtraBeats;
      e.target.value = ctTargetMeasures;
      sendStateUpdate();
    });
  }

  // Extra beats input
  if (ctExtraBeatsInput) {
    ctExtraBeatsInput.value = ctTargetExtraBeats;
    ctExtraBeatsInput.addEventListener('change', function(e) {
      ctTargetExtraBeats = Math.max(0, Math.min(beatsPerMeasure - 1, parseInt(e.target.value) || 0));
      // Ensure at least 1 total beat
      if (ctTargetMeasures === 0 && ctTargetExtraBeats === 0) ctTargetExtraBeats = 1;
      e.target.value = ctTargetExtraBeats;
      sendStateUpdate();
    });
  }

  // Stepper buttons
  var measMinus = document.getElementById('ct-measures-minus');
  var measPlus = document.getElementById('ct-measures-plus');
  var beatsMinus = document.getElementById('ct-beats-minus');
  var beatsPlus = document.getElementById('ct-beats-plus');

  if (measMinus) {
    measMinus.addEventListener('click', function() {
      ctTargetMeasures = Math.max(0, ctTargetMeasures - 1);
      // Ensure at least 1 total beat
      if (ctTargetMeasures === 0 && ctTargetExtraBeats === 0) {
        ctTargetExtraBeats = 1;
        if (ctExtraBeatsInput) ctExtraBeatsInput.value = ctTargetExtraBeats;
      }
      if (ctMeasuresInput) ctMeasuresInput.value = ctTargetMeasures;
      sendStateUpdate();
    });
  }
  if (measPlus) {
    measPlus.addEventListener('click', function() {
      ctTargetMeasures = Math.min(99, ctTargetMeasures + 1);
      if (ctMeasuresInput) ctMeasuresInput.value = ctTargetMeasures;
      sendStateUpdate();
    });
  }
  if (beatsMinus) {
    beatsMinus.addEventListener('click', function() {
      var minBeats = ctTargetMeasures === 0 ? 1 : 0;
      ctTargetExtraBeats = Math.max(minBeats, ctTargetExtraBeats - 1);
      if (ctExtraBeatsInput) ctExtraBeatsInput.value = ctTargetExtraBeats;
      sendStateUpdate();
    });
  }
  if (beatsPlus) {
    beatsPlus.addEventListener('click', function() {
      ctTargetExtraBeats = Math.min(beatsPerMeasure - 1, ctTargetExtraBeats + 1);
      if (ctExtraBeatsInput) ctExtraBeatsInput.value = ctTargetExtraBeats;
      sendStateUpdate();
    });
  }

  // Set initial button state
  if (ctBtn && countingTrainerEnabled) {
    ctBtn.classList.add('ct-active');
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// Setup p5.js canvas
function setup() {
  // Calculate responsive canvas size
  const size = getCanvasSize();
  canvasWidth = size.width;
  canvasHeight = size.height;
  canvasScale = size.scale;

  var canvas = createCanvas(canvasWidth, canvasHeight);
  canvas.parent(document.querySelector('.canvas-wrapper'));
  frameRate(120); // Higher frame rate for smoother animation at fast tempos
  xpos = canvasWidth / 2 + rad;

  // Create 2 animal instances
  createAnimals();

  // Initialize camera listeners for selfie feature
  initCameraListeners();

  // Initialize settings modal listeners
  initSettingsListeners();

  // Initialize fullscreen listeners
  initFullscreenListeners();

  // Initialize counting trainer listeners
  initCountingTrainerListeners();

  document.querySelector('#animal-selector').addEventListener('change', e => {
    animalType = e.target.value;

    // Show/hide color picker and conductor selfie button based on animation type
    updateColorPickerVisibility();

    // Always open camera when selfie is selected (allows retaking)
    if (animalType === 'selfie') {
      cameraTarget = 'selfie';
      openCamera();
    }

    createAnimals(); // Recreate animals when selection changes
    sendStateUpdate();
  });

  // Conductor selfie button — opens camera to capture a face for the conductor
  document.getElementById('conductor-selfie-btn').addEventListener('click', () => {
    cameraTarget = 'conductor';
    openCamera();
  });

  // Bounce direction dropdown
  document.querySelector('#bounce-direction').addEventListener('change', e => {
    bounceDirection = e.target.value;
    sendStateUpdate();
  });

  // Initial color picker visibility
  updateColorPickerVisibility();

  // Tempo marking dropdown - sets BPM based on Italian tempo terms
  document.querySelector('#tempo-marking').addEventListener('change', e => {
    const bpm = parseInt(e.target.value);
    if (bpm) {
      applyBPM(bpm);
      // Reset dropdown to placeholder so it can be re-selected
      e.target.value = '';
    }
  });

  // Start WebSocket remote control (only active when running from local server)
  initRemoteControl();
}

// Handle window resize for responsive canvas
function windowResized() {
  const size = isFullscreen ? getFullscreenCanvasSize() : getCanvasSize();
  canvasWidth = size.width;
  canvasHeight = size.height;
  canvasScale = size.scale;
  resizeCanvas(canvasWidth, canvasHeight);
}


// ── Counting Trainer display helpers ──────────────────────────────────────────

// Show the counting overlay with pre-computed values (avoids race with async Draw)
function updateCtDisplayWith(measDisplay, beatDisplay, elapsed, totalTarget) {
  var wrapper = isFullscreen
    ? document.querySelector('.fullscreen-canvas-wrapper')
    : document.querySelector('.canvas-wrapper');
  if (!wrapper) return;

  var el = wrapper.querySelector('.ct-measure-display');
  if (!el) {
    el = document.createElement('div');
    el.className = 'ct-measure-display counting';
    wrapper.appendChild(el);
  }
  el.className = 'ct-measure-display counting';
  // Hide the beat/measure text when visual is off so it doesn't
  // give a visual rhythm cue by updating each beat
  if (!ctVisualOn) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = 'Measure ' + measDisplay + ', Beat ' + beatDisplay +
    '  |  ' + elapsed + ' / ' + totalTarget + ' beats';
  el.classList.remove('hidden');
}

// Initial display when counting phase begins (beat 1 of measure 1, 0 elapsed)
function updateCtDisplay() {
  var totalTarget = ctTargetMeasures * beatsPerMeasure + ctTargetExtraBeats;
  updateCtDisplayWith(1, 1, 0, totalTarget);
}

function showCtDoneFeedback() {
  var wrapper = isFullscreen
    ? document.querySelector('.fullscreen-canvas-wrapper')
    : document.querySelector('.canvas-wrapper');
  if (!wrapper) return;

  // Update measure display to show "Done!"
  var el = wrapper.querySelector('.ct-measure-display');
  if (!el) {
    el = document.createElement('div');
    el.className = 'ct-measure-display';
    wrapper.appendChild(el);
  }
  el.className = 'ct-measure-display done';
  el.textContent = 'Time is up!';
  el.classList.remove('hidden');

  // Add green flash overlay
  var overlay = wrapper.querySelector('.ct-canvas-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'ct-canvas-overlay';
    wrapper.appendChild(overlay);
  }
  overlay.className = 'ct-canvas-overlay ct-done-flash';
}

function hideCtDisplay() {
  // Clean up from both wrappers (normal + fullscreen)
  ['.canvas-wrapper', '.fullscreen-canvas-wrapper'].forEach(function(sel) {
    var wrapper = document.querySelector(sel);
    if (!wrapper) return;
    var el = wrapper.querySelector('.ct-measure-display');
    if (el) el.remove();
    var overlay = wrapper.querySelector('.ct-canvas-overlay');
    if (overlay) overlay.remove();
  });
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Song Mode helpers ────────────────────────────────────────────────────────

// Sync UI controls when a new section starts
function applySongSectionUI(sec) {
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
function updateSongProgressDisplay() {
  if (!songModeEnabled || songSections.length === 0) return;
  var wrapper = isFullscreen
    ? document.querySelector('.fullscreen-canvas-wrapper')
    : document.querySelector('.canvas-wrapper');
  if (!wrapper) return;

  var el = wrapper.querySelector('.song-progress-display');
  if (!el) {
    el = document.createElement('div');
    el.className = 'song-progress-display';
    wrapper.appendChild(el);
  }

  if (songCurrentSection < 0 || songCurrentSection >= songSections.length) {
    el.textContent = 'Song complete';
    el.className = 'song-progress-display done';
    return;
  }

  var sec = songSections[songCurrentSection];
  el.className = 'song-progress-display active';
  el.textContent = 'Section ' + (songCurrentSection + 1) + '/' + songSections.length +
    '  |  Measure ' + (songMeasureInSection + 1) + '/' + sec.measures +
    '  |  ' + sec.beatsPerMeasure + '/4 at ' + sec.bpm + ' BPM';
}

function hideSongProgressDisplay() {
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
  if (songSections.length === 0) {
    alert('Add at least one section before saving.');
    return;
  }
  var title = (songTitle || '').trim() || 'Untitled Song';
  var songs = getSavedSongs();
  songs.push({
    id: Date.now(),
    title: title,
    sections: JSON.parse(JSON.stringify(songSections)),
    savedAt: new Date().toLocaleDateString()
  });
  localStorage.setItem(_VM_SONGS_KEY, JSON.stringify(songs));
  renderSavedSongsList();
}

function loadSavedSong(id) {
  var songs = getSavedSongs();
  var entry = songs.find(function(s) { return s.id === id; });
  if (!entry) return;
  songSections = JSON.parse(JSON.stringify(entry.sections));
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
    songEnabledCheckbox.checked = songModeEnabled;
    songEnabledCheckbox.addEventListener('change', function(e) {
      songModeEnabled = e.target.checked;
      if (songBtn) songBtn.classList.toggle('ct-active', songModeEnabled);
      // Cancel custom rhythm when entering song mode
      if (songModeEnabled) {
        crCancelCustomRhythm();
      }
      sendStateUpdate();
    });
  }

  if (songAddBtn) {
    songAddBtn.addEventListener('click', function() {
      // Default: current settings or 4 measures, 4/4, 120 BPM
      songSections.push({
        measures: 16,
        beatsPerMeasure: beatsPerMeasure,
        bpm: cachedBPM,
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

  if (songSections.length === 0) {
    var empty = document.createElement('p');
    empty.className = 'setting-hint';
    empty.style.textAlign = 'center';
    empty.textContent = 'No sections yet. Click + to add one.';
    listEl.appendChild(empty);
    return;
  }

  songSections.forEach(function(sec, idx) {
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
        songSections[i].measures = Math.max(1, Math.min(999, parseInt(e.target.value) || 1));
        e.target.value = songSections[i].measures;
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
        songSections[i].beatsPerMeasure = parseInt(e.target.value);
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
        songSections[i].bpm = Math.max(30, Math.min(300, parseInt(e.target.value) || 120));
        e.target.value = songSections[i].bpm;
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
        songSections.splice(i, 1);
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
          songSections[i].transitionBeats = Math.max(0, Math.min(999, parseInt(e.target.value) || 0));
          e.target.value = songSections[i].transitionBeats;
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
          songSections[i].transitionUnit = e.target.value;
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
        songSections[i].ritardandoEnabled = e.target.checked;
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
        songSections[i].ritardandoBeats = Math.max(1, Math.min(999, parseInt(e.target.value) || 4));
        e.target.value = songSections[i].ritardandoBeats;
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
        songSections[i].ritardandoUnit = e.target.value;
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
        songSections[i].ritardandoPercent = Math.max(1, Math.min(99, parseInt(e.target.value) || 30));
        e.target.value = songSections[i].ritardandoPercent;
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
// ─────────────────────────────────────────────────────────────────────────────

function draw() {
  // Flash white at beat (when progress is near 0) if enabled
  const progress = getAnimationProgress();
  // Suppress beat flash when counting trainer hides visuals
  const ctHideVisual = ctPhase === 'counting' && !ctVisualOn;
  const isFlashing = flashEnabled && !ctHideVisual && Tone.Transport.state === 'started' && progress < 0.08;
  // Counting trainer "done" flash: green background
  const isDoneFlashing = ctPhase === 'done' && Tone.Transport.state === 'started';
  // Compute the base background colour, blending in a warm amber tint
  // when a tempo transition ramp is active.  rampProgress runs 0→1 over
  // the ramp window; inverting it (1 - rampProgress) makes the tint
  // brightest at the first ramp beat and fades to normal as the new tempo
  // is reached.
  const baseColor        = color(105, 105, 105);   // #696969 — normal grey
  const rampColor        = color(180, 120,  40);   // warm amber for transition ramp
  const ritardandoColor  = color( 40, 140, 180);   // teal blue for ritardando
  const bgColor = (ritardandoProgress > 0)
    ? lerpColor(baseColor, ritardandoColor, (1 - ritardandoProgress) * 0.45)
    : (rampProgress > 0)
      ? lerpColor(baseColor, rampColor, (1 - rampProgress) * 0.45)
      : baseColor;

  if (isDoneFlashing && progress < 0.12) {
    background('#48bb78');
  } else if (isFlashing) {
    background('white');
  } else {
    background(bgColor);
  }

  // In fullscreen, also flash the overlay background so the entire screen flashes
  if (isFullscreen) {
    const overlay = document.getElementById('fullscreen-overlay');
    if (overlay) {
      if (isDoneFlashing && progress < 0.12) {
        overlay.style.background = '#48bb78';
      } else if (isFlashing) {
        overlay.style.background = 'white';
      } else {
        overlay.style.background = `rgb(${red(bgColor)},${green(bgColor)},${blue(bgColor)})`;
      }
    }
  }

  // Scale all drawing to fit responsive canvas
  push();
  scale(canvasScale);

  if (ctHideVisual) {
    // Skip animal rendering — canvas stays blank (just background)
  } else if (animalType === 'conductor') {
    // Conductor mode: both hands move in a 2D beat pattern regardless of direction setting
    animal1.pigmove();
    animal2.pigmove();
    animal1.display();
    animal2.display();
  } else if (bounceDirection === 'vertical') {
    // Vertical mode: one object bouncing against a horizontal line
    const lineY = 420;

    // Draw the horizontal line
    stroke(200);
    strokeWeight(4);
    line(120, lineY, 520, lineY);
    noStroke();

    // Position the single animal at center X, vertical Y
    animal1.x = 320; // Center of 640 width
    animal1.y = getVerticalY();
    animal1.display();
  } else {
    // Horizontal mode: two objects bouncing toward each other
    animal1.pigmove();
    animal2.pigmove();

    animal1.display();
    animal2.display();
  }

  // Counting trainer "ready" indicator — shown when armed and not yet playing
  if (countingTrainerEnabled && Tone.Transport.state !== 'started') {
    // Semi-transparent banner at top of canvas
    var bannerY = 18;
    var totalBeats = ctTargetMeasures * beatsPerMeasure + ctTargetExtraBeats;
    var label = 'Counting Trainer: ';
    if (ctTargetMeasures > 0 && ctTargetExtraBeats > 0) {
      label += ctTargetMeasures + (ctTargetMeasures === 1 ? ' measure' : ' measures') +
        ' + ' + ctTargetExtraBeats + (ctTargetExtraBeats === 1 ? ' beat' : ' beats');
    } else if (ctTargetMeasures > 0) {
      label += ctTargetMeasures + (ctTargetMeasures === 1 ? ' measure' : ' measures');
    } else {
      label += ctTargetExtraBeats + (ctTargetExtraBeats === 1 ? ' beat' : ' beats');
    }

    noStroke();
    fill(102, 126, 234, 180);
    rectMode(CENTER);
    var tw = textWidth(label);
    // Set font before measuring so width is accurate
    textFont('Inter, sans-serif');
    textSize(15);
    textStyle(BOLD);
    tw = textWidth(label);
    rect(320, bannerY, tw + 32, 28, 14);

    fill(255);
    textAlign(CENTER, CENTER);
    text(label, 320, bannerY);

    // Second line: sound/visual mode
    var modeLabel = (ctSoundOn ? 'Sound ON' : 'Sound OFF') + '  |  ' +
                    (ctVisualOn ? 'Visual ON' : 'Visual OFF');
    textSize(12);
    textStyle(NORMAL);
    var modeY = bannerY + 24;
    var mtw = textWidth(modeLabel);
    fill(102, 126, 234, 140);
    rect(320, modeY, mtw + 24, 22, 11);
    fill(255, 255, 255, 220);
    text(modeLabel, 320, modeY);

    // Reset text style
    textStyle(NORMAL);
    rectMode(CORNER);
  }

  // Song mode "ready" indicator — shown when armed and not yet playing
  if (songModeEnabled && songSections.length > 0 && Tone.Transport.state !== 'started') {
    var songBannerY = countingTrainerEnabled ? 66 : 18;
    var totalMeas = 0;
    for (var si = 0; si < songSections.length; si++) totalMeas += songSections[si].measures;
    var songLabel = 'Song Mode: ' + songSections.length +
      (songSections.length === 1 ? ' section' : ' sections') +
      ', ' + totalMeas + ' measures';

    noStroke();
    fill(118, 75, 162, 180);
    rectMode(CENTER);
    textFont('Inter, sans-serif');
    textSize(15);
    textStyle(BOLD);
    var stw = textWidth(songLabel);
    rect(320, songBannerY, stw + 32, 28, 14);

    fill(255);
    textAlign(CENTER, CENTER);
    text(songLabel, 320, songBannerY);

    textStyle(NORMAL);
    rectMode(CORNER);
  }

  pop();
}

// ═══════════════════════════════════════════════════════════════════════════
// REMOTE CONTROL
//
// Auto-selects a transport on startup:
//
//   WebSocket relay  (node server.js, local network)
//     – tries ws:// on the same host; if it connects within 1.5 s, use it
//     – QR code encodes http://<local-IP>/remote.html  (phone on same Wi-Fi)
//
//   PeerJS / WebRTC  (GitHub Pages or any static host)
//     – fallback when WebSocket fails to connect
//     – desktop gets a PeerJS peer ID; QR code encodes
//       <origin>/remote.html?p=<peerID>
//     – phone opens that URL, connects directly P2P via WebRTC data channel
//
// The 📱 button is hidden until one transport is confirmed ready.
// ═══════════════════════════════════════════════════════════════════════════

var _remoteMode = null;   // 'ws' | 'peer'
var _remoteWS   = null;
var _peer       = null;
var _peerId     = null;
var _peerConns  = new Set();

function initRemoteControl() {
  var remoteBtn        = document.getElementById('remote-btn');
  var remoteModal      = document.getElementById('remote-modal');
  var remoteModalClose = document.getElementById('remote-modal-close-btn');

  // ── Transport detection ──────────────────────────────────────────────────
  // Try WebSocket to the local server first.  If it connects quickly we stay
  // in WS mode; otherwise we initialise PeerJS for the GitHub Pages case.
  var modeDecided = false;

  function decidePeer() {
    if (modeDecided) return;
    modeDecided = true;
    _remoteMode = 'peer';
    initPeerMode(remoteBtn);
  }

  function decideWS(ws) {
    if (modeDecided) return;
    modeDecided = true;
    _remoteMode = 'ws';
    _attachWSHandlers(ws, remoteBtn);
    // Also start PeerJS as a backup transport for restricted networks (e.g. school
    // WiFi that blocks port 9090 or uses AP isolation). The peer QR code will be
    // shown alongside the local-network QR code in the remote modal.
    initPeerMode(null);
  }

  // Opened in an IIFE so the inner tryWS can tail-call itself for reconnects
  (function tryWS() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var ws    = new WebSocket(proto + '//' + location.host);

    ws.onopen  = function () { decideWS(ws); };
    ws.onerror = function () {};  // onclose follows; handled below

    ws.onclose = function () {
      if (_remoteMode === 'ws') {
        // Mid-session drop after mode was confirmed: reconnect
        _remoteWS = null;
        setTimeout(tryWS, 3000);
      }
      // If still in detection phase, the timeout below fires decidePeer
    };

    // If WS hasn't connected within 1.5 s, assume no local server → PeerJS
    setTimeout(function () {
      if (!modeDecided) { try { ws.close(); } catch (e) {} decidePeer(); }
    }, 1500);
  })();

  // ── Modal wiring ─────────────────────────────────────────────────────────
  if (remoteBtn) {
    remoteBtn.addEventListener('click', showQRModal);
  }
  if (remoteModalClose) {
    remoteModalClose.addEventListener('click', function () {
      if (remoteModal) remoteModal.classList.add('hidden');
    });
  }
  if (remoteModal) {
    remoteModal.addEventListener('click', function (e) {
      if (e.target === remoteModal) remoteModal.classList.add('hidden');
    });
  }
}

function _attachWSHandlers(ws, remoteBtn) {
  _remoteWS = ws;
  if (remoteBtn) remoteBtn.classList.remove('hidden');
  sendStateUpdate();
  ws.onmessage = function (evt) {
    try { applyRemoteCommand(JSON.parse(evt.data)); } catch (e) {}
  };
  // ws.onclose reconnect is already wired in the tryWS IIFE above
}

// ── QR rendering helper ──────────────────────────────────────────────────────
function _renderQR(container, url) {
  container.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    new QRCode(container, {
      text: url, width: 200, height: 200,
      colorDark: '#000000', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
  }
}

// ── PeerJS (desktop side) ────────────────────────────────────────────────────
function initPeerMode(remoteBtn) {
  if (typeof Peer === 'undefined') return; // CDN not loaded

  _peer = new Peer();

  _peer.on('open', function (id) {
    _peerId = id;
    if (remoteBtn) remoteBtn.classList.remove('hidden');
    // If the QR modal is already open in dual-QR (WS) mode, fill in the peer
    // QR code now — it couldn't be rendered earlier because we didn't have an
    // ID yet.
    var dualSection = document.getElementById('remote-dual-section');
    if (dualSection && !dualSection.classList.contains('hidden')) {
      var peerQrEl  = document.getElementById('qr-code-peer');
      var peerUrlEl = document.getElementById('remote-url-peer');
      var pUrl = location.origin + '/remote.html?p=' + id;
      if (peerQrEl)  _renderQR(peerQrEl, pUrl);
      if (peerUrlEl) peerUrlEl.textContent = pUrl;
    }
  });

  _peer.on('connection', function (conn) {
    conn.on('open', function () {
      _peerConns.add(conn);
      _closeRemoteModal();
      // Push current state to the newly connected phone immediately
      if (conn.open) conn.send({
        type:             'stateUpdate',
        playing:          Tone.Transport.state === 'started',
        bpm:              cachedBPM,
        animation:        animalType,
        direction:        bounceDirection,
        beatsPerMeasure:  beatsPerMeasure,
        subdivision:      subdivision,
        swingEnabled:     swingEnabled,
        soundEnabled:     animalSoundEnabled,
        accentEnabled:    accentEnabled,
        flashEnabled:     flashEnabled,
        voiceCountEnabled: voiceCountEnabled,
        rockBeatEnabled:  rockBeatEnabled,
        waltzBeatEnabled: waltzBeatEnabled,
        isFullscreen:     isFullscreen,
        circleColor:      circleColor,
        countingTrainerEnabled: countingTrainerEnabled,
        ctTargetMeasures: ctTargetMeasures,
        ctTargetExtraBeats: ctTargetExtraBeats,
        ctSoundOn: ctSoundOn,
        ctVisualOn: ctVisualOn,
      });
    });
    conn.on('data', function (data) {
      try {
        var msg = (typeof data === 'string') ? JSON.parse(data) : data;
        applyRemoteCommand(msg);
      } catch (e) {}
    });
    conn.on('close', function () { _peerConns.delete(conn); });
    conn.on('error', function () { _peerConns.delete(conn); });
  });

  _peer.on('error', function (err) {
    console.warn('PeerJS:', err.type);
  });
}

// ── QR code modal ────────────────────────────────────────────────────────────
function showQRModal() {
  var remoteModal     = document.getElementById('remote-modal');
  var singleSection   = document.getElementById('remote-single-section');
  var dualSection     = document.getElementById('remote-dual-section');
  if (!remoteModal) return;

  remoteModal.classList.remove('hidden');

  if (_remoteMode === 'peer') {
    // Pure PeerJS mode (GitHub Pages / static host) — single QR
    var qrContainer = document.getElementById('qr-code');
    var urlEl       = document.getElementById('remote-url');
    var hintEl      = document.getElementById('remote-modal-hint');
    if (singleSection) singleSection.classList.remove('hidden');
    if (dualSection)   dualSection.classList.add('hidden');
    if (hintEl) hintEl.textContent = 'Scan on your phone. Works on any network.';
    if (_peerId) {
      var peerUrl = location.origin + '/remote.html?p=' + _peerId;
      if (qrContainer) _renderQR(qrContainer, peerUrl);
      if (urlEl) urlEl.textContent = peerUrl;
    } else {
      if (urlEl) urlEl.textContent = 'Connecting to PeerJS\u2026 please wait a moment.';
    }
  } else if (_remoteMode === 'ws') {
    // WS mode — show two QR codes: local-network (WS) + any-network (PeerJS backup)
    if (singleSection) singleSection.classList.add('hidden');
    if (dualSection)   dualSection.classList.remove('hidden');
    var wsQrEl    = document.getElementById('qr-code-ws');
    var wsUrlEl   = document.getElementById('remote-url-ws');
    var peerQrEl  = document.getElementById('qr-code-peer');
    var peerUrlEl = document.getElementById('remote-url-peer');

    fetch('/api/info')
      .then(function (r) { return r.json(); })
      .then(function (info) {
        var wsUrl = 'http://' + info.ip + ':' + info.port + '/remote.html';
        if (wsQrEl)  _renderQR(wsQrEl, wsUrl);
        if (wsUrlEl) wsUrlEl.textContent = wsUrl;
      })
      .catch(function () {
        if (wsUrlEl) wsUrlEl.textContent = 'Could not reach server \u2014 is node server.js running?';
      });

    if (_peerId) {
      var pUrl = location.origin + '/remote.html?p=' + _peerId;
      if (peerQrEl)  _renderQR(peerQrEl, pUrl);
      if (peerUrlEl) peerUrlEl.textContent = pUrl;
    } else {
      if (peerUrlEl) peerUrlEl.textContent = 'Connecting\u2026 please reopen this dialog in a moment.';
    }
  }
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function _closeRemoteModal() {
  var el = document.getElementById('remote-modal');
  if (el) el.classList.add('hidden');
}

// ── State broadcast ───────────────────────────────────────────────────────────
function sendStateUpdate() {
  var state = {
    type:             'stateUpdate',
    playing:          Tone.Transport.state === 'started',
    bpm:              cachedBPM,
    animation:        animalType,
    direction:        bounceDirection,
    beatsPerMeasure:  beatsPerMeasure,
    subdivision:      subdivision,
    swingEnabled:     swingEnabled,
    soundEnabled:     animalSoundEnabled,
    accentEnabled:    accentEnabled,
    flashEnabled:     flashEnabled,
    voiceCountEnabled: voiceCountEnabled,
    rockBeatEnabled:  rockBeatEnabled,
    waltzBeatEnabled: waltzBeatEnabled,
    isFullscreen:     isFullscreen,
    circleColor:      circleColor,
    bluetoothDelay:   bluetoothDelay,
    countingTrainerEnabled: countingTrainerEnabled,
    ctTargetMeasures: ctTargetMeasures,
    ctTargetExtraBeats: ctTargetExtraBeats,
    ctSoundOn: ctSoundOn,
    ctVisualOn: ctVisualOn,
  };
  if (_remoteMode === 'ws' && _remoteWS && _remoteWS.readyState === WebSocket.OPEN) {
    _remoteWS.send(JSON.stringify(state));
  }
  // Send to any active PeerJS connections regardless of primary transport mode.
  // In WS mode, PeerJS runs as a backup for restricted networks (e.g. school WiFi).
  _peerConns.forEach(function (conn) {
    if (conn.open) conn.send(state);
  });
}

// ── Command handler (shared by both transports) ───────────────────────────────
function applyRemoteCommand(msg) {
  // Any message from the phone means it's connected — dismiss the QR modal
  _closeRemoteModal();

  switch (msg.type) {
    case 'play':
      if (Tone.Transport.state !== 'started') {
        _ensureAudioContext(function () { toggleTransport(false); });
      }
      break;

    case 'playWithCountIn1':
      if (Tone.Transport.state !== 'started') {
        _ensureAudioContext(function () { toggleTransport(1); });
      }
      break;

    case 'playWithCountIn':
      if (Tone.Transport.state !== 'started') {
        _ensureAudioContext(function () { toggleTransport(2); });
      }
      break;

    case 'stop':
      if (Tone.Transport.state === 'started') {
        toggleTransport(false);
      }
      break;

    case 'setBPM': {
      applyBPM(Math.round(msg.bpm));
      break;
    }

    case 'setAnimation': {
      var val = msg.value;
      if (['circle', 'pig', 'selfie', 'conductor'].indexOf(val) === -1) break;
      animalType = val;
      var selector = document.getElementById('animal-selector');
      if (selector) selector.value = val;
      updateColorPickerVisibility();
      createAnimals();
      sendStateUpdate();
      break;
    }

    case 'setDirection': {
      var dir = msg.value;
      if (dir !== 'horizontal' && dir !== 'vertical') break;
      bounceDirection = dir;
      var dirSel = document.getElementById('bounce-direction');
      if (dirSel) dirSel.value = dir;
      sendStateUpdate();
      break;
    }

    case 'setBeatsPerMeasure': {
      var bpm = parseInt(msg.value);
      if (bpm < 1 || bpm > 9 || isNaN(bpm)) break;
      beatsPerMeasure = bpm;
      currentBeat = 0;
      var tsSel = document.getElementById('time-signature');
      if (tsSel) tsSel.value = bpm;
      // Auto-disable rock beat if not 4/4
      if (bpm !== 4 && rockBeatEnabled) {
        rockBeatEnabled = false;
        var rbCb = document.getElementById('rock-beat-enabled');
        if (rbCb) rbCb.checked = false;
      }
      var rbGroup = document.getElementById('rock-beat-setting-group');
      if (rbGroup) rbGroup.style.display = bpm === 4 ? '' : 'none';
      // Auto-disable waltz beat if not 3/4
      if (bpm !== 3 && waltzBeatEnabled) {
        waltzBeatEnabled = false;
        var wbCb = document.getElementById('waltz-beat-enabled');
        if (wbCb) wbCb.checked = false;
      }
      var wbGroup = document.getElementById('waltz-beat-setting-group');
      if (wbGroup) wbGroup.style.display = bpm === 3 ? '' : 'none';
      sendStateUpdate();
      break;
    }

    case 'setSubdivision': {
      var sub = msg.value;
      if (['none', 'eighth', 'triplet', 'sixteenth'].indexOf(sub) === -1) break;
      subdivision = sub;
      var subSel = document.getElementById('subdivision');
      if (subSel) subSel.value = sub;
      // Update swing visibility and auto-disable if leaving eighth
      var swingGrp = document.getElementById('swing-group');
      if (swingGrp) swingGrp.style.display = (sub === 'eighth') ? '' : 'none';
      if (sub !== 'eighth' && swingEnabled) {
        swingEnabled = false;
        var swCb = document.getElementById('swing-enabled');
        if (swCb) swCb.checked = false;
      }
      sendStateUpdate();
      break;
    }

    case 'setSwingEnabled': {
      swingEnabled = !!msg.value;
      var swingCb2 = document.getElementById('swing-enabled');
      if (swingCb2) swingCb2.checked = swingEnabled;
      sendStateUpdate();
      break;
    }

    case 'setSoundEnabled': {
      animalSoundEnabled = !!msg.value;
      var sndCb = document.getElementById('animal-sound-enabled');
      if (sndCb) sndCb.checked = animalSoundEnabled;
      sendStateUpdate();
      break;
    }

    case 'setAccentEnabled': {
      accentEnabled = !!msg.value;
      var accCb = document.getElementById('accent-enabled');
      if (accCb) accCb.checked = accentEnabled;
      sendStateUpdate();
      break;
    }

    case 'setFlashEnabled': {
      flashEnabled = !!msg.value;
      var flCb = document.getElementById('flash-enabled');
      if (flCb) flCb.checked = flashEnabled;
      sendStateUpdate();
      break;
    }

    case 'setVoiceCountEnabled': {
      voiceCountEnabled = !!msg.value;
      var vcCb = document.getElementById('voice-count-enabled');
      if (vcCb) vcCb.checked = voiceCountEnabled;
      sendStateUpdate();
      break;
    }

    case 'setRockBeatEnabled': {
      if (beatsPerMeasure !== 4) break;
      rockBeatEnabled = !!msg.value;
      var rbCb2 = document.getElementById('rock-beat-enabled');
      if (rbCb2) rbCb2.checked = rockBeatEnabled;
      sendStateUpdate();
      break;
    }

    case 'setWaltzBeatEnabled': {
      if (beatsPerMeasure !== 3) break;
      waltzBeatEnabled = !!msg.value;
      var wbCb2 = document.getElementById('waltz-beat-enabled');
      if (wbCb2) wbCb2.checked = waltzBeatEnabled;
      sendStateUpdate();
      break;
    }

    case 'toggleFullscreen': {
      if (isFullscreen) {
        exitFullscreen();
      } else {
        enterFullscreen();
      }
      sendStateUpdate();
      break;
    }

    case 'setCircleColor': {
      var c = msg.value;
      if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) {
        circleColor = c;
        var cp = document.getElementById('circle-color');
        if (cp) cp.value = c;
        sendStateUpdate();
      }
      break;
    }

    case 'setBluetoothDelay': {
      var bd = parseInt(msg.value, 10);
      if (!isNaN(bd) && bd >= 0 && bd <= 500) {
        bluetoothDelay = bd;
        var bdSlider = document.getElementById('bluetooth-delay-slider');
        var bdValue  = document.getElementById('bluetooth-delay-value');
        if (bdSlider) bdSlider.value = bd;
        if (bdValue)  bdValue.textContent = bd;
        sendStateUpdate();
      }
      break;
    }

    case 'setCountingTrainerEnabled': {
      countingTrainerEnabled = !!msg.value;
      var ctCb = document.getElementById('ct-enabled');
      if (ctCb) ctCb.checked = countingTrainerEnabled;
      var ctBtnEl = document.getElementById('counting-trainer-btn');
      if (ctBtnEl) ctBtnEl.classList.toggle('ct-active', countingTrainerEnabled);
      sendStateUpdate();
      break;
    }

    case 'setCtTargetMeasures': {
      var m = parseInt(msg.value);
      if (!isNaN(m) && m >= 1 && m <= 99) {
        ctTargetMeasures = m;
        var ctMIn = document.getElementById('ct-measures');
        if (ctMIn) ctMIn.value = m;
        sendStateUpdate();
      }
      break;
    }

    case 'setCtTargetExtraBeats': {
      var b = parseInt(msg.value);
      if (!isNaN(b) && b >= 0 && b <= 8) {
        ctTargetExtraBeats = b;
        var ctBIn = document.getElementById('ct-extra-beats');
        if (ctBIn) ctBIn.value = b;
        sendStateUpdate();
      }
      break;
    }

    case 'setCtSoundOn': {
      ctSoundOn = !!msg.value;
      var ctSCb = document.getElementById('ct-sound-on');
      if (ctSCb) ctSCb.checked = ctSoundOn;
      sendStateUpdate();
      break;
    }

    case 'setCtVisualOn': {
      ctVisualOn = !!msg.value;
      var ctVCb = document.getElementById('ct-visual-on');
      if (ctVCb) ctVCb.checked = ctVisualOn;
      sendStateUpdate();
      break;
    }

    case 'requestState':
      sendStateUpdate();
      break;
  }
}

// ── Custom Rhythm Editor ────────────────────────────────────────────────────

// Available rhythm options per beat (quarter note = 1 beat)
var CR_OPTIONS = [
  { value: 'q',    label: '♩ Quarter note',           subBeats: [1] },
  { value: 'r',    label: '𝄾 Quarter rest',            subBeats: [] },
  { value: 'ee',   label: '♫ Two eighths',             subBeats: [1, 0.5] },
  { value: 'er',   label: '♪𝄾 Eighth + eighth rest',   subBeats: [1] },
  { value: 're',   label: '𝄾♪ Eighth rest + eighth',   subBeats: [0.5] },
  { value: 'ssss', label: '𝅘𝅥𝅯𝅘𝅥𝅯𝅘𝅥𝅯𝅘𝅥𝅯 Four sixteenths',     subBeats: [1, 0.75, 0.5, 0.25] },
  { value: 'sse',  label: '𝅘𝅥𝅯𝅘𝅥𝅯♪ Two sixteenths + eighth', subBeats: [1, 0.75, 0.5] },
  { value: 'ess',  label: '♪𝅘𝅥𝅯𝅘𝅥𝅯 Eighth + two sixteenths', subBeats: [1, 0.5, 0.25] },
];

// Map option value to sub-beat positions within the beat (as fractions of beat duration).
// Each entry is {offset: 0-1, velocity: 0-1} where offset is position within beat.
function crGetSubBeats(patternValue) {
  switch (patternValue) {
    case 'q':    return [{offset: 0, vel: 1.0}];
    case 'r':    return [];
    case 'ee':   return [{offset: 0, vel: 1.0}, {offset: 0.5, vel: 0.7}];
    case 'er':   return [{offset: 0, vel: 1.0}];
    case 're':   return [{offset: 0.5, vel: 0.7}];
    case 'ssss': return [{offset: 0, vel: 1.0}, {offset: 0.25, vel: 0.5}, {offset: 0.5, vel: 0.7}, {offset: 0.75, vel: 0.5}];
    case 'sse':  return [{offset: 0, vel: 1.0}, {offset: 0.25, vel: 0.5}, {offset: 0.5, vel: 0.7}];
    case 'ess':  return [{offset: 0, vel: 1.0}, {offset: 0.5, vel: 0.7}, {offset: 0.75, vel: 0.5}];
    default:     return [{offset: 0, vel: 1.0}];
  }
}

function crCancelCustomRhythm() {
  customRhythmEnabled = false;
  customRhythmPattern = [];
  var cb = document.getElementById('custom-rhythm-enabled');
  if (cb) cb.checked = false;
  var btn = document.getElementById('custom-rhythm-btn');
  if (btn) btn.classList.remove('ct-active');
}

// Build default pattern (all quarter notes) for current beatsPerMeasure
function crBuildDefaultPattern() {
  var pat = [];
  for (var i = 0; i < beatsPerMeasure; i++) pat.push('q');
  return pat;
}

// Render the beat selector dropdowns
function crRenderBeatSelectors() {
  var container = document.getElementById('custom-rhythm-beats');
  if (!container) return;
  container.innerHTML = '';

  // Ensure pattern length matches beatsPerMeasure
  while (customRhythmPattern.length < beatsPerMeasure) customRhythmPattern.push('q');
  if (customRhythmPattern.length > beatsPerMeasure) customRhythmPattern.length = beatsPerMeasure;

  for (var b = 0; b < beatsPerMeasure; b++) {
    var group = document.createElement('div');
    group.className = 'cr-beat-group';

    var label = document.createElement('div');
    label.className = 'cr-beat-label';
    label.textContent = 'Beat ' + (b + 1);
    group.appendChild(label);

    var select = document.createElement('select');
    select.className = 'cr-beat-select';
    select.dataset.beat = b;

    for (var o = 0; o < CR_OPTIONS.length; o++) {
      var opt = document.createElement('option');
      opt.value = CR_OPTIONS[o].value;
      opt.textContent = CR_OPTIONS[o].label;
      if (customRhythmPattern[b] === CR_OPTIONS[o].value) opt.selected = true;
      select.appendChild(opt);
    }

    select.addEventListener('change', function(e) {
      var beatIdx = parseInt(e.target.dataset.beat);
      customRhythmPattern[beatIdx] = e.target.value;
      crRenderNotation();
    });

    group.appendChild(select);
    container.appendChild(group);
  }
}

// ── SVG Notation Rendering ──────────────────────────────────────────────────
// Renders a simple staff-like SVG showing the rhythm pattern with standard notation.

function crRenderNotation() {
  var container = document.getElementById('custom-rhythm-notation');
  if (!container) return;

  var beatCount = customRhythmPattern.length;
  var beatWidth = 70;
  var totalWidth = beatCount * beatWidth + 40;
  var height = 100;
  var staffY = 50; // middle line of "staff"

  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + totalWidth + '" height="' + height + '" viewBox="0 0 ' + totalWidth + ' ' + height + '">';

  // Staff line (single line for rhythm notation)
  svg += '<line x1="10" y1="' + staffY + '" x2="' + (totalWidth - 10) + '" y2="' + staffY + '" stroke="#999" stroke-width="1"/>';

  // Time signature
  svg += '<text x="16" y="' + (staffY + 5) + '" font-size="16" font-weight="bold" fill="#333" font-family="serif">' + beatCount + '</text>';

  var xStart = 40;

  for (var b = 0; b < beatCount; b++) {
    var x = xStart + b * beatWidth;
    var pat = customRhythmPattern[b];

    // Beat number below
    svg += '<text x="' + (x + beatWidth / 2 - 4) + '" y="' + (staffY + 35) + '" font-size="11" fill="#666" font-family="sans-serif">' + (b + 1) + '</text>';

    // Draw barline before beat 1 equivalent
    if (b === 0) {
      svg += '<line x1="' + (x - 5) + '" y1="' + (staffY - 20) + '" x2="' + (x - 5) + '" y2="' + (staffY + 20) + '" stroke="#333" stroke-width="1.5"/>';
    }

    svg += crDrawBeatPattern(pat, x, staffY, beatWidth);
  }

  // Final barline
  svg += '<line x1="' + (xStart + beatCount * beatWidth + 2) + '" y1="' + (staffY - 20) + '" x2="' + (xStart + beatCount * beatWidth + 2) + '" y2="' + (staffY + 20) + '" stroke="#333" stroke-width="2.5"/>';
  svg += '<line x1="' + (xStart + beatCount * beatWidth - 2) + '" y1="' + (staffY - 20) + '" x2="' + (xStart + beatCount * beatWidth - 2) + '" y2="' + (staffY + 20) + '" stroke="#333" stroke-width="1"/>';

  svg += '</svg>';
  container.innerHTML = svg;
}

function crDrawBeatPattern(pat, x, y, w) {
  var svg = '';
  switch (pat) {
    case 'q': // Quarter note
      svg += crNoteHead(x + w / 2, y, false);
      svg += crStem(x + w / 2, y);
      break;

    case 'r': // Quarter rest
      svg += crQuarterRest(x + w / 2, y);
      break;

    case 'ee': // Two eighths
      var x1 = x + w * 0.25, x2 = x + w * 0.75;
      svg += crNoteHead(x1, y, false);
      svg += crStem(x1, y);
      svg += crNoteHead(x2, y, false);
      svg += crStem(x2, y);
      svg += crBeam(x1, x2, y - 25);
      break;

    case 'er': // Eighth + eighth rest
      svg += crNoteHead(x + w * 0.25, y, false);
      svg += crStem(x + w * 0.25, y);
      svg += crFlag(x + w * 0.25, y);
      svg += crEighthRest(x + w * 0.7, y);
      break;

    case 're': // Eighth rest + eighth
      svg += crEighthRest(x + w * 0.25, y);
      svg += crNoteHead(x + w * 0.7, y, false);
      svg += crStem(x + w * 0.7, y);
      svg += crFlag(x + w * 0.7, y);
      break;

    case 'ssss': // Four sixteenths
      var positions = [0.12, 0.37, 0.62, 0.87];
      for (var i = 0; i < 4; i++) {
        var px = x + w * positions[i];
        svg += crNoteHead(px, y, false);
        svg += crStem(px, y);
      }
      svg += crBeam(x + w * 0.12, x + w * 0.87, y - 25);
      svg += crBeam(x + w * 0.12, x + w * 0.87, y - 29);
      break;

    case 'sse': // Two sixteenths + eighth
      var s1 = x + w * 0.12, s2 = x + w * 0.37, e1 = x + w * 0.75;
      svg += crNoteHead(s1, y, false);
      svg += crStem(s1, y);
      svg += crNoteHead(s2, y, false);
      svg += crStem(s2, y);
      svg += crNoteHead(e1, y, false);
      svg += crStem(e1, y);
      // Single beam across all three
      svg += crBeam(s1, e1, y - 25);
      // Double beam only on first two (sixteenths)
      svg += crBeam(s1, s2, y - 29);
      break;

    case 'ess': // Eighth + two sixteenths
      var e0 = x + w * 0.15, s3 = x + w * 0.55, s4 = x + w * 0.85;
      svg += crNoteHead(e0, y, false);
      svg += crStem(e0, y);
      svg += crNoteHead(s3, y, false);
      svg += crStem(s3, y);
      svg += crNoteHead(s4, y, false);
      svg += crStem(s4, y);
      // Single beam across all three
      svg += crBeam(e0, s4, y - 25);
      // Double beam only on last two (sixteenths)
      svg += crBeam(s3, s4, y - 29);
      break;
  }
  return svg;
}

function crNoteHead(cx, cy, open) {
  if (open) {
    return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="5" ry="3.5" fill="none" stroke="#333" stroke-width="1.5" transform="rotate(-15,' + cx + ',' + cy + ')"/>';
  }
  return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="5" ry="3.5" fill="#333" transform="rotate(-15,' + cx + ',' + cy + ')"/>';
}

function crStem(x, y) {
  return '<line x1="' + (x + 4.5) + '" y1="' + y + '" x2="' + (x + 4.5) + '" y2="' + (y - 25) + '" stroke="#333" stroke-width="1.5"/>';
}

function crBeam(x1, x2, y) {
  return '<line x1="' + (x1 + 4.5) + '" y1="' + y + '" x2="' + (x2 + 4.5) + '" y2="' + y + '" stroke="#333" stroke-width="3"/>';
}

function crFlag(x, y) {
  // Simple flag curve for single eighth notes
  var sx = x + 4.5, sy = y - 25;
  return '<path d="M' + sx + ',' + sy + ' q4,6 2,14 q-1,-4 -2,-6" fill="#333" stroke="none"/>';
}

function crQuarterRest(cx, cy) {
  // Simplified quarter rest glyph
  var x = cx - 3;
  return '<path d="M' + (x + 2) + ',' + (cy - 10) +
    ' l4,5 l-4,5 l4,5 l-4,5" fill="none" stroke="#333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
}

function crEighthRest(cx, cy) {
  // Simplified eighth rest
  return '<circle cx="' + (cx + 2) + '" cy="' + (cy - 4) + '" r="2" fill="#333"/>' +
    '<line x1="' + (cx + 2) + '" y1="' + (cy - 4) + '" x2="' + (cx - 1) + '" y2="' + (cy + 8) + '" stroke="#333" stroke-width="1.5"/>';
}

// ── Custom Rhythm Playback ──────────────────────────────────────────────────
// Called from scheduleMainBeat instead of normal triggerSound when enabled.
function triggerCustomRhythmBeat(time, beatIndex) {
  if (!customRhythmPattern || beatIndex >= customRhythmPattern.length) return;

  var pat = customRhythmPattern[beatIndex];
  var subBeats = crGetSubBeats(pat);
  var beatDuration = Tone.Time("4n").toSeconds();
  var isFirstBeat = beatIndex === 0;

  for (var i = 0; i < subBeats.length; i++) {
    var sb = subBeats[i];
    var t = time + sb.offset * beatDuration;
    var isAccent = isFirstBeat && sb.offset === 0;

    if (isAccent && accentEnabled) {
      accentSynth.triggerAttackRelease("G5", "16n", t);
    }

    if (animalSoundEnabled) {
      // Vary volume based on velocity
      var originalVol = circleSynth.volume.value;
      if (sb.vel < 1.0) {
        // Quieter for off-beat sub-notes
        circleSynth.volume.setValueAtTime(originalVol - 6 * (1 - sb.vel), t);
        circleSynth.triggerAttackRelease("A4", "32n", t);
        circleSynth.volume.setValueAtTime(originalVol, t + 0.05);
      } else {
        circleSynth.triggerAttackRelease("A4", "16n", t);
      }
    }
  }
}

// ── Custom Rhythm UI Listeners ──────────────────────────────────────────────
function initCustomRhythmListeners() {
  var crBtn = document.getElementById('custom-rhythm-btn');
  var crModal = document.getElementById('custom-rhythm-modal');
  var crCloseBtn = document.getElementById('custom-rhythm-close-btn');
  var crEnabledCheckbox = document.getElementById('custom-rhythm-enabled');

  if (crBtn) {
    crBtn.addEventListener('click', function() {
      // Initialize pattern if empty
      if (customRhythmPattern.length === 0 || customRhythmPattern.length !== beatsPerMeasure) {
        customRhythmPattern = crBuildDefaultPattern();
      }
      crRenderBeatSelectors();
      crRenderNotation();
      crModal.classList.remove('hidden');
    });
  }

  if (crCloseBtn) {
    crCloseBtn.addEventListener('click', function() {
      crModal.classList.add('hidden');
    });
  }

  if (crModal) {
    crModal.addEventListener('click', function(e) {
      if (e.target === crModal) crModal.classList.add('hidden');
    });
  }

  if (crEnabledCheckbox) {
    crEnabledCheckbox.checked = customRhythmEnabled;
    crEnabledCheckbox.addEventListener('change', function(e) {
      customRhythmEnabled = e.target.checked;
      if (crBtn) crBtn.classList.toggle('ct-active', customRhythmEnabled);
      if (customRhythmEnabled && customRhythmPattern.length === 0) {
        customRhythmPattern = crBuildDefaultPattern();
      }
      sendStateUpdate();
    });
  }
}

// Initialize custom rhythm listeners
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCustomRhythmListeners);
} else {
  initCustomRhythmListeners();
}

// Initialize song sections listeners immediately (not dependent on p5.js setup)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSongSectionsListeners);
} else {
  initSongSectionsListeners();
}
