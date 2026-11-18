import { expect, test } from '@playwright/test';
import {
  chooseInstrument,
  closeSettings,
  debug,
  functionKey,
  importChanged,
  openEditor,
  openSettings,
  patternIndex,
  patternWatcher,
  project,
  setMode,
  stepKey,
  stepsOn,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('audio stays off until a user gesture, then the engine renders sound', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await expect(editor).toHaveAttribute('data-audio', 'idle');
  expect((await debug(page)).stats).toBeNull();
  expect((await debug(page)).soundsSent).toBe(0);

  const start = page.getByTestId('panel-start');
  await start.click();
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await expect(start).toHaveAttribute('aria-pressed', 'true');
  await openSettings(page);
  await expect(page.getByTestId('audio-status')).toHaveText('Audio is running');
  await closeSettings(page);

  // The worklet reports what it rendered: frames advance and the output is
  // not silence.
  await expect.poll(async () => (await debug(page)).stats?.frames ?? 0).toBeGreaterThan(20_000);
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
  const snapshot = await debug(page);
  expect(snapshot.sampleRate).toBeGreaterThanOrEqual(44100);
  // Every sound of the machine was synthesised here and taken by the worklet.
  expect(snapshot.soundsSent).toBe(15);
  await expect.poll(async () => (await debug(page)).soundsTaken).toBe(15);
  expect(snapshot.stats!.stolen).toBe(0);

  const stop = page.getByTestId('panel-stop');
  await expect(stop).toHaveAccessibleName('Stop');
  await stop.click();
  await expect(editor).toHaveAttribute('data-playing', 'false');
  await expect(stop).toHaveAccessibleName('Continue');
  // STOP/CONT starts it again.
  await stop.click();
  await expect(editor).toHaveAttribute('data-playing', 'true');
});

test('choosing an instrument plays it once without starting the beat', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await setMode(page, 'pattern_step');
  await expect(editor).toHaveAttribute('data-audio', 'idle');
  await chooseInstrument(page, 0);
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await expect(editor).toHaveAttribute('data-playing', 'false');
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
});

test('Space starts and stops', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await page.locator('body').press('Space');
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await page.locator('body').press('Space');
  await expect(editor).toHaveAttribute('data-playing', 'false');
});

test('the display and the lamps follow the running step', async ({ page }) => {
  await page.getByTestId('panel-start').click();
  const canvas = page.getByTestId('display-canvas');
  const drawn = new Set<string>();
  const lit = new Set<number>();
  await expect
    .poll(
      async () => {
        drawn.add((await canvas.getAttribute('data-step')) ?? '');
        const now = await page.locator('[data-testid^="lamp-step-"][data-now="true"]').getAttribute('data-testid').catch(() => null);
        if (now) lit.add(Number(now.replace('lamp-step-', '')));
        return Math.min(drawn.size, lit.size);
      },
      { intervals: [25] },
    )
    .toBeGreaterThanOrEqual(5);
  await page.getByTestId('panel-stop').click();
  // Stopped, no step is marked.
  await expect(canvas).toHaveAttribute('data-step', '-1');
  await expect(page.locator('[data-testid^="lamp-step-"][data-now="true"]')).toHaveCount(0);
});

test('edits made while playing keep the beat running', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await page.getByTestId('panel-start').click();
  await expect(editor).toHaveAttribute('data-audio', 'running');
  const tempo = page.getByTestId('panel-tempo');
  await tempo.focus();
  for (let press = 0; press < 4; press += 1) await page.keyboard.press('ArrowUp');
  await page.getByTestId('panel-fader-hi_hat').focus();
  await page.keyboard.press('PageDown');
  await setMode(page, 'pattern_step');
  await chooseInstrument(page, 14);
  await stepKey(page, 0).click();
  await chooseInstrument(page, 1);
  await stepKey(page, 2).click();
  await functionKey(page, 'shuffle').click();
  await stepKey(page, 2).click();
  await setMode(page, 'pattern_tap');
  await setMode(page, 'pattern_play');
  const before = (await debug(page)).stats?.frames ?? 0;
  await expect.poll(async () => (await debug(page)).stats?.frames ?? 0).toBeGreaterThan(before + 10_000);
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await expect(page.getByTestId('notice')).toHaveCount(0);
  expect((await debug(page)).stats!.stolen).toBe(0);
  const snapshot = await project(page);
  expect(snapshot.tempo).toBe(124);
  expect(snapshot.shuffle).toBe(2);
  expect(snapshot.sounds.bass_drum).toBe('bass_drum_2');
  expect(stepsOn(snapshot, 'crash')).toEqual([0]);
});

