import { expect, test } from '@playwright/test';
import { debug, openEditor, project, stepButton, stepsOn } from './helpers';

test.describe('the power switch', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test('switches the machine off: it stops, goes dark and answers nothing', async ({ page }) => {
    const editor = page.getByTestId('editor');
    const panel = page.getByTestId('panel');
    const power = page.getByTestId('panel-power');
    await expect(power).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('panel-toggle').click();
    await expect(editor).toHaveAttribute('data-playing', 'true');
    const before = await project(page);

    await power.click();
    await expect(power).toHaveAttribute('aria-checked', 'false');
    await expect(editor).toHaveAttribute('data-playing', 'false');
    await expect(panel).toHaveAttribute('data-power', 'off');
    // Every lamp is dark, though the steps are still written.
    const lit = await panel
      .locator('.sb-panel-led')
      .evaluateAll((lamps) => lamps.filter((lamp) => getComputedStyle(lamp).boxShadow.includes('1cqw') || getComputedStyle(lamp).backgroundImage !== 'none').length);
    expect(lit).toBe(0);
    // Nothing else can be pressed, by pointer or keyboard, and Space does not start it.
    await expect(panel.locator('.sb-panel-controls')).toHaveAttribute('inert', '');
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
    await expect(panel.locator('.sb-panel-controls')).not.toHaveAttribute('inert', '');
    await stepButton(page, 1).click();
    expect(stepsOn(await project(page), 'kick')).toContain(1);
    await page.getByTestId('panel-toggle').click();
    await expect(editor).toHaveAttribute('data-playing', 'true');
    await expect.poll(async () => (await debug(page)).stats?.peakEver ?? 0).toBeGreaterThan(0.05);
  });
});

test.describe('dials and cursors', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  /** A point on a dial's rim, at an angle in degrees clockwise from straight up. */
  const rim = async (page: import('@playwright/test').Page, testId: string, deg: number) => {
    const box = (await page.getByTestId(testId).boundingBox())!;
    const radius = box.width * 0.4;
    const angle = (deg * Math.PI) / 180;
    return { x: box.x + box.width / 2 + radius * Math.sin(angle), y: box.y + box.height / 2 - radius * Math.cos(angle) };
  };

  test('the mode and instrument dials turn to where they are pressed or dragged', async ({ page }) => {
    // Manual play is the fourth position, a little right of straight up.
    const manual = await rim(page, 'panel-dial-mode', 24);
    await page.mouse.click(manual.x, manual.y);
    expect((await project(page)).panel.mode).toBe('manual_play');
    await expect(page.getByTestId('panel-mode-manual_play')).toHaveAttribute('aria-checked', 'true');

    // Dragged round to the left it ends on pattern clear.
    await page.mouse.move(manual.x, manual.y);
    await page.mouse.down();
    for (const deg of [0, -30, -60, -90]) {
      const point = await rim(page, 'panel-dial-mode', deg);
      await page.mouse.move(point.x, point.y);
    }
    await page.mouse.up();
    expect((await project(page)).panel.mode).toBe('pattern_clear');

    // The instrument dial: the snare is its third position.
    await page.getByTestId('panel-mode-write_first').click();
    const selector = (await project(page)).panel.selector;
    const top = await rim(page, 'panel-dial-voice', 0);
    await page.mouse.click(top.x, top.y);
    const picked = (await project(page)).panel.selector;
    expect(picked).not.toBe(selector);
    await expect(page.locator('[data-testid^="panel-voice-"][aria-checked="true"]')).toHaveCount(1);
  });

  test('knobs that turn freely show up and down arrows, and those with positions a hand', async ({ page }) => {
    const cursor = (testId: string) => page.getByTestId(testId).evaluate((node) => getComputedStyle(node).cursor);
    for (const id of ['panel-tempo', 'panel-fine', 'panel-master', 'panel-knob-kick-level', 'panel-knob-snare-snappy']) {
      expect(await cursor(id), id).toBe('ns-resize');
    }
    for (const id of [
      'panel-dial-mode',
      'panel-dial-voice',
      'panel-auto-fill',
      'panel-pre-scale',
      'panel-basic-variation',
      'panel-fill-variation',
      'panel-switch-clap',
      'panel-power',
      'panel-tap',
    ]) {
      expect(await cursor(id), id).toBe('pointer');
    }
  });
});
