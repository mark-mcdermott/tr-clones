import { expect, test } from '@playwright/test';
import { debug, displayInk, openEditor, project, setMode, stepKey, stepsOn } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('the power switch turns the machine off: it stops, goes dark and answers nothing', async ({ page }) => {
  const editor = page.getByTestId('editor');
  const panel = page.getByTestId('panel');
  const power = page.getByTestId('panel-power');
  await expect(power).toHaveAttribute('aria-checked', 'true');
  await expect(power).toHaveAccessibleName('Power');
  await page.getByTestId('panel-shift').click();
  await page.getByTestId('panel-start').click();
  await expect(editor).toHaveAttribute('data-playing', 'true');
  expect(await displayInk(page)).toBeGreaterThan(0.03);
  const before = await project(page);

  await power.click();
  await expect(power).toHaveAttribute('aria-checked', 'false');
  await expect(editor).toHaveAttribute('data-playing', 'false');
  await expect(panel).toHaveAttribute('data-power', 'off');
  // Every lamp is dark, though the pattern is still chosen, and the display is blank glass.
  const lit = await panel
    .locator('.sb-panel-led')
    .evaluateAll((lamps) => lamps.filter((lamp) => getComputedStyle(lamp).boxShadow.includes('1cqw') || getComputedStyle(lamp).backgroundImage !== 'none').length);
  expect(lit).toBe(0);
  await expect.poll(() => displayInk(page)).toBe(0);
  // Nothing else can be pressed, by pointer or keyboard, and Space does not start it.
  await expect(panel.locator('.sb-panel-controls')).toHaveAttribute('inert', '');
  await expect(page.locator('.sb-panel-touch')).toHaveAttribute('inert', '');
  // Space on the switch itself would work it, so leave it first.
  await power.blur();
  await page.locator('body').press('Space');
  await expect(editor).toHaveAttribute('data-playing', 'false');
  await expect(power).toHaveAttribute('aria-checked', 'false');
  expect(await project(page)).toEqual(before);

  // On again, it remembers everything, and a key that was down has come up.
  await power.focus();
  await page.keyboard.press('Enter');
  await expect(power).toHaveAttribute('aria-checked', 'true');
  await expect(panel).toHaveAttribute('data-power', 'on');
  await expect(panel.locator('.sb-panel-controls')).not.toHaveAttribute('inert', '');
  await expect(page.getByTestId('panel-shift')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => displayInk(page)).toBeGreaterThan(0.03);
  await setMode(page, 'pattern_step');
  await stepKey(page, 1).click();
  expect(stepsOn(await project(page), 'bass_drum')).toContain(1);
  await page.getByTestId('panel-start').click();
  await expect(editor).toHaveAttribute('data-playing', 'true');
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
});

test('the lever of the power switch is up when it is on and down when it is off', async ({ page }) => {
  const lever = page.getByTestId('panel').locator('.sb-panel-lever');
  const on = (await lever.boundingBox())!;
  await page.getByTestId('panel-power').click();
  await expect.poll(async () => (await lever.boundingBox())!.y).toBeGreaterThan(on.y + on.height / 2);
});
