// Kids mode scenes: each "friend" draws its own world on the canvas and
// makes its own sound on the beat.
//
// draw(view) gets { w, h, t, beats, info, ... }, where info is null while stopped
// or { phase, beat, interval }: phase 0 is the beat itself, rising to 1 just
// before the next one, `interval` seconds later (beat is -1 during the
// lead-in to the first beat).
// sound(audio, time, accent) schedules one beat's sound at `time`.
//
// The hands also take two optional view fields, for the main app's
// Animation menu: `sleeves` ({ colors, bands }, left arm then right) and
// `bottom` (room left below the counter, instead of DOTS_H).

const INK = '#2b2250';

// Room left along the bottom of the canvas for the numbered beat dots.
const DOTS_H = 70;

let g = null; // the canvas 2D context, set by drawScene()

export function drawScene(id, ctx2d, view) {
  g = ctx2d;
  (SCENES[id] || SCENES.hands).draw(view);
}

export function playSceneSound(id, audio, time, accent) {
  (SCENES[id] || SCENES.hands).sound(audio, time, accent);
}

// ── Shared drawing helpers ──────────────────────────────────────────────────

const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (k) => Math.max(0, Math.min(1, k));
// 0 on the ground, 1 at the top of a hop that lasts from k = 0 to 1.
const arc = (k) => 4 * k * (1 - k);

// How hard the beat just hit: 1 at the beat, fading to 0 over `len` of it.
function impact(info, len) {
  if (!info || info.beat < 0 || info.phase >= len) return 0;
  return 1 - info.phase / len;
}

function outline(width) {
  g.lineWidth = width;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.stroke();
}

function ellipse(x, y, rx, ry, rot = 0) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
}

// Draws several parts as one cartoon blob: every outline first, then every
// fill on top, so the inner outlines disappear. A part is a function that
// builds a path and returns a line width (a thick stroked limb) or 0 (a
// filled shape).
function blob(parts, fill, lineW) {
  for (const part of parts) {
    g.beginPath();
    const limb = part();
    g.lineWidth = limb ? limb + lineW * 2 : lineW * 2;
    g.strokeStyle = INK;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke();
  }
  for (const part of parts) {
    g.beginPath();
    const limb = part();
    if (limb) {
      g.lineWidth = limb;
      g.strokeStyle = fill;
      g.stroke();
    } else {
      g.fillStyle = fill;
      g.fill();
    }
  }
}

function starShape(x, y, r, points, inner = 0.5, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 + rot;
    const rr = i % 2 === 0 ? r : r * inner;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}

function starburst(x, y, r, fill) {
  starShape(x, y, r, 10, 0.62);
  g.fillStyle = fill;
  g.fill();
  outline(4);
}

function eye(x, y, r, lookX = 0, lookY = 0, closed = false) {
  if (closed) {
    g.beginPath();
    g.arc(x, y + r * 0.2, r * 0.8, Math.PI * 1.1, Math.PI * 1.9);
    outline(Math.max(2, r * 0.35));
    return;
  }
  ellipse(x, y, r, r);
  g.fillStyle = '#fff';
  g.fill();
  outline(Math.max(2, r * 0.25));
  ellipse(x + lookX * r * 0.35, y + lookY * r * 0.35, r * 0.5, r * 0.5);
  g.fillStyle = INK;
  g.fill();
  ellipse(x + lookX * r * 0.35 - r * 0.18, y + lookY * r * 0.35 - r * 0.18, r * 0.16, r * 0.16);
  g.fillStyle = '#fff';
  g.fill();
}

// A fixed sprinkle of points, the same every frame.
function sprinkle(n, seed) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, () => ({ x: rand(), y: rand(), r: rand(), p: rand() * Math.PI * 2 }));
}

// ── Shared sound helpers ────────────────────────────────────────────────────

// One oscillator "blip": pitch glides from f0 to f1 over `glide` seconds
// while the volume snaps on and decays over `len`.
function blip(audio, time, { type, f0, f1, glide, len, vol, filter }) {
  const ctx = audio.ctx;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, time);
  osc.frequency.exponentialRampToValueAtTime(f1, time + glide);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(vol, time + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + len);
  let node = osc;
  if (filter) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = filter;
    node = node.connect(lp);
  }
  node.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + len + 0.02);
  return osc;
}

// ── 👏 Clapping hands ───────────────────────────────────────────────────────
//
// A little puppet rig rather than two stickers sliding together. Each hand
// is on a bendy cartoon arm that swings up from behind a counter, and turns
// to face the other hand as it comes in: the flat palm narrows while the
// round fingers keep their width, so the hands look solid. The fingers fan
// out when open, drag behind a fast swing and flick through on impact.
// Timing is in seconds rather than fractions of a beat, so the hands snap
// together, bounce apart and wait, like real clapping, instead of drifting
// to and fro in slow motion at slow tempos.

const SLEEVES = ['#ff6fb5', '#3ddc84'];     // left arm, right arm
const SLEEVE_BANDS = ['#ffc2e0', '#b8f5d2'];
const PALM_LINE = '43, 34, 80';             // INK as r, g, b
const COUNTER = '#ffb347';

