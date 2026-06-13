// Shared mutable application state.
// Properties here are read/written across modules; single-module state
// lives as module-level variables in its owning module.
export const state = {
  xpos: 0,
  rad: 50,
  t: 0,
  secondsPerBeat: 1,
  cachedBPM: 96,
  animal1: undefined,
  animal2: undefined,
  animalType: 'circle', // 'circle', 'pig', 'cat', 'dog', 'bird', etc.
  circleColor: '#000000', // Color for circle animation
  notationScale: 1,           // scale factor applied to the notation content group
  notationStaffDisplayY: 0,   // display-space Y of the staff line (note-head centres)
  notationTx: 0,              // display-space X translation of the notation group
  notationBallColor: '#ff6600', // fill colour for the ball / shoe
  notationBallStyle: 'ball',    // 'ball' or 'shoe'

// Selfie capture variables
  selfieImage: null,
  selfieImageDataURL: null, // Raw data URL of current selfie for saving
  conductorSelfieImage: null, // Selfie for the conductor's face (optional)
  cameraTarget: 'selfie', // 'selfie' or 'conductor' — controls where capturePhoto() stores the result
  mirrorSelfies: true, // When true, selfie images face each other
  DEFAULT_TEMPO_PRESETS: [
    { name: 'Largo',       bpm: 60  },
    { name: 'Larghetto',   bpm: 66  },
    { name: 'Adagio',      bpm: 72  },
    { name: 'Andante',     bpm: 84  },
    { name: 'Moderato',    bpm: 100 },
    { name: 'Allegretto',  bpm: 116 },
    { name: 'Allegro',     bpm: 132 },
    { name: 'Vivace',      bpm: 168 },
    { name: 'Presto',      bpm: 184 },
    { name: 'Prestissimo', bpm: 208 }
  ],
  tempoPresets: [],

// Advanced metronome settings
  beatsPerMeasure: 4,
  currentBeat: 0,
  subdivision: 'none', // 'none', 'eighth', 'triplet', 'sixteenth'
  swingEnabled: false, // Swing 8th notes (shifts subdivision from 50% to 66.7% of beat)
  animalSoundEnabled: true, // Play animal sound on beat
  accentEnabled: true,
  flashEnabled: false, // Flash background on beat
  voiceCountEnabled: false, // Count beats aloud
  rockBeatEnabled: false, // Rock beat drum machine (4/4 only)
  waltzBeatEnabled: false, // Waltz beat drum machine (3/4 only)
  spacebarAction: 'play', // 'play' | 'count-in-1' | 'count-in-2'
  beatNoteValue: 'q', // 'q'=quarter | 'h'=half | 'e'=eighth | 'dq'=dotted-quarter
  practiceRhythmEnabled: false,  // alternates sound/silent measures
  practiceRhythmMeasureIdx: -1,  // incremented at each measure start; even=sound, odd=silent
  checkMyRhythmEnabled: false,   // mic-based accuracy feedback for practice rhythm
  crmMicStream: null,     // MediaStream from getUserMedia
  lastBeatTime: 0,   // Track when last beat fired for animation sync
  animBeat: 0,       // Beat index for conductor animation, updated in Draw callback
  rampProgress: 0,         // 0 = not in a tempo ramp; 0–1 = fraction through ramp window
  ritardandoProgress: 0,   // 0 = not in a ritardando; 0–1 = fraction through ritardando zone
  bounceDirection: 'horizontal', // 'horizontal' or 'vertical'
  isFullscreen: false, // Fullscreen mode state
  bluetoothDelay: 0, // Bluetooth audio delay compensation in milliseconds (0 = no offset)

// Counting Trainer state
  countingTrainerEnabled: false,  // Whether counting trainer mode is active
  ctTargetMeasures: 4,            // Number of full measures to count
  ctTargetExtraBeats: 0,          // Extra beats beyond full measures
  ctPhase: 'idle',                // 'idle' | 'counting' | 'done'
  ctBeatsRemaining: 0,            // Beats left to count in the silent phase
  ctMeasuresCompleted: 0,         // Measures completed so far (for display)
  ctCurrentBeatInMeasure: 0,      // Current beat within the measure (for display)
  ctDoneTime: 0,                  // Tone.now() when "done" was triggered
  ctSoundOn: false,               // Keep metronome sound on during counting phase
  ctVisualOn: true,               // Keep visual animation on during counting phase

// Song Sections (multi-section playback)
  songSections: [],           // Array of {measures, beatsPerMeasure, bpm, transitionBeats, transitionUnit, ritardandoEnabled, ritardandoBeats, ritardandoUnit, ritardandoPercent}
  songModeEnabled: false,     // Whether song mode is active
  songCurrentSection: -1,     // Index of currently playing section (-1 = not playing)
  songMeasureInSection: 0,    // Current measure within the current section (0-based)
  songBeatInMeasure: 0,       // Current beat within the current measure (0-based, for section tracking)

// Two-Measure Pattern state
  twoMeasurePatternEnabled: false,
  twoMeasurePattern: [
    { beatsPerMeasure: 4, subdivision: 'none', bpm: 96 },
    { beatsPerMeasure: 3, subdivision: '2',    bpm: 96 }
  ],
  twoMeasureCurrentMeasure: 0, // 0 or 1 — which measure we're currently playing
// 'beat': M2 BPM = M1 BPM (beat tempo stays the same)
// 'subdivision': M2 BPM = M1 BPM × S1/S2 (subdivision note speed stays the same)
  tmpLinkMode: 'beat',

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
  customRhythmEnabled: false,
  customRhythmPattern: [], // e.g. ['q', 'ee', 'ssss', 'q'] for 4/4
  customRhythmNoteTies: [], // [beatIdx][noteIdx] = true means that note ties to the next note

// Canvas dimensions (will be set dynamically)
  canvasWidth: 640,
  canvasHeight: 480,
  canvasScale: 1,

// Metronome click sound selection
  metronomeSound: 'click', // 'click', 'woodblock', 'claves', 'beep', 'cowbell', 'rimshot'
  subdivisionSynth: null,
  accentSynth: null,
};
