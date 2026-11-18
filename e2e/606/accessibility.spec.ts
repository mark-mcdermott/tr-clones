import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openEditor, openSettings, run, selectTrack, setMode } from './helpers';

function summarize(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
  }));
}

test('the machine has no detectable accessibility violations', async ({ page }) => {
  await openEditor(page);
  await expect(page.getByTestId('panel')).toBeVisible();
  // Stopped with the accent selected; running with an instrument and FUNCTION down; and writing a track.
  await selectTrack(page, 'accent');
  expect(summarize((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
  await selectTrack(page, 'open_hat');
  await run(page);
  await page.getByTestId('panel-function').click();
  expect(summarize((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
  await setMode(page, 'track_write');
  await page.getByTestId('panel-function').click();
  expect(summarize((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
});

test('the machine switched off has no detectable accessibility violations', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('panel-power').click();
  await expect(page.getByTestId('panel')).toHaveAttribute('data-power', 'off');
  expect(summarize((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
});

test('the settings sheet has no detectable accessibility violations', async ({ page }) => {
  await openEditor(page);
  await openSettings(page);
  await page.getByTestId('panel-pending').locator('summary').click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(summarize(results.violations)).toEqual([]);
});

test('every control has an accessible name, in every mode', async ({ page }) => {
  await openEditor(page);
  for (const mode of ['pattern_write', 'pattern_play', 'track_play', 'track_write'] as const) {
    await setMode(page, mode);
    const unnamed = await page.evaluate(() => {
      const controls = document.querySelectorAll('button, input, [role="slider"], [role="radio"], [role="switch"]');
      return [...controls]
        .filter((element) => {
          const input = element as HTMLInputElement;
          const label =
            element.getAttribute('aria-label') ||
            element.textContent?.trim() ||
            (input.labels && input.labels.length > 0 ? input.labels[0]!.textContent : '');
          return !label;
        })
        .map((element) => element.outerHTML.slice(0, 120));
    });
    expect(unnamed, mode).toEqual([]);
  }
});

test('the whole machine can be worked from the keyboard', async ({ page }) => {
  await openEditor(page);
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.getAttribute('data-panel-step'));

  // The selector dials are one tab stop each, and the arrow keys turn them.
  await page.getByTestId('panel-voice-kick').focus();
  await page.keyboard.press('ArrowRight');
  expect(await focused()).toBe('panel-voice-snare');
  await expect(page.getByTestId('panel-voice-snare')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('End');
  expect(await focused()).toBe('panel-voice-closed_hat');
  await page.keyboard.press('Tab');
  expect(await focused()).toBe('panel-mode-pattern_write');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('panel-mode-pattern_play')).toHaveAttribute('aria-checked', 'true');

  // The arrow keys move along the step keys and round the end; Enter presses one, and Shift with it chains.
  await page.locator('[data-panel-step="2"]').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  expect(await focused()).toBe('0');
  await page.keyboard.press('ArrowLeft');
  expect(await focused()).toBe('15');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('[data-panel-step="1"]')).toHaveAccessibleName('Pattern 2, selected');
  await expect(page.locator('[data-panel-step="3"]')).toHaveAccessibleName('Pattern 4');

  // The scale switch and the knobs are sliders.
  const scale = page.getByTestId('panel-scale');
  await scale.focus();
  await page.keyboard.press('ArrowUp');
  await expect(scale).toHaveAttribute('aria-valuetext', 'Scale 2: eight steps to the beat');
  await page.keyboard.press('Home');
  await expect(scale).toHaveAttribute('aria-valuetext', 'Scale 4: six steps to the beat');
  await page.getByTestId('panel-level-toms').focus();
  await page.keyboard.press('Home');
  await expect(page.getByTestId('panel-level-toms')).toHaveAttribute('aria-valuetext', '0%');
});

test('the mouse wheel never turns a knob', async ({ page }) => {
  await openEditor(page);
  for (const id of ['panel-tempo', 'panel-volume', 'panel-level-accent', 'panel-scale']) {
    const knob = page.getByTestId(id);
    const before = await knob.getAttribute('aria-valuenow');
    await knob.hover();
    await page.mouse.wheel(0, 240);
    await page.mouse.wheel(0, -480);
    expect(await knob.getAttribute('aria-valuenow'), id).toBe(before);
  }
});
