import { expect, test } from '@playwright/test';
import {
  DRAFT_KEY,
  TRACK_IDS,
  bpmOf,
  debug,
  faceplate,
  faceplateIsCredited,
  hitCount,
  openEditor,
  openSettings,
  patternWatcher,
  project,
  selectTrack,
  stepButton,
  stepsOn,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('the step buttons write the selected instrument', async ({ page }) => {
  const before = await project(page);
  const panel = page.getByTestId('panel');
  await expect(panel.locator('[data-panel-step]')).toHaveCount(16);
  // The selector starts on the bass drum.
  await expect(page.getByTestId('panel-voice-kick')).toHaveAttribute('aria-checked', 'true');

  await selectTrack(page, 'snare');
  expect(stepsOn(before, 'snare')).toEqual([4, 12]);
  await expect(stepButton(page, 4)).toHaveAttribute('aria-pressed', 'true');
  await expect(stepButton(page, 4)).toHaveAccessibleName('Snare Drum, step 5, on');
  await stepButton(page, 6).click();
  await stepButton(page, 4).click();
  await expect(stepButton(page, 6)).toHaveAttribute('aria-pressed', 'true');
  await expect(stepButton(page, 4)).toHaveAttribute('aria-pressed', 'false');

  const after = await project(page);
  expect(stepsOn(after, 'snare')).toEqual([6, 12]);
  for (const track of TRACK_IDS.filter((id) => id !== 'snare')) {
    expect(stepsOn(after, track)).toEqual(stepsOn(before, track));
  }
  // Only Basic Rhythm 1 changed.
  expect(after.rhythms.slice(1)).toEqual(before.rhythms.slice(1));
  expect(after.rhythms[0]!.b).toEqual(before.rhythms[0]!.b);
});

test('the accent is a track of its own, and makes no sound when selected', async ({ page }) => {
  await selectTrack(page, 'accent');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-audio', 'idle');
  expect(stepsOn(await project(page), 'accent')).toEqual([0, 8]);
  await expect(stepButton(page, 8)).toHaveAttribute('aria-pressed', 'true');
  const hits = hitCount(await project(page));
  await stepButton(page, 4).click();
  const after = await project(page);
  expect(stepsOn(after, 'accent')).toEqual([0, 4, 8]);
  // An accent is not a hit.
  expect(hitCount(after)).toBe(hits);

  // Offline, the same hits fall on the same steps, and the new accent is marked.
  const render = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  expect(render.events).toHaveLength(hits);
  const accented = [...new Set(render.events.filter((event) => event.accent).map((event) => event.step))];
  expect(accented).toEqual([0, 4, 8]);
});

test('the panel runs the transport and sets tempo', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await page.getByTestId('panel-toggle').click();
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await expect(editor).toHaveAttribute('data-audio', 'running');
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
  await page.getByTestId('panel-toggle').click();
  await expect(editor).toHaveAttribute('data-playing', 'false');

  // The tempo knob turns in forty click stops; the fine knob adds up to one
  // stop either way.
  const knob = page.getByTestId('panel-tempo');
  const fine = page.getByTestId('panel-fine');
  const start = (await project(page)).tempo;
  await expect(knob).toHaveAccessibleName('Tempo');
  await expect(knob).toHaveAttribute('aria-valuenow', String(start.coarse));
  await expect(knob).toHaveAttribute('aria-valuemax', '39');
  await knob.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  expect((await project(page)).tempo).toEqual({ coarse: start.coarse + 2, fine: start.fine });
  await expect(knob).toHaveAttribute('aria-valuetext', /beats per minute, stop \d+ of 40$/);

  await fine.focus();
  await page.keyboard.press('End');
  expect((await project(page)).tempo).toEqual({ coarse: start.coarse + 2, fine: 1 });
  expect(bpmOf(await project(page))).toBeCloseTo(40 + ((start.coarse + 3) * 260) / 39, 6);
  await page.keyboard.press('Home');
  expect((await project(page)).tempo.fine).toBe(-1);

  // The machine runs from 40 to 300.
  await knob.focus();
  await page.keyboard.press('End');
  await fine.focus();
  await page.keyboard.press('End');
  expect(bpmOf(await project(page))).toBe(300);
  await knob.focus();
  await page.keyboard.press('Home');
  await fine.focus();
  await page.keyboard.press('Home');
  expect(bpmOf(await project(page))).toBe(40);
  await expect(page.getByTestId('notice')).toHaveCount(0);
});

