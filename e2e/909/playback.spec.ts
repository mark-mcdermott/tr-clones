import { expect, test } from '@playwright/test';
import { closeSettings, debug, importChanged, key, openEditor, openSettings, patternWatcher, project, start, stepKey, stepLamp, stop, writePattern } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('audio stays off until a user gesture, then the engine renders sound', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await expect(editor).toHaveAttribute('data-audio', 'idle');
  expect((await debug(page)).stats).toBeNull();
  expect((await debug(page)).soundsSent).toBe(0);

  await page.getByTestId('panel-start').click();
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await expect(page.getByTestId('panel-start')).toHaveAttribute('aria-pressed', 'true');
  await openSettings(page);
  await expect(page.getByTestId('audio-status')).toHaveText('Audio is running');
  await closeSettings(page);

  // The worklet reports what it rendered: frames advance and the output is not silence.
  await expect.poll(async () => (await debug(page)).stats?.frames ?? 0).toBeGreaterThan(20_000);
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
  const snapshot = await debug(page);
  expect(snapshot.sampleRate).toBeGreaterThanOrEqual(44100);
  // Each of the eleven voices was synthesised here and taken by the worklet.
  expect(snapshot.soundsSent).toBe(11);
  await expect.poll(async () => (await debug(page)).soundsTaken).toBe(11);
  expect(snapshot.stats!.stolen).toBe(0);

  await stop(page);
  await expect(page.getByTestId('panel-start')).toHaveAttribute('aria-pressed', 'false');
});

test('Space starts and stops', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await page.locator('body').press('Space');
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await page.locator('body').press('Space');
  await expect(editor).toHaveAttribute('data-playing', 'false');
});

test('edits made while playing keep the beat running', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await writePattern(page, 0);
  await start(page);
  await page.getByTestId('panel-tempo').focus();
  for (let press = 0; press < 4; press += 1) await page.keyboard.press('ArrowUp');
  await page.getByTestId('panel-knob-snare_drum_snappy').focus();
  await page.keyboard.press('PageUp');
  await page.getByTestId('panel-knob-open_hat_decay').focus();
  await page.keyboard.press('End');
  await page.getByTestId('panel-knob-volume').focus();
  await page.keyboard.press('PageDown');
  await stepKey(page, 6).click();
  await key(page, 'scale').click();
  await key(page, 'scale').click();
  const before = (await debug(page)).stats?.frames ?? 0;
  await expect.poll(async () => (await debug(page)).stats?.frames ?? 0).toBeGreaterThan(before + 10_000);
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await expect(page.getByTestId('notice')).toHaveCount(0);
  expect((await debug(page)).stats!.stolen).toBe(0);
  // A knob that moved sent its sound again; nothing else did.
  await expect.poll(async () => (await debug(page)).soundsSent).toBe(13);
});

test('a pattern chosen while another plays takes over at the bar line', async ({ page }) => {
  await importChanged(page, () => undefined, { fast: true });
  const watcher = patternWatcher(page);
  await start(page);
  await watcher.until(0);
  await stepKey(page, 2).click();
  // Until the bar line the chosen pattern flashes and the playing one is marked.
  await expect(stepLamp(page, 2)).toHaveAttribute('data-on', 'true');
  await watcher.until(4);
  await expect(stepKey(page, 2)).toHaveAccessibleName('Pattern 3, selected, playing');
  await expect(stepLamp(page, 2)).not.toHaveAttribute('data-flash', 'true');
  // The other group, the same way: pattern 3 of group 2 is the engine's pattern 5.
  await page.getByTestId('panel-group-1').click();
  await watcher.until(5);
  expect(await watcher.poll()).toEqual([0, 4, 5]);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
});

test('a chain plays its patterns in order, round and round', async ({ page }) => {
  await importChanged(page, () => undefined, { fast: true });
  await key(page, 'shift').click();
  await stepKey(page, 2).click();
  expect((await project(page)).panel).toMatchObject({ pattern: 0, chain: 2 });
  const watcher = patternWatcher(page);
  await start(page);
  for (const pattern of [0, 2, 4, 0, 2]) await watcher.until(pattern);
  expect(await watcher.poll()).toEqual([0, 2, 4, 0, 2]);

  // A single pattern chosen now takes the chain's place at the bar line.
  await stepKey(page, 3).click();
  await watcher.until(6);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  expect((await project(page)).panel).toMatchObject({ pattern: 3, chain: 3 });
});

test('a chain chosen while the machine runs stops it, to start from its first pattern', async ({ page }) => {
  await start(page);
  await key(page, 'shift').click();
  await stepKey(page, 3).click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
  expect((await project(page)).panel).toMatchObject({ pattern: 0, chain: 3 });
  await expect(page.getByTestId('notice')).toHaveCount(0);
});

test('going from pattern play to pattern write keeps the pattern running', async ({ page }) => {
  await start(page);
  await key(page, 'shift').click();
  await page.getByTestId('panel-group-0').click();
  expect((await project(page)).panel.mode).toBe('pattern_write');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  // Running, the keys write at once.
  await expect(stepKey(page, 1)).toHaveAccessibleName('Bass Drum, step 2, off');
});

test('the offline render of the selected pattern is one measure and not silent', async ({ page }) => {
  const render = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  const { tempo } = await project(page);
  // Sixteen steps of four to the beat: four beats.
  expect(Math.abs(render.frames - (44100 * 240) / tempo)).toBeLessThanOrEqual(1);
  expect(render.peak).toBeGreaterThan(0.1);
  expect(render.peak).toBeLessThanOrEqual(1);
  expect(render.rms).toBeGreaterThan(0.01);
  expect(render.events.length).toBeGreaterThan(10);
  expect(render.events.every((event) => event.pattern === 0 && event.track >= 1 && event.track <= 11)).toBe(true);
  // The total accent row marks the beats.
  expect([...new Set(render.events.filter((event) => event.accent).map((event) => event.step))]).toEqual([0, 4, 8, 12]);
});
