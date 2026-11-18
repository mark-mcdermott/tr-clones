import { expect, test } from '@playwright/test';
import {
  bankIndex,
  downloadBytes,
  exportVia,
  importChanged,
  litKeys,
  openEditor,
  openSettings,
  parseMidi,
  parseWav,
  patternWatcher,
  project,
  run,
  selectTrack,
  setMode,
  stepKey,
  stepLamp,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('a track is written a bar at a time with WRITE/NEXT', async ({ page }) => {
  await setMode(page, 'track_write');
  // The selector now chooses a track. Track 5 is one the starter leaves empty.
  await expect(page.getByTestId('panel-voice-high_tom')).toHaveAccessibleName('Track 5');
  await selectTrack(page, 'high_tom');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-audio', 'idle');
  expect((await project(page)).tracks[4]).toEqual([]);
  const untouched = (await project(page)).tracks.filter((_, index) => index !== 4);

  const next = page.getByTestId('panel-tap');
  await stepKey(page, 8).click();
  await expect(stepKey(page, 8)).toHaveAccessibleName('Pattern 9, chosen for bar 1');
  expect(await litKeys(page)).toEqual([8]);
  await next.click();
  await next.click();
  await stepKey(page, 12).click();
  await expect(stepKey(page, 12)).toHaveAccessibleName('Pattern 13, chosen for bar 3');
  await next.click();
  expect((await project(page)).tracks[4]).toEqual([8, 8, 12]);
  expect((await project(page)).tracks.filter((_, index) => index !== 4)).toEqual(untouched);

  // FUNCTION shows the number of the bar the track stands at: the fourth.
  const fn = page.getByTestId('panel-function');
  await fn.click();
  expect(await litKeys(page)).toEqual([3]);
  await expect(stepLamp(page, 3)).toHaveAttribute('data-flash', 'true');
  await fn.click();

  // BAR RESET goes back to the first bar, and the keys show what each bar holds on the way through.
  await page.getByTestId('panel-clear').click();
  expect(await litKeys(page)).toEqual([8]);
  await next.click();
  await next.click();
  expect(await litKeys(page)).toEqual([12]);
  expect((await project(page)).tracks[4]).toEqual([8, 8, 12]);

  // Each bar written is a step to undo.
  await page.keyboard.press('Control+z');
  expect((await project(page)).tracks[4]).toEqual([8, 8]);
  await openSettings(page);
  await expect(page.getByTestId('machine-status')).toHaveText('Track 5: 2 measures, at bar 3, group I');
});

test('D.C. ends a track, and DEL and INS take a bar out and put one in', async ({ page }) => {
  await setMode(page, 'track_write');
  await selectTrack(page, 'accent');
  const starter = (await project(page)).tracks[0]!;
  expect(starter).toEqual([0, 1, 0, 3, 0, 1, 2, 3]);
  const next = page.getByTestId('panel-tap');
  const fn = page.getByTestId('panel-function');
  const clear = page.getByTestId('panel-clear');

  // At the second bar: take it out.
  await next.click();
  await fn.click();
  await expect(stepKey(page, 14)).toHaveAccessibleName('Delete bar 2');
  await expect(stepKey(page, 15)).toHaveAccessibleName('Insert a bar at 2');
  await stepKey(page, 14).click();
  await expect(fn).toHaveAttribute('aria-pressed', 'false');
  expect((await project(page)).tracks[0]).toEqual([0, 0, 3, 0, 1, 2, 3]);

  // Put pattern 6 in there.
  await stepKey(page, 5).click();
  await fn.click();
  await stepKey(page, 15).click();
  expect((await project(page)).tracks[0]).toEqual([0, 5, 0, 3, 0, 1, 2, 3]);

  // Two bars on, make pattern 10 the last bar.
  await next.click();
  await next.click();
  await stepKey(page, 9).click();
  await fn.click();
  await expect(clear).toHaveAccessibleName('D.C.: write the chosen pattern here and make this bar the last');
  await clear.click();
  expect((await project(page)).tracks[0]).toEqual([0, 5, 0, 9]);
  for (let undone = 0; undone < 3; undone += 1) await page.keyboard.press('Control+z');
  expect((await project(page)).tracks[0]).toEqual(starter);
});

test('writing a track, RUN plays the chosen pattern round and round to hear it', async ({ page }) => {
  await importChanged(page, (seed) => void (seed.panel.mode = 'track_write'), { fast: true });
  await selectTrack(page, 'cymbal');
  const watch = patternWatcher(page);
  await stepKey(page, 4).click();
  await run(page);
  await watch.until(bankIndex(4));
  await stepKey(page, 0).click();
  await watch.until(bankIndex(0));
  await page.getByTestId('panel-tap').click();
  expect((await project(page)).tracks[5]).toEqual([0]);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
});

test('track play plays the bars in order and goes round, in the group the button stands on', async ({ page }) => {
  await importChanged(
    page,
    (seed) => {
      seed.panel.mode = 'track_play';
      seed.panel.selector = 2;
      seed.tracks[2] = [0, 4, 1];
    },
    { fast: true },
  );
  await expect(page.getByTestId('panel-voice-snare')).toHaveAttribute('aria-checked', 'true');
  // Waiting, the lamp of the first bar's pattern flashes.
  expect(await litKeys(page)).toEqual([0]);
  await expect(stepLamp(page, 0)).toHaveAttribute('data-flash', 'true');

  const watch = patternWatcher(page);
  await run(page);
  for (const number of [0, 4, 1, 0, 4]) await watch.until(bankIndex(number));
  // The lamps follow the pattern of each bar, and the step keys change nothing.
  await expect(page.getByTestId('panel').locator('[data-panel-lamp][data-on="true"]')).toHaveCount(1);
  await stepKey(page, 9).click();
  expect((await project(page)).panel.pattern).toBe(0);
  expect((await project(page)).tracks[2]).toEqual([0, 4, 1]);

  // Turning the selector to another track, or the mode selector out of the track modes, stops the machine.
  await page.getByTestId('panel-voice-accent').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
  await run(page);
  await setMode(page, 'pattern_play');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');

  // A track remembers pattern numbers: with the button on group II it plays that group's.
  await setMode(page, 'track_play');
  await page.getByTestId('panel-voice-snare').click();
  await page.getByTestId('panel-group').click();
  const inTwo = patternWatcher(page);
  await run(page);
  for (const number of [0, 4, 1]) await inTwo.until(bankIndex(number, 1));
});

test('an empty track does not start, and says how to write one', async ({ page }) => {
  await setMode(page, 'track_play');
  await selectTrack(page, 'closed_hat');
  await page.getByTestId('panel-toggle').click();
  await expect(page.getByTestId('notice')).toContainText('Track 8 is empty');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
  await openSettings(page);
  await expect(page.getByTestId('machine-status')).toHaveText('Track 8: empty, group I');
});

test('a track exports once through: every bar, in order', async ({ page }) => {
  await setMode(page, 'track_play');
  await selectTrack(page, 'kick');
  const snapshot = await project(page);
  expect(snapshot.tracks[1]).toEqual([4, 4, 4, 5]);

  const midi = parseMidi(await downloadBytes(await exportVia(page, 'export-midi')));
  // Four bars of four beats at 480 ticks to the beat.
  expect(midi.trackEnds).toEqual([7680, 7680]);
  const kicks = midi.notes.filter((note) => note.on && note.note === 36).map((note) => note.tick);
  expect(kicks).toEqual(Array.from({ length: 16 }, (_, beat) => beat * 480));

  const wav = parseWav(await downloadBytes(await exportVia(page, 'export-wav')));
  // Its sixteen beats, and time for the last hits to ring.
  const beats = (44100 * 60 * 16) / snapshot.tempo;
  expect(wav.frames).toBeGreaterThan(beats);
  expect(wav.frames).toBeLessThan(beats + 44100 * 4);
  expect(wav.rms).toBeGreaterThan(0.01);

  // An empty track has nothing to export, and the page says which.
  await page.keyboard.press('Escape');
  await selectTrack(page, 'closed_hat');
  await openSettings(page);
  await page.getByTestId('export-menu').click();
  await page.getByTestId('export-midi').click();
  await expect(page.getByTestId('notice')).toContainText('track 8 is empty');
});