test('the lamps show the steps that are on and follow the running step', async ({ page }) => {
  const panel = page.getByTestId('panel');
  const lamps = panel.locator('[data-panel-lamp]');
  await expect(lamps).toHaveCount(16);
  const kick = stepsOn(await project(page), 'kick');
  for (let index = 0; index < 16; index += 1) {
    await expect(lamps.nth(index)).toHaveAttribute('data-on', String(kick.includes(index)));
  }
  await expect(panel.locator('[data-panel-lamp][data-now="true"]')).toHaveCount(0);

  await page.getByTestId('panel-toggle').click();
  const seen = new Set<number>();
  await expect
    .poll(
      async () => {
        const now = await lamps.evaluateAll((nodes) =>
          nodes.findIndex((node) => node.getAttribute('data-now') === 'true'),
        );
        if (now >= 0) seen.add(now);
        return seen.size;
      },
      { intervals: [40] },
    )
    .toBeGreaterThanOrEqual(6);
  await page.getByTestId('panel-toggle').click();
  await expect(panel.locator('[data-panel-lamp][data-now="true"]')).toHaveCount(0);
});

test('a sound knob changes its own voice, in exports and while playing', async ({ page }) => {
  const decay = page.getByTestId('panel-knob-kick-decay');
  await expect(decay).toHaveAccessibleName('Bass Drum decay');
  await expect(decay).toHaveAttribute('aria-valuenow', '50');
  const before = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));

  // Keyboard: arrows, pages and the ends of its travel.
  await decay.focus();
  await page.keyboard.press('ArrowUp');
  await expect(decay).toHaveAttribute('aria-valuenow', '52');
  await page.keyboard.press('PageDown');
  await expect(decay).toHaveAttribute('aria-valuenow', '32');
  await page.keyboard.press('End');
  await expect(decay).toHaveAttribute('aria-valuenow', '100');
  await expect(decay).toHaveAttribute('aria-valuetext', '100%');
  expect((await project(page)).sound.knobs.kick!.decay).toBe(1);

  // A longer bass drum puts more energy into the same beat, on the same steps.
  const after = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  expect(after.events).toEqual(before.events);
  expect(after.rms).toBeGreaterThan(before.rms * 1.1);

  // Dragging up turns it clockwise: half a unit per pixel.
  const tone = page.getByTestId('panel-knob-snare-tone');
  const box = (await tone.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 60, { steps: 6 });
  await page.mouse.up();
  await expect(tone).toHaveAttribute('aria-valuenow', '80');

  // While the beat runs, a turned knob sends that one sound to the engine.
  await page.getByTestId('panel-toggle').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-audio', 'running');
  // All sixteen sounds are synthesised and taken when audio starts.
  await expect.poll(async () => (await debug(page)).soundsTaken).toBeGreaterThanOrEqual(16);
  const taken = (await debug(page)).soundsTaken;
  const snappy = page.getByTestId('panel-knob-snare-snappy');
  await snappy.focus();
  for (let press = 0; press < 5; press += 1) await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await debug(page)).soundsTaken).toBeGreaterThan(taken);
  await expect
    .poll(async () => {
      const snapshot = await debug(page);
      return snapshot.soundsSent - snapshot.soundsTaken;
    })
    .toBe(0);
  // Only the snare was sent again, however many presses there were.
  expect((await debug(page)).soundsTaken - taken).toBeLessThanOrEqual(5);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  await expect(page.getByTestId('notice')).toHaveCount(0);
});

