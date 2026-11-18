import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  DRAFT_KEY,
  FIXTURE,
  OTHER_MACHINE_FIXTURE,
  chooseInstrument,
  closeSettings,
  functionKey,
  hitCount,
  litSteps,
  openEditor,
  openSettings,
  project,
  setMode,
  stepKey,
  stepsOn,
} from './helpers';

test('the draft is saved locally and restored on reload, and the panel shows it as it was left', async ({ page }) => {
  await openEditor(page);
  await openSettings(page);
  await expect(page.getByTestId('draft-status')).toHaveAttribute('data-origin', 'new');
  await closeSettings(page);

  await page.getByTestId('panel-group-1').click();
  await stepKey(page, 6).click();
  await setMode(page, 'pattern_step');
  await chooseInstrument(page, 3);
  await stepKey(page, 2).click();
  await functionKey(page, 'last_step').click();
  await stepKey(page, 9).click();
  await functionKey(page, 'scale').click();
  await functionKey(page, 'shuffle').click();
  await stepKey(page, 4).click();
  await functionKey(page, 'tempo_measure').click();
  await page.getByTestId('panel-tempo').focus();
  await page.keyboard.press('PageUp');
  await page.getByTestId('panel-fader-crash').focus();
  await page.keyboard.press('Home');
  await page.getByTestId('panel-fader-volume').focus();
  await page.keyboard.press('End');
  await page.getByTestId('panel-fader-accent').focus();
  await page.keyboard.press('ArrowDown');
  await openSettings(page);
  await page.getByTestId('beat-name').fill('Reload test');
  await page.getByTestId('beat-name').press('Enter');
  const before = await project(page);
  await expect(page.getByTestId('draft-status')).toContainText('Draft saved in this browser');
  expect(JSON.parse((await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY))!)).toEqual(before);

  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  const after = await project(page);
  expect(after).toEqual(before);
  expect(after).toMatchObject({ name: 'Reload test', tempo: 130, shuffle: 4, machine: '707', schemaVersion: 1 });
  expect(after.mix).toMatchObject({ volume: 1, accent: 0.68 });
  expect(after.mix.levels.crash).toBe(0);
  expect(after.sounds.snare_drum).toBe('snare_drum_2');
  expect(after.groups.b[6]).toMatchObject({ lastStep: 10, scale: 6 });
  expect(stepsOn(after, 'snare_drum', 6, 'b')).toEqual([2]);
  expect(after.panel).toMatchObject({ mode: 'pattern_step', group: 'b', pattern: 6, row: 'snare_drum', readout: 'measure' });
  // The panel is where it was left.
  expect(await litSteps(page)).toEqual([2]);
  await expect(stepKey(page, 2)).toHaveAccessibleName('Snare Drum 2, step 3, on');
  await expect(page.getByTestId('lamp-group-1')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('lamp-scale-6')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('panel-tempo')).toHaveAttribute('aria-valuenow', '130');
  await expect(page.getByTestId('panel-fader-crash')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByTestId('panel-fader-volume')).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByTestId('panel-display')).toHaveAccessibleName(/Pattern write, by step\. Pattern B7\. 10 steps of sixteenth-note triplets\./);
  await openSettings(page);
  await expect(page.getByTestId('draft-status')).toHaveAttribute('data-origin', 'restored');
  await expect(page.getByTestId('beat-name')).toHaveValue('Reload test');
});

test('a key that was down, and the machine playing, are not kept across a reload', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('panel-shift').click();
  await page.getByTestId('panel-start').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
  await expect(page.getByTestId('panel-shift')).toHaveAttribute('aria-pressed', 'false');
});

test('an unreadable draft is set aside, and the starter beat is loaded', async ({ page }) => {
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, '{"format":"boombapbot.project","machine":"707","schemaVersion":1,"groups":{}}');
      sessionStorage.setItem('seeded', 'yes');
    }
  }, DRAFT_KEY);
  await openEditor(page);
  const notice = page.getByTestId('notice');
  await expect(notice).toHaveAttribute('data-kind', 'error');
  await expect(notice).toContainText('Your saved draft could not be read, so the starter beat was loaded.');
  const snapshot = await project(page);
  expect(snapshot.name).toBe('Starter beat');
  expect(hitCount(snapshot)).toBeGreaterThan(10);
  expect(await page.evaluate(() => localStorage.getItem('boombapbot.draft.unreadable'))).toContain('"groups":{}');
});

test('a beat of another machine, or a file that is no beat, is refused and changes nothing', async ({ page }) => {
  await openEditor(page);
  const before = await project(page);
  const notice = page.getByTestId('notice');
  const refuse = async (name: string, buffer: Buffer, why: string) => {
    await page.getByTestId('import-input').setInputFiles({ name, mimeType: 'application/json', buffer });
    await expect(notice).toHaveAttribute('data-kind', 'error');
    await expect(notice).toContainText('was not imported. Your current beat is unchanged.');
    await expect(notice).toContainText(why);
    expect(await project(page)).toEqual(before);
  };
  await refuse('an-808-beat.boombapbot.json', readFileSync(OTHER_MACHINE_FIXTURE), 'made on a machine this build does not have');
  await refuse('not-json.boombapbot.json', Buffer.from('{ not json'), 'not valid JSON');
  const broken = { ...JSON.parse(readFileSync(FIXTURE, 'utf8')), tempo: 999 };
  await refuse('too-fast.boombapbot.json', Buffer.from(JSON.stringify(broken)), 'tempo');
  await openSettings(page);
  await expect(page.getByTestId('undo')).toBeDisabled();
});

test('the committed fixture is imported whole, as one undo step', async ({ page }) => {
  await openEditor(page);
  const before = await project(page);
  const fixture = readFileSync(FIXTURE);
  await page.getByTestId('import-input').setInputFiles({ name: 'every-control.boombapbot.json', mimeType: 'application/json', buffer: fixture });
  await expect(page.getByTestId('notice')).toContainText('Imported “Every control”.');
  await expect(page.getByTestId('notice')).not.toContainText('earlier version');
  const imported = await project(page);
  // Everything but the time of the change is what the file holds.
  expect(imported).toEqual({ ...JSON.parse(fixture.toString('utf8')), updatedAt: imported.updatedAt });
  // The panel shows what came in: a chain, the fader positions, the chosen sounds.
  expect(await litSteps(page)).toEqual([0, 1, 2, 3]);
  await expect(page.getByTestId('panel-tempo')).toHaveAttribute('aria-valuenow', '132');
  await expect(page.getByTestId('panel-fader-crash')).toHaveAttribute('aria-valuenow', '40');
  await expect(page.getByTestId('panel-display')).toHaveAccessibleName(/Chain A1 to A4\. .*Bass Drum 2 on/);
  await page.keyboard.press('Control+z');
  expect(await project(page)).toEqual(before);
});
