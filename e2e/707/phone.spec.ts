import { expect, test } from '@playwright/test';
import { debug, displayInk, openEditor, project, stepsOn } from './helpers';

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

test('the display is repeated under the panel, large enough to read', async ({ page }) => {
  const strip = page.getByTestId('strip-display');
  await expect(strip).toBeVisible();
  const box = (await strip.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.width).toBeGreaterThanOrEqual(viewport.width - 40);
  // A column of the grid is wide enough to tell from its neighbours.
  expect((box.width * 27) / 500).toBeGreaterThanOrEqual(18);
  expect(await displayInk(page, 'strip-display')).toBeGreaterThan(0.03);
  // It follows the running step as the one on the faceplate does.
  await page.getByTestId('dock-play').tap();
  const drawn = new Set<string>();
  await expect
    .poll(async () => {
      drawn.add((await strip.getAttribute('data-step')) ?? '');
      return drawn.size;
    }, { intervals: [25] })
    .toBeGreaterThanOrEqual(4);
  await page.getByTestId('dock-play').tap();
});

test('the machine stays usable on a phone', async ({ page }) => {
  const panel = page.getByTestId('panel');
  await expect(panel).toBeVisible();

  // The faceplate keeps a workable size and scrolls sideways inside its
  // frame; the page itself does not scroll sideways.
  const first = panel.locator('[data-panel-step]').first();
  const zoomed = (await first.boundingBox())!;
  expect(zoomed.width).toBeGreaterThanOrEqual(30);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The strip is the touch-sized way to the mode, the instrument and the small keys.
  await expect(page.locator('[data-testid^="strip-mode-"]')).toHaveCount(5);
  await expect(page.locator('[data-testid^="strip-row-"]')).toHaveCount(12);
  for (const id of ['strip-mode-pattern_step', 'strip-row-snare_drum', 'strip-key-shift', 'strip-key-shuffle', 'strip-group-b']) {
    expect((await page.getByTestId(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(44);
  }

  await page.getByTestId('strip-mode-pattern_step').tap();
  expect((await project(page)).panel.mode).toBe('pattern_step');
  await page.getByTestId('strip-row-snare_drum').tap();
  expect((await project(page)).panel.row).toBe('snare_drum');
  await first.tap();
  expect(stepsOn(await project(page), 'snare_drum')).toEqual([0, 4, 12]);

  // A paired instrument offers its two sounds.
  await expect(page.getByTestId('strip-sound-snare_drum_1')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('strip-sound-snare_drum_2').tap();
  expect((await project(page)).sounds.snare_drum).toBe('snare_drum_2');
  await expect(page.getByTestId('strip-row-snare_drum')).toHaveText('SD2');
  await page.getByTestId('strip-row-ride').tap();
  await expect(page.locator('[data-testid^="strip-sound-"]')).toHaveCount(0);

  // The small keys, as buttons: last step, then a step key on the faceplate.
  const lastStep = page.getByTestId('strip-key-last_step');
  await lastStep.tap();
  await expect(lastStep).toHaveAttribute('aria-pressed', 'true');
  await panel.locator('[data-panel-step="7"]').tap();
  expect((await project(page)).groups.a[0]!.lastStep).toBe(8);
  await page.getByTestId('strip-key-scale').tap();
  expect((await project(page)).groups.a[0]!.scale).toBe(6);
  await expect(page.getByTestId('panel-where')).toHaveText('Pattern A1 · 8 steps of sixteenth-note triplets');

  await page.getByTestId('strip-group-b').tap();
  expect((await project(page)).panel.group).toBe('b');

  // A track is written from the strip too.
  await page.getByTestId('strip-mode-track_write').tap();
  await page.getByTestId('strip-track-2').tap();
  await page.getByTestId('strip-key-enter').tap();
  await page.getByTestId('strip-key-enter').tap();
  expect((await project(page)).tracks[2]!.measures).toHaveLength(2);
  await expect(page.getByTestId('panel-where')).toContainText('Track III · 2 measures, at the end');
  await page.getByTestId('strip-key-scale').tap();
  await expect(page.getByTestId('panel-where')).toContainText('measure 2 of 2');

  // Fit shows the whole faceplate at once.
  await page.getByRole('button', { name: 'Fit to screen' }).tap();
  const fitted = (await panel.boundingBox())!;
  expect(fitted.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
