// Kids mode (kids.html): a stripped-down metronome — play/stop, slower/faster
// and "count to" 2, 3 or 4 — drawn as two cartoon hands clapping on the beat.
// Standalone on purpose: it uses the Web Audio API directly rather than the
// main app's Tone.js/p5 stack, so it loads fast and has nothing to configure.

const MIN_BPM = 40;
const MAX_BPM = 180;
const BPM_STEP = 10;
const SETTINGS_KEY = 'vm.kids';
const KIDS_MODE_KEY = 'vm.kidsMode';
const EXIT_HOLD_MS = 1500;

// Scheduler: every TICK_MS, queue any beats due within LOOKAHEAD_S.
const TICK_MS = 25;
const LOOKAHEAD_S = 0.1;

const INK = '#2b2250';
const CUFF_COLORS = ['#ff6fb5', '#3ddc84'];

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
  const defaults = { bpm: 90, beats: 4 };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const bpm = Math.round(Number(saved.bpm) / BPM_STEP) * BPM_STEP;
    return {
      bpm: bpm >= MIN_BPM && bpm <= MAX_BPM ? bpm : defaults.bpm,
      beats: [2, 3, 4].includes(saved.beats) ? saved.beats : defaults.beats,
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

function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
    fallbackBuffer = synthClap(audioCtx);
    fetch('sounds/clap.wav')
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(res.statusText))))
      .then((data) => audioCtx.decodeAudioData(data))
      .then((buf) => { clapBuffer = buf; })
      .catch((err) => console.warn('Kids mode: using a synthesized clap', err));
  }
  if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
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

function playClap(time, accent) {
  const src = audioCtx.createBufferSource();
  src.buffer = clapBuffer || fallbackBuffer;
  src.playbackRate.value = accent ? 1 : 1.12;
  const gain = audioCtx.createGain();
  gain.gain.value = accent ? 1 : 0.6;
  src.connect(gain).connect(audioCtx.destination);
  src.start(time);
}

function beatInterval() {
  return 60 / settings.bpm;
}

function scheduler() {
  // After the tab was throttled, skip the beats we missed instead of
  // firing them all at once.
  if (nextBeatTime < audioCtx.currentTime - 0.05) nextBeatTime = audioCtx.currentTime + 0.05;
  while (nextBeatTime < audioCtx.currentTime + LOOKAHEAD_S) {
    const beat = nextBeatIndex % settings.beats;
    const interval = beatInterval();
    playClap(nextBeatTime, beat === 0);
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
  ensureAudio();
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

// ── Grown-ups: press and hold to leave ──────────────────────────────────────

const exitBtn = $('kids-exit');
const exitLabel = exitBtn.querySelector('.kids-exit-label');
let exitTimer = null;
exitBtn.style.setProperty('--hold-ms', EXIT_HOLD_MS + 'ms');

function beginExitHold() {
  if (exitTimer) return;
  exitBtn.classList.add('is-holding');
  exitLabel.textContent = 'Keep holding…';
  exitTimer = setTimeout(leaveKidsMode, EXIT_HOLD_MS);
}

function cancelExitHold() {
  clearTimeout(exitTimer);
  exitTimer = null;
  exitBtn.classList.remove('is-holding');
  exitLabel.textContent = 'Grown-ups: hold';
}

function leaveKidsMode() {
  stop();
  try { localStorage.removeItem(KIDS_MODE_KEY); } catch (e) {}
  location.href = 'index.html';
}

exitBtn.addEventListener('pointerdown', (e) => {
  exitBtn.setPointerCapture?.(e.pointerId);
  beginExitHold();
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => {
  exitBtn.addEventListener(type, cancelExitHold);
});
exitBtn.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
    e.preventDefault();
    beginExitHold();
  }
});
exitBtn.addEventListener('keyup', cancelExitHold);
exitBtn.addEventListener('blur', cancelExitHold);
exitBtn.addEventListener('contextmenu', (e) => e.preventDefault());

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
    return { phase: Math.max(0, 1 - (first.time - now) / first.interval), beat: -1 };
  }
  return { phase: Math.min(1, (now - current.time) / current.interval), beat: current.beat };
}

// One glove, fingers up, drawn for the LEFT hand (thumb toward +x). The
// palm centre is the origin and `s` is roughly the hand's height.
const FINGERS = [
  { x: -0.22, top: -0.5 },  // pinky
  { x: -0.075, top: -0.64 },
  { x: 0.075, top: -0.7 },
  { x: 0.22, top: -0.62 },  // index
];
const FINGER_W = 0.16;

function capsule(x1, y1, x2, y2, w) {
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.lineWidth = w;
}

function gloveParts(s, draw) {
  // Thumb, fingers, palm and cuff, each as its own subpath so we can
  // stroke all of them before filling all of them — that merges the
  // outlines into one chunky cartoon silhouette.
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // Thumb
  g.beginPath();
  capsule(0.24 * s, 0.24 * s, 0.47 * s, -0.08 * s, 0.17 * s);
  draw('limb');
  // Fingers
  for (const f of FINGERS) {
    g.beginPath();
    capsule(f.x * s, 0.1 * s, f.x * s, (f.top + FINGER_W / 2) * s, FINGER_W * s);
    draw('limb');
  }
  // Palm
  g.beginPath();
  g.roundRect(-0.31 * s, -0.12 * s, 0.62 * s, 0.6 * s, 0.2 * s);
  draw('body');
  // Cuff
  g.beginPath();
  g.roundRect(-0.34 * s, 0.42 * s, 0.68 * s, 0.24 * s, 0.1 * s);
  draw('cuff');
}

