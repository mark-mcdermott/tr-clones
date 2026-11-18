import { expect, test } from '@playwright/test';
import {
  DRAFT_KEY,
  EMPTY_PATTERN,
  closeSettings,
  hitCount,
  key,
  openEditor,
  openSettings,
  patternOf,
  project,
  selectInstrument,
  shifted,
  start,
  stepKey,
  stepLamp,
  stepsOn,
  stop,
  writePattern,
} from './helpers';

test('the draft is saved locally and restored on reload', async ({ page }) => {
  await openEditor(page);
  await openSettings(page);
  await expect(page.getByTestId('draft-status')).toHaveAttribute('data-origin', 'new');
  await closeSettings(page);

  // A track, a pattern with its own shape, knobs, the tempo and where the panel stands.
  await shifted(page, page.getByTestId('panel-track-2'));
  await stepKey(page, 4).click();
  await page.getByTestId('panel-enter').click();
  await page.getByTestId('panel-group-1').click();
  await key(page, 'cycle').click();
  await writePattern(page, EMPTY_PATTERN, 1);
  await selectInstrument(page, 15);
  await key(page, 'last-step').click();
  await stepKey(page, 9).click();
  await key(page, 'shuffle').click();
  await stepKey(page, 2).click();
  await key(page, 'scale').click();
  await shifted(page, key(page, 'back'));
  await shifted(page, key(page, 'tempo'));
  await start(page);
  await stepKey(page, 3).click();
  await stop(page);
  await page.getByTestId('panel-tempo').focus();
  await page.keyboard.press('PageUp');
  await page.getByTestId('panel-knob-volume').focus();
  await page.keyboard.press('End');
  await page.getByTestId('panel-knob-crash_tune').focus();
  await page.keyboard.press('Home');
  await page.getByTestId('panel-knob-accent').focus();
  await page.keyboard.press('ArrowDown');
  await openSettings(page);
  await page.getByTestId('beat-name').fill('Reload test');
  await page.getByTestId('beat-name').press('Enter');
  const before = await project(page);
  await expect(page.getByTestId('draft-status')).toContainText('Draft saved in this browser');
  expect(await page.evaluate((draft) => localStorage.getItem(draft) !== null, DRAFT_KEY)).toBe(true);

  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  const after = await project(page);
  expect(after).toEqual(before);
  expect(after).toMatchObject({ machine: '909', schemaVersion: 1, name: 'Reload test', tempo: 135 });
  expect(after.knobs).toMatchObject({ volume: 1, crash_tune: 0, accent: 0.73 });
  expect(after.patternTracks[2]).toEqual({ group: 1, measures: [4] });
  expect(after.panel).toEqual({
    mode: 'pattern_write',
    track: 2,
    group: 1,
    pattern: EMPTY_PATTERN,
    chain: EMPTY_PATTERN,
    write: 'step',
    instrument: 'ride',
    cycle: true,
  });
  const written = patternOf(after);
  expect(written).toMatchObject({ scale: 1, lastStep: 10, shuffle: 2 });
  expect(stepsOn(written, 'ride')).toEqual([3]);
  // The faceplate shows it as it was left.
  await expect(page.getByTestId('panel-group-1-lamp')).toHaveAttribute('data-on', 'true');
  await expect(stepLamp(page, EMPTY_PATTERN)).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('lamp-scale-1')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('panel-display')).toHaveAttribute('data-value', '135');
  await expect(page.getByTestId('panel-knob-volume')).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByTestId('panel-knob-crash_tune')).toHaveAttribute('aria-valuenow', '0');
  await openSettings(page);
  await expect(page.getByTestId('draft-status')).toHaveAttribute('data-origin', 'restored');
  await expect(page.getByTestId('beat-name')).toHaveValue('Reload test');
});

test('an unreadable draft is set aside and the starter patterns load', async ({ page }) => {
  await page.addInitScript((draft) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(draft, '{"format":"boombapbot.project","schemaVersion":1,"machine":"909","tempo":"fast"');
    }
  }, DRAFT_KEY);
  await openEditor(page);
  await expect(page.getByTestId('notice')).toContainText('could not be read');
  await expect(page.getByTestId('notice')).toContainText('the starter patterns were loaded');
  expect(hitCount(patternOf(await project(page)))).toBeGreaterThan(10);
  const kept = await page.evaluate(() => localStorage.getItem('boombapbot.draft.unreadable'));
  expect(kept).toContain('"tempo":"fast"');

  // The replacement draft is valid, so the next load restores it quietly.
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('notice')).toHaveCount(0);
  await openSettings(page);
  await expect(page.getByTestId('draft-status')).toHaveAttribute('data-origin', 'restored');
});

test('a draft of another machine, under its own key, is left alone and not read', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('boombapbot.draft.v2', '{"format":"boombapbot.project","schemaVersion":2,"name":"Another machine"}');
    }
  });
  await openEditor(page);
  await expect(page.getByTestId('notice')).toHaveCount(0);
  expect((await project(page)).name).toBe('Starter beat');
  expect(await page.evaluate(() => localStorage.getItem('boombapbot.draft.v2'))).toContain('Another machine');
});
