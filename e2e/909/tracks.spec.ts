import { expect, test } from '@playwright/test';
import { debug, importChanged, key, openEditor, patternWatcher, project, shifted, start, stepKey, stepLamp, stop } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

/** Empties track 2 and goes into track write on it. */
async function writeTrackTwo(page: import('@playwright/test').Page): Promise<void> {
  await shifted(page, page.getByTestId('panel-track-1'));
  expect((await project(page)).panel).toMatchObject({ mode: 'track_write', track: 1 });
}

test('a track is written a measure at a time with the step keys and ENTER', async ({ page }) => {
  await writeTrackTwo(page);
  const display = page.getByTestId('panel-display');
  await expect(display).toHaveAttribute('data-value', '1');
  await expect(display).toHaveAccessibleName('Track 2, measure 1: empty');
  await expect(page.getByTestId('panel-enter-lamp')).toHaveAttribute('data-on', 'true');

  await stepKey(page, 2).click();
  await expect(stepKey(page, 2)).toHaveAccessibleName('Pattern 3 for measure 1, selected');
  await expect(page.getByTestId('panel-enter')).toHaveAccessibleName('Enter: store pattern 3 in measure 1');
  await page.getByTestId('panel-enter').click();
  await expect(display).toHaveAttribute('data-value', '2');
  await page.getByTestId('panel-enter').click();
  await stepKey(page, 0).click();
  await page.getByTestId('panel-enter').click();
  await stepKey(page, 3).click();
  await page.getByTestId('panel-enter').click();
  expect((await project(page)).patternTracks[1]).toEqual({ group: 0, measures: [2, 2, 0, 3] });
  await expect(display).toHaveAttribute('data-value', '5');
  await expect(display).toHaveAccessibleName('Track 2, measure 5: 4 measures written');
  await expect(page.getByTestId('panel-status')).toHaveText('Writing track 2, measure 5: pattern 4 of group 1');

  // BACK and FWD move through it, and the lamp shows the pattern each measure holds.
  await key(page, 'back').click();
  await key(page, 'back').click();
  await expect(display).toHaveAttribute('data-value', '3');
  await expect(stepLamp(page, 0)).toHaveAttribute('data-on', 'true');
  await key(page, 'forward').click();
  await expect(stepLamp(page, 3)).toHaveAttribute('data-on', 'true');
  await key(page, 'back').click();

  // A measure can be written over.
  await stepKey(page, 1).click();
  await page.getByTestId('panel-enter').click();
  expect((await project(page)).patternTracks[1]!.measures).toEqual([2, 2, 1, 3]);

  // AVAILABLE MEAS shows what is left of the 192, and TEMPO the tempo.
  await key(page, 'available').click();
  await expect(display).toHaveAttribute('data-value', '188');
  await expect(display).toHaveAccessibleName('Track 2 has 188 measures left');
  await key(page, 'tempo').click();
  await expect(display).toHaveAttribute('data-value', '125');
  await expect(page.getByTestId('panel-key-tempo-lamp')).toHaveAttribute('data-on', 'true');
  await key(page, 'tempo').click();
  await expect(display).toHaveAttribute('data-value', '4');

  // SHIFT and CYCLE is LAST MEAS: the track ends on the measure shown.
  await key(page, 'back').click();
  await key(page, 'back').click();
  await key(page, 'shift').click();
  await expect(key(page, 'cycle')).toHaveAccessibleName('Last measure: end track 2 on measure 2');
  await key(page, 'cycle').click();
  expect((await project(page)).patternTracks[1]!.measures).toEqual([2, 2]);
  await page.keyboard.press('Control+z');
  expect((await project(page)).patternTracks[1]!.measures).toEqual([2, 2, 1, 3]);
});

