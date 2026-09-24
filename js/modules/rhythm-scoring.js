// Pure "Check my rhythm" scoring — no DOM, no Tone, no shared state — so it
// can be unit-tested under Node (see tests/unit/). Times are in seconds.

export var ON_TIME_FRACTION = 0.20;  // within ±20% of a beat = "on time" (green)
export var MATCH_FRACTION   = 0.45;  // up to ±45% = matched but early/late

// Pairs each expected note time with at most one detected hit.
//
// Every (expected, detected) pair within the match window is considered and
// committed shortest-difference first. This avoids the in-order greedy
// mistake of letting an early expected note grab a detected hit that
// actually belongs to its neighbour.
//
// Returns { notes: [{ status: 'on'|'early'|'late'|'missed', diff }],
//           extraHits: [detected times that matched nothing] }.
export function matchHits(expected, detected, beatDur) {
  var onWindow  = beatDur * ON_TIME_FRACTION;
  var maxWindow = beatDur * MATCH_FRACTION;
  var usedD     = new Array(detected.length).fill(false);
  var matchOfE  = new Array(expected.length).fill(-1);

  var pairs = [];
  for (var e = 0; e < expected.length; e++) {
    for (var d = 0; d < detected.length; d++) {
      var diff = detected[d] - expected[e];
      if (Math.abs(diff) <= maxWindow) pairs.push({ e: e, d: d, abs: Math.abs(diff) });
    }
  }
  pairs.sort(function(a, b) { return a.abs - b.abs; });
  for (var p = 0; p < pairs.length; p++) {
    var pr = pairs[p];
    if (matchOfE[pr.e] !== -1 || usedD[pr.d]) continue;
    matchOfE[pr.e] = pr.d;
    usedD[pr.d] = true;
  }

  var notes = [];
  for (var e2 = 0; e2 < expected.length; e2++) {
    var di = matchOfE[e2];
    if (di === -1) {
      notes.push({ status: 'missed', diff: null });
    } else {
      var d2 = detected[di] - expected[e2];
      var status = Math.abs(d2) < onWindow ? 'on' : (d2 < 0 ? 'early' : 'late');
      notes.push({ status: status, diff: d2 });
    }
  }
  var extraHits = [];
  for (var d3 = 0; d3 < usedD.length; d3++) { if (!usedD[d3]) extraHits.push(detected[d3]); }
  return { notes: notes, extraHits: extraHits };
}

// 0–100. 100% means every expected note was clapped within the on-time
// window with no missed and no extra hits. Notes outside the on-time window
// but still matched earn partial credit that fades to 0 at the match limit;
// missed notes earn nothing, and spurious extra hits dilute the score like
// wrong notes would.
export function scoreResult(result, beatDur) {
  var onWindow  = beatDur * ON_TIME_FRACTION;
  var maxWindow = beatDur * MATCH_FRACTION;
  var total     = result.notes.length;
  if (total === 0) return 0;
  var sum = 0;
  result.notes.forEach(function(n) {
    if (n.status === 'missed') return;                 // no credit
    var ad = Math.abs(n.diff);
    if (ad <= onWindow) { sum += 1; return; }          // full credit (green)
    sum += Math.max(0, 1 - (ad - onWindow) / (maxWindow - onWindow));
  });
  var denom = total + result.extraHits.length;
  return Math.round((sum / denom) * 100);
}