test('every knob of every column turns', async ({ page }) => {
  // A level for each of the twelve columns, and ten tone, decay, tuning and snappy knobs.
  const knobs = page.getByTestId('panel').locator('[data-testid^="panel-knob-"]');
  await expect(knobs).toHaveCount(22);
  for (let index = 0; index < 22; index += 1) {
    const knob = knobs.nth(index);
    const [track, param] = (await knob.getAttribute('data-testid'))!.replace('panel-knob-', '').split('-') as [
      string,
      'level' | 'tune' | 'tone' | 'decay' | 'snappy',
    ];
    await knob.focus();
    await page.keyboard.press('Home');
    const { sound } = await project(page);
    const position = track === 'accent' ? sound.accent : param === 'level' ? sound.levels[track] : sound.knobs[track]![param];
    expect(position, `${track} ${param}`).toBe(0);
    await expect(knob).toHaveAttribute('aria-valuenow', '0');
  }
});

test('the level, accent and master volume knobs set the mix', async ({ page }) => {
  const render = () => page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  const turn = async (testId: string, key: string) => {
    await page.getByTestId(testId).focus();
    await page.keyboard.press(key);
  };
  const full = await render();
  await expect(page.getByTestId('panel-knob-kick-level')).toHaveAccessibleName('Bass Drum level');
  await expect(page.getByTestId('panel-knob-accent-level')).toHaveAccessibleName('Accent level');
  await expect(page.getByTestId('panel-master')).toHaveAttribute('aria-valuenow', '75');

  // With the bass drum fully left the rhythm is quieter, on the same steps.
  await turn('panel-knob-kick-level', 'Home');
  const noKick = await render();
  expect(noKick.events).toEqual(full.events);
  expect(noKick.rms).toBeLessThan(full.rms * 0.9);

  // With no accent every hit is as loud as a plain one.
  await turn('panel-knob-accent-level', 'Home');
  const flat = await render();
  expect(flat.rms).toBeLessThan(noKick.rms);

  // Master volume scales everything, and fully left is silence.
  await turn('panel-master', 'End');
  const loud = await render();
  expect(loud.rms).toBeGreaterThan(flat.rms * 1.3);
  expect(loud.peak).toBeLessThanOrEqual(1);
  await turn('panel-master', 'Home');
  const silent = await render();
  expect(silent.peak).toBe(0);
  expect(silent.events).toEqual(full.events);

  // Live, a moved level reaches the engine without stopping the beat or re-synthesising anything.
  await turn('panel-master', 'End');
  await page.getByTestId('panel-toggle').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-audio', 'running');
  await expect.poll(async () => (await debug(page)).soundsTaken).toBe(16);
  await turn('panel-knob-snare-level', 'End');
  await turn('panel-knob-kick-level', 'End');
  await expect.poll(async () => (await debug(page)).stats?.peak ?? 0).toBeGreaterThan(0.05);
  expect((await debug(page)).soundsSent).toBe(16);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
});

test('a voice switch gives its column the alternate sound', async ({ page }) => {
  const render = () => page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  const panel = page.getByTestId('panel');
  await expect(panel.locator('[data-testid^="panel-switch-"]')).toHaveCount(5);
  const conga = page.getByTestId('panel-switch-low_tom');
  await expect(conga).toHaveAccessibleName('Low Conga in place of Low Tom');
  await expect(conga).toHaveAttribute('aria-checked', 'false');
  const lever = panel.locator('.sb-panel-lever').first();
  const down = (await lever.boundingBox())!;
  const before = await render();

  await conga.click();
  await expect(conga).toHaveAttribute('aria-checked', 'true');
  expect((await project(page)).sound.alternates).toEqual({
    low_tom: true,
    mid_tom: false,
    high_tom: false,
    rim_shot: false,
    clap: false,
  });
  // The lever moves up, toward the conga's plate.
  await expect.poll(async () => (await lever.boundingBox())!.y).toBeLessThan(down.y - 5);

  // The column keeps its steps and its knobs; what is on them is now a conga.
  await selectTrack(page, 'low_tom');
  await expect(stepButton(page, 15)).toHaveAccessibleName('Low Conga, step 16, on');
  await expect(page.getByTestId('panel-knob-low_tom-tune')).toHaveAccessibleName('Low Conga tuning');
  const after = await render();
  expect(after.events).toEqual(before.events);
  expect(after.rms).not.toBe(before.rms);

  // The keyboard throws it back.
  await conga.focus();
  await page.keyboard.press('Space');
  await expect(conga).toHaveAttribute('aria-checked', 'false');
  await expect(stepButton(page, 15)).toHaveAccessibleName('Low Tom, step 16, on');
  expect((await render()).rms).toBe(before.rms);
});