// The glove, in hand units with the wrist at the origin and the fingers up
// (−y), drawn as the LEFT hand: palm toward us, thumb toward the middle (+x).
// Fingers run pinky → index.
const FINGERS = [
  { x: -0.22, len: 0.34 },
  { x: -0.075, len: 0.44 },
  { x: 0.075, len: 0.48 },
  { x: 0.22, len: 0.41 },
];
const FINGER_W = 0.155;
const KNUCKLE_Y = -0.5;

// Clap timing for a clap every `interval` seconds: how long the palms stay
// pressed together, how long the swing in and the bounce back out take, and
// how much wider the hands open while winding up in between. The swing
// keeps to a natural speed rather than stretching across slow beats, but
// always leads into the next clap.
function clapTiming(interval) {
  return {
    press: Math.min(0.04, 0.1 * interval),
    close: Math.min(0.42 * interval, 0.45),
    recoil: Math.min(0.33 * interval, 0.35),
    windUp: 0.08 + 0.1 * clamp01((interval - 0.6) / 0.9),
  };
}

// How open the hands are `since` seconds after a clap: 0 = together,
// 1 = open (a little more while winding up for the next clap).
function clapOpen(since, interval) {
  const { press, close, recoil, windUp } = clapTiming(interval);
  const closeStart = interval - close;
  if (since >= closeStart) {
    const k = (since - closeStart) / close;
    return (1 + windUp) * (1 - Math.pow(k, 2.2)); // speeding up into the clap
  }
  if (since < press) return 0; // palms pressed together for a moment
  if (since < press + recoil) return 1 - Math.pow(1 - (since - press) / recoil, 3); // bounce off
  const k = (since - press - recoil) / (closeStart - press - recoil);
  return 1 + windUp * k * k * (3 - 2 * k); // winding up
}

// Sideways bend of the fingers (radians, + = toward the other hand): they
// drag behind a fast swing in, then flick through on impact and wobble back.
function fingerFlex(since, interval) {
  const { close } = clapTiming(interval);
  const k = clamp01((since - (interval - close)) / close);
  return -0.2 * k * k + 0.32 * Math.exp(-since / 0.07) * Math.cos(since * 26);
}

// Maps hand units to the screen: turn (narrow the palm as it faces the
// middle), tilt, then place at the wrist; m = 1 for the left hand, −1 to
// mirror it into the right.
function handXform(wx, wy, m, tilt, turn, s, sy = 1) {
  const c = Math.cos(tilt);
  const sn = Math.sin(tilt);
  return (x, y) => {
    const x1 = x * s * turn;
    const y1 = y * s * sy;
    return [wx + m * (x1 * c - y1 * sn), wy + x1 * sn + y1 * c];
  };
}

function tracePts(pts, P, close) {
  pts.forEach(([x, y], i) => {
    const [X, Y] = P(x, y);
    if (i) g.lineTo(X, Y); else g.moveTo(X, Y);
  });
  if (close) g.closePath();
}

function roundRectPts(l, t, r, b, rad) {
  const pts = [];
  const corners = [[r - rad, t + rad, -0.5], [r - rad, b - rad, 0], [l + rad, b - rad, 0.5], [l + rad, t + rad, 1]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= 4; i++) {
      const a = (a0 + i / 8) * Math.PI;
      pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
  }
  return pts;
}
const PALM_PTS = roundRectPts(-0.31, -0.62, 0.31, 0.02, 0.2);
const CUFF_PTS = roundRectPts(-0.33, -0.06, 0.33, 0.24, 0.08);

// A finger (or thumb) as a bendy two-joint polyline from inside the palm.
function fingerPts(x, y, len, angle, bend) {
  const a1 = angle + bend * 0.4;
  const a2 = angle + bend;
  const jx = x + Math.sin(a1) * len * 0.55;
  const jy = y - Math.cos(a1) * len * 0.55;
  return [[x, y + 0.14], [x, y], [jx, jy], [jx + Math.sin(a2) * len * 0.45, jy - Math.cos(a2) * len * 0.45]];
}

function drawGlove(P, s, pose) {
  const lineW = Math.max(3, s * 0.045);
  const fingers = FINGERS.map((f, i) =>
    fingerPts(f.x, KNUCKLE_Y, f.len, (i - 1.5) * pose.spread, pose.bend * (0.75 + 0.1 * i) + (pose.wiggle ? pose.wiggle[i] : 0)));
  const thumb = fingerPts(0.24, -0.1, 0.4, pose.thumb, pose.bend * 0.5);
  // Round fingers keep their width however the palm turns.
  blob([
    () => { tracePts(thumb, P); return 0.17 * s; },
    ...fingers.map((pts) => () => { tracePts(pts, P); return FINGER_W * s; }),
    () => { tracePts(PALM_PTS, P, true); return 0; },
  ], '#ffffff', lineW);

  // Where neighbouring fingers overlap, a line keeps them apart.
  g.beginPath();
  for (let i = 0; i < fingers.length - 1; i++) {
    const a = fingers[i];
    const b = fingers[i + 1];
    const reach = Math.min(FINGERS[i].len, FINGERS[i + 1].len) * 0.8;
    const apart = Math.max(0.001, pose.spread);
    const upTo = Math.min(1, (0.185 - 0.145) / apart / reach);
    const mid = (u) => {
      // Point u of the way up both fingers' first joint, averaged.
      const pa = [a[1][0] + (a[2][0] - a[1][0]) * u, a[1][1] + (a[2][1] - a[1][1]) * u];
      const pb = [b[1][0] + (b[2][0] - b[1][0]) * u, b[1][1] + (b[2][1] - b[1][1]) * u];
      return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
    };
    tracePts([[(a[1][0] + b[1][0]) / 2, KNUCKLE_Y - 0.06], mid(upTo * 0.5), mid(upTo)], P);
  }
  outline(Math.max(2, lineW * 0.6));

  // Palm creases, fading as the palm turns away from us.
  const show = clamp01((pose.turn - 0.55) / 0.45);
  if (show > 0) {
    g.beginPath();
    tracePts([[0.27, -0.43], [0.13, -0.36], [0.08, -0.22], [0.11, -0.07]], P);
    tracePts([[-0.27, -0.4], [-0.1, -0.42], [0.06, -0.47]], P);
    g.lineWidth = Math.max(2, lineW * 0.55);
    g.strokeStyle = `rgba(${PALM_LINE}, ${0.35 * show})`;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke();
  }
}

