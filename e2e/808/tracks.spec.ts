import { expect, test } from '@playwright/test';
import {
  DRAFT_KEY,
  bpmOf,
  closeSettings,
  downloadBytes,
  exportVia,
  importChanged,
  openEditor,
  openSettings,
  parseMidi,
  parseWav,
  patternWatcher,
  project,
  stepButton,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('composing records the rhythm of every measure into the selected track', async ({ page }) => {
  await importChanged(
    page,
    (seed) => {
      seed.panel.mode = 'compose';
      seed.panel.selector = 2;
    },
    { fast: true },
  );
  // The selector now chooses a rhythm track, and CLEAR empties it.
  await expect(page.getByTestId('panel-voice-snare')).toHaveAccessibleName('Rhythm track 3');
  await expect(page.getByTestId('panel-voice-snare')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('panel-clear')).toHaveAccessibleName('Clear rhythm track 3');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-audio', 'idle');
  expect((await project(page)).rhythmTracks[2]).toEqual([]);
  const untouched = (await project(page)).rhythmTracks.filter((_, index) => index !== 2);

  // Play Basic Rhythm 1, change to 5, drop in a fill-in, and stop back on 5.
  const watch = patternWatcher(page);
  await page.getByTestId('panel-toggle').click();
  await watch.until(0);
  await watch.pastFirstBeat();
  await stepButton(page, 4).click();
  await watch.until(8);
  await page.getByTestId('panel-tap').click();
  await watch.until(24);
  await watch.until(8);
  await page.getByTestId('panel-toggle').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');

  const composed = (await project(page)).rhythmTracks[2]!;
  expect(composed.join(' ')).toMatch(/^(0 )+(4 )+12( 4)+$/);
  // No other track was touched, and the draft has it.
  const after = await project(page);
  expect(after.rhythmTracks.filter((_, index) => index !== 2)).toEqual(untouched);
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).rhythmTracks[2].length, DRAFT_KEY))
    .toBe(composed.length);
  await openSettings(page);
  await expect(page.getByTestId('track-length')).toHaveText(`Rhythm track 3: ${composed.length} measures`);
  await closeSettings(page);

  // The whole take is one step to undo, and CLEAR empties the track again.
  await page.keyboard.press('Control+z');
  expect((await project(page)).rhythmTracks[2]).toEqual([]);
  await page.keyboard.press('Control+Shift+z');
  expect((await project(page)).rhythmTracks[2]).toEqual(composed);
  await page.getByTestId('panel-clear').click();
  expect((await project(page)).rhythmTracks[2]).toEqual([]);
});

test('play replays a rhythm track with the variation switches as they stand, and starts over', async ({ page }) => {
  await importChanged(
    page,
    (seed) => {
      seed.panel.mode = 'play';
      seed.panel.selector = 0;
      seed.panel.basicVariation = 'b';
      seed.rhythmTracks[0] = [0, 4, 12];
    },
    { fast: true },
  );
  await expect(page.getByTestId('panel-tap')).toBeDisabled();
  await expect(page.getByTestId('panel-clear')).toBeDisabled();

  const watch = patternWatcher(page);
  await page.getByTestId('panel-toggle').click();
  await expect.poll(async () => (await watch.poll()).length, { intervals: [20] }).toBeGreaterThanOrEqual(5);
  // Version B of the Basic Rhythms, the fill-in as its own switch says, then round again.
  expect((await watch.poll()).slice(0, 5)).toEqual([1, 9, 24, 1, 9]);

  // The step buttons show the rhythm of each measure and choose nothing.
  const lamps = page.getByTestId('panel').locator('[data-panel-lamp]');
  await watch.until(9);
  await expect(lamps.nth(4)).toHaveAttribute('data-on', 'true');
  await expect(stepButton(page, 4)).toHaveAccessibleName('Basic Rhythm 5, playing');
  const before = (await project(page)).panel;
  await stepButton(page, 7).click();
  expect((await project(page)).panel).toEqual(before);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');

  // Turning the mode selector away stops the track.
  await page.getByTestId('panel-mode-manual_play').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
});

test('an empty rhythm track says so and does not start', async ({ page }) => {
  await page.getByTestId('panel-mode-play').click();
  await page.getByTestId('panel-voice-rim_shot').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-audio', 'idle');
  await page.getByTestId('panel-toggle').click();
  await expect(page.getByTestId('notice')).toContainText('Rhythm track 7 is empty');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
});