test('panel steps can be walked with the arrow keys', async ({ page }) => {
  await stepButton(page, 0).focus();
  await page.keyboard.press('ArrowRight');
  await expect(stepButton(page, 1)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(stepButton(page, 15)).toBeFocused();
  // Enter presses the step under focus.
  const before = stepsOn(await project(page), 'kick').includes(15);
  await page.keyboard.press('Enter');
  expect(stepsOn(await project(page), 'kick').includes(15)).toBe(!before);
});

test('every position of the selector programs its own track', async ({ page }) => {
  const panel = page.getByTestId('panel');
  const positions = panel.locator('[data-testid^="panel-voice-"]');
  await expect(positions).toHaveCount(TRACK_IDS.length);
  for (const track of TRACK_IDS) {
    await selectTrack(page, track);
    const before = await project(page);
    const target = Array.from({ length: 16 }, (_, index) => index).find(
      (index) => !stepsOn(before, track).includes(index),
    )!;
    await stepButton(page, target).click();
    const after = await project(page);
    expect(stepsOn(after, track)).toEqual([...stepsOn(before, track), target].sort((a, b) => a - b));
    for (const other of TRACK_IDS.filter((id) => id !== track)) {
      expect(stepsOn(after, other)).toEqual(stepsOn(before, other));
    }
  }
  expect((await project(page)).panel.selector).toBe(TRACK_IDS.length - 1);
});

test('the machine is its faceplate, with controls that stay inside it', async ({ page }) => {
  const panel = page.getByTestId('panel');
  // The panel is the faceplate image where the build ships one, and is drawn
  // from the same layout where it does not. Both must work.
  const image = await faceplate(page);
  await expect(panel).toHaveAttribute('data-photo', image ? 'photo' : 'drawn');
  if (image) {
    const photo = panel.locator('img.sb-panel-photo');
    await expect(photo).toHaveAttribute('src', new RegExp(`${image}$`));
    await expect
      .poll(() => photo.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0);
    await expect(panel.locator('.sb-knob-photo')).not.toHaveCount(0);
    await expect(panel.locator('.sb-panel-key')).toHaveCount(0);
    // A photograph is shown with its credit. Artwork drawn for boombapbot has
    // nobody to credit.
    await expect(page.getByTestId('panel-credit')).toHaveCount(faceplateIsCredited() ? 1 : 0);
  } else {
    await expect(page.getByTestId('panel-credit')).toHaveCount(0);
    await expect(panel.locator('.sb-panel-key')).toHaveCount(16);
  }

  // Nothing but the faceplate: the touch strip is for phones.
  await expect(page.getByTestId('strip-voice-snare')).toBeHidden();

  // Step areas stay inside the faceplate and do not overlap.
  const boxes = await panel.locator('[data-panel-step]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    }),
  );
  boxes.forEach((box, index) => {
    expect(box.width).toBeGreaterThan(20);
    expect(box.height).toBeGreaterThan(20);
    if (index > 0) expect(box.left).toBeGreaterThanOrEqual(boxes[index - 1]!.right - 0.5);
  });
});

test('a faceplate image that fails to load falls back to the drawn panel', async ({ page }) => {
  const image = await faceplate(page);
  test.skip(!image, 'this build ships no faceplate image');
  // The editor opens on the faceplate, so fail the image on a fresh load.
  await page.route(`**/${image}`, (route) => route.abort());
  await page.reload();
  const panel = page.getByTestId('panel');
  await expect(panel).toHaveAttribute('data-photo', 'drawn');
  await expect(panel.locator('.sb-panel-key')).toHaveCount(16);
  await stepButton(page, 3).click();
  await expect(stepButton(page, 3)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) !== null, DRAFT_KEY)).toBe(true);
});

