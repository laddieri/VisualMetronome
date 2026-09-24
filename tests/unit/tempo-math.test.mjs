import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  addTap, clampBPM, linkedM2BPM, songTempoAt, TAP_MAX_INTERVALS, TAP_RESET_MS,
} from '../../js/modules/tempo-math.js';

const close = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg ?? ''} expected ${expected}, got ${actual}`);

// Runs every beat of section `cur` and returns the tempo set on each.
const tempos = (cur, next) =>
  Array.from({ length: cur.measures * cur.beatsPerMeasure }, (_, i) => songTempoAt(cur, next, i));

const section = (over) => ({ measures: 2, beatsPerMeasure: 4, bpm: 100, ...over });

describe('clampBPM', () => {
  test('keeps tempos inside 30–300', () => {
    assert.equal(clampBPM(10), 30);
    assert.equal(clampBPM(120), 120);
    assert.equal(clampBPM(999), 300);
  });
});

describe('songTempoAt', () => {
  test('leaves the tempo alone with no ramp or ritardando', () => {
    for (const r of tempos(section(), section({ bpm: 140 }))) {
      assert.deepEqual(r, { bpm: null, ritardandoProgress: 0, rampProgress: 0 });
    }
  });

  test('ramps linearly to the next section over the last N beats, landing on its tempo', () => {
    const next = section({ bpm: 140, transitionBeats: 4 });
    const r = tempos(section(), next);
    assert.deepEqual(r.slice(0, 4).map((x) => x.bpm), [null, null, null, null]);
    assert.deepEqual(r.slice(4).map((x) => x.bpm), [110, 120, 130, 140]);
    assert.deepEqual(r.slice(4).map((x) => x.rampProgress), [0.25, 0.5, 0.75, 1]);
  });

  test('measures as the ramp unit use the next section\'s meter', () => {
    const next = section({ bpm: 130, beatsPerMeasure: 3, transitionBeats: 1, transitionUnit: 'measures' });
    const r = tempos(section(), next);
    assert.deepEqual(r.map((x) => x.bpm), [null, null, null, null, null, 110, 120, 130]);
  });

  test('a ramp never starts before the section does', () => {
    const next = section({ bpm: 180, transitionBeats: 99 });
    const r = tempos(section(), next);
    assert.equal(r[0].bpm, 110);        // 8-beat window, first step
    assert.equal(r[7].bpm, 180);
  });

  test('no ramp when the next section has the same tempo', () => {
    const r = tempos(section(), section({ transitionBeats: 4 }));
    assert.ok(r.every((x) => x.bpm === null));
  });

  test('ritardando slows by the given percent over the last N beats', () => {
    const cur = section({ ritardandoEnabled: true, ritardandoBeats: 4, ritardandoPercent: 20 });
    const r = tempos(cur);
    assert.deepEqual(r.slice(4).map((x) => x.bpm), [95, 90, 85, 80]);
    assert.deepEqual(r.slice(4).map((x) => x.ritardandoProgress), [0.25, 0.5, 0.75, 1]);
  });

  test('ritardando defaults to 30% and can be given in measures', () => {
    const cur = section({ ritardandoEnabled: true, ritardandoBeats: 1, ritardandoUnit: 'measures' });
    const r = tempos(cur);
    close(r[7].bpm, 70);
    close(r[4].bpm, 92.5);
  });

  test('ritardando takes priority over a transition ramp inside its window', () => {
    const cur = section({ ritardandoEnabled: true, ritardandoBeats: 2, ritardandoPercent: 50 });
    const next = section({ bpm: 140, transitionBeats: 4 });
    const r = tempos(cur, next);
    // Beats 4–5: ramp toward 140; beats 6–7: ritardando from 100 toward 50.
    assert.deepEqual(r.slice(4).map((x) => x.bpm), [110, 120, 75, 50]);
    assert.deepEqual(r.slice(4).map((x) => x.rampProgress), [0.25, 0.5, 0, 0]);
    assert.deepEqual(r.slice(4).map((x) => x.ritardandoProgress), [0, 0, 0.5, 1]);
  });

  test('ritardando never drops below 30 BPM', () => {
    const cur = section({ bpm: 40, ritardandoEnabled: true, ritardandoBeats: 1, ritardandoPercent: 90 });
    assert.equal(songTempoAt(cur, undefined, 7).bpm, 30);
  });

  test('a disabled ritardando is ignored', () => {
    const cur = section({ ritardandoEnabled: false, ritardandoBeats: 4 });
    assert.ok(tempos(cur).every((x) => x.bpm === null));
  });
});

describe('linkedM2BPM', () => {
  test('beat link keeps the same tempo', () => {
    assert.equal(linkedM2BPM(96, '4', '3', 'beat'), 96);
  });

  test('subdivision link keeps the subdivided note the same speed', () => {
    assert.equal(linkedM2BPM(90, '2', '3', 'subdivision'), 60);
    assert.equal(linkedM2BPM(100, '3', '2', 'subdivision'), 150);
  });

  test('falls back to the beat when either measure has no subdivision', () => {
    assert.equal(linkedM2BPM(96, 'none', '3', 'subdivision'), 96);
    assert.equal(linkedM2BPM(96, '2', 'none', 'subdivision'), 96);
  });

  test('rounds and clamps', () => {
    assert.equal(linkedM2BPM(100, '3', '7', 'subdivision'), 43);
    assert.equal(linkedM2BPM(200, '7', '2', 'subdivision'), 300);
  });
});

describe('addTap', () => {
  const tapAt = (times) => times.reduce((acc, t) => addTap(acc.times, t), { times: [] });

  test('needs two taps before giving a tempo', () => {
    assert.equal(addTap([], 1000).bpm, null);
    assert.equal(addTap([1000], 1500).bpm, 120);
  });

  test('averages steady taps', () => {
    close(tapAt([0, 400, 800, 1200, 1600]).bpm, 150);
  });

  test('averages over at most the last few intervals', () => {
    // Drift from 600 ms to 500 ms intervals; only the recent ones count.
    const times = [0, 600, 1200, 1700, 2200, 2700, 3200];
    const r = tapAt(times);
    assert.equal(r.times.length, TAP_MAX_INTERVALS + 1);
    close(r.bpm, 120);
  });

  test('a long pause starts a new measurement', () => {
    const r = addTap([0, 500, 1000], 1000 + TAP_RESET_MS + 1);
    assert.deepEqual(r, { times: [1000 + TAP_RESET_MS + 1], bpm: null });
  });

  test('a wildly off interval restarts the average from the last tap', () => {
    // Steady at 500 ms, then a double tap 100 ms later.
    const r = addTap([0, 500, 1000], 1100);
    assert.deepEqual(r.times, [1000, 1100]);
    close(r.bpm, 600);
  });

  test('does not mutate the list it was given', () => {
    const times = [0, 500];
    addTap(times, 1000);
    assert.deepEqual(times, [0, 500]);
  });
});
