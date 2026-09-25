import { test, expect, openApp, setControl } from './fixtures.mjs';

// Practice modes (two-measure, custom rhythm, song, counting trainer) are
// one-at-a-time: picking one turns the others off, and a badge on the stage
// names whichever is active.

const activeModes = (page) => page.evaluate(async () => {
  const { state } = await import('/js/modules/state.js');
  return {
    twoMeasure: state.twoMeasurePatternEnabled,
    customRhythm: state.customRhythmEnabled,
    song: state.songModeEnabled,
    counting: state.countingTrainerEnabled,
  };
});

const NONE = { twoMeasure: false, customRhythm: false, song: false, counting: false };

async function openPractice(page) {
  await page.locator('.rail-btn[data-panel="rhythm"]').click();
}

async function closeModal(page, id) {
  await page.locator(`#${id} .settings-btn-close`).click();
}

test('choosing a mode turns it on, opens its editor and shows the badge', async ({ page, errors }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  const badge = page.locator('#mode-badge');
  await expect(badge).toBeHidden();
  await expect(page.locator('#steady-beat-btn')).toHaveAttribute('aria-pressed', 'true');

  await openPractice(page);
  await page.locator('#song-sections-btn').click();
  await expect(page.locator('#song-sections-modal')).toBeVisible();
  expect(await activeModes(page)).toEqual({ ...NONE, song: true });
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('Song');
  await expect(page.locator('#song-sections-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#steady-beat-btn')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('choosing another mode turns the first one off', async ({ page, errors }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await openPractice(page);
  await page.locator('#song-sections-btn').click();
  await closeModal(page, 'song-sections-modal');

  await page.locator('#counting-trainer-btn').click();
  expect(await activeModes(page)).toEqual({ ...NONE, counting: true });
  await expect(page.locator('#mode-badge')).toContainText('Counting trainer');
  await closeModal(page, 'counting-trainer-modal');

  await page.locator('#two-measure-btn').click();
  expect(await activeModes(page)).toEqual({ ...NONE, twoMeasure: true });
  await expect(page.locator('#mode-badge')).toContainText('Two-measure pattern');
  expect(errors).toEqual([]);
});

test('the badge ✕, Steady beat and "Turn off" all return to a steady beat', async ({ page, errors }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  const badge = page.locator('#mode-badge');

  // Badge ✕
  await openPractice(page);
  await page.locator('#two-measure-btn').click();
  await closeModal(page, 'two-measure-modal');
  await page.locator('.panel-close').click();
  await badge.locator('.mode-badge-off').click();
  expect(await activeModes(page)).toEqual(NONE);
  await expect(badge).toBeHidden();

  // Steady beat card
  await openPractice(page);
  await page.locator('#counting-trainer-btn').click();
  await closeModal(page, 'counting-trainer-modal');
  await page.locator('#steady-beat-btn').click();
  expect(await activeModes(page)).toEqual(NONE);

  // "Turn off" in the editor
  await page.locator('#song-sections-btn').click();
  await page.locator('#song-sections-modal .mode-off-btn').click();
  await expect(page.locator('#song-sections-modal')).toBeHidden();
  expect(await activeModes(page)).toEqual(NONE);
  await expect(badge).toBeHidden();
  expect(errors).toEqual([]);
});

test('clicking the badge reopens the active mode\'s editor', async ({ page, errors }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await openPractice(page);
  await page.locator('#counting-trainer-btn').click();
  await closeModal(page, 'counting-trainer-modal');
  await page.locator('.panel-close').click();

  await page.locator('#mode-badge .mode-badge-edit').click();
  await expect(page.locator('#counting-trainer-modal')).toBeVisible();
  expect(await activeModes(page)).toEqual({ ...NONE, counting: true });
  expect(errors).toEqual([]);
});

test('custom rhythm switched on from the score view also claims the mode', async ({ page, errors }) => {
  await openApp(page);
  await setControl(page, 'song-mode-enabled', true);
  expect(await activeModes(page)).toEqual({ ...NONE, song: true });

  // Checkbox path used by the custom rhythm editor
  await setControl(page, 'custom-rhythm-enabled', true);
  expect(await activeModes(page)).toEqual({ ...NONE, customRhythm: true });
  await expect(page.locator('#mode-badge')).toContainText('Custom rhythm');
  expect(errors).toEqual([]);
});

test('Reset turns off the active mode', async ({ page, errors }) => {
  await openApp(page);
  await setControl(page, 'song-mode-enabled', true);
  page.once('dialog', (d) => d.accept());
  await page.locator('.app-header #settings-btn').click();
  await page.locator('#reset-settings-btn').click();
  expect(await activeModes(page)).toEqual(NONE);
  await expect(page.locator('#mode-badge')).toBeHidden();
  expect(errors).toEqual([]);
});
