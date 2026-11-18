import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  ROW_IDS,
  chooseInstrument,
  displayInk,
  functionKey,
  hitCount,
  litSteps,
  openEditor,
  project,
  setMode,
  stepKey,
  stepLamp,
  stepsOn,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('the panel is the drawn faceplate, with every control laid over it', async ({ page }) => {
  const panel = page.getByTestId('panel');
  await expect(panel).toHaveAttribute('data-photo', 'photo');
  const image = panel.locator('img.sb-panel-photo');
  await expect(image).toHaveAttribute('src', /faceplates\/707\.svg$/);
  await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(panel.locator('[data-panel-step]')).toHaveCount(16);
  await expect(panel.locator('[role="slider"]')).toHaveCount(13);
  await expect(panel.locator('[data-testid^="lamp-step-"]')).toHaveCount(16);
  // The drawing is our own, so there is nobody to credit.
  await expect(page.getByTestId('panel-credit')).toHaveCount(0);
  const manifest = JSON.parse(readFileSync('machines/707/data/707.panel.json', 'utf8')) as { faceplate: object };
  expect(manifest.faceplate).toEqual({ file: '707.svg', width: 2000, height: 1272, original: true });
});

test('the display draws the pattern, and draws another when one is chosen', async ({ page }) => {
  const filled = await displayInk(page);
  expect(filled).toBeGreaterThan(0.03);
  // A16 is empty: less of the glass is dark.
  await stepKey(page, 15).click();
  await expect.poll(() => displayInk(page)).toBeLessThan(filled - 0.01);
  await expect(page.getByTestId('panel-display')).toHaveAccessibleName(/Pattern A16\./);
});

test('the step keys choose a pattern in pattern play, and A and B its group', async ({ page }) => {
  expect((await project(page)).panel).toMatchObject({ mode: 'pattern_play', group: 'a', pattern: 0 });
  await expect(stepKey(page, 0)).toHaveAccessibleName('Pattern A1, selected');
  await expect(page.getByRole('group', { name: 'Patterns' })).toBeVisible();
  expect(await litSteps(page)).toEqual([0]);

  await stepKey(page, 2).click();
  expect((await project(page)).panel.pattern).toBe(2);
  expect(await litSteps(page)).toEqual([2]);
  await expect(stepKey(page, 2)).toHaveAttribute('aria-pressed', 'true');

  await expect(page.getByTestId('lamp-group-0')).toHaveAttribute('data-on', 'true');
  await page.getByTestId('panel-group-1').click();
  expect((await project(page)).panel.group).toBe('b');
  await expect(page.getByTestId('lamp-group-1')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('lamp-group-0')).toHaveAttribute('data-on', 'false');
  await expect(stepKey(page, 2)).toHaveAccessibleName('Pattern B3, selected');
});

test('keys C and D say they have no group here, and still choose a track with SHIFT', async ({ page }) => {
  const c = page.getByTestId('panel-group-2');
  await expect(c).toBeDisabled();
  await expect(c).toHaveAccessibleName('Pattern group C is not in this machine. With Shift, track III');
  await page.getByTestId('panel-shift').click();
  await expect(c).toBeEnabled();
  await expect(c).toHaveAccessibleName('Track III');
  // While SHIFT is down the four lamps show the track.
  await expect(page.getByTestId('lamp-group-0')).toHaveAttribute('data-on', 'true');
  await c.click();
  expect((await project(page)).panel.track).toBe(2);
  await expect(page.getByTestId('panel-shift')).toHaveAttribute('aria-pressed', 'false');
});

