import { expect, test } from '@playwright/test';
import { EMPTY_PATTERN, debug, key, openEditor, patternOf, project, start, stepKey, stepsOn, writePattern } from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('the power switch turns the machine off: it stops, goes dark and answers nothing', async ({ page }) => {
  const editor = page.getByTestId('editor');
  const panel = page.getByTestId('panel');
  const power = page.getByTestId('panel-power');
  await expect(power).toHaveAttribute('aria-checked', 'true');
  await expect(power).toHaveAccessibleName('Power');
  await writePattern(page, 0);
  await key(page, 'shuffle').click();
  await start(page);
  const before = await project(page);

  await power.click();
  await expect(power).toHaveAttribute('aria-checked', 'false');
  await expect(editor).toHaveAttribute('data-playing', 'false');
  await expect(panel).toHaveAttribute('data-power', 'off');
  // Every lamp is dark, and so is the display.
  const lit = await panel
    .locator('.sb-panel-led')
    .evaluateAll((lamps) => lamps.filter((lamp) => getComputedStyle(lamp).boxShadow.includes('1cqw') || getComputedStyle(lamp).backgroundImage !== 'none').length);
  expect(lit).toBe(0);
  const display = page.getByTestId('panel-display');
  await expect(display).toHaveAccessibleName('The display is dark');
  expect(await display.locator('path[data-on="true"]').count()).toBe(0);
  await expect(page.getByTestId('panel-status')).toHaveText('The power is off');
  // Nothing else can be pressed, by pointer or keyboard, and Space does not start it.
  await expect(panel.locator('.sb-panel-controls')).toHaveAttribute('inert', '');
  await expect(page.locator('.sb-panel-touch')).toHaveAttribute('inert', '');
  // Space on the switch itself would work it, so leave it first.
  await power.blur();
  await page.locator('body').press('Space');
  await expect(editor).toHaveAttribute('data-playing', 'false');
  await expect(power).toHaveAttribute('aria-checked', 'false');
  expect(await project(page)).toEqual(before);

  // On again, what it remembers is as it was, and the keys that were down are up.
  await power.focus();
  await page.keyboard.press('Enter');
  await expect(power).toHaveAttribute('aria-checked', 'true');
  await expect(panel).toHaveAttribute('data-power', 'on');
  await expect(panel.locator('.sb-panel-controls')).not.toHaveAttribute('inert', '');
  await expect(key(page, 'shuffle')).toHaveAttribute('aria-pressed', 'false');
  await expect(display).toHaveAttribute('data-value', '125');
  expect((await project(page)).panel.mode).toBe('pattern_write');
  await stepKey(page, EMPTY_PATTERN).click();
  await start(page);
  await stepKey(page, 1).click();
  expect(stepsOn(patternOf(await project(page)), 'bass_drum')).toEqual([1]);
  await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
});
