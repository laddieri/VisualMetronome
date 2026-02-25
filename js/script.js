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
var animalSoundEnabled = true; // Play animal sound on beat
var accentEnabled = true;
var flashEnabled = true; // Flash background on beat
var voiceCountEnabled = false; // Count beats aloud
var rockBeatEnabled = false; // Rock beat drum machine (4/4 only)
var waltzBeatEnabled = false; // Waltz beat drum machine (3/4 only)
var countInBeatsRemaining = 0; // Counts down during the count-in phase
var lastBeatTime = 0; // Track when last beat fired for animation sync
var animBeat = 0;    // Beat index for conductor animation, updated in Draw callback
var bounceDirection = 'horizontal'; // 'horizontal' or 'vertical'
var isFullscreen = false; // Fullscreen mode state
var bluetoothDelay = 0; // Bluetooth audio delay compensation in milliseconds (0 = no offset)

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
  const beatDuration = 60 / Tone.Transport.bpm.value;
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

  // Waypoints defined for the right hand; left hand is mirrored around x=320.
  // All beat positions share the same y (BEAT_Y), except the last beat which is
  // slightly above (LAST_Y). All x values must be >= 320 so hands never cross.
  getRightHandWaypoints() {
    const n = beatsPerMeasure;
    const BY = 425; // beat y-level
    const LY = 381; // last-beat y (slightly above)
    const defined = {
      1: [[475, BY]],
      2: [[475, BY], [475, LY]],
      3: [[475, BY], [530, BY], [475, LY]],
      4: [[475, BY], [385, BY], [530, BY], [475, LY]],
      5: [[475, BY], [385, BY], [475, BY], [530, BY], [475, LY]],
      6: [[475, BY], [385, BY], [400, BY], [530, BY], [490, BY], [475, LY]],
    };
    if (defined[n]) return defined[n];

    // Fallback for 7+ beats: alternate inner/outer at BY, last beat at LY
    const pts = [[475, BY]];
    for (let i = 1; i < n - 1; i++) {
      const x = i % 2 === 0 ? 530 : 385;
      pts.push([x, BY]);
    }
    pts.push([475, LY]);
    return pts;
  }

  getWaypoints() {
    const rightPts = this.getRightHandWaypoints();
    if (this.direction === 1) return rightPts;
    // Mirror x around canvas center (320) for left hand
    return rightPts.map(([x, y]) => [640 - x, y]);
  }

  getConductorPosition() {
    const waypoints = this.getWaypoints();
    const n = waypoints.length;
    if (n === 0) return [this.x, this.y];

    // When stopped, rest at the UP position (last waypoint)
    if (Tone.Transport.state !== 'started' || lastBeatTime <= 0) {
      return [waypoints[n - 1][0], waypoints[n - 1][1]];
    }

    // Compute progress and waypoint selection independently of getAnimationProgress()
    // so we can handle the Bluetooth delay window correctly for waypoint-based animation.
    // During the delay window, animBeat has already incremented but the audio hasn't
    // reached the speaker yet — we must keep the previous waypoint pair so the hand
    // arrives at the beat waypoint exactly when the sound plays (not when it fires).
    const beatDuration = 60 / Tone.Transport.bpm.value;
    const timeSinceLastBeat = Tone.now() - lastBeatTime - (bluetoothDelay / 1000);

    let progress, effectiveAnimBeat;
    if (timeSinceLastBeat < 0) {
      // Bluetooth delay window: continue on the previous segment.
      progress = (timeSinceLastBeat + beatDuration) / beatDuration;
      if (progress < 0) progress = 0;
      effectiveAnimBeat = animBeat - 1; // keep previous waypoints until audio plays
    } else {
      progress = Math.min(timeSinceLastBeat / beatDuration, 1);
      effectiveAnimBeat = animBeat;
    }

    const lastFiredBeatIndex = (effectiveAnimBeat - 1 + beatsPerMeasure) % beatsPerMeasure;

    const fromIdx = lastFiredBeatIndex % n;
    const toIdx = (fromIdx + 1) % n;
    const [fx, fy] = waypoints[fromIdx];
    const [tx, ty] = waypoints[toIdx];

    const eased = Easing.easeInOutQuad(progress);
    // Subtract bounce so hands rise between beats (smaller y = higher on canvas).
    // Only the rebound after the last beat of the measure uses full amplitude (140);
    // all other inter-beat bounces use a reduced amplitude (35) so they stay low.
    const bounceAmp = fromIdx === n - 1 ? 140 : 35;
    const bounce = Math.sin(progress * Math.PI) * bounceAmp;
    return [fx + (tx - fx) * eased, fy + (ty - fy) * eased - bounce];
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
    if (this.direction === -1) {
      const armDx = this.x - shoulderX;
      const armDy = this.y - shoulderY;
      const armLen = Math.sqrt(armDx * armDx + armDy * armDy);
      if (armLen > 0) {
        const batonLen = 60;
        const batonX = this.x + (armDx / armLen) * batonLen;
        const batonY = this.y + (armDy / armLen) * batonLen;
        stroke(230, 220, 200);
        strokeWeight(3);
        line(this.x, this.y, batonX, batonY);
      }
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
      sendStateUpdate();
    });
  }

  // Rock beat toggle
  const rockBeatCheckbox = document.getElementById('rock-beat-enabled');
  const rockBeatGroup = document.getElementById('rock-beat-setting-group');

  // Waltz beat toggle
  const waltzBeatCheckbox = document.getElementById('waltz-beat-enabled');
  const waltzBeatGroup = document.getElementById('waltz-beat-setting-group');

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
      const totalCountIn = 2 * beatsPerMeasure;
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
      } else if (beatsPerMeasure === 4 && beatIndex < beatsPerMeasure) {
        // 4/4 first count-in measure: speak only on beats 1 & 3 ("one", "two"),
        // leave beats 2 & 4 silent so the pattern is "one – two – | one two ready go".
        if (beatIndex % 2 === 0) {
          speakWord(String(beatIndex / 2 + 1), time); // beatIndex 0→"1", 2→"2"
        }
      } else {
        speakWord(String((beatIndex % beatsPerMeasure) + 1), time);
      }

      countInBeatsRemaining--;
      return; // Skip normal beat processing during count-in
    }
    // ────────────────────────────────────────────────────────────────────────

    // Drum machine modes: play drum pattern instead of normal click sounds
    if (rockBeatEnabled && beatsPerMeasure === 4) {
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

    // Capture beat index before incrementing so Draw callback can use it
    const thisBeat = currentBeat;

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
    }, time);

    // Advance beat counter
    currentBeat = (currentBeat + 1) % beatsPerMeasure;
  }, "4n");
}

