import { test, expect, openApp, setControl, controlValues } from './fixtures.mjs';

const bpm = (page) => page.locator('#bpm-input').inputValue().then(Number);

test('boots without errors', async ({ page, errors }) => {
  await openApp(page);
  await expect(page.locator('canvas')).toBeVisible();
  expect(await bpm(page)).toBe(96);
  expect(errors).toEqual([]);
});

test('Space starts and stops the metronome', async ({ page, errors }) => {
  await openApp(page);
  await page.locator('body').press('Space');
  await page.waitForFunction(() => Tone.Transport.state === 'started');
  // Let a few beats go by and check the transport is actually advancing.
  const t0 = await page.evaluate(() => Tone.Transport.seconds);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => Tone.Transport.seconds)).toBeGreaterThan(t0 + 1);

  await page.locator('body').press('Space');
  await page.waitForFunction(() => Tone.Transport.state !== 'started');
  expect(errors).toEqual([]);
});

test('tempo controls: −/+ buttons, arrow keys and tap tempo', async ({ page, errors }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Increase tempo by 1 BPM' }).click();
  expect(await bpm(page)).toBe(97);
  await page.locator('body').press('ArrowDown');
  expect(await bpm(page)).toBe(96);

  // Tap timing is read from performance.now(); drive it by hand so the
  // result is exact rather than subject to test-runner jitter.
  await page.evaluate(() => {
    window.__fakeNow = 10_000;
    performance.now = () => window.__fakeNow;
  });
  const advance = (ms) => page.evaluate((ms) => { window.__fakeNow += ms; }, ms);

  const tap = page.locator('#tap-tempo-btn');
  for (let i = 0; i < 5; i++) {
    await tap.dispatchEvent('pointerdown', { button: 0 });
    await advance(500);
  }
  expect(await bpm(page)).toBe(120);

  // A pause starts a new measurement; then tap with the T key.
  await advance(2500);
  for (let i = 0; i < 5; i++) {
    await page.locator('body').press('t');
    await advance(400);
  }
  expect(await bpm(page)).toBe(150);
  expect(errors).toEqual([]);
});

const CHANGED = {
  'time-signature': '3',
  'subdivision': '2',
  'swing-enabled': true,
  'waltz-beat-enabled': true,
  'animal-selector': 'pendulum',
  'metronome-sound-select': 'woodblock',
  'flash-enabled': true,
  'bluetooth-delay-slider': '120',
};

async function changeSettings(page) {
  await page.locator('#bpm-input').fill('132');
  await page.locator('#bpm-input').press('Enter');
  for (const [id, value] of Object.entries(CHANGED)) {
    await setControl(page, id, value, id === 'bluetooth-delay-slider' ? 'input' : 'change');
  }
  // Saves are debounced.
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('vm.settings') || '{}').bpm === 132);
}

test('settings survive a reload', async ({ page, errors }) => {
  await openApp(page);
  await changeSettings(page);

  await page.reload();
  await openApp(page);
  expect(await bpm(page)).toBe(132);
  expect(await controlValues(page, Object.keys(CHANGED))).toEqual(CHANGED);
  // The restore ran each control's handler, so app state matches too.
  expect(await page.evaluate(async () => {
    const { state } = await import('/js/modules/state.js');
    return [state.beatsPerMeasure, state.subdivision, state.swingEnabled, state.waltzBeatEnabled,
            state.animalType, state.metronomeSound, state.flashEnabled, state.bluetoothDelay,
            Math.round(Tone.Transport.bpm.value)];
  })).toEqual([3, '2', true, true, 'pendulum', 'woodblock', true, 120, 132]);
  expect(errors).toEqual([]);
});

test('Reset is remembered too', async ({ page, errors }) => {
  await openApp(page);
  await changeSettings(page);
  // Reset lives in the Settings modal and asks for confirmation
  page.once('dialog', (d) => d.accept());
  await page.locator('.app-header #settings-btn').click();
  await page.locator('#reset-settings-btn').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('vm.settings') || '{}').bpm === 96);

  await page.reload();
  await openApp(page);
  expect(await bpm(page)).toBe(96);
  expect(await controlValues(page, ['time-signature', 'subdivision', 'waltz-beat-enabled']))
    .toEqual({ 'time-signature': '4', 'subdivision': 'none', 'waltz-beat-enabled': false });
  expect(errors).toEqual([]);
});

test('a full localStorage is reported instead of failing silently', async ({ page }) => {
  await openApp(page);
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });

  // The song button sits in a collapsible menu; open the modal directly.
  await page.evaluate(() => document.getElementById('song-sections-btn').click());
  await page.locator('#song-add-section-btn').click();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  });
  await page.locator('#song-save-btn').click();
  await expect.poll(() => dialogs).toEqual([expect.stringContaining('browser storage is full')]);
  await expect(page.locator('#song-saved-list')).toContainText('No saved songs yet.');
});

test('saved selfies move from localStorage to IndexedDB and list safely', async ({ page, errors }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('vm_saved_selfies', JSON.stringify([{
      id: 1, name: '<img src=x id=injected>', savedAt: 'today', sound: null,
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    }]));
  });
  await page.context().grantPermissions(['camera']);
  await openApp(page);

  // Opening the camera renders the saved list (the fake camera may fail;
  // the list renders regardless).
  page.on('dialog', (d) => d.dismiss());
  await page.evaluate(async () => (await import('/js/modules/camera.js')).openCamera());
  const item = page.locator('#saved-selfies-list .saved-selfie-name');
  await expect(item).toHaveText('<img src=x id=injected>');
  await expect(page.locator('#injected')).toHaveCount(0);

  expect(await page.evaluate(() => localStorage.getItem('vm_saved_selfies'))).toBeNull();
  expect(await page.evaluate(async () =>
    (await (await import('/js/modules/storage.js')).getSavedSelfies()).map((s) => s.id))).toEqual([1]);
  expect(errors.filter((e) => !/camera|getUserMedia|NotFound|NotAllowed|Requested device/i.test(e))).toEqual([]);
});