// A bendy "rubber hose" arm from the elbow (below the counter) to the wrist.
function drawArm(ex, ey, wx, wy, bow, width, fill, band, lineW) {
  const qx = (ex + wx) / 2 + bow[0];
  const qy = (ey + wy) / 2 + bow[1];
  const at = (u) => [
    (1 - u) * (1 - u) * ex + 2 * (1 - u) * u * qx + u * u * wx,
    (1 - u) * (1 - u) * ey + 2 * (1 - u) * u * qy + u * u * wy,
  ];
  g.beginPath();
  g.moveTo(ex, ey);
  g.quadraticCurveTo(qx, qy, wx, wy);
  g.lineCap = 'butt';
  g.lineWidth = width + lineW * 2;
  g.strokeStyle = INK;
  g.stroke();
  g.lineWidth = width;
  g.strokeStyle = fill;
  g.stroke();
  // A stripe near the cuff.
  g.beginPath();
  for (let u = 0.8; u <= 0.9001; u += 0.025) {
    const [x, y] = at(u);
    if (u === 0.8) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.lineWidth = width;
  g.strokeStyle = band;
  g.stroke();
  g.lineCap = 'round';
}

function drawHands({ w, h, t, info, sleeves, bottom = DOTS_H }) {
  const areaH = h - bottom;
  const sleeveColors = sleeves ? sleeves.colors : SLEEVES;
  const sleeveBands = sleeves ? sleeves.bands : SLEEVE_BANDS;
  const s = Math.max(30, Math.min(areaH / 2, (w - 24) / 3.4));
  const cx = w / 2;
  const L = 2.2 * s;                   // forearm: elbow (out of sight) to wrist
  const LEAN_IN = 0.38;                // forearm lean at the clap (radians)…
  const LEAN_OUT = 0.05;               // …and with the hands open
  const wristY = areaH * 0.45 + 0.55 * s;
  const elbowDX = 0.17 * s + L * Math.sin(LEAN_IN);
  const elbowY = wristY + L * Math.cos(LEAN_IN);
  const clapY = wristY - 0.5 * s;      // where the palms meet
  const lineW = Math.max(3, s * 0.045);

  // Sunny background, rays spreading from the clap.
  g.fillStyle = '#fff6d6';
  g.fillRect(0, 0, w, h);
  const rr = Math.hypot(w, h);
  g.fillStyle = '#ffeaa8';
  g.beginPath();
  const rays = 12;
  for (let i = 0; i < rays; i++) {
    const a = t * 0.00006 + (i / rays) * Math.PI * 2;
    g.moveTo(cx, clapY);
    g.arc(cx, clapY, rr, a, a + Math.PI / rays);
    g.closePath();
  }
  g.fill();

  // Pose for this frame.
  let open;
  let bend;
  let wiggle = null;
  let bow;           // arm bend, in forearm lengths (+ = toward the middle)
  let since = Infinity;
  let swoosh = 0;    // 0–1: how fast the hands are swinging in
  let squash = 0;
  let bob = 0;
  if (info) {
    const interval = info.interval;
    since = info.phase * interval;
    open = clapOpen(since, interval);
    bend = fingerFlex(since, interval);
    // The arms lag behind the hands: bowed out on the way in, in on the way out.
    const a = Math.max(0, since - 0.012);
    const b = Math.min(interval, since + 0.012);
    const speed = (clapOpen(b, interval) - clapOpen(a, interval)) / (b - a);
    bow = -0.05 + Math.max(-0.1, Math.min(0.1, speed * 0.015));
    const { close } = clapTiming(interval);
    swoosh = clamp01((since - (interval - close)) / close);
    if (info.beat >= 0) squash = since < 0.08 ? 1 - since / 0.08 : 0;
    else since = Infinity; // lead-in: no burst for a clap that hasn't happened
  } else {
    // Waiting to play: hands up and ready, fingers wiggling.
    open = 0.92 + 0.05 * Math.sin(t / 700);
    bend = 0;
    wiggle = FINGERS.map((_, i) => 0.08 * Math.sin(t / 260 + i * 0.9));
    bow = -0.05 + 0.02 * Math.sin(t / 700);
    bob = Math.sin(t / 450) * s * 0.03;
  }
  const o = clamp01(open);
  const pose = {
    spread: 0.11 * o + 0.06 * squash,
    bend,
    wiggle,
    thumb: lerp(0.3, 0.95, o) + 0.5 * bend,
    turn: lerp(0.42, 1, o) * (1 - 0.12 * squash),
  };
  const tilt = lerp(0.03, -0.28, open);
  const lean = lerp(LEAN_IN, LEAN_OUT, open);

  // Where each hand is: m = 1 for the left, −1 for the right.
  const rig = [1, -1].map((m) => {
    const ex = cx - m * elbowDX;
    const wx = cx - m * (elbowDX - L * Math.sin(lean)) + m * 0.04 * s * squash;
    const wy = elbowY - L * Math.cos(lean) + bob;
    return { m, ex, wx, wy, P: handXform(wx, wy, m, tilt, pose.turn, s, 1 + 0.04 * squash) };
  });

  // Motion lines along each hand's swing, trailing behind it.
  if (swoosh > 0.25) {
    g.save();
    g.globalAlpha = Math.min(1, (swoosh - 0.25) / 0.5) * 0.7;
    g.beginPath();
    // Each line runs from `back` behind the hand's centre to just behind it
    // (the hand, drawn later, covers the near end).
    const back = 0.32 * swoosh * swoosh;
    const gap = 0.04;
    for (const { m, ex, P } of rig) {
      for (const up of back > gap + 0.01 ? [-0.2, -0.55, -0.9] : []) {
        const [px, py] = P(0, up);
        const r = Math.hypot(px - ex, py - elbowY);
        const a = Math.atan2(py - elbowY, px - ex);
        g.moveTo(ex + Math.cos(a - m * back) * r, elbowY + Math.sin(a - m * back) * r);
        g.arc(ex, elbowY, r, a - m * back, a - m * gap, m < 0);
      }
    }
    outline(Math.max(3, s * 0.035));
    g.restore();
  }

  // Burst of colour right at the clap.
  const burstLen = Math.min(0.22, (info ? info.interval : 1) * 0.6);
  if (since < burstLen) {
    const k = since / burstLen;
    g.save();
    g.globalAlpha = 1 - k * k;
    starburst(cx, clapY, s * (0.55 + 0.45 * k), info.beat === 0 ? '#ff6fb5' : '#ffd23f');
    g.beginPath();
    for (const a of [-2.3, -1.57, -0.84]) {
      const r1 = s * (0.75 + 0.35 * k);
      const r2 = r1 + s * 0.18;
      g.moveTo(cx + Math.cos(a) * r1, clapY + Math.sin(a) * r1);
      g.lineTo(cx + Math.cos(a) * r2, clapY + Math.sin(a) * r2);
    }
    outline(Math.max(3, s * 0.04));
    g.restore();
  }

  // Left hand first, so the right one lands in front of it.
  rig.forEach(({ m, ex, wx, wy, P }, i) => {
    const dx = wx - ex;
    const dy = wy - elbowY;
    const len = Math.hypot(dx, dy);
    // Perpendicular to the forearm, pointing toward the middle.
    const nx = (-dy / len) * m;
    const ny = (dx / len) * m;
    drawArm(ex, elbowY, wx, wy, [nx * bow * L, ny * bow * L], 0.42 * s, sleeveColors[i], sleeveBands[i], lineW);
    // The cuff is round, so it doesn't narrow as the hand turns.
    const cuff = handXform(wx, wy, m, tilt, 1, s);
    g.beginPath();
    tracePts(CUFF_PTS, cuff, true);
    g.fillStyle = '#ffffff';
    g.fill();
    outline(lineW);
    g.beginPath();
    tracePts([[-0.3, 0.07], [0, 0.1], [0.3, 0.07]], cuff);
    outline(Math.max(2, lineW * 0.6));
    drawGlove(P, s, pose);
  });

  // The counter the arms come up from behind.
  const top = areaH - 6;
  g.fillStyle = COUNTER;
  g.fillRect(-4, top, w + 8, h - top + 4);
  g.fillStyle = 'rgba(255, 255, 255, 0.35)';
  g.fillRect(-4, top + 9, w + 8, 7);
  g.beginPath();
  g.moveTo(-4, top);
  g.lineTo(w + 4, top);
  outline(4);
}

function clapSound(audio, time, accent) {
  const ctx = audio.ctx;
  const src = ctx.createBufferSource();
  src.buffer = audio.clapBuffer;
  src.playbackRate.value = accent ? 1 : 1.12;
  const gain = ctx.createGain();
  gain.gain.value = accent ? 1 : 0.6;
  src.connect(gain).connect(ctx.destination);
  src.start(time);
}

// ── 🐸 Hopping frog ─────────────────────────────────────────────────────────

const FROG_GREEN = '#6cc94a';
const REEDS = sprinkle(6, 7);

function lilyPad(x, y, rx, flower) {
  ellipse(x, y, rx, rx * 0.32);
  g.fillStyle = '#3fa34d';
  g.fill();
  outline(3);
  // The notch.
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + rx * 0.9, y - rx * 0.12);
  g.lineTo(x + rx * 0.9, y + rx * 0.12);
  g.closePath();
  g.fillStyle = '#62c3d0';
  g.fill();
  if (flower) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ellipse(x - rx * 0.55 + Math.cos(a) * rx * 0.1, y - rx * 0.05 + Math.sin(a) * rx * 0.05, rx * 0.1, rx * 0.06);
      g.fillStyle = '#ff9ccf';
      g.fill();
      outline(2);
    }
    ellipse(x - rx * 0.55, y - rx * 0.05, rx * 0.05, rx * 0.04);
    g.fillStyle = '#ffd23f';
    g.fill();
  }
}

