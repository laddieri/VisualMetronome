// Kids mode (kids.html): a stripped-down metronome — play/stop, slower/faster
// "count to" 2, 3 or 4, and a choice of cartoon friends (kids-scenes.js) who
// clap, hop, bounce or stomp on the beat.
// Standalone on purpose: it uses the Web Audio API directly rather than the
// main app's Tone.js/p5 stack, so it loads fast and has nothing to configure.

import { SCENES, drawScene, playSceneSound } from './kids-scenes.js';

const MIN_BPM = 40;
const MAX_BPM = 180;
const BPM_STEP = 10;
const SETTINGS_KEY = 'vm.kids';
const KIDS_MODE_KEY = 'vm.kidsMode';
// Long enough to see the switch slide off before the page changes.
const EXIT_SLIDE_MS = 250;

// Scheduler: every TICK_MS, queue any beats due within LOOKAHEAD_S.
const TICK_MS = 25;
const LOOKAHEAD_S = 0.1;

const settings = loadSettings();

let audioCtx = null;
let clapBuffer = null;       // decoded sounds/clap.wav
let fallbackBuffer = null;   // synthesized clap, used until/unless the file loads
let schedulerId = null;
let nextBeatTime = 0;
let nextBeatIndex = 0;
let beatsScheduled = 0;
// Beats already handed to the audio clock: { time, beat, interval }.
let beatQueue = [];

const $ = (id) => document.getElementById(id);
const playBtn = $('kids-play');
const slowerBtn = $('kids-slower');
const fasterBtn = $('kids-faster');
const bpmOut = $('kids-bpm');
const speedName = $('kids-speed-name');
const beatsRow = $('kids-beats');
const canvas = $('kids-canvas');
const g = canvas.getContext('2d');

// ── Settings ────────────────────────────────────────────────────────────────

function loadSettings() {
  const defaults = { bpm: 90, beats: 4, scene: 'hands' };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const bpm = Math.round(Number(saved.bpm) / BPM_STEP) * BPM_STEP;
    return {
      bpm: bpm >= MIN_BPM && bpm <= MAX_BPM ? bpm : defaults.bpm,
      beats: [2, 3, 4].includes(saved.beats) ? saved.beats : defaults.beats,
      scene: Object.hasOwn(SCENES, saved.scene) ? saved.scene : defaults.scene,
    };
  } catch (e) {
    return defaults;
  }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}

function speedLabel(bpm) {
  if (bpm <= 60) return 'Snail';
  if (bpm <= 90) return 'Walking';
  if (bpm <= 120) return 'Skipping';
  if (bpm <= 150) return 'Running';
  return 'Zooming!';
}

// ── Audio ───────────────────────────────────────────────────────────────────

// Called from the Play press (a user gesture), so a fresh context is
// allowed to start. A context left over from earlier — suspended by the
// browser, or "interrupted" after the page came back from the back/forward
// cache — may never resume, and its clock would stay frozen along with the
// animation, so swap it for a new one instead of trying to revive it.
// Returns false if no audio context could be made.
function ensureAudio() {
  if (audioCtx && audioCtx.state !== 'running') releaseAudio();
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    let ctx;
    try {
      ctx = new Ctx();
    } catch (err) {
      console.warn('Kids mode: could not start audio', err);
      return false;
    }
    audioCtx = ctx;
    // AudioBuffers work in any context, so these are only made once.
    if (!fallbackBuffer) fallbackBuffer = synthClap(ctx);
    if (!clapBuffer) {
      fetch('sounds/clap.wav')
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(res.statusText))))
        .then((data) => ctx.decodeAudioData(data))
        .then((buf) => { clapBuffer = buf; })
        .catch((err) => console.warn('Kids mode: using a synthesized clap', err));
    }
  }
  if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  return true;
}

// Close the context so it doesn't linger (browsers cap how many can exist,
// and pages in the back/forward cache keep theirs alive).
function releaseAudio() {
  if (!audioCtx) return;
  audioCtx.close().catch(() => {});
  audioCtx = null;
}

// A few quick noise bursts and a short tail — close enough to a hand clap.
function synthClap(ctx) {
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(rate * 0.2), rate);
  const data = buf.getChannelData(0);
  const bursts = [0, 0.011, 0.022];
  let prev = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / rate;
    let env = Math.exp(-(t - 0.022) * 30) * (t >= 0.022 ? 0.8 : 0);
    for (const b of bursts) if (t >= b && t < b + 0.01) env = Math.max(env, Math.exp(-(t - b) * 300));
    // Crude high-pass so it snaps instead of hissing.
    const n = Math.random() * 2 - 1;
    data[i] = (n - prev * 0.6) * env * 0.7;
    prev = n;
  }
  return buf;
}

