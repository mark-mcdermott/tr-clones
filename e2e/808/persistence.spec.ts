import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  DRAFT_KEY,
  LEGACY_DRAFT_KEY,
  LEGACY_FIXTURE,
  bpmOf,
  closeSettings,
  hitCount,
  openEditor,
  openSettings,
  project,
  selectTrack,
  stepButton,
  stepsOn,
} from './helpers';

test('the draft is saved locally and restored on reload', async ({ page }) => {
  await openEditor(page);
  await openSettings(page);
  await expect(page.getByTestId('draft-status')).toHaveAttribute('data-origin', 'new');
  await closeSettings(page);

  await selectTrack(page, 'high_tom');
  await stepButton(page, 2).click();
  await selectTrack(page, 'kick');
  await stepButton(page, 0).click(); // off
  await page.getByTestId('panel-tempo').focus();
  await page.keyboard.press('ArrowDown');
  await page.getByTestId('panel-fine').focus();
  await page.keyboard.press('End');
  await page.getByTestId('panel-switch-clap').click();
  await page.getByTestId('panel-knob-cowbell-level').focus();
  await page.keyboard.press('Home');
  await page.getByTestId('panel-master').focus();
  await page.keyboard.press('End');
  await page.getByTestId('panel-knob-cymbal-tone').focus();
  await page.keyboard.press('End');
  await openSettings(page);
  await page.getByTestId('beat-name').fill('Reload test');
  await page.getByTestId('beat-name').press('Enter');
  const before = await project(page);
  await expect(page.getByTestId('draft-status')).toContainText('Draft saved in this browser');

  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  const after = await project(page);
  expect(after).toEqual(before);
  expect(after.tempo).toEqual({ coarse: before.tempo.coarse, fine: 1 });
  expect(bpmOf(after)).toBeCloseTo(40 + ((after.tempo.coarse + 1) * 260) / 39, 6);
  expect(after.sound.alternates.clap).toBe(true);
  expect(after.sound.levels.cowbell).toBe(0);
  expect(after.sound.master).toBe(1);
  expect(after.name).toBe('Reload test');
  expect(after.sound.knobs.cymbal!.tone).toBe(1);
  expect(stepsOn(after, 'high_tom')).toContain(2);
  expect(stepsOn(after, 'kick')).not.toContain(0);
  // The selector is where it was left, and the faceplate shows it.
  await expect(page.getByTestId('panel-voice-kick')).toHaveAttribute('aria-checked', 'true');
  await expect(stepButton(page, 0)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('panel-knob-cymbal-tone')).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByTestId('panel-switch-clap')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('panel-master')).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByTestId('panel-fine')).toHaveAttribute('aria-valuenow', '100');
  await openSettings(page);
  await expect(page.getByTestId('draft-status')).toHaveAttribute('data-origin', 'restored');
  await expect(page.getByTestId('beat-name')).toHaveValue('Reload test');
});

test('a draft from the earlier version becomes Basic Rhythm 1, and says what it lost', async ({ page }) => {
  const legacy = readFileSync(LEGACY_FIXTURE, 'utf8');
  await page.addInitScript(
    ([key, text]) => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem(key!, text!);
      }
    },
    [LEGACY_DRAFT_KEY, legacy],
  );
  await openEditor(page);
  const notice = page.getByTestId('notice');
  await expect(notice).toContainText('earlier version');
  await expect(notice).toContainText('Basic Rhythm 1');
  await expect(notice.locator('li')).not.toHaveCount(0);

  const snapshot = await project(page);
  expect(snapshot.schemaVersion).toBe(2);
  expect(snapshot.name).toBe(JSON.parse(legacy).name);
  expect(hitCount(snapshot)).toBe(22);
  expect(bpmOf(snapshot)).toBeCloseTo(JSON.parse(legacy).bpm, 1);
  expect(snapshot.rhythms.slice(1).every((_, index) => hitCount(snapshot, index + 1) === 0)).toBe(true);

  // It is saved in the current format, so the next visit is quiet. The old
  // draft is left where it was.
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) !== null, DRAFT_KEY)).toBe(true);
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('notice')).toHaveCount(0);
  expect(await project(page)).toEqual(snapshot);
  expect(await page.evaluate((key) => localStorage.getItem(key), LEGACY_DRAFT_KEY)).toBe(legacy);
});

test('an unreadable draft is set aside and the starter rhythms load', async ({ page }) => {
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(key, '{"format":"boombapbot.project","schemaVersion":2,"tempo":"fast"');
    }
  }, DRAFT_KEY);
  await openEditor(page);
  await expect(page.getByTestId('notice')).toContainText('could not be read');
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
