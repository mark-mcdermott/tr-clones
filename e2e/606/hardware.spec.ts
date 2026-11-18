import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  TRACK_IDS,
  bankIndex,
  debug,
  hitCount,
  importChanged,
  litKeys,
  openEditor,
  patternWatcher,
  project,
  run,
  selectTrack,
  setMode,
  stepKey,
  stepLamp,
  stepsOn,
  stop,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

/** The middle of a step key, in page pixels. */
async function middleOf(page: Page, key: number): Promise<{ x: number; y: number }> {
  const box = (await stepKey(page, key).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height * 0.6 };
}

test('the faceplate is the drawing made for this machine, with every control on it', async ({ page }) => {
  const manifest = (await (await page.request.get('/boombapbot-assets.json')).json()) as { machine: string; faceplate: string | null };
  expect(manifest).toMatchObject({ machine: '606', faceplate: 'faceplates/606.svg' });
  const panel = page.getByTestId('panel');
  await expect(panel).toHaveAttribute('data-photo', 'photo');
  await expect(page.getByTestId('hardware')).toHaveAccessibleName('606 drum machine');
  // A drawing of our own needs no credit line.
  await expect(page.getByTestId('panel-credit')).toHaveCount(0);
  await expect(panel.locator('[data-panel-step]')).toHaveCount(16);
  await expect(panel.locator('[data-panel-lamp]')).toHaveCount(16);
  await expect(panel.locator('[data-testid^="panel-level-"]')).toHaveCount(6);
  await expect(panel.locator('[data-testid^="panel-voice-"]')).toHaveCount(8);
  await expect(panel.locator('[data-testid^="panel-mode-"]')).toHaveCount(4);
  for (const id of ['panel-tempo', 'panel-volume', 'panel-power', 'panel-scale', 'panel-toggle', 'panel-clear', 'panel-function', 'panel-tap', 'panel-group']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  // The drawing is lettered with the model number, and is the one the page shows.
  const svg = await (await page.request.get('/faceplates/606.svg')).text();
  expect(svg).toContain('<title>606 panel</title>');
  await expect(panel.locator('img.sb-panel-photo')).toHaveAttribute('src', /faceplates\/606\.svg$/);
});

test('without its drawing the panel is drawn plainly and still works', async ({ page }) => {
  await page.route('**/faceplates/**', (route) => route.abort());
  await page.reload();
  const panel = page.getByTestId('panel');
  await expect(panel).toHaveAttribute('data-photo', 'drawn');
  await expect(panel.getByText('Drawn stand-in')).toBeVisible();
  await expect(stepKey(page, 3)).toHaveText('4');
  await stepKey(page, 3).click();
  expect((await project(page)).panel.pattern).toBe(3);
  // Its lettering is text now, and has to be readable as text.
  const results = await new AxeBuilder({ page }).include('[data-testid="hardware"]').analyze();
  expect(results.violations.map((violation) => [violation.id, violation.nodes.map((node) => node.target.join(' '))])).toEqual([]);
});

test('stopped, the step keys choose a pattern, and the one that will play flashes', async ({ page }) => {
  // A new machine waits in pattern write on pattern 1 of group I.
  await expect(page.getByTestId('panel-mode-pattern_write')).toHaveAttribute('aria-checked', 'true');
  expect(await litKeys(page)).toEqual([0]);
  await expect(stepLamp(page, 0)).toHaveAttribute('data-flash', 'true');
  await expect(stepKey(page, 0)).toHaveAccessibleName('Pattern 1, selected');
  const before = await project(page);

  await stepKey(page, 4).click();
  expect((await project(page)).panel).toMatchObject({ pattern: 4, chainEnd: 4 });
  expect(await litKeys(page)).toEqual([4]);
  await expect(stepKey(page, 4)).toHaveAttribute('aria-pressed', 'true');

  // Choosing a pattern writes nothing, and is nothing to undo.
  expect((await project(page)).patterns).toEqual(before.patterns);
  await page.keyboard.press('Control+z');
  expect((await project(page)).panel.pattern).toBe(4);
});

test('two step keys together chain the patterns between them', async ({ page }) => {
  // Shift is the second hand.
  await stepKey(page, 4).click();
  await stepKey(page, 6).click({ modifiers: ['Shift'] });
  expect((await project(page)).panel).toMatchObject({ pattern: 4, chainEnd: 6 });
  expect(await litKeys(page)).toEqual([4, 5, 6]);
  await expect(stepLamp(page, 4)).toHaveAttribute('data-flash', 'true');
  await expect(stepLamp(page, 5)).not.toHaveAttribute('data-flash', 'true');

  // Pressing one key and letting go over another does the same, in either direction.
  const from = await middleOf(page, 11);
  const to = await middleOf(page, 8);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, to.y, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  expect((await project(page)).panel).toMatchObject({ pattern: 8, chainEnd: 11 });
  expect(await litKeys(page)).toEqual([8, 9, 10, 11]);

  // A chain stays inside its block of four: across two blocks the second key is the pattern.
  await stepKey(page, 12).click({ modifiers: ['Shift'] });
  expect((await project(page)).panel).toMatchObject({ pattern: 12, chainEnd: 12 });
  // One key by itself lets a chain go.
  await stepKey(page, 0).click();
  await stepKey(page, 3).click({ modifiers: ['Shift'] });
  await stepKey(page, 1).click();
  expect((await project(page)).panel).toMatchObject({ pattern: 1, chainEnd: 1 });
});

test('while a pattern runs in pattern write, the step keys write the selected instrument', async ({ page }) => {
  const before = await project(page);
  // Pattern 16 is one the starter leaves empty.
  await stepKey(page, 15).click();
  expect(hitCount(before, 15)).toBe(0);
  await run(page);
  await expect(page.getByTestId('lamp-run')).toHaveAttribute('data-on', 'true');
  await expect(stepKey(page, 0)).toHaveAccessibleName('Bass Drum, step 1, off');

  await stepKey(page, 0).click();
  await stepKey(page, 6).click();
  await expect(stepKey(page, 0)).toHaveAccessibleName('Bass Drum, step 1, on');
  await expect(stepLamp(page, 6)).toHaveAttribute('data-on', 'true');
  await selectTrack(page, 'snare');
  await expect(stepLamp(page, 6)).toHaveAttribute('data-on', 'false');
  await stepKey(page, 4).click();
  await stepKey(page, 12).click();
  await stepKey(page, 12).click();
  await selectTrack(page, 'accent');
  await stepKey(page, 0).click();

  const after = await project(page);
  expect(stepsOn(after, 'kick', 15)).toEqual([0, 6]);
  expect(stepsOn(after, 'snare', 15)).toEqual([4]);
  expect(stepsOn(after, 'accent', 15)).toEqual([0]);
  // The selection did not move, and no other pattern changed.
  expect(after.panel).toMatchObject({ pattern: 15, chainEnd: 15 });
  expect(after.patterns[0]!.slice(0, 15)).toEqual(before.patterns[0]!.slice(0, 15));
  expect(after.patterns[1]).toEqual(before.patterns[1]);

  // The lamp of the step sounding runs along the keys.
  await expect.poll(() => page.getByTestId('panel').locator('[data-panel-lamp][data-now="true"]').count()).toBe(1);
  await stop(page);
  await expect(page.getByTestId('lamp-run')).toHaveAttribute('data-on', 'false');
  // Stopped, the keys are patterns again.
  await expect(stepKey(page, 15)).toHaveAccessibleName('Pattern 16, selected');

  // Offline the same pattern plays those hits, with the bass drum accented on the first step.
  const render = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  expect(render.events.map((event) => [event.step, event.track, event.accent])).toEqual([[0, 1, true], [4, 2, false], [6, 1, false]]);
  expect(render.events.every((event) => event.pattern === bankIndex(15))).toBe(true);
});

test('FUNCTION stores the scale the switch stands on, and the next step key is the last step', async ({ page }) => {
  await stepKey(page, 15).click();
  const scale = page.getByTestId('panel-scale');
  await expect(scale).toHaveAttribute('aria-valuetext', 'Scale 1: four steps to the beat');
  // Pressed where 3 is lettered: the second position from the top.
  const box = (await scale.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.375);
  await expect(scale).toHaveAttribute('aria-valuetext', 'Scale 3: three steps to the beat');
  expect((await project(page)).panel.scale).toBe(3);
  expect((await project(page)).patterns[0]![15]).toMatchObject({ scale: 1, lastStep: 16 });

  const fn = page.getByTestId('panel-function');
  await fn.click();
  await expect(fn).toHaveAttribute('aria-pressed', 'true');
  expect((await project(page)).patterns[0]![15]).toMatchObject({ scale: 3, lastStep: 16 });
  // With FUNCTION down the lamps are the quarter notes, and the last step flashes.
  expect(await litKeys(page)).toEqual([0, 3, 6, 9, 12, 15]);
  await expect(stepLamp(page, 15)).toHaveAttribute('data-flash', 'true');
  await expect(stepKey(page, 11)).toHaveAccessibleName('Make step 12 the last step');

  await stepKey(page, 11).click();
  await expect(fn).toHaveAttribute('aria-pressed', 'false');
  expect((await project(page)).patterns[0]![15]).toMatchObject({ scale: 3, lastStep: 12 });
  expect((await project(page)).panel.pattern).toBe(15);

  // Twelve steps at three to the beat are four beats.
  const render = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  expect(Math.abs(render.frames - (44100 * 240) / (await project(page)).tempo)).toBeLessThanOrEqual(1);

  // Escape lets FUNCTION up without setting anything.
  await fn.click();
  await expect(fn).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(fn).toHaveAttribute('aria-pressed', 'false');
  expect((await project(page)).patterns[0]![15]).toMatchObject({ scale: 3, lastStep: 12 });
});

test('CLEAR, then a step key, clears that pattern', async ({ page }) => {
  const before = await project(page);
  expect(hitCount(before, 1)).toBeGreaterThan(10);
  const clear = page.getByTestId('panel-clear');
  await clear.click();
  await expect(clear).toHaveAttribute('aria-pressed', 'true');
  await expect(stepKey(page, 1)).toHaveAccessibleName('Clear pattern 2');
  await stepKey(page, 1).click();
  await expect(clear).toHaveAttribute('aria-pressed', 'false');

  const after = await project(page);
  expect(hitCount(after, 1)).toBe(0);
  expect(stepsOn(after, 'accent', 1)).toEqual([]);
  expect(after.panel.pattern).toBe(1);
  expect(after.patterns[0]!.filter((_, index) => index !== 1)).toEqual(before.patterns[0]!.filter((_, index) => index !== 1));
  await page.keyboard.press('Control+z');
  expect((await project(page)).patterns).toEqual(before.patterns);

  // While the machine runs there is no clearing a pattern.
  await run(page);
  await expect(clear).toBeDisabled();
});

test('TAP writes the selected instrument where the pattern is, and stopped it plays it', async ({ page }) => {
  await stepKey(page, 15).click();
  await selectTrack(page, 'low_tom');
  const tap = page.getByTestId('panel-tap');
  await expect(tap).toHaveAccessibleName('Tap: write the selected instrument now');
  await tap.click();
  expect(hitCount(await project(page), 15)).toBe(0);
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);

  await run(page);
  await expect.poll(() => page.evaluate(() => window.__boombapbot!.playing().step)).toBeGreaterThanOrEqual(0);
  for (let tapped = 0; tapped < 3; tapped += 1) {
    await tap.click();
    await page.waitForTimeout(260);
  }
  const written = stepsOn(await project(page), 'low_tom', 15);
  expect(written.length).toBeGreaterThanOrEqual(2);
  expect(written.length).toBeLessThanOrEqual(3);
  for (const track of TRACK_IDS.filter((id) => id !== 'low_tom')) expect(stepsOn(await project(page), track, 15)).toEqual([]);
});