test('the mode selector turns the step buttons from steps into rhythm choices', async ({ page }) => {
  const panel = page.getByTestId('panel');
  await expect(panel.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio')).toHaveCount(6);
  await expect(page.getByTestId('panel-mode-write_first')).toHaveAttribute('aria-checked', 'true');
  await expect(stepButton(page, 0)).toHaveAccessibleName('Bass Drum, step 1, on');
  await expect(page.getByTestId('lamp-first-part')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('lamp-second-part')).toHaveAttribute('data-on', 'false');

  // In manual play the buttons choose rhythms: twelve basic, four intro and fill-in.
  await page.getByTestId('panel-mode-manual_play').click();
  expect((await project(page)).panel.mode).toBe('manual_play');
  await expect(stepButton(page, 0)).toHaveAccessibleName('Basic Rhythm 1, selected');
  await expect(stepButton(page, 12)).toHaveAccessibleName('Intro/Fill-in 1, selected');
  await expect(stepButton(page, 9)).toHaveAccessibleName('Basic Rhythm 10');
  const lamps = panel.locator('[data-panel-lamp]');
  await expect(lamps.nth(0)).toHaveAttribute('data-flash', 'true');
  await expect(lamps.nth(12)).toHaveAttribute('data-on', 'true');
  await expect(lamps.nth(12)).toHaveAttribute('data-flash', 'false');
  await expect(page.getByTestId('lamp-first-part')).toHaveAttribute('data-on', 'false');

  const before = await project(page);
  await stepButton(page, 9).click();
  const after = await project(page);
  expect(after.panel.basicRhythm).toBe(9);
  expect(after.rhythms).toEqual(before.rhythms);
  await expect(lamps.nth(9)).toHaveAttribute('data-flash', 'true');
  await expect(lamps.nth(0)).toHaveAttribute('data-on', 'false');

  // Back in a write mode, the buttons are the steps of the rhythm just chosen,
  // which the starter set leaves empty.
  await page.getByTestId('panel-mode-write_first').click();
  await expect(stepButton(page, 0)).toHaveAccessibleName('Bass Drum, step 1, off');
  await stepButton(page, 0).click();
  expect(stepsOn(await project(page), 'kick', 9)).toEqual([0]);
  expect(hitCount(await project(page), 0)).toBe(hitCount(before, 0));
});

test('CLEAR wipes the selected rhythm in pattern clear', async ({ page }) => {
  const clear = page.getByTestId('panel-clear');
  await expect(clear).toHaveAccessibleName(/store the pre-scale/);
  await page.getByTestId('panel-mode-manual_play').click();
  await expect(clear).toBeDisabled();
  await page.getByTestId('panel-mode-pattern_clear').click();
  await expect(clear).toHaveAccessibleName('Clear the selected rhythm');
  // Only the selected rhythm's lamp is lit, and it does not flash.
  const lamps = page.getByTestId('panel').locator('[data-panel-lamp]');
  await expect(lamps.nth(0)).toHaveAttribute('data-on', 'true');
  await expect(lamps.nth(0)).toHaveAttribute('data-flash', 'false');
  await expect(lamps.nth(12)).toHaveAttribute('data-on', 'false');

  expect(hitCount(await project(page))).toBeGreaterThan(0);
  await clear.click();
  const cleared = await project(page);
  expect(hitCount(cleared)).toBe(0);
  expect(stepsOn(cleared, 'accent')).toEqual([]);
  expect(cleared.rhythms[0]).toMatchObject({ firstLength: 16, secondLength: 0 });
  await page.keyboard.press('Control+z');
  expect(hitCount(await project(page))).toBeGreaterThan(0);
});

test('pre-scale and the last step are set with CLEAR and a step button', async ({ page }) => {
  const clear = page.getByTestId('panel-clear');
  const preScale = page.getByTestId('panel-pre-scale');
  await expect(preScale).toHaveAttribute('aria-valuetext', '3: 4 steps to the beat');
  const lever = page.getByTestId('panel').locator('.sb-panel-lever').last();
  const third = (await lever.boundingBox())!;

  // Move the switch to 1 with the keyboard: three steps to the beat.
  await preScale.focus();
  await page.keyboard.press('Home');
  await expect(preScale).toHaveAttribute('aria-valuetext', '1: 3 steps to the beat');
  await expect.poll(async () => (await lever.boundingBox())!.y).toBeLessThan(third.y - 5);
  // The rhythm keeps its own pre-scale until CLEAR stores the switch.
  expect((await project(page)).rhythms[0]!.preScale).toBe(3);
  const fourBeats = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));

  await clear.click();
  await expect(clear).toHaveAttribute('aria-pressed', 'true');
  expect((await project(page)).rhythms[0]!.preScale).toBe(1);
  await expect(stepButton(page, 11)).toHaveAccessibleName('Make step 12 the last step');
  await stepButton(page, 11).click();
  await expect(clear).toHaveAttribute('aria-pressed', 'false');
  const rhythm = (await project(page)).rhythms[0]!;
  expect(rhythm).toMatchObject({ preScale: 1, firstLength: 12, secondLength: 0 });
  // Setting the length wrote no step.
  expect(stepsOn(await project(page), 'kick')).not.toContain(11);

  // Twelve steps of three to the beat are four beats again, with only the first twelve steps played.
  const triplets = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  expect(triplets.frames).toBe(fourBeats.frames);
  expect(Math.max(...triplets.events.map((event) => event.step))).toBeLessThan(12);
  expect(triplets.events.length).toBeLessThan(fourBeats.events.length);
  await openSettings(page);
  await expect(page.getByTestId('hit-count')).toContainText('in 12 steps');
  await page.keyboard.press('Escape');

  // Escape lets CLEAR up again without setting anything.
  await clear.click();
  await expect(clear).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(clear).toHaveAttribute('aria-pressed', 'false');
  expect((await project(page)).rhythms[0]!.firstLength).toBe(12);

  // Clicking the switch where position 4 is selects eight steps to the beat.
  const box = (await preScale.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.9);
  await expect(preScale).toHaveAttribute('aria-valuenow', '3');
  expect((await project(page)).panel.preScale).toBe(4);
});