function playBeat(time, accent) {
  const audio = { ctx: audioCtx, clapBuffer: clapBuffer || fallbackBuffer };
  playSceneSound(settings.scene, audio, time, accent);
}

function beatInterval() {
  return 60 / settings.bpm;
}

// Watchdog: the beats (and so the animation) run on the audio clock. If it
// stops advancing — the browser suspended audio and won't give it back —
// stop cleanly so the next Play press starts on a fresh context, rather
// than leaving the friend frozen mid-beat.
const STALL_MS = 1200;
let lastClock = 0;
let lastClockChange = 0;

function scheduler() {
  const clock = audioCtx.currentTime;
  const wall = performance.now();
  if (clock !== lastClock) {
    lastClock = clock;
    lastClockChange = wall;
  } else if (wall - lastClockChange > STALL_MS && !document.hidden) {
    console.warn('Kids mode: audio clock stalled; stopping');
    stop();
    releaseAudio();
    return;
  }
  // After the tab was throttled, skip the beats we missed instead of
  // firing them all at once.
  if (nextBeatTime < audioCtx.currentTime - 0.05) nextBeatTime = audioCtx.currentTime + 0.05;
  while (nextBeatTime < audioCtx.currentTime + LOOKAHEAD_S) {
    const beat = nextBeatIndex % settings.beats;
    const interval = beatInterval();
    playBeat(nextBeatTime, beat === 0);
    beatQueue.push({ time: nextBeatTime, beat, interval });
    nextBeatTime += interval;
    nextBeatIndex = beat + 1;
    beatsScheduled++;
  }
  // Keep only what the animation might still need.
  const now = audioCtx.currentTime;
  while (beatQueue.length > 2 && beatQueue[1].time < now) beatQueue.shift();
}

function start() {
  if (!ensureAudio()) return;
  lastClock = audioCtx.currentTime;
  lastClockChange = performance.now();
  nextBeatIndex = 0;
  beatQueue = [];
  nextBeatTime = audioCtx.currentTime + 0.15;
  scheduler();
  schedulerId = setInterval(scheduler, TICK_MS);
  setPlayingUI(true);
}

function stop() {
  clearInterval(schedulerId);
  schedulerId = null;
  beatQueue = [];
  setPlayingUI(false);
}

const isPlaying = () => schedulerId !== null;

// ── UI ──────────────────────────────────────────────────────────────────────

function setPlayingUI(playing) {
  playBtn.setAttribute('aria-pressed', String(playing));
  playBtn.querySelector('.kids-play-icon').textContent = playing ? '■' : '▶';
  playBtn.querySelector('.kids-play-label').textContent = playing ? 'Stop' : 'Play';
  if (!playing) highlightBeat(-1);
}

function renderTempo() {
  bpmOut.textContent = settings.bpm;
  speedName.textContent = speedLabel(settings.bpm);
  slowerBtn.disabled = settings.bpm <= MIN_BPM;
  fasterBtn.disabled = settings.bpm >= MAX_BPM;
}

function changeTempo(dir) {
  const bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, settings.bpm + dir * BPM_STEP));
  if (bpm === settings.bpm) return;
  settings.bpm = bpm;
  saveSettings();
  renderTempo();
}

function renderBeats() {
  beatsRow.replaceChildren(...Array.from({ length: settings.beats }, (_, i) => {
    const dot = document.createElement('span');
    dot.className = 'kids-beat';
    dot.textContent = i + 1;
    return dot;
  }));
  document.querySelectorAll('.kids-chip').forEach((chip) => {
    chip.setAttribute('aria-checked', String(Number(chip.dataset.beats) === settings.beats));
  });
}

let litBeat = -1;
function highlightBeat(i) {
  if (i === litBeat) return;
  litBeat = i;
  Array.from(beatsRow.children).forEach((dot, j) => dot.classList.toggle('is-on', j === i));
}

function setBeats(n) {
  settings.beats = n;
  // Start counting again from 1 on the next beat.
  nextBeatIndex = 0;
  saveSettings();
  renderBeats();
}