test('a chain plays through, pattern after pattern, and goes round', async ({ page }) => {
  await importChanged(page, (seed) => void (seed.panel.mode = 'pattern_play'), { fast: true });
  await stepKey(page, 0).click();
  await stepKey(page, 3).click({ modifiers: ['Shift'] });
  const watch = patternWatcher(page);
  await run(page);
  for (const number of [0, 1, 2, 3, 0, 1]) await watch.until(bankIndex(number));
  // The four lamps of the chain stay lit, and the one playing is the bright one.
  expect(await litKeys(page)).toEqual([0, 1, 2, 3]);
  await expect(page.getByTestId('panel').locator('[data-panel-lamp][data-now="true"]')).toHaveCount(1);

  // Its own first pattern is where the chain already is; another pattern takes over at the bar line.
  await stepKey(page, 0).click();
  expect((await project(page)).panel).toMatchObject({ pattern: 0, chainEnd: 3 });
  await stepKey(page, 4).click();
  expect((await project(page)).panel).toMatchObject({ pattern: 4, chainEnd: 4 });
  await watch.until(bankIndex(4));
  const after = watch.seen.length;
  await page.waitForTimeout(1800);
  await watch.poll();
  expect(watch.seen.slice(after)).toEqual([]);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
});

test('the pattern group button changes groups while the machine is stopped', async ({ page }) => {
  const group = page.getByTestId('panel-group');
  await expect(group).toHaveAccessibleName('Pattern group I. Press for group II.');
  await expect(page.getByTestId('lamp-group-1')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('lamp-group-2')).toHaveAttribute('data-on', 'false');
  await group.click();
  await expect(group).toHaveAccessibleName('Pattern group II. Press for group I.');
  await expect(page.getByTestId('lamp-group-2')).toHaveAttribute('data-on', 'true');
  expect((await project(page)).panel.group).toBe(1);

  // Group II is empty in the starter: what is written there stays there, and plays from there.
  await run(page);
  await expect(group).toBeDisabled();
  await stepKey(page, 2).click();
  await stop(page);
  const written = await project(page);
  expect(stepsOn(written, 'kick', 0, 1)).toEqual([2]);
  expect(stepsOn(written, 'kick', 0, 0)).not.toContain(2);
  const render = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  expect(render.events.map((event) => [event.pattern, event.step])).toEqual([[bankIndex(0, 1), 2]]);
  await group.click();
  expect((await project(page)).panel.group).toBe(0);
});

