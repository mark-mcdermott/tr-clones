import { expect, test } from '@playwright/test';
import { closeSettings, debug, openEditor, openSettings, project, run, selectTrack, stepKey, stop } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('audio stays off until a user gesture, then the engine renders sound', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await expect(editor).toHaveAttribute('data-audio', 'idle');
  expect((await debug(page)).stats).toBeNull();
  expect((await debug(page)).soundsSent).toBe(0);

  await run(page);
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await openSettings(page);
  await expect(page.getByTestId('audio-status')).toHaveText('Audio is running');
  await closeSettings(page);

  // The worklet reports what it rendered: frames advance and the output is not silence.
  await expect.poll(async () => (await debug(page)).stats?.frames ?? 0).toBeGreaterThan(20_000);
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
  const snapshot = await debug(page);
  expect(snapshot.sampleRate).toBeGreaterThanOrEqual(44100);
  // Each of the machine's seven sounds was synthesised here and taken by the worklet.
  expect(snapshot.soundsSent).toBe(7);
  await expect.poll(async () => (await debug(page)).soundsTaken).toBe(7);
  expect(snapshot.stats!.stolen).toBe(0);
  // It never clips.
  expect(snapshot.stats!.peakEver).toBeLessThanOrEqual(1);

  await stop(page);
});

test('turning the selector to an instrument plays it once without starting the beat', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await selectTrack(page, 'cymbal');
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await expect(editor).toHaveAttribute('data-playing', 'false');
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
});

test('the accent is a track of its own, and makes no sound when selected', async ({ page }) => {
  await selectTrack(page, 'accent');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-audio', 'idle');
});

test('Space runs and stops', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await page.locator('body').press('Space');
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await page.locator('body').press('Space');
  await expect(editor).toHaveAttribute('data-playing', 'false');
});

test('edits made while playing keep the beat running', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await run(page);
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await page.getByTestId('panel-tempo').focus();
  for (let press = 0; press < 4; press += 1) await page.keyboard.press('ArrowUp');
  await page.getByTestId('panel-level-hi_hat').focus();
  await page.keyboard.press('PageDown');
  await selectTrack(page, 'cymbal');
  await stepKey(page, 0).click();
  await selectTrack(page, 'accent');
  await stepKey(page, 2).click();
  await page.getByTestId('panel-tap').click();
  const before = (await debug(page)).stats?.frames ?? 0;
  await expect.poll(async () => (await debug(page)).stats?.frames ?? 0).toBeGreaterThan(before + 10_000);
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await expect(page.getByTestId('notice')).toHaveCount(0);
  expect((await debug(page)).stats!.stolen).toBe(0);
  // No sound knob moved, so no sound was made again.
  expect((await debug(page)).soundsSent).toBe(7);
});

test('the offline render of the same pattern is one measure and not silent', async ({ page }) => {
  const render = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  const { tempo } = await project(page);
  // Sixteen steps of four to the beat: four beats.
  expect(Math.abs(render.frames - (44100 * 240) / tempo)).toBeLessThanOrEqual(1);
  expect(render.peak).toBeGreaterThan(0.1);
  expect(render.peak).toBeLessThanOrEqual(1);
  expect(render.rms).toBeGreaterThan(0.01);
  expect(render.events.length).toBeGreaterThan(10);
  expect(render.events.every((event) => event.pattern === 0 && event.track >= 1 && event.track <= 7)).toBe(true);
});