test('composing over a written track changes it from there on and keeps its length', async ({ page }) => {
  await importChanged(
    page,
    (seed) => {
      seed.panel.mode = 'compose';
      seed.panel.selector = 0;
      seed.rhythmTracks[0] = [0, 0, 0, 0, 0, 0];
    },
    { fast: true },
  );
  const watch = patternWatcher(page);
  await page.getByTestId('panel-toggle').click();
  await watch.until(0);
  await watch.pastFirstBeat();
  await stepButton(page, 4).click();
  await watch.until(8);
  // Left alone, it stops by itself at the end of the track.
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false', { timeout: 15_000 });
  const edited = (await project(page)).rhythmTracks[0]!;
  expect(edited).toHaveLength(6);
  expect(edited.join(' ')).toMatch(/^(0 )+4( 4)*$/);
  expect((await project(page)).rhythmTracks[1]).toEqual([]);
  await expect(page.getByTestId('notice')).not.toHaveAttribute('data-kind', 'error');
});

test('exports a rhythm track as MIDI and as audio that rings out', async ({ page }) => {
  await importChanged(page, (seed) => {
    seed.panel.mode = 'play';
    seed.panel.selector = 0;
    // Basic Rhythm 9 is empty in the starter set: a measure of rest.
    seed.rhythmTracks[0] = [0, 0, 8, 0];
  });
  const bpm = bpmOf(await project(page));
  const midi = parseMidi(await downloadBytes(await exportVia(page, 'export-midi')));
  expect(midi.trackEnds).toEqual([4 * 1920, 4 * 1920]);
  // Basic Rhythm 1 twice, the rest, and Basic Rhythm 1 again.
  const kicks = midi.notes.filter((note) => note.on && note.note === 36).map((note) => note.tick);
  expect(kicks.filter((tick) => tick >= 2 * 1920 && tick < 3 * 1920)).toEqual([]);
  expect(kicks.filter((tick) => tick < 1920).map((tick) => tick + 3 * 1920)).toEqual(kicks.filter((tick) => tick >= 3 * 1920));

  const wav = parseWav(await downloadBytes(await exportVia(page, 'export-wav')));
  // Four measures of four beats, and three seconds for the last hits to ring.
  expect(Math.abs(wav.frames - (44100 * 4 * 240) / bpm - 3 * 44100)).toBeLessThanOrEqual(1);
  expect(wav.rms).toBeGreaterThan(0.01);

  // An empty track has nothing to export, and says so.
  await closeSettings(page);
  await page.getByTestId('panel-voice-cowbell').click();
  await openSettings(page);
  await page.getByTestId('export-menu').click();
  await page.getByTestId('export-midi').click();
  await expect(page.getByTestId('notice')).toHaveAttribute('data-kind', 'error');
  await expect(page.getByTestId('notice')).toContainText('rhythm track 9 is empty');
});

test('with the lever on AB an export holds A then B', async ({ page }) => {
  const lever = page.getByTestId('panel-basic-variation');
  const bpm = bpmOf(await project(page));
  const one = parseWav(await downloadBytes(await exportVia(page, 'export-wav')));
  await closeSettings(page);
  await lever.focus();
  await page.keyboard.press('ArrowRight');
  const both = parseWav(await downloadBytes(await exportVia(page, 'export-wav')));
  expect(Math.abs(one.frames - (44100 * 240) / bpm)).toBeLessThanOrEqual(1);
  expect(Math.abs(both.frames - (44100 * 480) / bpm)).toBeLessThanOrEqual(1);
  const midi = parseMidi(await downloadBytes(await exportVia(page, 'export-midi')));
  expect(midi.trackEnds).toEqual([3840, 3840]);
  // The bass drum plays version A's steps in the first measure and version B's in the second.
  const rhythm = (await project(page)).rhythms[0]!;
  const steps = (row: string) => [...row].flatMap((mark, index) => (mark === 'x' ? [index] : []));
  const kicks = midi.notes.filter((note) => note.on && note.note === 36).map((note) => note.tick);
  expect(kicks).toEqual([
    ...steps(rhythm.a.kick).map((index) => index * 120),
    ...steps(rhythm.b.kick).map((index) => 1920 + index * 120),
  ]);
});