test('the 2nd part adds steps after the 1st, written from the same sixteen buttons', async ({ page }) => {
  await page.getByTestId('panel-mode-write_second').click();
  await expect(page.getByTestId('lamp-second-part')).toHaveAttribute('data-on', 'true');
  // Until it is given a length the 2nd part has no steps.
  expect((await project(page)).rhythms[0]!.secondLength).toBe(0);
  await page.getByTestId('panel-clear').click();
  await stepButton(page, 3).click();
  expect((await project(page)).rhythms[0]).toMatchObject({ firstLength: 16, secondLength: 4 });

  await selectTrack(page, 'cowbell');
  await stepButton(page, 0).click();
  await stepButton(page, 3).click();
  await expect(stepButton(page, 3)).toHaveAttribute('aria-pressed', 'true');
  expect(stepsOn(await project(page), 'cowbell')).toEqual([16, 19]);

  // Twenty steps of four to the beat are five beats, and the cowbell plays in the fifth.
  const render = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  const bpm = bpmOf(await project(page));
  expect(Math.abs(render.frames - (44100 * 300) / bpm)).toBeLessThanOrEqual(1);
  expect(render.events.filter((event) => event.track === 8).map((event) => event.step)).toEqual([16, 19]);

  // The 1st part's buttons still show the 1st part.
  await page.getByTestId('panel-mode-write_first').click();
  await expect(stepButton(page, 3)).toHaveAttribute('aria-pressed', 'false');

  // Running, the lamps run only while the part being written plays.
  await page.getByTestId('panel-mode-write_second').click();
  await page.getByTestId('panel-toggle').click();
  const seen = new Set<number>();
  await expect
    .poll(
      async () => {
        const now = await page
          .getByTestId('panel')
          .locator('[data-panel-lamp]')
          .evaluateAll((nodes) => nodes.findIndex((node) => node.getAttribute('data-now') === 'true'));
        seen.add(now);
        return seen.has(-1) && seen.size >= 3;
      },
      { intervals: [30], timeout: 15_000 },
    )
    .toBe(true);
  expect([...seen].every((index) => index < 4)).toBe(true);
});

