import { expect, test } from '@playwright/test';
import { debug, openEditor, project, run, stepKey, stepsOn } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('switched off, the machine stops, goes dark and answers nothing but its power switch', async ({ page }) => {
  const editor = page.getByTestId('editor');
  const panel = page.getByTestId('panel');
  const power = page.getByTestId('panel-power');
  await expect(power).toHaveAttribute('aria-checked', 'true');
  await stepKey(page, 15).click();
  await run(page);
  const before = await project(page);

  await power.click();
  await expect(power).toHaveAttribute('aria-checked', 'false');
  await expect(editor).toHaveAttribute('data-playing', 'false');
  await expect(panel).toHaveAttribute('data-power', 'off');
  // Every lamp is dark, though what they showed is still remembered.
  const lit = await panel
    .locator('.sb-panel-led')
    .evaluateAll((lamps) => lamps.filter((lamp) => getComputedStyle(lamp).boxShadow.includes('1cqw') || getComputedStyle(lamp).backgroundImage !== 'none').length);
  expect(lit).toBe(0);
  // Nothing else can be pressed, by pointer or keyboard, and Space does not start it.
  const controls = panel.locator('.sb-panel-controls');
  await expect(controls).toHaveCount(2);
  for (const group of await controls.all()) await expect(group).toHaveAttribute('inert', '');
  await expect(page.locator('.sb-panel-touch')).toHaveAttribute('inert', '');
  // Space on the switch itself would work it, so leave it first.
  await power.blur();
  await page.locator('body').press('Space');
  await expect(editor).toHaveAttribute('data-playing', 'false');
  await expect(power).toHaveAttribute('aria-checked', 'false');
  expect(await project(page)).toEqual(before);

  // On again, it is as it was.
  await power.focus();
  await page.keyboard.press('Enter');
  await expect(power).toHaveAttribute('aria-checked', 'true');
  await expect(panel).toHaveAttribute('data-power', 'on');
  for (const group of await controls.all()) await expect(group).not.toHaveAttribute('inert', '');
  await run(page);
  await stepKey(page, 1).click();
  expect(stepsOn(await project(page), 'kick', 15)).toContain(1);
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
});

test('the volume knob clicks the power off at its left end, and on again when it is turned up', async ({ page }) => {
  const panel = page.getByTestId('panel');
  const volume = page.getByTestId('panel-volume');
  await expect(volume).toHaveAccessibleName('Volume and power');
  await expect(volume).toHaveAttribute('aria-valuetext', '75%');
  const before = (await project(page)).mix.volume;

  await run(page);
  await volume.focus();
  await page.keyboard.press('Home');
  await expect(panel).toHaveAttribute('data-power', 'off');
  await expect(volume).toHaveAttribute('aria-valuenow', '0');
  await expect(volume).toHaveAttribute('aria-valuetext', 'Power off');
  await expect(page.getByTestId('panel-power')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
  // Off is not a volume: the knob remembers where it stood.
  expect((await project(page)).mix.volume).toBe(before);

  // Turned up from the click, it is on and quiet.
  await page.keyboard.press('ArrowUp');
  await expect(panel).toHaveAttribute('data-power', 'on');
  await expect(volume).toHaveAttribute('aria-valuetext', '2%');
  expect((await project(page)).mix.volume).toBe(0.02);

  // Dragged down to the stop it clicks off again, and the switch beside it brings it back where it stood.
  const box = (await volume.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await expect(panel).toHaveAttribute('data-power', 'off');
  await page.getByTestId('panel-power').click();
  await expect(panel).toHaveAttribute('data-power', 'on');
  await expect(volume).toHaveAttribute('aria-valuenow', '2');
});
