import { expect, test } from '@playwright/test';
import {
  closeSettings,
  functionKey,
  hitCount,
  openEditor,
  openSettings,
  project,
  remembersNothing,
  setMode,
  stepKey,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('settings list where the panel departs from the machine', async ({ page }) => {
  await openSettings(page);
  const pending = page.getByTestId('panel-pending');
  await pending.locator('summary').click();
  await expect(pending.locator('li').first()).toBeVisible();
  expect(await pending.locator('li').count()).toBeGreaterThan(8);
  // What the engine cannot do is said plainly.
  await expect(pending).toContainText('Flam is not in the engine');
  await expect(pending).toContainText('there are two groups here, A and B');
  await expect(pending).toContainText('a row plays one of them for the whole project');
  await expect(page.getByTestId('settings-modal')).toContainText('lets up a key that is down');
});

test('a pattern can be cleared, undone and reset to the starter beat', async ({ page }) => {
  const starter = await project(page);
  const hits = hitCount(starter);
  await openSettings(page);
  await expect(page.getByTestId('hit-count')).toHaveText(`${hits} hits in pattern A1`);
  await expect(page.getByTestId('track-length')).toHaveCount(0);
  await expect(page.getByTestId('undo')).toBeDisabled();

  await page.getByTestId('clear').click();
  await expect(page.getByTestId('hit-count')).toHaveText('0 hits in pattern A1');
  await expect(page.getByTestId('clear')).toBeDisabled();
  expect(hitCount(await project(page))).toBe(0);

  await page.getByTestId('undo').click();
  expect((await project(page)).groups).toEqual(starter.groups);
  await page.getByTestId('redo').click();
  expect(hitCount(await project(page))).toBe(0);

  // Ctrl+Z works from the machine too.
  await closeSettings(page);
  await setMode(page, 'pattern_step');
  await stepKey(page, 5).click();
  expect(hitCount(await project(page))).toBe(1);
  await page.keyboard.press('Control+z');
  expect(hitCount(await project(page))).toBe(0);

  await openSettings(page);
  await page.getByTestId('starter').click();
  expect((await project(page)).groups).toEqual(starter.groups);
  expect((await project(page)).tracks).toEqual(starter.tracks);
});

test('the status lines follow the pattern and the track the panel is on', async ({ page }) => {
  await stepKey(page, 15).click();
  await openSettings(page);
  await expect(page.getByTestId('hit-count')).toHaveText('0 hits in pattern A16');
  await expect(page.getByTestId('clear')).toBeDisabled();
  await closeSettings(page);
  await functionKey(page, 'track').click();
  await openSettings(page);
  await expect(page.getByTestId('track-length')).toHaveText('Track I: 8 measures');
  await closeSettings(page);
  await page.getByTestId('panel-shift').click();
  await page.getByTestId('panel-group-2').click();
  await openSettings(page);
  await expect(page.getByTestId('track-length')).toHaveText('Track III: empty');
});

test('everything can be cleared at once, stays cleared after a reload, and comes back with undo', async ({ page }) => {
  const starter = await project(page);
  expect(remembersNothing(starter)).toBe(false);

  await openSettings(page);
  await page.getByTestId('clear-everything').click();
  await expect(page.getByTestId('clear-everything')).toBeDisabled();
  await expect(page.getByTestId('hit-count')).toHaveText('0 hits in pattern A1');
  const cleared = await project(page);
  expect(remembersNothing(cleared)).toBe(true);
  // The faders, the tempo and the chosen sounds are not part of what it clears.
  expect(cleared.mix).toEqual(starter.mix);
  expect(cleared.tempo).toBe(starter.tempo);
  expect(cleared.sounds).toEqual(starter.sounds);

  await page.getByTestId('undo').click();
  expect((await project(page)).groups).toEqual(starter.groups);
  expect((await project(page)).tracks).toEqual(starter.tracks);
  await page.getByTestId('redo').click();
  expect(remembersNothing(await project(page))).toBe(true);

  await expect(page.getByTestId('draft-status')).toContainText('Draft saved in this browser');
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  expect(remembersNothing(await project(page))).toBe(true);
});