test('SHIFT and PATTERN write a pattern by step: the step keys are steps of the chosen instrument', async ({ page }) => {
  const before = await project(page);
  await setMode(page, 'pattern_step');
  await expect(page.getByRole('group', { name: 'Bass Drum 1 steps' })).toBeVisible();
  expect(await litSteps(page)).toEqual(stepsOn(before, 'bass_drum'));
  await expect(stepKey(page, 0)).toHaveAccessibleName('Bass Drum 1, step 1, on');
  await expect(stepKey(page, 1)).toHaveAccessibleName('Bass Drum 1, step 2, off');

  await stepKey(page, 2).click();
  await stepKey(page, 0).click();
  await expect(stepKey(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await expect(stepKey(page, 0)).toHaveAttribute('aria-pressed', 'false');
  const after = await project(page);
  expect(stepsOn(after, 'bass_drum')).toEqual([2, 4, 8, 12]);
  for (const row of ROW_IDS.filter((id) => id !== 'bass_drum')) expect(stepsOn(after, row)).toEqual(stepsOn(before, row));
  // Only A1 changed.
  expect(after.groups.a.slice(1)).toEqual(before.groups.a.slice(1));
  expect(after.groups.b).toEqual(before.groups.b);
  await expect(page.getByTestId('panel-display')).toHaveAccessibleName(/Writing Bass Drum 1\. .*Bass Drum 1 on 3, 5, 9, 13\./);
});

test('INSTRUMENT and a step key choose what is written, and which of two sounds a row plays', async ({ page }) => {
  await setMode(page, 'pattern_step');
  const instrument = functionKey(page, 'instrument');
  await expect(instrument).toHaveAccessibleName('Instrument: Bass Drum 1. Then a step key chooses another');
  await instrument.click();
  await expect(instrument).toHaveAttribute('aria-pressed', 'true');
  // With INSTRUMENT down the lamp of the chosen sound's key is lit, and the keys say what they choose.
  expect(await litSteps(page)).toEqual([0]);
  await expect(stepKey(page, 3)).toHaveAccessibleName('Choose Snare Drum 2');
  await expect(stepKey(page, 12)).toHaveAccessibleName('Choose Closed Hi-Hat');
  await stepKey(page, 3).click();
  await expect(instrument).toHaveAttribute('aria-pressed', 'false');
  let snapshot = await project(page);
  expect(snapshot.panel.row).toBe('snare_drum');
  expect(snapshot.sounds.snare_drum).toBe('snare_drum_2');
  expect(await litSteps(page)).toEqual(stepsOn(snapshot, 'snare_drum'));
  await expect(stepKey(page, 4)).toHaveAccessibleName('Snare Drum 2, step 5, on');
  await expect(page.getByTestId('panel-display')).toHaveAccessibleName(/Snare Drum 2 on 5, 13\./);

  await chooseInstrument(page, 8);
  snapshot = await project(page);
  expect(snapshot.panel.row).toBe('rim_cowbell');
  expect(snapshot.sounds.rim_cowbell).toBe('cowbell');
  await stepKey(page, 6).click();
  expect(stepsOn(await project(page), 'rim_cowbell')).toEqual([6]);
  // A sound is a switch: undo takes the step back and leaves the cowbell.
  await page.keyboard.press('Control+z');
  snapshot = await project(page);
  expect(stepsOn(snapshot, 'rim_cowbell')).toEqual([]);
  expect(snapshot.sounds.rim_cowbell).toBe('cowbell');
});

test('INSTRUMENT and ENTER give the step keys the accent, which makes no sound', async ({ page }) => {
  await setMode(page, 'pattern_step');
  const enter = page.getByTestId('panel-enter');
  await expect(enter).toBeDisabled();
  await functionKey(page, 'instrument').click();
  await expect(enter).toHaveAccessibleName('Accent: give the step keys the accent row');
  await enter.click();
  expect((await project(page)).panel.row).toBe('accent');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-audio', 'idle');
  const hits = hitCount(await project(page));
  await stepKey(page, 2).click();
  const after = await project(page);
  expect(stepsOn(after, 'accent')).toEqual([0, 2, 4, 8, 12]);
  // An accent is not a hit.
  expect(hitCount(after)).toBe(hits);
});

test('LAST STEP, SCALE and SHUFFLE set how a pattern runs', async ({ page }) => {
  await setMode(page, 'pattern_step');
  const last = functionKey(page, 'last_step');
  await expect(last).toHaveAccessibleName('Last step: 16. Then a step key sets it');
  await last.click();
  expect(await litSteps(page)).toEqual([15]);
  await expect(stepKey(page, 11)).toHaveAccessibleName('Make step 12 the last step');
  await stepKey(page, 11).click();
  expect((await project(page)).groups.a[0]!.lastStep).toBe(12);
  await expect(last).toHaveAttribute('aria-pressed', 'false');
  await expect(last).toHaveAccessibleName('Last step: 12. Then a step key sets it');

  // The chart's lamps show the scale; SCALE steps down the chart and round.
  const scale = functionKey(page, 'scale');
  await expect(page.getByTestId('lamp-scale-4')).toHaveAttribute('data-on', 'true');
  await scale.click();
  await expect(page.getByTestId('lamp-scale-6')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('lamp-scale-4')).toHaveAttribute('data-on', 'false');
  await scale.click();
  expect((await project(page)).groups.a[0]!.scale).toBe(3);
  await expect(scale).toHaveAccessibleName('Scale: eighth-note triplets. Press for the next');
  await expect(page.getByTestId('panel-display')).toHaveAccessibleName(/12 steps of eighth-note triplets\./);

  const shuffle = functionKey(page, 'shuffle');
  await shuffle.click();
  expect(await litSteps(page)).toEqual([0]);
  await expect(stepKey(page, 0)).toHaveAccessibleName('Shuffle off');
  await stepKey(page, 3).click();
  expect((await project(page)).shuffle).toBe(3);
  await expect(shuffle).toHaveAccessibleName('Shuffle: 3. Then step key 1 to 5 sets it');
  // A step key past the fifth sets nothing, and lets SHUFFLE up.
  await shuffle.click();
  await stepKey(page, 9).click();
  expect((await project(page)).shuffle).toBe(3);
  await expect(shuffle).toHaveAttribute('aria-pressed', 'false');

  // The last step and the scale are remembered and undone; the shuffle is a setting.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  const undone = await project(page);
  expect(undone.groups.a[0]).toMatchObject({ lastStep: 16, scale: 4 });
  expect(undone.shuffle).toBe(3);
});

test('CLEAR and a step key clear a pattern; SHIFT, COPY and a step key copy one', async ({ page }) => {
  const before = await project(page);
  await setMode(page, 'pattern_step');
  await page.getByTestId('panel-shift').click();
  await expect(stepKey(page, 10)).toHaveAccessibleName('Copy this pattern');
  await stepKey(page, 10).click();
  await expect(stepKey(page, 9)).toHaveAccessibleName('Copy this pattern to A10');
  await expect(stepLamp(page, 0)).toHaveAttribute('data-flash', 'true');
  await stepKey(page, 9).click();
  let snapshot = await project(page);
  expect(snapshot.groups.a[9]).toEqual(before.groups.a[0]);
  expect(snapshot.panel.pattern).toBe(0);

  const clear = functionKey(page, 'clear');
  await clear.click();
  await expect(clear).toHaveAttribute('aria-pressed', 'true');
  await expect(stepKey(page, 9)).toHaveAccessibleName('Clear pattern A10');
  await stepKey(page, 9).click();
  snapshot = await project(page);
  expect(hitCount(snapshot, 9)).toBe(0);
  expect(snapshot.groups.a[0]).toEqual(before.groups.a[0]);
  await page.keyboard.press('Control+z');
  expect((await project(page)).groups.a[9]).toEqual(before.groups.a[0]);

  // Outside the write modes the keys that change a pattern have nothing to do.
  await setMode(page, 'pattern_play');
  await expect(clear).toBeDisabled();
  await expect(functionKey(page, 'scale')).toBeDisabled();
  await expect(functionKey(page, 'last_step')).toBeDisabled();
  await expect(functionKey(page, 'instrument')).toBeDisabled();
});

test('a fader follows the pointer, and each one sets what it is lettered for', async ({ page }) => {
  const fader = page.getByTestId('panel-fader-bass_drum');
  const cap = fader.locator('.sb-707-fader-cap');
  const box = (await fader.boundingBox())!;
  const start = (await cap.boundingBox())!;
  const grab = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  // Dragged to the bottom of its slot and beyond, it stops at nothing.
  await page.mouse.move(grab.x, box.y + box.height + 40, { steps: 6 });
  expect((await project(page)).mix.levels.bass_drum).toBe(0);
  // Back to where it was grabbed, it is where it was; dragged up by a quarter of its travel, a quarter more.
  await page.mouse.move(grab.x, grab.y, { steps: 6 });
  expect((await project(page)).mix.levels.bass_drum).toBeCloseTo(0.75, 1);
  const travel = box.height * (164 / 220);
  await page.mouse.move(grab.x, grab.y - travel / 4, { steps: 6 });
  await page.mouse.up();
  expect((await project(page)).mix.levels.bass_drum).toBeCloseTo(1, 5);
  // The cap is where the level says, under the pointer, once it has slid there.
  await expect
    .poll(async () => {
      const moved = (await cap.boundingBox())!;
      return Math.abs(moved.y + moved.height / 2 - (grab.y - travel / 4));
    })
    .toBeLessThan(2);

  const set = async (id: string, key: string) => {
    await page.getByTestId(`panel-fader-${id}`).focus();
    await page.keyboard.press(key);
  };
  await set('accent', 'Home');
  await set('volume', 'End');
  await set('hi_hat', 'Home');
  await set('ride', 'PageDown');
  const { mix } = await project(page);
  expect(mix).toMatchObject({ accent: 0, volume: 1 });
  expect(mix.levels).toMatchObject({ hi_hat: 0, ride: 0.55, snare_drum: 0.75 });
  await expect(page.getByTestId('panel-fader-accent')).toHaveAccessibleName('Accent');
  await expect(page.getByTestId('panel-fader-volume')).toHaveAccessibleName('Volume');
  await expect(page.getByTestId('panel-fader-hi_hat')).toHaveAccessibleName('Hi-Hat level');
  // A fader is not something to undo.
  await page.keyboard.press('Control+z');
  expect((await project(page)).mix).toEqual(mix);
});

test('the tempo knob turns from 40 to 240, and TEMPO/MEAS changes what the display counts', async ({ page }) => {
  const tempo = page.getByTestId('panel-tempo');
  await expect(tempo).toHaveAttribute('aria-valuetext', '120 beats per minute');
  await tempo.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('PageUp');
  expect((await project(page)).tempo).toBe(131);
  await page.keyboard.press('End');
  expect((await project(page)).tempo).toBe(240);
  await page.keyboard.press('Home');
  expect((await project(page)).tempo).toBe(40);
  await expect(page.getByTestId('panel-display')).toHaveAccessibleName(/Tempo 40\./);
  // Dragged upwards it goes faster.
  const box = (await tempo.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 60, { steps: 5 });
  await page.mouse.up();
  expect((await project(page)).tempo).toBe(100);

  const readout = functionKey(page, 'tempo_measure');
  await expect(readout).toHaveAccessibleName('Tempo or measure: the display shows the tempo. Press for the other');
  await readout.click();
  expect((await project(page)).panel.readout).toBe('measure');
  await readout.click();
  expect((await project(page)).panel.readout).toBe('tempo');
});

test('controls that slide show up and down arrows, and keys a hand', async ({ page }) => {
  const cursor = (testId: string) => page.getByTestId(testId).evaluate((node) => getComputedStyle(node).cursor);
  for (const id of ['panel-tempo', 'panel-fader-accent', 'panel-fader-ride', 'panel-fader-volume']) {
    expect(await cursor(id), id).toBe('ns-resize');
  }
  for (const id of ['panel-power', 'panel-start', 'panel-stop', 'panel-shift', 'panel-key-shuffle', 'panel-key-track', 'panel-group-0']) {
    expect(await cursor(id), id).toBe('pointer');
  }
  expect(await stepKey(page, 0).evaluate((node) => getComputedStyle(node).cursor)).toBe('pointer');
  // A key with nothing to do in this mode says so.
  expect(await cursor('panel-key-clear')).toBe('not-allowed');
});
