import { state } from './state.js';


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

// Woodblock synth - short, pitched, hollow knock
var woodblockSynth = new Tone.Synth({
  oscillator: { type: "square" },
  envelope: {
    attack: 0.001,
    decay: 0.06,
    sustain: 0,
    release: 0.04
  }
}).toMaster();
woodblockSynth.volume.value = 3;

// Claves synth - very sharp, bright, high-pitched crack
var clavesSynth = new Tone.Synth({
  oscillator: { type: "triangle" },
  envelope: {
    attack: 0.001,
    decay: 0.04,
    sustain: 0,
    release: 0.02
  }
}).toMaster();
clavesSynth.volume.value = 5;

// Beep synth - clean electronic beep
var beepSynth = new Tone.Synth({
  oscillator: { type: "sine" },
  envelope: {
    attack: 0.001,
    decay: 0.15,
    sustain: 0,
    release: 0.05
  }
}).toMaster();
beepSynth.volume.value = 4;

// Cowbell synth - metallic, resonant clang
var cowbellSynth = new Tone.MetalSynth({
  frequency: 550,
  envelope: {
    attack: 0.001,
    decay: 0.4,
    release: 0.2
  },
  harmonicity: 5.1,
  modulationIndex: 16,
  resonance: 3500,
  octaves: 0.5
}).toMaster();
cowbellSynth.volume.value = -4;

// Rimshot synth - snappy noise burst
var rimshotSynth = new Tone.NoiseSynth({
  noise: { type: "white" },
  envelope: {
    attack: 0.001,
    decay: 0.05,
    sustain: 0,
    release: 0.02
  }
}).toMaster();
rimshotSynth.volume.value = 4;

// Play the selected click sound
function triggerClickSound(time) {
  switch (state.metronomeSound) {
    case 'woodblock':
      woodblockSynth.triggerAttackRelease("G5", "32n", time);
      break;
    case 'claves':
      clavesSynth.triggerAttackRelease("C6", "32n", time);
      break;
    case 'beep':
      beepSynth.triggerAttackRelease("C5", "16n", time);
      break;
    case 'cowbell':
      cowbellSynth.triggerAttackRelease("16n", time);
      break;
    case 'rimshot':
      rimshotSynth.triggerAttackRelease("16n", time);
      break;
    default: // 'click'
      circleSynth.triggerAttackRelease("A4", "16n", time);
  }
}

// Play click sound with velocity scaling (for custom rhythm sub-notes)
export function triggerClickSoundVel(time, vel, short) {
  var dur = short ? "32n" : "16n";
  var dbOffset = vel < 1.0 ? -6 * (1 - vel) : 0;
  switch (state.metronomeSound) {
    case 'woodblock': {
      var v = woodblockSynth.volume.value;
      woodblockSynth.volume.setValueAtTime(v + dbOffset, time);
      woodblockSynth.triggerAttackRelease("G5", dur, time);
      woodblockSynth.volume.setValueAtTime(v, time + 0.05);
      break;
    }
    case 'claves': {
      var v = clavesSynth.volume.value;
      clavesSynth.volume.setValueAtTime(v + dbOffset, time);
      clavesSynth.triggerAttackRelease("C6", dur, time);
      clavesSynth.volume.setValueAtTime(v, time + 0.05);
      break;
    }
    case 'beep': {
      var v = beepSynth.volume.value;
      beepSynth.volume.setValueAtTime(v + dbOffset, time);
      beepSynth.triggerAttackRelease("C5", dur, time);
      beepSynth.volume.setValueAtTime(v, time + 0.05);
      break;
    }
    case 'cowbell': {
      var v = cowbellSynth.volume.value;
      cowbellSynth.volume.setValueAtTime(v + dbOffset, time);
      cowbellSynth.triggerAttackRelease(dur, time);
      cowbellSynth.volume.setValueAtTime(v, time + 0.05);
      break;
    }
    case 'rimshot': {
      var v = rimshotSynth.volume.value;
      rimshotSynth.volume.setValueAtTime(v + dbOffset, time);
      rimshotSynth.triggerAttackRelease(dur, time);
      rimshotSynth.volume.setValueAtTime(v, time + 0.05);
      break;
    }
    default: { // 'click'
      var v = circleSynth.volume.value;
      circleSynth.volume.setValueAtTime(v + dbOffset, time);
      circleSynth.triggerAttackRelease("A4", dur, time);
      circleSynth.volume.setValueAtTime(v, time + 0.05);
    }
  }
}

// Subdivision click synth - soft tick for subdivisions
state.subdivisionSynth = new Tone.Synth({
  oscillator: { type: "triangle" },
  envelope: {
    attack: 0.001,
    decay: 0.05,
    sustain: 0,
    release: 0.05
  }
}).toMaster();
state.subdivisionSynth.volume.value = -6; // Quieter than main beat

// Accent synth - louder, higher-pitched click for beat 1
state.accentSynth = new Tone.Synth({
  oscillator: { type: "triangle" },
  envelope: {
    attack: 0.001,
    decay: 0.1,
    sustain: 0,
    release: 0.05
  }
}).toMaster();
state.accentSynth.volume.value = 6; // Audible accent level

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
export function triggerSound(time, isAccent = false){
  // Play accent on beat 1 if enabled (higher pitched click)
  if (isAccent && state.accentEnabled) {
    state.accentSynth.triggerAttackRelease("G5", "16n", time);
  }

  // Play animal sound if enabled
  if (!state.animalSoundEnabled) return;

  switch(state.animalType) {
    case 'circle':
    case 'conductor':
    default:
      triggerClickSound(time);
      break;
    // case 'pig':    // removed from animation menu
    // case 'selfie': // removed from animation menu
    // case 'webgpu': // disabled
  }
}

// Play subdivision sound
function triggerSubdivision(time) {
  state.subdivisionSynth.triggerAttackRelease("C5", "32n", time);
}

// Play rock beat pattern for the given beat index (0-3 in 4/4)
// Pattern: kick on 1 & 3, snare on 2 & 4, hi-hat on every 8th note
export function triggerRockBeat(time, beat) {
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
export function triggerWaltzBeat(time, beat) {
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
