import { expect, test } from '@playwright/test';
import {
  functionKey,
  importChanged,
  litSteps,
  openEditor,
  patternIndex,
  patternWatcher,
  project,
  setMode,
  stepKey,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('SHIFT and a step key chain patterns, which then play one after the other, round and round', async ({ page }) => {
  await importChanged(page, () => undefined, { fast: true });
  await page.getByTestId('panel-shift').click();
  await expect(stepKey(page, 2)).toHaveAccessibleName('Chain patterns through A3');
  await stepKey(page, 2).click();
  expect((await project(page)).panel).toMatchObject({ pattern: 0, chain: { first: 0, last: 2 } });
  expect(await litSteps(page)).toEqual([0, 1, 2]);
  await expect(stepKey(page, 1)).toHaveAccessibleName('Pattern A2, in the chain');
  await expect(page.getByTestId('panel-display')).toHaveAccessibleName(/Chain A1 to A3\./);

  const watcher = patternWatcher(page);
  await page.getByTestId('panel-start').click();
  await watcher.until(patternIndex('a', 1));
  await watcher.until(patternIndex('a', 2));
  await watcher.until(patternIndex('a', 0));
  await watcher.until(patternIndex('a', 1));
  expect(watcher.seen).toEqual([0, 2, 4, 0, 2]);

  // Stopped, the chain is kept and starts from its first pattern again.
  await page.getByTestId('panel-stop').click();
  await expect.poll(async () => (await project(page)).panel.pattern).toBe(0);
  expect((await project(page)).panel.chain).toEqual({ first: 0, last: 2 });
  // One step key alone ends it.
  await stepKey(page, 3).click();
  expect((await project(page)).panel).toMatchObject({ pattern: 3, chain: null });
  expect(await litSteps(page)).toEqual([3]);
});

test('two step keys pressed together chain the patterns between them', async ({ page }) => {
  // Two fingers: the second goes down while the first is still on its key.
  const finger = (key: number, type: string, pointerId: number) =>
    stepKey(page, key).dispatchEvent(type, { pointerId, pointerType: 'touch', isPrimary: pointerId === 1, bubbles: true });
  await finger(4, 'pointerdown', 1);
  await finger(1, 'pointerdown', 2);
  expect((await project(page)).panel).toMatchObject({ pattern: 1, chain: { first: 1, last: 4 } });
  // Lifting them, each key gets its click, which must not undo the chain.
  for (const [key, pointerId] of [[4, 1], [1, 2]] as const) {
    await finger(key, 'pointerup', pointerId);
    await stepKey(page, key).dispatchEvent('click', { detail: 1 });
  }
  expect((await project(page)).panel.chain).toEqual({ first: 1, last: 4 });
  expect(await litSteps(page)).toEqual([1, 2, 3, 4]);
  // The next key pressed alone is a pattern by itself again.
  await stepKey(page, 6).click();
  expect((await project(page)).panel).toMatchObject({ pattern: 6, chain: null });
});

test('TRACK plays the selected track once through, measure by measure, and stops', async ({ page }) => {
  await importChanged(page, (next) => {
    next.tracks[0] = { group: 'a', measures: [0, 1, 2] };
  }, { fast: true });
  await functionKey(page, 'track').click();
  expect((await project(page)).panel.mode).toBe('track_play');
  const display = page.getByTestId('panel-display');
  await expect(display).toHaveAccessibleName(/Track play\. Track I, measure 1 of 3\. Pattern A1\./);
  // The step keys only show the pattern of the measure.
  expect(await litSteps(page)).toEqual([0]);
  await stepKey(page, 5).click();
  expect((await project(page)).panel.pattern).toBe(0);

  const editor = page.getByTestId('editor');
  const watcher = patternWatcher(page);
  await page.getByTestId('panel-start').click();
  await watcher.until(patternIndex('a', 1));
  await expect(display).toHaveAccessibleName(/Track I, measure 2 of 3\. Pattern A2, playing\./);
  await watcher.until(patternIndex('a', 2));
  await expect(editor).toHaveAttribute('data-playing', 'false');
  expect(watcher.seen).toEqual([0, 2, 4]);
  // Played through, it is back at its first measure.
  expect((await project(page)).panel.measure).toBe(0);
  await expect(display).toHaveAccessibleName(/Track I, measure 1 of 3\. Pattern A1\./);
});

test('STOP/CONT carries a track on from the measure it was stopped in, and START goes back to the top', async ({ page }) => {
  await importChanged(page, (next) => {
    next.tracks[0] = { group: 'a', measures: [0, 1, 2, 3, 0, 1, 2, 3] };
  }, { fast: true });
  await functionKey(page, 'track').click();
  const watcher = patternWatcher(page);
  await page.getByTestId('panel-start').click();
  await watcher.until(patternIndex('a', 2));
  await page.getByTestId('panel-stop').click();
  await expect.poll(async () => (await project(page)).panel.measure).toBe(2);
  await expect(page.getByTestId('panel-display')).toHaveAccessibleName(/Track I, measure 3 of 8\./);

  // BACK and FWD step through it while it is stopped.
  await functionKey(page, 'scale').click();
  expect((await project(page)).panel.measure).toBe(1);
  await functionKey(page, 'last_step').click();
  await functionKey(page, 'last_step').click();
  expect((await project(page)).panel.measure).toBe(3);

  const onward = patternWatcher(page);
  await page.getByTestId('panel-stop').click();
  await onward.until(patternIndex('a', 0));
  expect(onward.seen).toEqual([patternIndex('a', 3), patternIndex('a', 0)]);
  await page.getByTestId('panel-stop').click();

  const again = patternWatcher(page);
  await page.getByTestId('panel-start').click();
  await again.until(patternIndex('a', 1));
  expect(again.seen).toEqual([0, 2]);
});

test('SHIFT and TRACK write a track: a step key chooses the pattern and ENTER stores it', async ({ page }) => {
  await setMode(page, 'track_write');
  // Track II, with SHIFT and the second of the four keys.
  await page.getByTestId('panel-shift').click();
  await page.getByTestId('panel-group-1').click();
  expect((await project(page)).panel).toMatchObject({ mode: 'track_write', track: 1, measure: 0 });
  const display = page.getByTestId('panel-display');
  await expect(display).toHaveAccessibleName(/Track write\. Track II, empty\./);

  const enter = page.getByTestId('panel-enter');
  await stepKey(page, 2).click();
  await expect(enter).toHaveAccessibleName('Enter: store pattern A3 in measure 1');
  await enter.click();
  await enter.click();
  await stepKey(page, 0).click();
  await enter.click();
  expect((await project(page)).tracks[1]).toEqual({ group: 'a', measures: [2, 2, 0] });
  await expect(display).toHaveAccessibleName(/Track II, 3 measures, at the end\./);

  // BACK to the second measure, and write over it.
  await functionKey(page, 'scale').click();
  await functionKey(page, 'scale').click();
  await expect(display).toHaveAccessibleName(/Track II, measure 2 of 3\. Pattern A3\./);
  await stepKey(page, 1).click();
  await enter.click();
  expect((await project(page)).tracks[1]!.measures).toEqual([2, 1, 0]);

  // INS and DEL, with SHIFT.
  await stepKey(page, 3).click();
  await page.getByTestId('panel-shift').click();
  await expect(stepKey(page, 11)).toHaveAccessibleName('Insert a measure here');
  await stepKey(page, 11).click();
  expect((await project(page)).tracks[1]!.measures).toEqual([2, 1, 3, 0]);
  await page.getByTestId('panel-shift').click();
  await stepKey(page, 12).click();
  expect((await project(page)).tracks[1]!.measures).toEqual([2, 1, 0]);

  // Key B gives the whole track group B's patterns.
  await page.getByTestId('panel-group-1').click();
  expect((await project(page)).tracks[1]!.group).toBe('b');
  await expect(page.getByTestId('lamp-group-1')).toHaveAttribute('data-on', 'true');

  // LAST MEAS ends it where it stands; every one of these is undone in turn.
  await functionKey(page, 'scale').click();
  await functionKey(page, 'scale').click();
  await functionKey(page, 'instrument').click();
  expect((await project(page)).tracks[1]!.measures).toEqual([2]);
  await page.keyboard.press('Control+z');
  expect((await project(page)).tracks[1]).toEqual({ group: 'b', measures: [2, 1, 0] });
  await page.keyboard.press('Control+z');
  expect((await project(page)).tracks[1]!.group).toBe('a');

  // CLEAR, then ENTER, empties it.
  await functionKey(page, 'clear').click();
  await expect(enter).toHaveAccessibleName('Enter: empty track II');
  await enter.click();
  expect((await project(page)).tracks[1]!.measures).toEqual([]);
  // The other tracks were never touched.
  expect((await project(page)).tracks[0]!.measures).toEqual([0, 0, 0, 1, 0, 0, 0, 2]);
});

test('a track being written plays the pattern that is chosen, so it can be heard first', async ({ page }) => {
  await importChanged(page, () => undefined, { fast: true });
  await setMode(page, 'track_write');
  const watcher = patternWatcher(page);
  await page.getByTestId('panel-start').click();
  await watcher.until(patternIndex('a', 0));
  await stepKey(page, 3).click();
  await watcher.until(patternIndex('a', 3));
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  // Going to play the track stops the machine: a track starts from a measure of its own.
  await functionKey(page, 'track').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
});

test('an empty track does not start, and the machine says how to write one', async ({ page }) => {
  await functionKey(page, 'track').click();
  await page.getByTestId('panel-shift').click();
  await page.getByTestId('panel-group-3').click();
  expect((await project(page)).panel.track).toBe(3);
  await page.getByTestId('panel-start').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
  const notice = page.getByTestId('notice');
  await expect(notice).toHaveAttribute('data-kind', 'info');
  await expect(notice).toContainText('Track IV is empty.');
  await expect(functionKey(page, 'scale')).toBeDisabled();
  await expect(functionKey(page, 'last_step')).toBeDisabled();
});