function drawFrogBody(x, y, s, air, blink) {
  const lineW = Math.max(3, s * 0.05);
  // Back legs: tucked while sitting, stretched down while hopping.
  const legs = [-1, 1].map((side) => () => {
    g.moveTo(x + side * 0.38 * s, y - 0.22 * s);
    g.lineTo(x + side * (0.5 + 0.05 * air) * s, y - (0.1 - 0.45 * air) * s);
    return 0.22 * s;
  });
  blob([
    ...legs,
    () => { g.ellipse(x, y - 0.38 * s, 0.55 * s, 0.38 * s, 0, 0, Math.PI * 2); return 0; },
    () => { g.arc(x - 0.27 * s, y - 0.72 * s, 0.2 * s, 0, Math.PI * 2); return 0; },
    () => { g.arc(x + 0.27 * s, y - 0.72 * s, 0.2 * s, 0, Math.PI * 2); return 0; },
  ], FROG_GREEN, lineW);
  // Feet.
  for (const side of [-1, 1]) {
    ellipse(x + side * (0.55 + 0.05 * air) * s, y - (0.02 - 0.45 * air) * s, 0.18 * s, 0.08 * s);
    g.fillStyle = FROG_GREEN;
    g.fill();
    outline(lineW * 0.8);
  }
  // Belly, cheeks, smile.
  ellipse(x, y - 0.26 * s, 0.32 * s, 0.2 * s);
  g.fillStyle = '#c9f2a0';
  g.fill();
  for (const side of [-1, 1]) {
    ellipse(x + side * 0.36 * s, y - 0.44 * s, 0.08 * s, 0.05 * s);
    g.fillStyle = '#ff9ccf';
    g.fill();
  }
  g.beginPath();
  g.arc(x, y - 0.56 * s, 0.24 * s, Math.PI * 0.15, Math.PI * 0.85);
  outline(lineW * 0.8);
  // Eyes look up while in the air.
  eye(x - 0.27 * s, y - 0.74 * s, 0.12 * s, 0, -air, blink);
  eye(x + 0.27 * s, y - 0.74 * s, 0.12 * s, 0, -air, blink);
}