// Schedule subdivisions for a single beat
// Uses direct synth triggering with audio context time for precise timing
function scheduleSubdivisionsForBeat(beatTime) {
  if (subdivision === 'none') return;

  const beatDuration = Tone.Time("4n").toSeconds();

  switch(subdivision) {
    case 'eighth':
      // One subdivision at the halfway point
      subdivisionSynth.triggerAttackRelease("C5", "32n", beatTime + beatDuration / 2);
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
const _countInBtn        = document.getElementById('count-in-play-btn');
const _stopBtn           = document.getElementById('stop-btn');
const _playBtnsContainer = document.getElementById('play-buttons-container');

// Show/hide the combined stop button vs. the two individual play buttons
function _updatePlayStopUI(playing) {
  if (playing) {
    _playBtnsContainer.classList.add('hidden');
    _stopBtn.classList.remove('hidden');
  } else {
    _playBtnsContainer.classList.remove('hidden');
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

// +2 button: start with 2-measure count-in
_countInBtn.addEventListener('click', () => {
  _ensureAudioContext(() => toggleTransport(true));
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
    _countInBtn.classList.remove('active');
    _setPlayTogglePlaying(false);
    _updatePlayStopUI(false);
  } else {
    // Starting: reset beat counter and start fresh
    currentBeat = 0;
    lastBeatTime = 0;
    animBeat = 0;
    countInBeatsRemaining = withCountIn ? 2 * beatsPerMeasure : 0;
    Tone.Transport.start();
    // Always sync the play-toggle visual — needed when called from remote
    // (clicking tone-play-toggle directly already updates it before firing 'change',
    // so setting .playing = true again is a safe no-op in that path).
    _setPlayTogglePlaying(true);
    if (withCountIn) {
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


function draw() {
  // Flash white at beat (when progress is near 0) if enabled
  const progress = getAnimationProgress();
  const isFlashing = flashEnabled && Tone.Transport.state === 'started' && progress < 0.08;
  if (isFlashing) {
    background('white');
  } else {
    background('#696969');
  }

  // In fullscreen, also flash the overlay background so the entire screen flashes
  if (isFullscreen) {
    const overlay = document.getElementById('fullscreen-overlay');
    if (overlay) {
      overlay.style.background = isFlashing ? 'white' : '#696969';
    }
  }

  // Scale all drawing to fit responsive canvas
  push();
  scale(canvasScale);

  if (animalType === 'conductor') {
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
        soundEnabled:     animalSoundEnabled,
        accentEnabled:    accentEnabled,
        flashEnabled:     flashEnabled,
        voiceCountEnabled: voiceCountEnabled,
        rockBeatEnabled:  rockBeatEnabled,
        waltzBeatEnabled: waltzBeatEnabled,
        isFullscreen:     isFullscreen,
        circleColor:      circleColor,
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
    soundEnabled:     animalSoundEnabled,
    accentEnabled:    accentEnabled,
    flashEnabled:     flashEnabled,
    voiceCountEnabled: voiceCountEnabled,
    rockBeatEnabled:  rockBeatEnabled,
    waltzBeatEnabled: waltzBeatEnabled,
    isFullscreen:     isFullscreen,
    circleColor:      circleColor,
    bluetoothDelay:   bluetoothDelay,
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

    case 'playWithCountIn':
      if (Tone.Transport.state !== 'started') {
        _ensureAudioContext(function () { toggleTransport(true); });
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

    case 'requestState':
      sendStateUpdate();
      break;
  }
}
