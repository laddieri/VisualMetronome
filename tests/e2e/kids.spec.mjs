import { test, expect, openApp } from './fixtures.mjs';

const kids = (page) => page.evaluate(() => ({ ...window.kidsMetronome }));

async function openKids(page) {
  await page.goto('/kids.html');
  await page.waitForFunction(() => window.kidsMetronome);
}

test('the header link opens Kids mode, and it sticks until a grown-up leaves', async ({ page, errors }) => {
  await openApp(page);
  await page.getByRole('link', { name: 'Kids mode' }).click();
  await page.waitForURL('**/kids.html');

  // Reopening the app goes straight back to Kids mode.
  await page.goto('/index.html');
  await page.waitForURL('**/kids.html');

  // A quick tap doesn't leave; holding does.
  const exit = page.getByRole('button', { name: /Grown-ups/ });
  await exit.click();
  await page.waitForTimeout(1700);
  expect(page.url()).toContain('kids.html');

  const box = await exit.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForURL('**/index.html', { timeout: 5000 });
  await page.mouse.up();
  await page.waitForSelector('canvas');
  expect(page.url()).toContain('index.html');
  expect(errors).toEqual([]);
});

test('Kids mode claps along and has simple speed and count controls', async ({ page, errors }) => {
  await openKids(page);
  expect(await kids(page)).toMatchObject({ playing: false, bpm: 90, beats: 4 });

  await page.getByRole('button', { name: 'Faster' }).click();
  await page.getByRole('button', { name: 'Faster' }).click();
  await expect(page.locator('#kids-bpm')).toHaveText('110');
  await page.getByRole('button', { name: 'Slower' }).click();
  await expect(page.locator('#kids-bpm')).toHaveText('100');

  await page.getByRole('radio', { name: '3' }).click();
  await expect(page.locator('.kids-beat')).toHaveCount(3);

  const play = page.locator('#kids-play');
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  // 100 BPM: a clap every 0.6s.
  await page.waitForFunction(() => window.kidsMetronome.beatsPlayed >= 3);
  await expect(page.locator('.kids-beat.is-on')).toHaveCount(1);

  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.kids-beat.is-on')).toHaveCount(0);

  // Settings survive a reload.
  await page.reload();
  await page.waitForFunction(() => window.kidsMetronome);
  expect(await kids(page)).toMatchObject({ bpm: 100, beats: 3 });
  expect(errors).toEqual([]);
});

test('Space plays and stops in Kids mode', async ({ page, errors }) => {
  await openKids(page);
  await page.locator('body').press('Space');
  await page.waitForFunction(() => window.kidsMetronome.playing);
  await page.locator('body').press('Space');
  await page.waitForFunction(() => !window.kidsMetronome.playing);
  expect(errors).toEqual([]);
});

test('every friend keeps the beat, and the pick is remembered', async ({ page, errors }) => {
  await openKids(page);
  expect(await kids(page)).toMatchObject({ scene: 'hands' });
  const play = page.locator('#kids-play');
  await play.click();

  for (const [name, scene, title] of [
    ['Hopping frog', 'frog', 'Hop Along!'],
    ['Bouncy ball', 'ball', 'Bounce Along!'],
    ['Stomping dino', 'dino', 'Stomp Along!'],
    ['Clapping hands', 'hands', 'Clap Along!'],
  ]) {
    const friend = page.getByRole('radio', { name });
    await friend.click();
    await expect(friend).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('body')).toHaveAttribute('data-scene', scene);
    await expect(page.locator('.kids-title')).toHaveText(title);
    // Switching friends doesn't interrupt the beat.
    const before = await page.evaluate(() => window.kidsMetronome.beatsPlayed);
    await page.waitForFunction((n) => window.kidsMetronome.beatsPlayed >= n + 2, before);
  }
  await play.click();

  await page.getByRole('radio', { name: 'Bouncy ball' }).click();
  await page.reload();
  await page.waitForFunction(() => window.kidsMetronome);
  expect(await kids(page)).toMatchObject({ scene: 'ball' });
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'ball');
  expect(errors).toEqual([]);
});