function drawFrog({ w, h, t, beats, info }) {
  const areaH = h - DOTS_H;
  const waterY = areaH * 0.42;
  // Sky and pond.
  g.fillStyle = '#d9f4ff';
  g.fillRect(0, 0, w, waterY);
  g.fillStyle = '#62c3d0';
  g.fillRect(0, waterY, w, h - waterY);
  // Lazy waves.
  g.beginPath();
  for (let row = 0; row < 4; row++) {
    const y = waterY + 30 + row * (h - waterY) / 4;
    for (let x = (row % 2) * 40 - 60 + ((t / 40) % 80); x < w; x += 80) {
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 15, y - 6, x + 30, y);
    }
  }
  g.lineWidth = 3;
  g.strokeStyle = '#8fd8e0';
  g.stroke();
  // Reeds along the bank.
  for (const r of REEDS) {
    const x = r.x < 0.5 ? r.x * w * 0.25 : w - (r.x - 0.5) * w * 0.25;
    const top = waterY - 20 - r.r * areaH * 0.2;
    const sway = Math.sin(t / 900 + r.p) * 4;
    g.beginPath();
    g.moveTo(x, waterY + 6);
    g.quadraticCurveTo(x, top + 30, x + sway, top);
    outline(4);
    ellipse(x + sway, top + 8, 5, 14);
    g.fillStyle = '#9c6b3f';
    g.fill();
    outline(2);
  }

  // One lily pad per beat.
  const n = beats;
  const margin = Math.min(w * 0.14, 90);
  const pads = Array.from({ length: n }, (_, i) => margin + (w - 2 * margin) * (n === 1 ? 0.5 : i / (n - 1)));
  const padY = waterY + (areaH - waterY) * 0.62;
  const padR = Math.min((w - 2 * margin) / (n - 1 || 1) * 0.42, w * 0.16, 90);
  const s = Math.max(36, Math.min(padR * 1.35, areaH * 0.28));
  const hopH = Math.min(areaH * 0.42, padY - s * 1.1);

  // Ripples where the frog just landed.
  const hit = impact(info, 0.45);
  const landX = info && info.beat >= 0 ? pads[info.beat % n] : pads[0];
  pads.forEach((x, i) => lilyPad(x, padY, padR, i === 0));
  if (hit > 0) {
    const k = 1 - hit;
    g.save();
    g.globalAlpha = hit;
    for (const m of [1, 1.35]) {
      ellipse(landX, padY + 4, padR * m * (1 + 0.5 * k), padR * 0.32 * m * (1 + 0.5 * k));
      g.lineWidth = 3;
      g.strokeStyle = '#ffffff';
      g.stroke();
    }
    g.restore();
  }

  // Sits for a moment after landing, then hops to the next pad.
  let x = pads[0];
  let y = padY;
  let air = 0;
  let squash;
  if (info) {
    const from = info.beat >= 0 ? info.beat % n : 0;
    const to = info.beat >= 0 ? (info.beat + 1) % n : 0;
    const k = clamp01((info.phase - 0.18) / 0.82);
    x = lerp(pads[from], pads[to], k);
    air = arc(k);
    y = padY - hopH * air;
    squash = impact(info, 0.15);
  } else {
    squash = 0.25 + 0.25 * Math.sin(t / 500); // breathing
  }
  // Shadow on the water.
  ellipse(x, padY + 2, s * 0.5 * (1 - 0.5 * air), s * 0.12 * (1 - 0.5 * air));
  g.fillStyle = 'rgba(43, 34, 80, 0.2)';
  g.fill();

  g.save();
  g.translate(x, y);
  g.scale(1 + 0.12 * squash, 1 - 0.12 * squash);
  drawFrogBody(0, 0, s, air, !info && (t % 3500) < 150);
  g.restore();
}