test('a pattern chosen while another plays takes over at the bar line, its lamp flashing until then', async ({ page }) => {
  await importChanged(page, () => undefined, { fast: true });
  const watcher = patternWatcher(page);
  await page.getByTestId('panel-start').click();
  await watcher.until(patternIndex('a', 0));
  // Early in the measure, so the bar line is still to come.
  await expect.poll(() => page.evaluate(() => window.__boombapbot!.playing().step), { intervals: [10] }).toBeLessThan(6);
  await stepKey(page, 1).click();
  await expect(page.getByTestId('lamp-step-1')).toHaveAttribute('data-flash', 'true');
  await expect(stepKey(page, 0)).toHaveAttribute('aria-pressed', 'true');
  await watcher.until(patternIndex('a', 1));
  await expect(page.getByTestId('lamp-step-1')).not.toHaveAttribute('data-flash', 'true');
  await expect(stepKey(page, 0)).toHaveAttribute('aria-pressed', 'false');
  // Group B's first pattern is twelve triplet steps: the engine goes to it the same way.
  await page.getByTestId('panel-group-1').click();
  await stepKey(page, 0).click();
  await watcher.until(patternIndex('b', 0));
  expect(watcher.seen).toEqual([0, 2, 1]);
  await expect(page.getByTestId('panel-display')).toHaveAccessibleName(/Pattern B1, playing\. 12 steps of eighth-note triplets\./);
});

test('tapping a step key in tap write records its instrument where it fell, as one undo step', async ({ page }) => {
  await stepKey(page, 15).click();
  await setMode(page, 'pattern_tap');
  await expect(page.getByRole('group', { name: 'Instruments' })).toBeVisible();
  await expect(stepKey(page, 7)).toHaveAccessibleName('Tap Rim Shot');

  // Stopped, a tap is only heard.
  await stepKey(page, 7).click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-audio', 'running');
  expect(stepsOn(await project(page), 'rim_cowbell', 15)).toEqual([]);

  await page.getByTestId('panel-start').click();
  await expect.poll(() => page.evaluate(() => window.__boombapbot!.playing().step)).toBeGreaterThanOrEqual(0);
  const taps = [7, 4, 0];
  for (const key of taps) {
    await stepKey(page, key).click();
    await page.waitForTimeout(170);
  }
  // ENTER is the accent.
  await page.getByTestId('panel-enter').click();
  await page.getByTestId('panel-stop').click();
  const taken = await project(page);
  expect(stepsOn(taken, 'rim_cowbell', 15)).toHaveLength(1);
  expect(stepsOn(taken, 'low_tom', 15)).toHaveLength(1);
  expect(stepsOn(taken, 'bass_drum', 15)).toHaveLength(1);
  expect(stepsOn(taken, 'accent', 15)).toHaveLength(1);
  // The taps were a moment apart, so they are not all on one step.
  const fell = new Set([...stepsOn(taken, 'rim_cowbell', 15), ...stepsOn(taken, 'low_tom', 15), ...stepsOn(taken, 'bass_drum', 15)]);
  expect(fell.size).toBeGreaterThan(1);

  await page.keyboard.press('Control+z');
  const undone = await project(page);
  for (const row of ['rim_cowbell', 'low_tom', 'bass_drum', 'accent'] as const) expect(stepsOn(undone, row, 15)).toEqual([]);
});

test('the offline render of the pattern is one measure and not silent', async ({ page }) => {
  const render = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  // Sixteen steps of four to the beat at 120: two seconds.
  expect(Math.abs(render.frames - 88_200)).toBeLessThanOrEqual(1);
  expect(render.peak).toBeGreaterThan(0.1);
  expect(render.peak).toBeLessThanOrEqual(1);
  expect(render.rms).toBeGreaterThan(0.01);
  expect(render.events.length).toBeGreaterThan(10);
  expect(render.events.every((event) => event.pattern === 0 && event.track >= 1 && event.track <= 11)).toBe(true);
});
