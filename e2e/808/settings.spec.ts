import { expect, test } from '@playwright/test';
import { closeSettings, hitCount, openEditor, openSettings, project, stepButton } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('settings list what the panel does not model yet', async ({ page }) => {
  await openSettings(page);
  const pending = page.getByTestId('panel-pending');
  await pending.locator('summary').click();
  await expect(pending.locator('li').first()).toBeVisible();
});

test('a rhythm can be cleared, undone and reset to the starter rhythms', async ({ page }) => {
  const starter = await project(page);
  const hits = hitCount(starter);
  await openSettings(page);
  await expect(page.getByTestId('hit-count')).toHaveText(`${hits} hits in 16 steps`);
  await expect(page.getByTestId('undo')).toBeDisabled();

  await page.getByTestId('clear').click();
  await expect(page.getByTestId('hit-count')).toHaveText('0 hits in 16 steps');
  await expect(page.getByTestId('clear')).toBeDisabled();
  expect(hitCount(await project(page))).toBe(0);

  await page.getByTestId('undo').click();
  expect((await project(page)).rhythms).toEqual(starter.rhythms);
  await page.getByTestId('redo').click();
  expect(hitCount(await project(page))).toBe(0);

  // Ctrl+Z works from the machine too.
  await closeSettings(page);
  await stepButton(page, 5).click();
  expect(hitCount(await project(page))).toBe(1);
  await page.keyboard.press('Control+z');
  expect(hitCount(await project(page))).toBe(0);

  await openSettings(page);
  await page.getByTestId('starter').click();
  expect((await project(page)).rhythms).toEqual(starter.rhythms);
});

test('everything can be cleared at once, stays cleared after a reload, and comes back with undo', async ({ page }) => {
  const starter = await project(page);
  const blank = (snapshot: Awaited<ReturnType<typeof project>>) =>
    snapshot.rhythms.every((_, index) => hitCount(snapshot, index) === 0) &&
    snapshot.rhythmTracks.every((track) => track.length === 0);
  expect(blank(starter)).toBe(false);

  await openSettings(page);
  await page.getByTestId('clear-everything').click();
  await expect(page.getByTestId('clear-everything')).toBeDisabled();
  await expect(page.getByTestId('hit-count')).toHaveText('0 hits in 16 steps');
  const cleared = await project(page);
  expect(blank(cleared)).toBe(true);
  // The knobs and the tempo are not part of what it clears.
  expect(cleared.sound).toEqual(starter.sound);
  expect(cleared.tempo).toEqual(starter.tempo);

  await page.getByTestId('undo').click();
  expect((await project(page)).rhythms).toEqual(starter.rhythms);
  expect((await project(page)).rhythmTracks).toEqual(starter.rhythmTracks);
  await page.getByTestId('redo').click();
  expect(blank(await project(page))).toBe(true);

  await expect(page.getByTestId('draft-status')).toContainText('Draft saved in this browser');
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  expect(blank(await project(page))).toBe(true);
});
