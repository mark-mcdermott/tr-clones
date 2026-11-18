import { expect, test } from '@playwright/test';
import { DRAFT_KEY, closeSettings, hitCount, openEditor, openSettings, project, run, selectTrack, setMode, stepKey, stepsOn, stop } from './helpers';

test('the draft is saved locally and restored on reload', async ({ page }) => {
  await openEditor(page);
  await openSettings(page);
  await expect(page.getByTestId('draft-status')).toHaveAttribute('data-origin', 'new');
  await closeSettings(page);

  // A step in pattern 16, its last step and scale, every kind of knob and switch, and a bar of a track.
  await stepKey(page, 15).click();
  await selectTrack(page, 'high_tom');
  await run(page);
  await stepKey(page, 2).click();
  await stop(page);
  await page.getByTestId('panel-scale').focus();
  await page.keyboard.press('Home');
  await page.getByTestId('panel-function').click();
  await stepKey(page, 9).click();
  await page.getByTestId('panel-tempo').focus();
  await page.keyboard.press('PageDown');
  await page.getByTestId('panel-level-cymbal').focus();
  await page.keyboard.press('Home');
  await page.getByTestId('panel-volume').focus();
  await page.keyboard.press('End');
  await setMode(page, 'track_write');
  await selectTrack(page, 'cymbal');
  await stepKey(page, 15).click();
  await page.getByTestId('panel-tap').click();
  await setMode(page, 'pattern_play');
  await stepKey(page, 4).click();
  await stepKey(page, 5).click({ modifiers: ['Shift'] });
  await page.getByTestId('panel-group').click();
  await openSettings(page);
  await page.getByTestId('beat-name').fill('Reload test');
  await page.getByTestId('beat-name').press('Enter');
  const before = await project(page);
  await expect(page.getByTestId('draft-status')).toContainText('Draft saved in this browser');

  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  const after = await project(page);
  expect(after).toEqual(before);
  expect(after.name).toBe('Reload test');
  expect(after.tempo).toBe(116);
  expect(after.mix.levels.cymbal).toBe(0);
  expect(after.mix.volume).toBe(1);
  expect(stepsOn(after, 'high_tom', 15)).toEqual([2]);
  expect(after.patterns[0]![15]).toMatchObject({ scale: 4, lastStep: 10 });
  expect(after.tracks[5]).toEqual([15]);
  expect(after.panel).toEqual({ mode: 'pattern_play', selector: 5, group: 1, pattern: 4, chainEnd: 5, scale: 4 });
  // The panel shows it all as it was left.
  await expect(page.getByTestId('panel-mode-pattern_play')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('panel-voice-cymbal')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('lamp-group-2')).toHaveAttribute('data-on', 'true');
  await expect(stepKey(page, 5)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('panel-level-cymbal')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByTestId('panel-volume')).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByTestId('panel-scale')).toHaveAttribute('aria-valuetext', 'Scale 4: six steps to the beat');
  await openSettings(page);
  await expect(page.getByTestId('draft-status')).toHaveAttribute('data-origin', 'restored');
  await expect(page.getByTestId('beat-name')).toHaveValue('Reload test');
});

test('what is held down, and the power switch, are not saved', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('panel-function').click();
  await page.getByTestId('panel-power').click();
  await expect(page.getByTestId('panel')).toHaveAttribute('data-power', 'off');
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('panel')).toHaveAttribute('data-power', 'on');
  await expect(page.getByTestId('panel-function')).toHaveAttribute('aria-pressed', 'false');
});

test('an unreadable draft is set aside and the starter beat loads', async ({ page }) => {
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(key, '{"format":"boombapbot.project","schemaVersion":1,"machine":"606","tempo":"fast"');
    }
  }, DRAFT_KEY);
  await openEditor(page);
  await expect(page.getByTestId('notice')).toContainText('could not be read');
  await expect(page.getByTestId('notice')).toContainText('starter beat');
  expect(hitCount(await project(page))).toBeGreaterThan(10);
  const kept = await page.evaluate(() => localStorage.getItem('boombapbot.draft.unreadable'));
  expect(kept).toContain('"tempo":"fast"');

  // The replacement draft is valid, so the next load restores it quietly.
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('notice')).toHaveCount(0);
  await openSettings(page);
  await expect(page.getByTestId('draft-status')).toHaveAttribute('data-origin', 'restored');
});

test('a draft another machine left under its own key is not this one\'s to read', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('boombapbot.draft.v2', JSON.stringify({ format: 'boombapbot.project', schemaVersion: 2, name: 'Another machine' }));
  });
  await openEditor(page);
  await expect(page.getByTestId('notice')).toHaveCount(0);
  expect((await project(page)).name).toBe('Starter beat');
  expect(await page.evaluate(() => localStorage.getItem('boombapbot.draft.v2'))).toContain('Another machine');
});
