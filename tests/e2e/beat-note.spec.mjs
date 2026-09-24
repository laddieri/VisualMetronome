import { test, expect, openApp, setControl } from './fixtures.mjs';

// The beat note (quarter, half, eighth, dotted quarter) only changes how a
// beat is written. Every beat is scheduled at Tone "4n" at the transport
// tempo, and code that needs a beat's length (rhythm checker windows,
// drum grooves, custom-rhythm playback) uses Tone.Time("4n"). This test
// pins that: the measured time between beats must equal "4n" for each
// beat note.
for (const note of ['q', 'h', 'e', 'dq']) {
  test(`beats are one "4n" apart with beat note '${note}'`, async ({ page, errors }) => {
    await openApp(page);
    await setControl(page, 'animal-selector', 'score');
    await setControl(page, 'beat-note-select', note);
    await page.locator('#bpm-input').fill('120');
    await page.locator('#bpm-input').press('Enter');

    // The app's beat callback hands its audio-clock time to Tone.Draw once
    // per beat (to sync the animation). Record those times.
    await page.evaluate(() => {
      window.__beatTimes = new Set();
      const schedule = Tone.Draw.schedule.bind(Tone.Draw);
      Tone.Draw.schedule = (fn, time) => { window.__beatTimes.add(time); return schedule(fn, time); };
    });
    await page.locator('body').press('Space');
    await page.waitForFunction(() => window.__beatTimes.size >= 6);
    await page.locator('body').press('Space');

    const { gaps, fourN, noteValue } = await page.evaluate(async () => {
      const { state } = await import('/js/modules/state.js');
      const t = [...window.__beatTimes].sort((x, y) => x - y);
      return {
        gaps: t.slice(1).map((x, i) => x - t[i]),
        fourN: Tone.Time('4n').toSeconds(),
        noteValue: state.beatNoteValue,
      };
    });
    expect(noteValue).toBe(note);
    expect(fourN).toBeCloseTo(0.5, 6); // 120 BPM
    for (const gap of gaps) expect(gap).toBeCloseTo(fourN, 6);
    expect(errors).toEqual([]);
  });
}
