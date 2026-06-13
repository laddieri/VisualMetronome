import { state } from './state.js';



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
// Per-word playback offset (seconds) to skip leading silence in specific samples.
var VOICE_OFFSETS = { '6': 0.08 };

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
    var offset = VOICE_OFFSETS[word] || 0;
    player.start(time, offset);
  } else {
    // Fallback: Web Speech API (may lag at fast tempos)
    speechFallback(word);
  }
}

export function speakBeatNumber(beatNumber, audioTime) {
  if (!state.voiceCountEnabled) return;
  triggerVoice(String(beatNumber), audioTime);
}

// Speak any word at a precise audio time (used for count-in cues).
export function speakWord(word, audioTime) {
  triggerVoice(word, audioTime);
}