function frogSound(audio, time, accent) {
  const f = accent ? 520 : 400;
  blip(audio, time, { type: 'square', f0: f, f1: f * 0.55, glide: 0.05, len: 0.06, vol: 0.35, filter: 1400 });
  blip(audio, time + 0.08, { type: 'square', f0: f * 1.15, f1: f * 0.6, glide: 0.05, len: 0.07, vol: 0.3, filter: 1400 });
}

// ── ⚽ Bouncy ball on the moon ──────────────────────────────────────────────

const STARS = sprinkle(70, 42);
const BALL_COLORS = ['#ff5a5f', '#ffd23f', '#3ddc84', '#5ec8f2'];

function drawBall({ w, h, t, info }) {
  const areaH = h - DOTS_H;
  // Night sky.
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1b1446');
  sky.addColorStop(1, '#4b3a9a');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  for (const st of STARS) {
    const tw = 0.5 + 0.5 * Math.sin(t / 400 + st.p);
    g.globalAlpha = 0.4 + 0.6 * tw;
    starShape(st.x * w, st.y * areaH * 0.9, 1.5 + st.r * 3, 4, 0.4, 0);
    g.fillStyle = '#fff6c2';
    g.fill();
  }
  g.globalAlpha = 1;
  // A ringed planet.
  const px = w * 0.82;
  const py = areaH * 0.2;
  const pr = Math.min(w, areaH) * 0.08;
  ellipse(px, py, pr, pr);
  g.fillStyle = '#ff9ccf';
  g.fill();
  outline(3);
  ellipse(px, py, pr * 1.7, pr * 0.45, -0.35);
  outline(4);
  g.lineWidth = 3;
  g.strokeStyle = '#ffd23f';
  g.stroke();

  // Moon ground with craters.
  const groundY = areaH * 0.84;
  g.beginPath();
  g.moveTo(0, groundY + 10);
  g.quadraticCurveTo(w / 2, groundY - 18, w, groundY + 10);
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  g.fillStyle = '#d7d9ea';
  g.fill();
  outline(4);
  for (const [cxk, cyk, r] of [[0.15, 0.4, 22], [0.75, 0.55, 30], [0.45, 0.8, 16], [0.92, 0.25, 14]]) {
    ellipse(w * cxk, groundY + (h - groundY) * cyk, r, r * 0.35);
    g.fillStyle = '#b9bcd6';
    g.fill();
    outline(2);
  }

  const cx = w / 2;
  const r = Math.max(24, Math.min(areaH * 0.12, w * 0.13));
  const floor = groundY - 6;
  const topH = Math.max(0, floor - r * 2 - areaH * 0.1);

  let air;
  let squash = 0;
  if (info) {
    air = arc(info.phase);
    squash = impact(info, 0.12);
  } else {
    air = 0.04 + 0.04 * Math.sin(t / 500);
  }
  const y = floor - r - topH * air;

  // Sparkles kicked up on landing.
  const hit = impact(info, 0.4);
  if (hit > 0) {
    const k = 1 - hit;
    g.save();
    g.globalAlpha = hit;
    for (const side of [-1, 1]) {
      for (const [dx, dy] of [[1.2, 0.6], [1.7, 1.1], [1.1, 1.5]]) {
        starShape(cx + side * r * dx * (1 + k), floor - r * dy * (0.5 + k), r * 0.22, 5, 0.45);
        g.fillStyle = info.beat === 0 ? '#ff9ccf' : '#ffd23f';
        g.fill();
        outline(2);
      }
    }
    g.restore();
  }

  // Shadow shrinks as the ball rises.
  ellipse(cx, floor, r * (1 - 0.6 * air), r * 0.2 * (1 - 0.6 * air));
  g.fillStyle = 'rgba(43, 34, 80, 0.3)';
  g.fill();

  // The ball, squashed against the ground on impact.
  g.save();
  g.translate(cx, floor);
  g.scale(1 + 0.3 * squash, 1 - 0.3 * squash);
  g.translate(0, y - floor);
  // Striped rainbow ball, spinning a quarter-turn each beat.
  const spin = info ? ((info.beat < 0 ? 0 : info.beat) + info.phase) * Math.PI / 2 : 0;
  g.save();
  ellipse(0, 0, r, r);
  g.clip();
  g.rotate(spin);
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, r, (i / 4) * Math.PI * 2, ((i + 1) / 4) * Math.PI * 2);
    g.closePath();
    g.fillStyle = BALL_COLORS[i];
    g.fill();
  }
  g.restore();
  ellipse(0, 0, r, r);
  outline(Math.max(3, r * 0.08));
  // Face stays upright: happy eyes squeeze shut on landing.
  eye(-r * 0.32, -r * 0.18, r * 0.2, 0, air > 0.5 ? -1 : 0, squash > 0.3);
  eye(r * 0.32, -r * 0.18, r * 0.2, 0, air > 0.5 ? -1 : 0, squash > 0.3);
  g.beginPath();
  g.arc(0, r * 0.12, r * 0.35, Math.PI * 0.15, Math.PI * 0.85);
  outline(Math.max(3, r * 0.08));
  g.restore();
}

