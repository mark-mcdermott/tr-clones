import { expect, test } from '@playwright/test';
import {
  EMPTY_PATTERN,
  debug,
  importChanged,
  key,
  openEditor,
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

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('the faceplate is the drawing, with every live control on it', async ({ page }) => {
  const manifest = (await (await page.request.get('/boombapbot-assets.json')).json()) as { machine: string; faceplate: string };
  expect(manifest).toMatchObject({ machine: '909', faceplate: 'faceplates/909.svg' });
  const panel = page.getByTestId('panel');
  await expect(panel).toHaveAttribute('data-photo', 'photo');
  await expect(panel.locator('.sb-panel-photo')).toHaveJSProperty('complete', true);
  expect(await panel.locator('.sb-panel-photo').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  // It is our own drawing, so there is nobody to credit.
  await expect(page.getByTestId('panel-credit')).toHaveCount(0);
  await expect(page.getByTestId('hardware')).toHaveAccessibleName('909 panel drum machine');

  await expect(panel.locator('[data-panel-step]')).toHaveCount(16);
  await expect(panel.locator('[data-panel-lamp]')).toHaveCount(16);
  await expect(panel.locator('[data-testid^="panel-knob-"]')).toHaveCount(28);
  await expect(panel.locator('[data-testid^="panel-track-"]:not([data-testid$="-lamp"])')).toHaveCount(4);
  await expect(panel.locator('[data-testid^="panel-group-"]:not([data-testid$="-lamp"])')).toHaveCount(2);
  for (const name of ['tempo', 'back', 'forward', 'available', 'cycle', 'last-step', 'scale', 'shuffle', 'clear', 'instrument', 'shift']) {
    await expect(key(page, name)).toHaveCount(1);
  }
  await expect(page.getByTestId('panel-start')).toHaveAccessibleName('Start');
  await expect(page.getByTestId('panel-stop')).toHaveAccessibleName('Stop');
});

test('opens in pattern play on pattern 1 of group 1, and its lamps say so', async ({ page }) => {
  expect((await project(page)).panel).toMatchObject({ mode: 'pattern_play', group: 0, pattern: 0, chain: 0 });
  await expect(page.getByTestId('panel-group-0')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('panel-group-0-lamp')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('panel-group-1-lamp')).toHaveAttribute('data-on', 'false');
  for (let index = 0; index < 4; index += 1) {
    await expect(page.getByTestId(`panel-track-${index}-lamp`)).toHaveAttribute('data-on', 'false');
  }
  await expect(stepKey(page, 0)).toHaveAccessibleName('Pattern 1, selected');
  await expect(stepLamp(page, 0)).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('panel').locator('[data-panel-lamp][data-on="true"]')).toHaveCount(1);
  // The chart shows the pattern's scale: four steps to the beat.
  await expect(page.getByTestId('lamp-scale-4')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('panel-status')).toHaveText('Pattern play, group 1: pattern 1');
});

test('in pattern play a step key chooses a pattern, and SHIFT with another makes a chain', async ({ page }) => {
  const before = await project(page);
  await stepKey(page, 2).click();
  expect((await project(page)).panel).toMatchObject({ pattern: 2, chain: 2 });
  await expect(stepKey(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await expect(stepKey(page, 0)).toHaveAccessibleName('Pattern 1');

  await key(page, 'shift').click();
  await expect(page.getByTestId('panel-key-shift-lamp')).toHaveAttribute('data-on', 'true');
  await expect(stepKey(page, 5)).toHaveAccessibleName('Chain patterns 3 to 6');
  await stepKey(page, 5).click();
  expect((await project(page)).panel).toMatchObject({ pattern: 2, chain: 5 });
  await expect(page.getByTestId('panel-key-shift-lamp')).toHaveAttribute('data-on', 'false');
  for (let index = 0; index < 16; index += 1) {
    await expect(stepLamp(page, index)).toHaveAttribute('data-on', String(index >= 2 && index <= 5));
  }
  await expect(stepKey(page, 4)).toHaveAccessibleName('Pattern 5, in the chain');
  await expect(page.getByTestId('panel-status')).toHaveText('Pattern play, group 1: patterns 3 to 6');

  // The other group keeps the chain; a plain key ends it.
  await page.getByTestId('panel-group-1').click();
  expect((await project(page)).panel).toMatchObject({ group: 1, pattern: 2, chain: 5 });
  await stepKey(page, 1).click();
  expect((await project(page)).panel).toMatchObject({ pattern: 1, chain: 1 });
  // Choosing patterns changes nothing the machine remembers.
  expect((await project(page)).patterns).toEqual(before.patterns);
});

test('the TRACK and PATTERN keys choose the mode, and SHIFT makes it a write mode', async ({ page }) => {
  await expect(page.getByTestId('panel-track-1')).toHaveAccessibleName('Play track 2');
  await page.getByTestId('panel-track-1').click();
  expect((await project(page)).panel).toMatchObject({ mode: 'track_play', track: 1 });
  await expect(page.getByTestId('panel-track-1-lamp')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('panel-track-1-lamp')).not.toHaveAttribute('data-flash', 'true');

  await key(page, 'shift').click();
  await expect(page.getByTestId('panel-track-0')).toHaveAccessibleName('Write track 1');
  await expect(page.getByTestId('panel-group-0')).toHaveAccessibleName('Write patterns of group 1');
  await page.getByTestId('panel-track-0').click();
  expect((await project(page)).panel).toMatchObject({ mode: 'track_write', track: 0 });
  // A write mode flashes its lamp.
  await expect(page.getByTestId('panel-track-0-lamp')).toHaveAttribute('data-flash', 'true');
  await expect(page.getByTestId('panel-track-1-lamp')).toHaveAttribute('data-on', 'false');

  await shifted(page, page.getByTestId('panel-group-1'));
  expect((await project(page)).panel).toMatchObject({ mode: 'pattern_write', group: 1 });
  await expect(page.getByTestId('panel-group-1-lamp')).toHaveAttribute('data-flash', 'true');
  await page.getByTestId('panel-group-0').click();
  expect((await project(page)).panel).toMatchObject({ mode: 'pattern_play', group: 0 });
});

test('the function keys answer only in pattern write', async ({ page }) => {
  for (const name of ['last-step', 'scale', 'shuffle', 'clear', 'instrument', 'back', 'forward', 'tempo', 'available', 'cycle']) {
    await expect(key(page, name), name).toBeDisabled();
  }
  await expect(page.getByTestId('panel-enter')).toBeDisabled();
  await writePattern(page, 0);
  for (const name of ['last-step', 'scale', 'shuffle', 'clear', 'instrument']) await expect(key(page, name), name).toBeEnabled();
  for (const name of ['back', 'forward', 'tempo', 'available', 'cycle']) await expect(key(page, name), name).toBeDisabled();
  // With SHIFT down, TEMPO and BACK are STEP and TAP.
  await key(page, 'shift').click();
  await expect(key(page, 'tempo')).toHaveAccessibleName('Step write');
  await expect(key(page, 'back')).toHaveAccessibleName('Tap write');
  await page.keyboard.press('Escape');
  await expect(key(page, 'shift')).toHaveAttribute('aria-pressed', 'false');
});

test('pattern write: the step keys choose a pattern while stopped and write it while running', async ({ page }) => {
  await writePattern(page, EMPTY_PATTERN);
  await expect(stepKey(page, EMPTY_PATTERN)).toHaveAccessibleName('Pattern 9, selected');
  await expect(page.getByTestId('panel-status')).toContainText('press START to write this one');
  expect((await project(page)).panel).toMatchObject({ mode: 'pattern_write', pattern: EMPTY_PATTERN, instrument: 'bass_drum' });
  await expect(page.getByTestId('panel-key-tempo-lamp')).toHaveAttribute('data-on', 'true');

  await start(page);
  await expect(stepKey(page, 0)).toHaveAccessibleName('Bass Drum, step 1, off');
  await stepKey(page, 0).click();
  await stepKey(page, 4).click();
  await stepKey(page, 10).click();
  await expect(stepKey(page, 4)).toHaveAccessibleName('Bass Drum, step 5, on');
  await expect(stepLamp(page, 4)).toHaveAttribute('data-on', 'true');
  await stepKey(page, 10).click();
  const written = await project(page);
  expect(stepsOn(patternOf(written), 'bass_drum')).toEqual([0, 4]);
  expect(written.panel.pattern).toBe(EMPTY_PATTERN);
  await expect(page.getByTestId('panel-status')).toContainText('Bass Drum: 2 steps on');

  // The steps are heard.
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
  // Each press is an undo step.
  await page.keyboard.press('Control+z');
  expect(stepsOn(patternOf(await project(page)), 'bass_drum')).toEqual([0, 4, 10]);
  await page.keyboard.press('Control+z');
  expect(stepsOn(patternOf(await project(page)), 'bass_drum')).toEqual([0, 4]);

  // Stopped again, the keys choose patterns once more.
  await stop(page);
  await stepKey(page, 0).click();
  expect((await project(page)).panel.pattern).toBe(0);
  expect(stepsOn(patternOf(await project(page), EMPTY_PATTERN), 'bass_drum')).toEqual([0, 4]);
});

test('the lamps follow the running step while a pattern is written', async ({ page }) => {
  await writePattern(page, 0);
  const panel = page.getByTestId('panel');
  await expect(panel.locator('[data-panel-lamp][data-now="true"]')).toHaveCount(0);
  await start(page);
  const seen = new Set<string>();
  await expect
    .poll(async () => {
      const now = await panel.evaluate((node) => node.querySelector('[data-panel-lamp][data-now="true"]')?.getAttribute('data-panel-lamp'));
      if (now) seen.add(now);
      return seen.size;
    }, { intervals: [15] })
    .toBeGreaterThanOrEqual(4);
  const kick = stepsOn(patternOf(await project(page)), 'bass_drum');
  for (const index of [0, 1, 4, 5]) {
    await expect(stepLamp(page, index)).toHaveAttribute('data-on', String(kick.includes(index)));
  }
  await stop(page);
  await expect(panel.locator('[data-panel-lamp][data-now="true"]')).toHaveCount(0);
});

test('INSTRUMENT SELECT and a step key choose the row the keys write', async ({ page }) => {
  await writePattern(page, 0);
  await key(page, 'instrument').click();
  await expect(page.getByTestId('panel-key-instrument-lamp')).toHaveAttribute('data-on', 'true');
  // The selected instrument's keys are lit: the bass drum is the first pair.
  await expect(stepLamp(page, 0)).toHaveAttribute('data-on', 'true');
  await expect(stepLamp(page, 1)).toHaveAttribute('data-on', 'true');
  await expect(stepLamp(page, 2)).toHaveAttribute('data-on', 'false');
  await expect(stepKey(page, 13)).toHaveAccessibleName('Select Open Hi-Hat');
  await expect(page.getByTestId('panel-enter')).toHaveAccessibleName('Select the total accent');
  await stepKey(page, 13).click();
  expect((await project(page)).panel).toMatchObject({ instrument: 'open_hat', pattern: 0 });
  await expect(page.getByTestId('panel-key-instrument-lamp')).toHaveAttribute('data-on', 'false');
  // Choosing an instrument sounds it, without starting the machine.
  await expect(page.getByTestId('editor')).toHaveAttribute('data-audio', 'running');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.02);

  await start(page);
  const open = stepsOn(patternOf(await project(page)), 'open_hat');
  for (const index of [2, 3]) await expect(stepLamp(page, index)).toHaveAttribute('data-on', String(open.includes(index)));
  await expect(stepKey(page, 2)).toHaveAccessibleName('Open Hi-Hat, step 3, on');

  // The total accent is chosen with the ENTER key, and is a row like any other.
  await key(page, 'instrument').click();
  await page.getByTestId('panel-enter').click();
  expect((await project(page)).panel.instrument).toBe('accent');
  await expect(page.getByTestId('panel-enter-lamp')).toHaveAttribute('data-on', 'true');
  expect(stepsOn(patternOf(await project(page)), 'accent')).toEqual([0, 4, 8, 12]);
  await stepKey(page, 2).click();
  expect(stepsOn(patternOf(await project(page)), 'accent')).toEqual([0, 2, 4, 8, 12]);
  await expect(stepKey(page, 2)).toHaveAccessibleName('Total Accent, step 3, on');
});

test('LAST STEP, SHUFFLE and SCALE shape the pattern', async ({ page }) => {
  await writePattern(page, EMPTY_PATTERN);
  await key(page, 'last-step').click();
  await expect(stepLamp(page, 15)).toHaveAttribute('data-on', 'true');
  await expect(stepKey(page, 11)).toHaveAccessibleName('Make step 12 the last step');
  await stepKey(page, 11).click();
  expect(patternOf(await project(page)).lastStep).toBe(12);
  await expect(key(page, 'last-step')).toHaveAttribute('aria-pressed', 'false');
  // The pattern is still the one selected: the key set its length.
  expect((await project(page)).panel.pattern).toBe(EMPTY_PATTERN);

  await key(page, 'shuffle').click();
  await expect(stepLamp(page, 0)).toHaveAttribute('data-on', 'true');
  await expect(stepKey(page, 0)).toHaveAccessibleName('No shuffle, selected');
  await expect(stepKey(page, 4)).toHaveAccessibleName('Shuffle 4');
  // Only the first seven keys are shuffle settings.
  await expect(stepKey(page, 9)).toBeDisabled();
  await stepKey(page, 4).click();
  expect(patternOf(await project(page)).shuffle).toBe(4);

  await expect(key(page, 'scale')).toHaveAccessibleName('Scale: 4 steps to the beat');
  await key(page, 'scale').click();
  expect(patternOf(await project(page)).scale).toBe(1);
  await expect(key(page, 'scale')).toHaveAccessibleName('Scale: 6 steps to the beat');
  await expect(page.getByTestId('lamp-scale-1')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('lamp-scale-4')).toHaveAttribute('data-on', 'false');
  await key(page, 'scale').click();
  await expect(page.getByTestId('lamp-scale-2')).toHaveAttribute('data-on', 'true');

  // Twelve steps of three to the beat: the measure is four beats, as the render shows.
  const render = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  const { tempo } = await project(page);
  expect(Math.abs(render.frames - (44100 * 240) / tempo)).toBeLessThanOrEqual(1);

  // Each was one undo step.
  for (let undo = 0; undo < 4; undo += 1) await page.keyboard.press('Control+z');
  expect(patternOf(await project(page))).toMatchObject({ scale: 4, lastStep: 16, shuffle: 0 });
});

test('CLEAR and a key clear a pattern while stopped, and an instrument while running', async ({ page }) => {
  await writePattern(page, 0);
  expect(stepsOn(patternOf(await project(page), 1), 'bass_drum').length).toBeGreaterThan(0);
  await expect(key(page, 'clear')).toHaveAccessibleName('Clear: then press the key of a pattern');
  await key(page, 'clear').click();
  await expect(stepKey(page, 1)).toHaveAccessibleName('Clear pattern 2');
  await stepKey(page, 1).click();
  const cleared = patternOf(await project(page), 1);
  expect(Object.values(cleared.steps).every((row) => row === '................')).toBe(true);
  await page.keyboard.press('Control+z');
  expect(stepsOn(patternOf(await project(page), 1), 'bass_drum').length).toBeGreaterThan(0);

  await start(page);
  const before = patternOf(await project(page));
  await key(page, 'clear').click();
  await expect(stepKey(page, 12)).toHaveAccessibleName('Clear Closed Hi-Hat from the pattern');
  await stepKey(page, 12).click();
  const after = patternOf(await project(page));
  expect(stepsOn(after, 'closed_hat')).toEqual([]);
  expect(stepsOn(after, 'open_hat')).toEqual(stepsOn(before, 'open_hat'));
  expect(stepsOn(after, 'bass_drum')).toEqual(stepsOn(before, 'bass_drum'));
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
});

test('tap write records what is tapped, in time, as one undo step', async ({ page }) => {
  // Slow, so a tap falls well inside a step.
  await importChanged(page, (next) => {
    next.tempo = 40;
  });
  await writePattern(page, EMPTY_PATTERN);
  await shifted(page, key(page, 'back'));
  expect((await project(page)).panel.write).toBe('tap');
  await expect(page.getByTestId('panel-key-back-lamp')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('panel-key-tempo-lamp')).toHaveAttribute('data-on', 'false');
  await start(page);
  await expect(stepKey(page, 2)).toHaveAccessibleName('Tap Snare Drum');
  await expect(page.getByTestId('panel-enter')).toHaveAccessibleName('Tap a total accent');

  await expect.poll(() => page.evaluate(() => window.__boombapbot!.playing().step)).toBeGreaterThanOrEqual(0);
  await stepKey(page, 2).click();
  await stepKey(page, 15).click();
  await page.getByTestId('panel-enter').click();
  await expect.poll(async () => stepsOn(patternOf(await project(page)), 'snare_drum').length).toBe(1);
  await expect.poll(async () => stepsOn(patternOf(await project(page)), 'ride').length).toBe(1);
  // Still on the pattern: the keys were instruments, not patterns or steps.
  expect((await project(page)).panel.pattern).toBe(EMPTY_PATTERN);
  expect(stepsOn(patternOf(await project(page)), 'bass_drum')).toEqual([]);

  await stop(page);
  const taken = patternOf(await project(page));
  expect(stepsOn(taken, 'snare_drum')).toHaveLength(1);
  expect(stepsOn(taken, 'ride')).toHaveLength(1);
  expect(stepsOn(taken, 'accent')).toHaveLength(1);
  // The whole take comes off with one undo.
  await page.keyboard.press('Control+z');
  const undone = patternOf(await project(page));
  expect(Object.values(undone.steps).every((row) => row === '................')).toBe(true);
});

test('the knobs turn with the keyboard and by dragging, and never with the wheel', async ({ page }) => {
  const knob = page.getByTestId('panel-knob-bass_drum_attack');
  await expect(knob).toHaveAccessibleName('Bass Drum attack');
  await expect(knob).toHaveAttribute('aria-valuenow', '50');
  await knob.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('PageUp');
  expect((await project(page)).knobs.bass_drum_attack).toBeCloseTo(0.72, 5);
  await expect(knob).toHaveAttribute('aria-valuetext', '72%');
  await page.keyboard.press('Home');
  expect((await project(page)).knobs.bass_drum_attack).toBe(0);
  await page.keyboard.press('End');
  expect((await project(page)).knobs.bass_drum_attack).toBe(1);

  const level = page.getByTestId('panel-knob-hi_hat_level');
  await expect(level).toHaveAccessibleName('Hi-Hat level');
  const box = (await level.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 4 });
  await page.mouse.up();
  expect((await project(page)).knobs.hi_hat_level).toBeLessThan(0.6);

  const before = await project(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await page.mouse.wheel(0, -300);
  expect((await project(page)).knobs).toEqual(before.knobs);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(0);
  // Every knob of the panel has a name of its own.
  const names = await page.getByTestId('panel').locator('[role="slider"]').evaluateAll((knobs) => knobs.map((node) => node.getAttribute('aria-label')));
  expect(names).toHaveLength(29);
  expect(new Set(names).size).toBe(29);
  expect(names).toEqual(expect.arrayContaining(['Tempo', 'Volume', 'Total accent', 'Snare Drum snappy', 'Closed Hi-Hat decay', 'Ride tune']));
});

test('the tempo knob turns the display, a beat a minute at a time', async ({ page }) => {
  const knob = page.getByTestId('panel-tempo');
  const display = page.getByTestId('panel-display');
  await expect(display).toHaveAttribute('data-value', '125');
  await expect(display).toHaveAccessibleName('Tempo: 125 beats per minute');
  // The digits are drawn: 1, 2 and 5 light two, five and five of their seven segments.
  expect(await display.locator('path[data-on="true"]').count()).toBe(12);
  await knob.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('PageDown');
  expect((await project(page)).tempo).toBe(117);
  await expect(display).toHaveAttribute('data-value', '117');
  await expect(knob).toHaveAttribute('aria-valuetext', '117 beats per minute');
  await page.keyboard.press('Home');
  await expect(display).toHaveAttribute('data-value', '40');
  // A dark digit stands where a hundred would be.
  expect(await display.locator('g').first().locator('path[data-on="true"]').count()).toBe(0);
  await page.keyboard.press('End');
  expect((await project(page)).tempo).toBe(290);
  await expect(display).toHaveAccessibleName('Tempo: 290 beats per minute');
  await expect(page.getByTestId('notice')).toHaveCount(0);
});

test('controls that are pressed show a hand, and knobs up and down arrows', async ({ page }) => {
  const cursor = (testId: string) => page.getByTestId(testId).evaluate((node) => getComputedStyle(node).cursor);
  for (const id of ['panel-tempo', 'panel-knob-volume', 'panel-knob-accent', 'panel-knob-crash_tune']) {
    expect(await cursor(id), id).toBe('ns-resize');
  }
  for (const id of ['panel-power', 'panel-start', 'panel-stop', 'panel-key-shift', 'panel-track-0', 'panel-group-1']) {
    expect(await cursor(id), id).toBe('pointer');
  }
  expect(await stepKey(page, 3).evaluate((node) => getComputedStyle(node).cursor)).toBe('pointer');
});

test('the arrow keys move between the step keys, and Enter presses one', async ({ page }) => {
  await stepKey(page, 0).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(stepKey(page, 2)).toBeFocused();
  await page.keyboard.press('Enter');
  expect((await project(page)).panel.pattern).toBe(2);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(stepKey(page, 15)).toBeFocused();
  // Enter on a key does not start the machine; Space does, from anywhere that is not a control.
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
});

test('a pattern in the other group is written apart from its namesake', async ({ page }) => {
  await writePattern(page, EMPTY_PATTERN, 1);
  await selectInstrument(page, 10);
  await start(page);
  await stepKey(page, 3).click();
  await stop(page);
  const snapshot = await project(page);
  expect(stepsOn(patternOf(snapshot, EMPTY_PATTERN, 1), 'rim_shot')).toEqual([3]);
  expect(stepsOn(patternOf(snapshot, EMPTY_PATTERN, 0), 'rim_shot')).toEqual([]);
});
