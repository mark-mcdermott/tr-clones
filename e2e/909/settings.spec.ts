import { expect, test } from '@playwright/test';
import { EMPTY_PATTERN, closeSettings, hitCount, openEditor, openSettings, patternOf, project, start, stepKey, writePattern } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('settings list where the panel departs from the machine', async ({ page }) => {
  await openSettings(page);
  const pending = page.getByTestId('panel-pending');
  await pending.locator('summary').click();
  await expect(pending.locator('li').first()).toBeVisible();
  expect(await pending.locator('li').count()).toBeGreaterThan(8);
  await expect(pending).toContainText('two pattern groups of sixteen');
  await expect(pending).toContainText('there is no CONTINUE');
});

test('settings explain the keys', async ({ page }) => {
  await openSettings(page);
  await expect(page.getByTestId('settings-modal')).toContainText('lets SHIFT and the function keys up');
});

test('a pattern can be cleared, undone and reset to the starter patterns', async ({ page }) => {
  const starter = await project(page);
  const hits = hitCount(patternOf(starter));
  expect(hits).toBeGreaterThan(20);
  await openSettings(page);
  await expect(page.getByTestId('hit-count')).toHaveText(`${hits} hits in 16 steps`);
  await expect(page.getByTestId('undo')).toBeDisabled();

  await page.getByTestId('clear').click();
  await expect(page.getByTestId('hit-count')).toHaveText('0 hits in 16 steps');
  await expect(page.getByTestId('clear')).toBeDisabled();
  expect(hitCount(patternOf(await project(page)))).toBe(0);

  await page.getByTestId('undo').click();
  expect((await project(page)).patterns).toEqual(starter.patterns);
  await page.getByTestId('redo').click();
  expect(hitCount(patternOf(await project(page)))).toBe(0);

  // Ctrl+Z works from the machine too.
  await closeSettings(page);
  await writePattern(page, EMPTY_PATTERN);
  await start(page);
  await stepKey(page, 5).click();
  expect(hitCount(patternOf(await project(page)))).toBe(1);
  await page.keyboard.press('Control+z');
  expect(hitCount(patternOf(await project(page)))).toBe(0);

  await openSettings(page);
  await page.getByTestId('starter').click();
  expect((await project(page)).patterns).toEqual(starter.patterns);
  expect((await project(page)).patternTracks).toEqual(starter.patternTracks);
});

test('the status lines follow the pattern and the track the panel is on', async ({ page }) => {
  await stepKey(page, 7).click();
  await openSettings(page);
  // Pattern 8 of the starter beat is seven steps long.
  await expect(page.getByTestId('hit-count')).toContainText('in 7 steps');
  await expect(page.getByTestId('track-length')).toHaveCount(0);
  await closeSettings(page);
  await page.getByTestId('panel-track-0').click();
  await openSettings(page);
  await expect(page.getByTestId('track-length')).toHaveText('Track 1: 16 measures');
  await closeSettings(page);
  await page.getByTestId('panel-track-2').click();
  await openSettings(page);
  await expect(page.getByTestId('track-length')).toHaveText('Track 3: empty');
});

test('everything can be cleared at once, stays cleared after a reload, and comes back with undo', async ({ page }) => {
  const starter = await project(page);
  const blank = (snapshot: Awaited<ReturnType<typeof project>>) =>
    snapshot.patterns.flat().every((pattern) => hitCount(pattern) === 0) &&
    snapshot.patternTracks.every((track) => track.measures.length === 0);
  expect(blank(starter)).toBe(false);

  await openSettings(page);
  await page.getByTestId('clear-everything').click();
  await expect(page.getByTestId('clear-everything')).toBeDisabled();
  await expect(page.getByTestId('hit-count')).toHaveText('0 hits in 16 steps');
  const cleared = await project(page);
  expect(blank(cleared)).toBe(true);
  // The knobs and the tempo are not part of what it clears.
  expect(cleared.knobs).toEqual(starter.knobs);
  expect(cleared.tempo).toBe(starter.tempo);

  await page.getByTestId('undo').click();
  expect((await project(page)).patterns).toEqual(starter.patterns);
  expect((await project(page)).patternTracks).toEqual(starter.patternTracks);
  await page.getByTestId('redo').click();
  expect(blank(await project(page))).toBe(true);

  await expect(page.getByTestId('draft-status')).toContainText('Draft saved in this browser');
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  expect(blank(await project(page))).toBe(true);
});
