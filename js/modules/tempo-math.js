// Pure tempo calculations — no DOM, no Tone, no shared state — so they can
// be unit-tested under Node (see tests/unit/).

export var MIN_BPM = 30;
export var MAX_BPM = 300;

export function clampBPM(bpm) {
  return Math.max(MIN_BPM, Math.min(MAX_BPM, bpm));
}

// ── Song sections ─────────────────────────────────────────────────────────

// Length in beats of a ramp/ritardando window given in beats or measures,
// never longer than the section it sits in.
function windowBeats(count, unit, beatsPerMeasure, sectionBeats) {
  var beats = (unit === 'measures') ? count * beatsPerMeasure : count;
  return Math.min(beats, sectionBeats);
}

// Tempo for the beat at `beatIndex` (0-based) within section `cur`, where
// `next` is the following section (or undefined for the last one).
//
// Returns { bpm, ritardandoProgress, rampProgress }:
//   bpm — the tempo to set for this beat, or null to leave it unchanged;
//   *Progress — 0 outside the window, else the fraction (0–1] through it.
//
// A ritardando at the end of `cur` takes priority over a transition ramp
// toward `next`. Both step linearly so the last beat of the window lands
// exactly on the target tempo.
export function songTempoAt(cur, next, beatIndex) {
  var result = { bpm: null, ritardandoProgress: 0, rampProgress: 0 };
  var sectionBeats = cur.measures * cur.beatsPerMeasure;
  var remaining = sectionBeats - beatIndex; // including this beat

  if (cur.ritardandoEnabled && (cur.ritardandoBeats || 0) > 0) {
    var ritBeats = windowBeats(cur.ritardandoBeats, cur.ritardandoUnit || 'beats',
                               cur.beatsPerMeasure, sectionBeats);
    if (remaining <= ritBeats) {
      var ritStep = ritBeats - remaining + 1; // 1-based step into the window
      var ritTarget = Math.max(MIN_BPM, cur.bpm * (1 - (cur.ritardandoPercent || 30) / 100));
      result.bpm = clampBPM(cur.bpm + (ritTarget - cur.bpm) * ritStep / ritBeats);
      result.ritardandoProgress = ritStep / ritBeats;
      return result;
    }
  }

  if (next && (next.transitionBeats || 0) > 0 && next.bpm !== cur.bpm) {
    var rampBeats = windowBeats(next.transitionBeats, next.transitionUnit || 'beats',
                                next.beatsPerMeasure, sectionBeats);
    if (remaining <= rampBeats) {
      var rampStep = rampBeats - remaining + 1;
      result.bpm = clampBPM(cur.bpm + (next.bpm - cur.bpm) * rampStep / rampBeats);
      result.rampProgress = rampStep / rampBeats;
    }
  }
  return result;
}

// ── Two-measure pattern ───────────────────────────────────────────────────

// Measure 2's tempo. 'beat' keeps the beat the same; 'subdivision' keeps
// the subdivided note the same speed (M2 = M1 × S1 / S2).
export function linkedM2BPM(m1Bpm, m1Subdivision, m2Subdivision, linkMode) {
  var s1 = parseInt(m1Subdivision) || 0;
  var s2 = parseInt(m2Subdivision) || 0;
  var bpm = (linkMode === 'subdivision' && s1 > 0 && s2 > 0) ? m1Bpm * s1 / s2 : m1Bpm;
  return clampBPM(Math.round(bpm));
}

// ── Tap tempo ─────────────────────────────────────────────────────────────

export var TAP_RESET_MS = 2000;     // a longer pause starts a new measurement
export var TAP_MAX_INTERVALS = 4;   // average over at most this many intervals
var TAP_TOLERANCE = 0.4;            // ±40% of the running average

// Adds a tap at time `now` (ms) to the previous tap times. Returns the new
// list and the tempo it implies (null until there are two taps). A pause of
// more than TAP_RESET_MS starts over; an interval far off the running
// average (a missed or double tap) restarts the average from the last tap.
export function addTap(times, now) {
  var last = times[times.length - 1];
  if (last === undefined || now - last > TAP_RESET_MS) {
    return { times: [now], bpm: null };
  }
  var next = times.slice();
  if (next.length >= 2) {
    var avg = (last - next[0]) / (next.length - 1);
    var interval = now - last;
    if (interval < avg * (1 - TAP_TOLERANCE) || interval > avg * (1 + TAP_TOLERANCE)) next = [last];
  }
  next.push(now);
  if (next.length > TAP_MAX_INTERVALS + 1) next.shift();
  var ms = (next[next.length - 1] - next[0]) / (next.length - 1);
  return { times: next, bpm: 60000 / ms };
}