test('each rhythm has an A and a B version, chosen with the variation lever', async ({ page }) => {
  // Basic Rhythm 10 is empty in the starter set, in both versions.
  await page.getByTestId('panel-mode-pattern_clear').click();
  await stepButton(page, 9).click();
  await page.getByTestId('panel-mode-write_first').click();
  const lever = page.getByTestId('panel-basic-variation');
  await expect(lever).toHaveAttribute('aria-valuetext', 'A');
  await expect(page.getByTestId('lamp-variation-a')).toHaveAttribute('data-on', 'true');
  await stepButton(page, 0).click();
  const a = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  expect(a.events.map((event) => [event.pattern, event.step])).toEqual([[18, 0]]);

  await lever.focus();
  await page.keyboard.press('End');
  await expect(lever).toHaveAttribute('aria-valuetext', 'B');
  await expect(page.getByTestId('lamp-variation-b')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('lamp-variation-a')).toHaveAttribute('data-on', 'false');
  // Version B has its own steps: the one just written in A is not among them.
  await expect(stepButton(page, 0)).toHaveAttribute('aria-pressed', 'false');
  await stepButton(page, 2).click();
  const snapshot = await project(page);
  expect(snapshot.rhythms[9]!.b.kick[2]).toBe('x');
  expect(stepsOn(snapshot, 'kick', 9)).toEqual([0]);
  const b = await page.evaluate(() => window.__boombapbot!.renderLoop(44100));
  expect(b.events.map((event) => [event.pattern, event.step])).toEqual([[19, 2]]);

  // An Intro/Fill-in has its own lever, with two positions.
  await page.getByTestId('panel-mode-pattern_clear').click();
  await stepButton(page, 13).click();
  const fill = page.getByTestId('panel-fill-variation');
  await fill.focus();
  await page.keyboard.press('ArrowRight');
  await expect(fill).toHaveAttribute('aria-valuetext', 'B');
  await page.getByTestId('panel-mode-write_first').click();
  await stepButton(page, 7).click();
  expect((await project(page)).rhythms[13]!.b.kick[7]).toBe('x');
});

test('TAP writes the selected instrument while the rhythm runs', async ({ page }) => {
  await selectTrack(page, 'cowbell');
  expect(stepsOn(await project(page), 'cowbell')).toEqual([]);
  // Stopped, TAP only plays the instrument.
  await page.getByTestId('panel-tap').click();
  expect(stepsOn(await project(page), 'cowbell')).toEqual([]);

  await page.getByTestId('panel-toggle').click();
  await expect.poll(async () => (await debug(page)).stats?.frames ?? 0).toBeGreaterThan(5_000);
  await page.getByTestId('panel-tap').click();
  await expect.poll(async () => stepsOn(await project(page), 'cowbell').length).toBe(1);
  const [step] = stepsOn(await project(page), 'cowbell');
  expect(step).toBeGreaterThanOrEqual(0);
  expect(step).toBeLessThan(16);
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');

  // The keyboard works the button too, and a tapped step can be undone.
  await page.getByTestId('panel-tap').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+z');
  expect(stepsOn(await project(page), 'cowbell').length).toBeLessThanOrEqual(1);

  // Outside the write modes TAP writes nothing.
  await page.getByTestId('panel-mode-manual_play').click();
  const before = (await project(page)).rhythms;
  await page.getByTestId('panel-tap').click();
  expect((await project(page)).rhythms).toEqual(before);
});