function boingSound(audio, time, accent) {
  const f = accent ? 260 : 200;
  const osc = blip(audio, time, { type: 'sine', f0: f, f1: f * 2.6, glide: 0.12, len: 0.28, vol: 0.5 });
  // A wobble makes it go "boi-oi-oing".
  const ctx = audio.ctx;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 22;
  const depth = ctx.createGain();
  depth.gain.value = f * 0.25;
  lfo.connect(depth).connect(osc.frequency);
  lfo.start(time);
  lfo.stop(time + 0.3);
}

// ── 🦕 Stomping dino ────────────────────────────────────────────────────────

const DINO = '#9b7bea';
const DINO_BELLY = '#d9ccff';
const SPIKES = '#ff9f43';

function drawDinoBody(x, y, u, lift, blink) {
  const lineW = Math.max(3, u * 0.022);
  // Back spikes first so the body covers their bases.
  for (let i = 0; i < 5; i++) {
    const k = i / 4;
    const sx = x - 0.28 * u + k * 0.5 * u;
    const sy = y - 0.62 * u - Math.sin(k * Math.PI) * 0.05 * u - (k > 0.8 ? 0.1 * u : 0);
    g.beginPath();
    g.moveTo(sx - 0.06 * u, sy + 0.06 * u);
    g.lineTo(sx, sy - 0.08 * u);
    g.lineTo(sx + 0.06 * u, sy + 0.06 * u);
    g.closePath();
    g.fillStyle = SPIKES;
    g.fill();
    outline(lineW);
  }
  const legs = [-1, 1].map((side, i) => () => {
    g.moveTo(x + side * 0.14 * u, y - 0.35 * u);
    g.lineTo(x + side * 0.14 * u, y - 0.12 * u - lift[i]);
    return 0.15 * u;
  });
  blob([
    ...legs,
    // Tail
    () => {
      g.moveTo(x - 0.2 * u, y - 0.58 * u);
      g.quadraticCurveTo(x - 0.55 * u, y - 0.45 * u, x - 0.78 * u, y - 0.2 * u);
      g.quadraticCurveTo(x - 0.5 * u, y - 0.28 * u, x - 0.2 * u, y - 0.3 * u);
      g.closePath();
      return 0;
    },
    () => { g.ellipse(x, y - 0.45 * u, 0.34 * u, 0.22 * u, 0, 0, Math.PI * 2); return 0; },
    () => { g.moveTo(x + 0.22 * u, y - 0.55 * u); g.lineTo(x + 0.32 * u, y - 0.8 * u); return 0.17 * u; },
    () => { g.ellipse(x + 0.4 * u, y - 0.86 * u, 0.2 * u, 0.13 * u, 0.1, 0, Math.PI * 2); return 0; },
  ], DINO, lineW);
  // Feet
  [-1, 1].forEach((side, i) => {
    g.beginPath();
    g.roundRect(x + side * 0.14 * u - 0.1 * u, y - 0.06 * u - lift[i], 0.22 * u, 0.07 * u, 0.03 * u);
    g.fillStyle = DINO;
    g.fill();
    outline(lineW);
  });
  // Belly, arm, face.
  ellipse(x + 0.08 * u, y - 0.4 * u, 0.2 * u, 0.13 * u, -0.2);
  g.fillStyle = DINO_BELLY;
  g.fill();
  g.beginPath();
  g.moveTo(x + 0.24 * u, y - 0.48 * u);
  g.lineTo(x + 0.33 * u, y - 0.4 * u);
  outline(0.05 * u + lineW);
  g.beginPath();
  g.moveTo(x + 0.24 * u, y - 0.48 * u);
  g.lineTo(x + 0.33 * u, y - 0.4 * u);
  g.lineWidth = 0.05 * u;
  g.strokeStyle = DINO;
  g.stroke();
  eye(x + 0.43 * u, y - 0.9 * u, 0.045 * u, 1, 0, blink);
  g.beginPath();
  g.arc(x + 0.43 * u, y - 0.86 * u, 0.12 * u, Math.PI * 0.1, Math.PI * 0.45);
  outline(lineW);
  ellipse(x + 0.57 * u, y - 0.9 * u, 0.012 * u, 0.012 * u);
  g.fillStyle = INK;
  g.fill();
  ellipse(x + 0.47 * u, y - 0.8 * u, 0.04 * u, 0.025 * u);
  g.fillStyle = '#ff9ccf';
  g.fill();
}

