import { expect, test } from '@playwright/test';
import { closeSettings, hitCount, isBlank, openEditor, openSettings, project, run, stepKey, stop } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('settings list where the machine departs from the hardware, and how its keyboard works', async ({ page }) => {
  await openSettings(page);
  const pending = page.getByTestId('panel-pending');
  await pending.locator('summary').click();
  await expect(pending.locator('li').first()).toBeVisible();
  expect(await pending.locator('li').count()).toBeGreaterThan(5);
  await expect(page.getByTestId('settings-modal')).toContainText('chains patterns up to that key');
});

test('a pattern can be cleared, undone and reset to the starter beat', async ({ page }) => {
  const starter = await project(page);
  const hits = hitCount(starter);
  await openSettings(page);
  await expect(page.getByTestId('hit-count')).toHaveText(`${hits} hits in pattern 1 of group I`);
  await expect(page.getByTestId('machine-status')).toHaveText('Pattern 1, group I: 16 steps at scale 1, Bass Drum on 4');
  await expect(page.getByTestId('undo')).toBeDisabled();

  await page.getByTestId('clear').click();
  await expect(page.getByTestId('hit-count')).toHaveText('0 hits in pattern 1 of group I');
  await expect(page.getByTestId('clear')).toBeDisabled();
  expect(hitCount(await project(page))).toBe(0);

  await page.getByTestId('undo').click();
  expect((await project(page)).patterns).toEqual(starter.patterns);
  await page.getByTestId('redo').click();
  expect(hitCount(await project(page))).toBe(0);

  // Ctrl+Z works from the machine too.
  await closeSettings(page);
  await run(page);
  await stepKey(page, 5).click();
  await stop(page);
  expect(hitCount(await project(page))).toBe(1);
  await page.keyboard.press('Control+z');
  expect(hitCount(await project(page))).toBe(0);

  await openSettings(page);
  await page.getByTestId('starter').click();
  expect((await project(page)).patterns).toEqual(starter.patterns);
  expect((await project(page)).tracks).toEqual(starter.tracks);
});

test('everything can be cleared at once, stays cleared after a reload, and comes back with undo', async ({ page }) => {
  const starter = await project(page);
  expect(isBlank(starter)).toBe(false);

  await openSettings(page);
  await page.getByTestId('clear-everything').click();
  await expect(page.getByTestId('clear-everything')).toBeDisabled();
  await expect(page.getByTestId('hit-count')).toHaveText('0 hits in pattern 1 of group I');
  const cleared = await project(page);
  expect(isBlank(cleared)).toBe(true);
  // The knobs and the tempo are not part of what it clears.
  expect(cleared.mix).toEqual(starter.mix);
  expect(cleared.tempo).toEqual(starter.tempo);

  await page.getByTestId('undo').click();
  expect((await project(page)).patterns).toEqual(starter.patterns);
  expect((await project(page)).tracks).toEqual(starter.tracks);
  await page.getByTestId('redo').click();
  expect(isBlank(await project(page))).toBe(true);

  await expect(page.getByTestId('draft-status')).toContainText('Draft saved in this browser');
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  expect(isBlank(await project(page))).toBe(true);
});