test.describe('manual play', () => {
  test.beforeEach(async ({ page }) => {
    // Fast, so several measures pass in a second or two.
    await page.getByTestId('panel-tempo').focus();
    await page.keyboard.press('End');
    await page.getByTestId('panel-mode-manual_play').click();
  });

  test('the AB position plays the A and B versions in turn', async ({ page }) => {
    const lever = page.getByTestId('panel-basic-variation');
    await lever.focus();
    await page.keyboard.press('ArrowRight');
    await expect(lever).toHaveAttribute('aria-valuetext', 'A then B');
    await page.getByTestId('panel-toggle').click();
    const played = patternWatcher(page);
    await expect.poll(async () => (await played.poll()).length, { intervals: [20] }).toBeGreaterThanOrEqual(4);
    const seen = await played.poll();
    // It begins with A and never plays one version twice running.
    expect(seen[0]).toBe(0);
    expect(seen.slice(0, 4)).toEqual([0, 1, 0, 1]);
    // The version lamps follow what is playing.
    await expect
      .poll(async () => page.getByTestId('lamp-variation-b').getAttribute('data-on'), { intervals: [20] })
      .toBe('true');
    await expect
      .poll(async () => page.getByTestId('lamp-variation-a').getAttribute('data-on'), { intervals: [20] })
      .toBe('true');
  });

  test('TAP sets an intro before start and a fill-in while running', async ({ page }) => {
    const tap = page.getByTestId('panel-tap');
    const lamps = page.getByTestId('panel').locator('[data-panel-lamp]');
    await expect(tap).toHaveAccessibleName('Tap: play the intro or fill-in next');
    await expect(tap).toHaveAttribute('aria-pressed', 'false');
    // The Basic Rhythm has priority and flashes; the Intro/Fill-in is lit.
    await expect(lamps.nth(0)).toHaveAttribute('data-flash', 'true');
    await expect(lamps.nth(12)).toHaveAttribute('data-flash', 'false');

    await tap.click();
    await expect(tap).toHaveAttribute('aria-pressed', 'true');
    await expect(lamps.nth(12)).toHaveAttribute('data-flash', 'true');
    await expect(lamps.nth(0)).toHaveAttribute('data-flash', 'false');
    await expect(lamps.nth(0)).toHaveAttribute('data-on', 'true');
    // Pressed again it gives priority back.
    await tap.click();
    await expect(tap).toHaveAttribute('aria-pressed', 'false');
    await tap.click();

    const played = patternWatcher(page);
    await page.getByTestId('panel-toggle').click();
    await expect.poll(async () => (await played.poll()).length, { intervals: [20] }).toBeGreaterThanOrEqual(2);
    // The intro, Intro/Fill-in 1 version A, played once and handed over to Basic Rhythm 1.
    expect((await played.poll()).slice(0, 2)).toEqual([24, 0]);
    await expect(tap).toHaveAttribute('aria-pressed', 'false');

    // While it runs, TAP queues the fill-in for the next bar line, once.
    await tap.click();
    await expect.poll(async () => (await played.poll()).slice(2, 4), { intervals: [20] }).toEqual([24, 0]);
    await expect(tap).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
  });

  test('the auto fill-in selector plays the fill-in every so many measures', async ({ page }) => {
    const selector = page.getByTestId('panel-auto-fill');
    await expect(selector).toHaveAttribute('aria-valuetext', 'Manual');
    await selector.focus();
    await page.keyboard.press('End');
    await expect(selector).toHaveAttribute('aria-valuetext', 'Every 2 measures');
    expect((await project(page)).panel.autoFill).toBe(2);

    const played = patternWatcher(page);
    await page.getByTestId('panel-toggle').click();
    await expect.poll(async () => (await played.poll()).length, { intervals: [20] }).toBeGreaterThanOrEqual(4);
    expect((await played.poll()).slice(0, 4)).toEqual([0, 24, 0, 24]);

    // Pressing beside a number on the dial turns it there.
    await page.getByTestId('panel-toggle').click();
    const box = (await selector.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.08);
    const picked = (await project(page)).panel.autoFill;
    expect([12, 8]).toContain(picked);
    await page.mouse.click(box.x + box.width * 0.06, box.y + box.height * 0.63);
    expect((await project(page)).panel.autoFill).toBe(0);
  });

  test('a rhythm chosen while another plays takes over, and the write modes then edit it', async ({ page }) => {
    const before = (await project(page)).rhythms;
    const played = patternWatcher(page);
    await page.getByTestId('panel-toggle').click();
    await expect.poll(async () => (await played.poll()).length, { intervals: [20] }).toBeGreaterThanOrEqual(1);
    await stepButton(page, 4).click();
    expect((await project(page)).panel.basicRhythm).toBe(4);
    await expect.poll(async () => (await played.poll()).includes(8), { intervals: [20] }).toBe(true);
    await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
    // Nothing was written by choosing it.
    expect((await project(page)).rhythms).toEqual(before);
  });
});