test('the knobs set the tempo, the levels and the volume', async ({ page }) => {
  const tempo = page.getByTestId('panel-tempo');
  await expect(tempo).toHaveAttribute('aria-valuetext', '126 beats per minute');
  await tempo.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('PageUp');
  await expect(tempo).toHaveAttribute('aria-valuenow', '137');
  await page.keyboard.press('End');
  expect((await project(page)).tempo).toBe(300);
  await page.keyboard.press('Home');
  expect((await project(page)).tempo).toBe(40);

  // Dragging a knob upwards turns it up.
  const toms = page.getByTestId('panel-level-toms');
  const box = (await toms.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 30, { steps: 5 });
  await page.mouse.up();
  const levels = (await project(page)).mix.levels;
  expect(levels.toms).toBeCloseTo(0.9, 5);
  await expect(toms).toHaveAccessibleName('Low and hi tom level');

  for (const id of ['accent', 'bass_drum', 'snare_drum', 'cymbal', 'hi_hat']) {
    await page.getByTestId(`panel-level-${id}`).focus();
    await page.keyboard.press('Home');
  }
  await page.getByTestId('panel-volume').focus();
  await page.keyboard.press('End');
  const after = await project(page);
  expect(after.mix).toEqual({ volume: 1, levels: { accent: 0, bass_drum: 0, snare_drum: 0, toms: levels.toms, cymbal: 0, hi_hat: 0 } });
  // Knobs are not something to undo.
  await page.keyboard.press('Control+z');
  expect((await project(page)).mix).toEqual(after.mix);
  expect((await project(page)).tempo).toBe(40);
});