function renderScene() {
  const scene = SCENES[settings.scene];
  document.body.dataset.scene = settings.scene;
  document.querySelector('.kids-title').textContent = scene.title;
  canvas.setAttribute('aria-label', scene.name + ' keeping the beat');
  document.querySelectorAll('.kids-friend').forEach((btn) => {
    btn.setAttribute('aria-checked', String(btn.dataset.scene === settings.scene));
  });
}

function setScene(id) {
  settings.scene = id;
  saveSettings();
  renderScene();
}

document.querySelectorAll('.kids-friend').forEach((btn) => {
  btn.addEventListener('click', () => setScene(btn.dataset.scene));
});

playBtn.addEventListener('click', () => (isPlaying() ? stop() : start()));
slowerBtn.addEventListener('click', () => changeTempo(-1));
fasterBtn.addEventListener('click', () => changeTempo(1));
document.querySelectorAll('.kids-chip').forEach((chip) => {
  chip.addEventListener('click', () => setBeats(Number(chip.dataset.beats)));
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('button')) return; // buttons handle their own keys
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) (isPlaying() ? stop() : start());
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
    e.preventDefault();
    changeTempo(1);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
    e.preventDefault();
    changeTempo(-1);
  }
});

// ── Kids mode switch: flip it off to leave ──────────────────────────────────

const exitBtn = $('kids-exit');
let leaving = false;

function leaveKidsMode() {
  if (leaving) return;
  leaving = true;
  stop();
  exitBtn.setAttribute('aria-checked', 'false');
  try { localStorage.removeItem(KIDS_MODE_KEY); } catch (e) {}
  // Replace rather than push: Back shouldn't bounce between the two modes,
  // and a page with no history entry can't linger in the back/forward cache.
  setTimeout(() => location.replace('index.html'), EXIT_SLIDE_MS);
}

exitBtn.addEventListener('click', leaveKidsMode);

// ── Drawing ─────────────────────────────────────────────────────────────────

let cssW = 0;
let cssH = 0;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cssW = rect.width;
  cssH = rect.height;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resizeCanvas).observe(canvas);

// Where we are in the current beat: phase 0 = the clap, rising to 1 just
// before the next one. Returns null while stopped.
function beatPhase() {
  if (!isPlaying() || !beatQueue.length) return null;
  // Line the picture up with what's coming out of the speakers.
  const now = audioCtx.currentTime - (audioCtx.outputLatency || audioCtx.baseLatency || 0);
  let current = null;
  for (const b of beatQueue) if (b.time <= now) current = b;
  if (!current) {
    // Before the first clap: bring the hands together for it.
    const first = beatQueue[0];
    return { phase: Math.max(0, 1 - (first.time - now) / first.interval), beat: -1, interval: first.interval };
  }
  return { phase: Math.min(1, (now - current.time) / current.interval), beat: current.beat, interval: current.interval };
}

function draw(t) {
  if (!cssW || !cssH) return;
  const info = beatPhase();
  highlightBeat(info ? info.beat : -1);
  drawScene(settings.scene, g, { w: cssW, h: cssH, t, beats: settings.beats, info });
}

let drawFailed = false;
function frame(t) {
  // Keep the loop alive even if one frame throws, so a single bad frame
  // can't freeze the picture for good.
  try {
    draw(t);
  } catch (err) {
    if (!drawFailed) console.error('Kids mode: drawing failed', err);
    drawFailed = true;
  }
  requestAnimationFrame(frame);
}

// Pause when hidden so a backgrounded tab isn't clapping to nobody.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && isPlaying()) stop();
});

// Leaving the page: let go of the audio. Coming back from the back/forward
// cache: flip the switch back on (Play makes new audio as needed).
window.addEventListener('pagehide', () => {
  stop();
  releaseAudio();
});
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  leaving = false;
  exitBtn.setAttribute('aria-checked', 'true');
  try { localStorage.setItem(KIDS_MODE_KEY, '1'); } catch (err) {}
});

// Test/debug hook.
window.kidsMetronome = {
  get playing() { return isPlaying(); },
  get bpm() { return settings.bpm; },
  get beats() { return settings.beats; },
  get scene() { return settings.scene; },
  // Claps that have actually sounded, not just been scheduled.
  get beatsPlayed() {
    const now = audioCtx ? audioCtx.currentTime : 0;
    return beatsScheduled - beatQueue.filter((b) => b.time > now).length;
  },
};

renderTempo();
renderBeats();
renderScene();
resizeCanvas();
requestAnimationFrame(frame);