function drawDino({ w, h, t, info }) {
  const areaH = h - DOTS_H;
  const groundY = areaH * 0.86;
  const hit = impact(info, 0.25);
  const accent = info && info.beat === 0;

  g.save();
  // The whole world shakes when the dino stomps (more on beat 1).
  if (hit > 0) {
    const amp = hit * (accent ? 9 : 5);
    g.translate(Math.sin(t * 0.09) * amp, Math.cos(t * 0.13) * amp * 0.6);
  }
  // Sunset sky, volcano and hills; drawn oversized so shaking never shows an edge.
  const sky = g.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, '#ffb86b');
  sky.addColorStop(1, '#ffe7a8');
  g.fillStyle = sky;
  g.fillRect(-20, -20, w + 40, h + 40);
  const vx = w * 0.78;
  const vw = Math.min(w * 0.3, 220);
  const vh = areaH * 0.38;
  // Smoke puffs, with a big one on beat 1.
  for (let i = 0; i < 3; i++) {
    const k = ((t / 2500) + i / 3) % 1;
    const pr = vw * (0.1 + 0.12 * k) * (accent ? 1 + hit * 0.5 : 1);
    g.globalAlpha = 1 - k;
    ellipse(vx + Math.sin(k * 6 + i) * 10, groundY - vh - k * areaH * 0.3, pr, pr);
    g.fillStyle = '#ffffff';
    g.fill();
    g.globalAlpha = 1;
  }
  g.beginPath();
  g.moveTo(vx - vw, groundY);
  g.lineTo(vx - vw * 0.2, groundY - vh);
  g.lineTo(vx + vw * 0.2, groundY - vh);
  g.lineTo(vx + vw, groundY);
  g.closePath();
  g.fillStyle = '#a0674b';
  g.fill();
  outline(4);
  g.beginPath();
  g.moveTo(vx - vw * 0.2, groundY - vh);
  g.lineTo(vx - vw * 0.08, groundY - vh * 0.8);
  g.lineTo(vx, groundY - vh * 0.9);
  g.lineTo(vx + vw * 0.1, groundY - vh * 0.78);
  g.lineTo(vx + vw * 0.2, groundY - vh);
  g.closePath();
  g.fillStyle = '#ff5a5f';
  g.fill();
  outline(3);
  for (const [hx, hr] of [[0.1, 0.35], [0.45, 0.25]]) {
    ellipse(w * hx, groundY, w * hr, areaH * 0.14);
    g.fillStyle = '#7ed957';
    g.fill();
    outline(4);
  }
  g.fillStyle = '#6cc94a';
  g.fillRect(-20, groundY, w + 40, h - groundY + 20);
  g.beginPath();
  g.moveTo(-20, groundY);
  g.lineTo(w + 20, groundY);
  outline(4);

  const u = Math.max(80, Math.min(areaH * 0.78, w * 0.55, 420));
  const x = w / 2 + u * 0.1;

  // Feet take turns: the one that lands on the next beat lifts during this one.
  const lift = [0, 0];
  if (info) lift[(info.beat + 1) % 2] = Math.sin(Math.PI * info.phase) * 0.16 * u;
  const landed = info && info.beat >= 0 ? info.beat % 2 : -1;

  // Dust puffs by the foot that just landed.
  if (hit > 0 && landed >= 0) {
    const fx = x + (landed === 0 ? -1 : 1) * 0.14 * u;
    g.save();
    g.globalAlpha = hit;
    for (const side of [-1, 1]) {
      ellipse(fx + side * u * (0.14 + 0.1 * (1 - hit)), groundY - 0.03 * u, 0.05 * u, 0.035 * u);
      g.fillStyle = '#f3e3c3';
      g.fill();
      outline(2);
    }
    g.restore();
  }

  drawDinoBody(x, groundY, u, lift, (t % 4000) < 150);
  g.restore();
}

function stompSound(audio, time, accent) {
  const vol = accent ? 0.95 : 0.7;
  blip(audio, time, { type: 'sine', f0: 150, f1: 40, glide: 0.18, len: 0.28, vol });
  // A higher "thud" so it's still heard on small phone speakers.
  blip(audio, time, { type: 'triangle', f0: 320, f1: 90, glide: 0.06, len: 0.09, vol: vol * 0.45 });
}

// ── The line-up ─────────────────────────────────────────────────────────────

export const SCENES = {
  hands: { name: 'Clapping hands', title: 'Clap Along!', draw: drawHands, sound: clapSound },
  frog: { name: 'Hopping frog', title: 'Hop Along!', draw: drawFrog, sound: frogSound },
  ball: { name: 'Bouncy ball', title: 'Bounce Along!', draw: drawBall, sound: boingSound },
  dino: { name: 'Stomping dino', title: 'Stomp Along!', draw: drawDino, sound: stompSound },
};
