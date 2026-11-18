import { expect, test } from '@playwright/test';
import { bpmOf, debug, openEditor, project, stepsOn } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('the docked start button starts audio, beside the tempo', async ({ page }) => {
  const dock = page.getByTestId('dock-play');
  await expect(dock).toBeVisible();
  expect((await dock.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByTestId('dock-bpm')).toHaveText(String(Math.round(bpmOf(await project(page)))));
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
  const zoomed = (await first.boundingBox())!;
  expect(zoomed.width).toBeGreaterThanOrEqual(30);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The instrument strip is the touch-sized way to pick a track: the accent
  // and all eleven instruments.
  await expect(page.locator('[data-testid^="strip-voice-"]')).toHaveCount(12);
  const strip = page.getByTestId('strip-voice-snare');
  expect((await strip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await strip.tap();
  await expect(page.getByTestId('panel-voice')).toContainText('Snare Drum');
  await expect(page.getByTestId('panel-voice')).toContainText('2 steps on');
  await first.tap();
  expect(stepsOn(await project(page), 'snare')).toEqual([0, 4, 12]);
  await expect(page.getByTestId('panel-voice')).toContainText('3 steps on');

  // Fit shows the whole faceplate at once.
  await page.getByRole('button', { name: 'Fit to screen' }).tap();
  const fitted = (await panel.boundingBox())!;
  expect(fitted.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
