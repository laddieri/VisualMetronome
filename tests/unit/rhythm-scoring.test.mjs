import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchHits, scoreResult } from '../../js/modules/rhythm-scoring.js';

const BEAT = 0.5; // 120 BPM: on-time window ±0.1 s, match window ±0.225 s
const statuses = (r) => r.notes.map((n) => n.status);

describe('matchHits', () => {
  test('classifies on-time, early, late and missed notes', () => {
    const expected = [0, 0.5, 1.0, 1.5];
    const detected = [0.02, 0.33, 1.15];
    const r = matchHits(expected, detected, BEAT);
    assert.deepEqual(statuses(r), ['on', 'early', 'late', 'missed']);
    assert.equal(r.notes[3].diff, null);
    assert.deepEqual(r.extraHits, []);
  });

  test('hits outside the match window are extra, not matched', () => {
    const r = matchHits([0], [0.3], BEAT);
    assert.deepEqual(statuses(r), ['missed']);
    assert.deepEqual(r.extraHits, [0.3]);
  });

  test('each hit matches at most one note', () => {
    const r = matchHits([0, 0.25], [0.12], BEAT);
    // 0.12 is nearer note 0 (+0.12) than note 1 (−0.13).
    assert.deepEqual(statuses(r), ['late', 'missed']);
    assert.deepEqual(r.extraHits, []);
  });

  test('pairs by closest difference, not in order', () => {
    // Matching hits in the order they arrived would give 0.2 to note 0
    // (late by 0.2) and 0.05 to note 1 (early by 0.2); nearest-first gets
    // both on time.
    const r = matchHits([0, 0.25], [0.2, 0.05], BEAT);
    assert.deepEqual(statuses(r), ['on', 'on']);
    assert.deepEqual(r.extraHits, []);
  });
});

describe('scoreResult', () => {
  test('100 for every note on time with nothing extra', () => {
    const r = matchHits([0, 0.5, 1.0], [0.01, 0.49, 1.05], BEAT);
    assert.equal(scoreResult(r, BEAT), 100);
  });

  test('0 with no notes to play', () => {
    assert.equal(scoreResult({ notes: [], extraHits: [] }, BEAT), 0);
  });

  test('missed notes earn nothing', () => {
    const r = matchHits([0, 0.5], [0], BEAT);
    assert.equal(scoreResult(r, BEAT), 50);
  });

  test('off-time notes earn partial credit fading to 0 at the match limit', () => {
    // Halfway between the on-time window (0.1) and the match limit (0.225).
    const r = { notes: [{ status: 'late', diff: 0.1625 }], extraHits: [] };
    assert.equal(scoreResult(r, BEAT), 50);
    const edge = { notes: [{ status: 'late', diff: 0.225 }], extraHits: [] };
    assert.equal(scoreResult(edge, BEAT), 0);
  });

  test('extra hits dilute the score', () => {
    const r = matchHits([0], [0, 0.4], BEAT);
    assert.equal(r.extraHits.length, 1);
    assert.equal(scoreResult(r, BEAT), 50);
  });
});