test('the dials turn to where they are pressed or dragged, and cursors say how a control moves', async ({ page }) => {
  /** A point on a dial's rim, at an angle in degrees clockwise from straight up. */
  const rim = async (testId: string, deg: number) => {
    const box = (await page.getByTestId(testId).boundingBox())!;
    const radius = box.width * 0.4;
    const angle = (deg * Math.PI) / 180;
    return { x: box.x + box.width / 2 + radius * Math.sin(angle), y: box.y + box.height / 2 - radius * Math.cos(angle) };
  };
  // Track play is the second position of the mode selector, up and to the right.
  const play = await rim('panel-dial-mode', 67);
  await page.mouse.click(play.x, play.y);
  expect((await project(page)).panel.mode).toBe('track_play');
  await expect(page.getByTestId('panel-mode-track_play')).toHaveAttribute('aria-checked', 'true');
  // In a track mode the selector chooses a track.
  await expect(page.getByTestId('panel-voice-cymbal')).toHaveAccessibleName('Track 6');

  // Dragged round it ends on pattern write.
  await page.mouse.move(play.x, play.y);
  await page.mouse.down();
  for (const deg of [80, 97, 110, 127]) {
    const point = await rim('panel-dial-mode', deg);
    await page.mouse.move(point.x, point.y);
  }
  await page.mouse.up();
  expect((await project(page)).panel.mode).toBe('pattern_write');
  await expect(page.getByTestId('panel-voice-cymbal')).toHaveAccessibleName('CY, Cymbal');

  // The instrument dial: straight up is between the two toms, right of it the hi tom.
  const hiTom = await rim('panel-dial-voice', 15);
  await page.mouse.click(hiTom.x, hiTom.y);
  expect((await project(page)).panel.selector).toBe(4);
  await expect(page.locator('[data-testid^="panel-voice-"][aria-checked="true"]')).toHaveCount(1);

  const cursor = (testId: string) => page.getByTestId(testId).evaluate((node) => getComputedStyle(node).cursor);
  for (const id of ['panel-tempo', 'panel-volume', 'panel-level-accent', 'panel-level-hi_hat']) expect(await cursor(id), id).toBe('ns-resize');
  for (const id of ['panel-dial-mode', 'panel-dial-voice', 'panel-scale', 'panel-power', 'panel-toggle', 'panel-group', 'panel-tap', 'panel-voice-snare']) {
    expect(await cursor(id), id).toBe('pointer');
  }
});

test('in the play modes the keys that only write are out of use', async ({ page }) => {
  await setMode(page, 'pattern_play');
  for (const id of ['panel-function', 'panel-clear', 'panel-tap']) await expect(page.getByTestId(id)).toBeDisabled();
  await setMode(page, 'track_play');
  for (const id of ['panel-function', 'panel-clear', 'panel-tap']) await expect(page.getByTestId(id)).toBeDisabled();
  await setMode(page, 'track_write');
  for (const id of ['panel-function', 'panel-clear', 'panel-tap']) await expect(page.getByTestId(id)).toBeEnabled();
  await expect(page.getByTestId('panel-tap')).toHaveAccessibleName('Write/next: write the chosen pattern into this bar and move on a bar');
  await expect(page.getByTestId('panel-clear')).toHaveAccessibleName('Bar reset: back to the first bar');
});