test('a PATTERN key gives the track its group, and CLEAR empties it', async ({ page }) => {
  await writeTrackTwo(page);
  await stepKey(page, 0).click();
  await page.getByTestId('panel-enter').click();
  await expect(page.getByTestId('panel-group-1')).toHaveAccessibleName('Pattern group 2 for track 2');
  await page.getByTestId('panel-group-1').click();
  const snapshot = await project(page);
  expect(snapshot.panel.mode).toBe('track_write');
  expect(snapshot.patternTracks[1]).toEqual({ group: 1, measures: [0] });
  await expect(page.getByTestId('panel-group-1-lamp')).toHaveAttribute('data-on', 'true');
  // The first track is still in its own group.
  expect(snapshot.patternTracks[0]!.group).toBe(0);

  await expect(key(page, 'clear')).toHaveAccessibleName('Clear track 2');
  await key(page, 'clear').click();
  expect((await project(page)).patternTracks[1]!.measures).toEqual([]);
  await expect(page.getByTestId('panel-display')).toHaveAttribute('data-value', '1');
  await page.keyboard.press('Control+z');
  expect((await project(page)).patternTracks[1]!.measures).toEqual([0]);
});

test('an empty track will not start, and says how to write it', async ({ page }) => {
  await page.getByTestId('panel-track-3').click();
  await page.getByTestId('panel-start').click();
  await expect(page.getByTestId('notice')).toContainText('Track 4 is empty. To write it, press SHIFT, then TRACK 4.');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
  // The step keys only show what a track plays.
  await expect(stepKey(page, 0)).toBeDisabled();
});

test('a track plays its measures in order, counts them on the display, and stops at its end', async ({ page }) => {
  await importChanged(page, (next) => {
    next.patternTracks[1] = { group: 0, measures: [0, 2, 1] };
  }, { fast: true });
  await page.getByTestId('panel-track-1').click();
  const display = page.getByTestId('panel-display');
  await expect(display).toHaveAttribute('data-value', '1');
  await expect(display).toHaveAccessibleName('Track 2, measure 1: 3 measures written');
  await expect(stepLamp(page, 0)).toHaveAttribute('data-on', 'true');

  const watcher = patternWatcher(page);
  const counted = new Set<string>();
  await start(page);
  await expect
    .poll(async () => {
      await watcher.poll();
      counted.add((await display.getAttribute('data-value')) ?? '');
      return page.getByTestId('editor').getAttribute('data-playing');
    }, { intervals: [15], timeout: 12_000 })
    .toBe('false');
  // Patterns 1, 3 and 2 of group 1 are the engine's patterns 0, 4 and 2.
  expect(await watcher.poll()).toEqual([0, 4, 2]);
  expect([...counted].sort()).toEqual(['1', '2', '3']);
  expect((await debug(page)).stats!.peakEver).toBeGreaterThan(0.05);
  // It stopped by itself, on its last measure, and the keys show the pattern that was last.
  await expect(display).toHaveAttribute('data-value', '3');
  await expect(stepLamp(page, 1)).toHaveAttribute('data-on', 'true');
});

test('with CYCLE a track goes round, and going to another mode stops it', async ({ page }) => {
  await importChanged(page, (next) => {
    next.patternTracks[1] = { group: 1, measures: [0, 1] };
  }, { fast: true });
  await page.getByTestId('panel-track-1').click();
  await expect(key(page, 'cycle')).toHaveAccessibleName('Cycle: play the track round and round');
  await key(page, 'cycle').click();
  expect((await project(page)).panel.cycle).toBe(true);
  await expect(page.getByTestId('panel-key-cycle-lamp')).toHaveAttribute('data-on', 'true');
  // The track is of group 2, and its lamp shows it.
  await expect(page.getByTestId('panel-group-1-lamp')).toHaveAttribute('data-on', 'true');

  const watcher = patternWatcher(page);
  await start(page);
  await watcher.until(1);
  await watcher.until(3);
  await watcher.until(1);
  await watcher.until(3);
  expect(await watcher.poll()).toEqual([1, 3, 1, 3]);
  await page.getByTestId('panel-group-0').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
  expect((await project(page)).panel.mode).toBe('pattern_play');
});

test('a pattern chosen for a measure can be heard before it is stored', async ({ page }) => {
  await importChanged(page, () => undefined, { fast: true });
  await shifted(page, page.getByTestId('panel-track-1'));
  const watcher = patternWatcher(page);
  await start(page);
  await watcher.until(0);
  await stepKey(page, 2).click();
  await watcher.until(4);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  await stop(page);
});
