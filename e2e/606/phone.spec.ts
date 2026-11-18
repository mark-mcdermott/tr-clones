import { expect, test } from '@playwright/test';
import { debug, openEditor, project, stepsOn } from './helpers';

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
  const first = panel.locator('[data-panel-step]').first();
  expect((await first.boundingBox())!.width).toBeGreaterThanOrEqual(30);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // The strip is the touch-sized way to the selector, the mode and the scale.
  await expect(page.locator('[data-testid^="strip-voice-"]')).toHaveCount(8);
  await expect(page.locator('[data-testid^="strip-mode-"]')).toHaveCount(4);
  await expect(page.locator('[data-testid^="strip-scale-"]')).toHaveCount(4);
  const snare = page.getByTestId('strip-voice-snare');
  expect((await snare.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await snare.tap();
  await expect(page.getByTestId('panel-status')).toHaveText('Pattern 1, group I: 16 steps at scale 1, Snare Drum on 2');
  await expect(page.getByTestId('panel-voice-snare')).toHaveAttribute('aria-checked', 'true');

  // Written as on the machine: run, then a step key.
  await page.getByTestId('dock-play').tap();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  await first.tap();
  expect(stepsOn(await project(page), 'snare')).toEqual([0, 4, 12]);
  await expect(page.getByTestId('panel-status')).toContainText('Snare Drum on 3');
  await page.getByTestId('dock-play').tap();

  // Scale, FUNCTION and the last step, all by touch.
  await page.getByTestId('strip-scale-3').tap();
  const fn = page.getByTestId('strip-function');
  expect((await fn.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  await fn.tap();
  await expect(fn).toHaveAttribute('aria-pressed', 'true');
  await panel.locator('[data-panel-step="8"]').tap();
  expect((await project(page)).patterns[0]![0]).toMatchObject({ scale: 3, lastStep: 9 });
  await expect(page.getByTestId('panel-status')).toContainText('9 steps at scale 3');

  // The mode, the track and WRITE/NEXT.
  await page.getByTestId('strip-mode-track_write').tap();
  await expect(snare).toHaveAccessibleName('Track 3');
  await expect(snare).toHaveText('3');
  const next = page.getByTestId('strip-tap');
  await expect(next).toHaveText('Write/next');
  await next.tap();
  expect((await project(page)).tracks[2]).toEqual([0]);
  await expect(page.getByTestId('strip-clear')).toHaveText('Bar reset');
  await page.getByTestId('strip-group').tap();
  expect((await project(page)).panel.group).toBe(1);
  await expect(page.getByTestId('strip-group')).toHaveText('Group II');

  // Fit shows the whole faceplate at once.
  await page.getByRole('button', { name: 'Fit to screen' }).tap();
  const fitted = (await panel.boundingBox())!;
  expect(fitted.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