function drawGlove(s, cuffColor) {
  const outline = Math.max(3, s * 0.045);
  // Pass 1: outlines (a limb's outline is just a fatter stroke of it).
  gloveParts(s, (kind) => {
    g.strokeStyle = INK;
    if (kind === 'limb') {
      g.lineWidth += outline * 2;
      g.stroke();
    } else {
      g.lineWidth = outline * 2;
      g.stroke();
    }
  });
  // Pass 2: fills on top, hiding the inner outlines.
  gloveParts(s, (kind) => {
    if (kind === 'limb') {
      g.strokeStyle = '#ffffff';
      g.stroke();
    } else {
      g.fillStyle = kind === 'cuff' ? cuffColor : '#ffffff';
      g.fill();
    }
  });
  // Cuff sits over the wrist — outline it on top so it reads as separate.
  g.beginPath();
  g.roundRect(-0.34 * s, 0.42 * s, 0.68 * s, 0.24 * s, 0.1 * s);
  g.lineWidth = outline;
  g.strokeStyle = INK;
  g.stroke();

  // Finger gaps and the three stitches on the back of the glove.
  g.lineWidth = Math.max(2, outline * 0.6);
  g.beginPath();
  for (let i = 0; i < FINGERS.length - 1; i++) {
    const x = (FINGERS[i].x + FINGERS[i + 1].x) / 2;
    const top = Math.max(FINGERS[i].top, FINGERS[i + 1].top) + FINGER_W * 0.6;
    g.moveTo(x * s, -0.06 * s);
    g.lineTo(x * s, top * s);
  }
  for (const x of [-0.11, 0, 0.11]) {
    g.moveTo(x * s, 0.1 * s);
    g.lineTo(x * s, 0.3 * s);
  }
  g.stroke();
}

function starburst(x, y, r, points, fill) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.62;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = INK;
  g.stroke();
}

function drawBackground(t) {
  g.fillStyle = '#fff6d6';
  g.fillRect(0, 0, cssW, cssH);
  // Slowly turning sunbeams.
  const cx = cssW / 2;
  const cy = cssH * 0.45;
  const r = Math.hypot(cssW, cssH);
  g.fillStyle = '#ffeaa8';
  g.beginPath();
  const rays = 12;
  for (let i = 0; i < rays; i++) {
    const a = t * 0.00006 + (i / rays) * Math.PI * 2;
    g.moveTo(cx, cy);
    g.arc(cx, cy, r, a, a + Math.PI / rays);
    g.closePath();
  }
  g.fill();
}

function draw(t) {
  if (!cssW || !cssH) return;
  drawBackground(t);

  const info = beatPhase();
  highlightBeat(info ? info.beat : -1);

  // Leave room for the beat dots along the bottom.
  const areaH = cssH - 70;
  const s = Math.max(40, Math.min(areaH / 1.5, cssW / 3.4));
  const cx = cssW / 2;
  const cy = areaH / 2 + 12;
  const maxSep = Math.max(0, Math.min(cssW - 1.9 * s - 24, 1.8 * s));

  // open: 0 = hands together, 1 = wide apart.
  let open;
  let bob = 0;
  if (info) {
    open = Math.sin(Math.PI * info.phase);
  } else {
    open = 0.55 + 0.08 * Math.sin(t / 600);
    bob = Math.sin(t / 450) * s * 0.03;
  }

  // Burst of colour right at the clap.
  const IMPACT = 0.3;
  if (info && info.beat >= 0 && info.phase < IMPACT) {
    const k = info.phase / IMPACT;
    g.save();
    g.globalAlpha = 1 - k * k;
    starburst(cx, cy - s * 0.1, s * (0.75 + 0.35 * k), 10, info.beat === 0 ? '#ff6fb5' : '#ffd23f');
    // Little "pop" lines flying out above the hands.
    g.lineCap = 'round';
    g.lineWidth = Math.max(3, s * 0.04);
    g.strokeStyle = INK;
    g.beginPath();
    for (const a of [-2.3, -1.57, -0.84]) {
      const r1 = s * (0.85 + 0.3 * k);
      const r2 = r1 + s * 0.18;
      g.moveTo(cx + Math.cos(a) * r1, cy - s * 0.1 + Math.sin(a) * r1);
      g.lineTo(cx + Math.cos(a) * r2, cy - s * 0.1 + Math.sin(a) * r2);
    }
    g.stroke();
    g.restore();
  }

  // Squash a little on impact.
  const squash = info && info.beat >= 0 && info.phase < 0.12 ? 1 - info.phase / 0.12 : 0;
  // Tilt outward as the hands open, upright as they meet.
  const tilt = 0.06 - 0.32 * open;
  const halfGap = maxSep * open / 2 + 0.47 * s;

  for (const side of [-1, 1]) {
    g.save();
    g.translate(cx + side * halfGap, cy + bob);
    if (side === 1) g.scale(-1, 1); // mirror to make the right hand
    g.rotate(tilt);
    g.scale(1 - 0.08 * squash, 1 + 0.06 * squash);
    drawGlove(s, CUFF_COLORS[side === -1 ? 0 : 1]);
    g.restore();
  }
}

function frame(t) {
  draw(t);
  requestAnimationFrame(frame);
}

// Pause when hidden so a backgrounded tab isn't clapping to nobody.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && isPlaying()) stop();
});

// Test/debug hook.
window.kidsMetronome = {
  get playing() { return isPlaying(); },
  get bpm() { return settings.bpm; },
  get beats() { return settings.beats; },
  // Claps that have actually sounded, not just been scheduled.
  get beatsPlayed() {
    const now = audioCtx ? audioCtx.currentTime : 0;
    return beatsScheduled - beatQueue.filter((b) => b.time > now).length;
  },
};

renderTempo();
renderBeats();
resizeCanvas();
requestAnimationFrame(frame);
