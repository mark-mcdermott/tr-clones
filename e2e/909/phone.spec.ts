import { expect, test } from '@playwright/test';
import { EMPTY_PATTERN, debug, openEditor, patternOf, project, stepKey, stepsOn } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('the docked start button starts audio, beside the tempo', async ({ page }) => {
  const dock = page.getByTestId('dock-play');
  await expect(dock).toBeVisible();
  expect((await dock.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByTestId('dock-bpm')).toHaveText(String((await project(page)).tempo));
  await dock.tap();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-audio', 'running');
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.01);
  await dock.tap();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
});

test('settings is reachable by touch', async ({ page }) => {
  const cog = (await page.getByTestId('settings').boundingBox())!;
  expect(Math.min(cog.width, cog.height)).toBeGreaterThanOrEqual(44);
  await page.getByTestId('settings').tap();
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  // The modal grows the last little way as it opens, so wait for it to settle.
  for (const id of ['undo', 'clear', 'import', 'export-menu']) {
    await expect.poll(async () => (await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(40);
  }
});

test('the machine stays usable on a phone', async ({ page }) => {
  const panel = page.getByTestId('panel');
  await expect(panel).toBeVisible();

  // The faceplate keeps a workable size and scrolls sideways inside its
  // frame; the page itself does not scroll sideways.
  const first = stepKey(page, 0);
  expect((await first.boundingBox())!.width).toBeGreaterThanOrEqual(30);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // The strip is the touch-sized way to what the small keys do: the mode first.
  await expect(page.getByTestId('strip-status')).toHaveText('Pattern play, group 1: pattern 1');
  const write = page.getByTestId('strip-mode-pattern_write');
  expect((await write.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await write.tap();
  expect((await project(page)).panel.mode).toBe('pattern_write');
  await stepKey(page, EMPTY_PATTERN).tap();
  await expect(page.getByTestId('strip-status')).toContainText('pattern 9');

  // Then the instrument, the accent and all eleven.
  await expect(page.locator('[data-testid^="strip-voice-"]')).toHaveCount(12);
  const snare = page.getByTestId('strip-voice-snare_drum');
  expect((await snare.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await snare.tap();
  expect((await project(page)).panel.instrument).toBe('snare_drum');

  // Then the pattern's shape, and its steps on the faceplate's own keys.
  await page.getByTestId('strip-last-step').tap();
  await expect(page.getByTestId('strip-last-step')).toHaveAttribute('aria-pressed', 'true');
  await stepKey(page, 7).tap();
  expect(patternOf(await project(page)).lastStep).toBe(8);
  await page.getByTestId('strip-scale').tap();
  expect(patternOf(await project(page)).scale).toBe(1);
  await page.getByTestId('dock-play').tap();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  await first.tap();
  await stepKey(page, 4).tap();
  expect(stepsOn(patternOf(await project(page)), 'snare_drum')).toEqual([0, 4]);
  await expect(page.getByTestId('strip-status')).toContainText('Snare Drum: 2 steps on');
  await page.getByTestId('dock-play').tap();

  // The other group, and a track, without the small keys.
  await page.getByTestId('strip-group-1').tap();
  expect((await project(page)).panel).toMatchObject({ mode: 'pattern_write', group: 1 });
  await page.getByTestId('strip-mode-track_write').tap();
  await page.getByTestId('strip-track-2').tap();
  expect((await project(page)).panel).toMatchObject({ mode: 'track_write', track: 2 });
  await stepKey(page, 3).tap();
  await page.getByTestId('strip-enter').tap();
  await page.getByTestId('strip-enter').tap();
  await page.getByTestId('strip-back').tap();
  expect((await project(page)).patternTracks[2]!.measures).toEqual([3, 3]);
  await expect(page.getByTestId('strip-status')).toHaveText('Writing track 3, measure 2: pattern 4 of group 1');
  await page.getByTestId('strip-cycle').tap();
  expect((await project(page)).panel.cycle).toBe(true);

  // A chain, with the strip's SHIFT.
  await page.getByTestId('strip-mode-pattern_play').tap();
  await stepKey(page, 1).tap();
  await page.getByTestId('strip-shift').tap();
  await stepKey(page, 3).tap();
  expect((await project(page)).panel).toMatchObject({ pattern: 1, chain: 3 });

  // Fit shows the whole faceplate at once.
  await page.getByRole('button', { name: 'Fit to screen' }).tap();
  const fitted = (await panel.boundingBox())!;
  expect(fitted.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('the strip offers only what the mode has', async ({ page }) => {
  for (const id of ['strip-tap', 'strip-last-step', 'strip-shuffle', 'strip-scale', 'strip-clear', 'strip-enter', 'strip-cycle']) {
    await expect(page.getByTestId(id), id).toHaveCount(0);
  }
  await expect(page.locator('[data-testid^="strip-voice-"]')).toHaveCount(0);
  await page.getByTestId('strip-mode-track_play').tap();
  await expect(page.getByTestId('strip-cycle')).toBeVisible();
  await expect(page.locator('[data-testid^="strip-track-"]')).toHaveCount(4);
  await expect(page.locator('[data-testid^="strip-group-"]')).toHaveCount(0);
  await page.getByTestId('strip-mode-pattern_write').tap();
  for (const id of ['strip-tap', 'strip-last-step', 'strip-shuffle', 'strip-scale', 'strip-clear']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.height, id).toBeGreaterThanOrEqual(40);
  }
  await page.getByTestId('strip-tap').tap();
  expect((await project(page)).panel.write).toBe('tap');
});
