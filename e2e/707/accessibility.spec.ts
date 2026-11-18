import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { functionKey, openEditor, openSettings, project, setMode, stepKey } from './helpers';

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
  // As it opens; writing a pattern with a key down; and writing a track while it runs.
  expect(summarize((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
  await setMode(page, 'pattern_step');
  await functionKey(page, 'instrument').click();
  expect(summarize((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
  await stepKey(page, 13).click();
  await setMode(page, 'track_write');
  await page.getByTestId('panel-start').click();
  expect(summarize((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
});

test('the settings sheet has no detectable accessibility violations', async ({ page }) => {
  await openEditor(page);
  await openSettings(page);
  await page.getByTestId('panel-pending').locator('summary').click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(summarize(results.violations)).toEqual([]);
});

test('every control has an accessible name, in English', async ({ page }) => {
  await openEditor(page);
  await openSettings(page);
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
  expect(unnamed).toEqual([]);
});

test('the display has its pattern in words', async ({ page }) => {
  await openEditor(page);
  const display = page.getByRole('img', { name: /^Display\./ });
  await expect(display).toHaveAccessibleName(/Pattern play\. Pattern A1\. 16 steps of sixteenth notes\. Tempo 120\. No shuffle\./);
  await expect(display).toHaveAccessibleName(/Bass Drum 1 on 1, 5, 9, 13\. Snare Drum 1 on 5, 13\./);
  await stepKey(page, 4).click();
  await expect(display).toHaveAccessibleName(/Pattern A5\. .* No steps are on\./);
});

test('every control of the machine can be reached and worked from the keyboard', async ({ page }) => {
  await openEditor(page);
  const panel = page.getByTestId('panel');
  // Everything that can be pressed or moved takes focus: no control is a picture only.
  const unreachable = await panel.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('button:not(:disabled), [role="slider"]')]
      .filter((element) => element.tabIndex < 0)
      .map((element) => element.outerHTML.slice(0, 100)),
  );
  expect(unreachable).toEqual([]);

  // A fader: arrows, Page Up and Down, Home and End.
  const fader = page.getByTestId('panel-fader-snare_drum');
  await expect(fader).toHaveAttribute('aria-orientation', 'vertical');
  await expect(fader).toHaveAccessibleName('Snare Drum level');
  await fader.focus();
  await page.keyboard.press('ArrowUp');
  await expect(fader).toHaveAttribute('aria-valuenow', '77');
  await expect(fader).toHaveAttribute('aria-valuetext', '77%');
  await page.keyboard.press('PageDown');
  await expect(fader).toHaveAttribute('aria-valuenow', '57');
  await page.keyboard.press('Home');
  expect((await project(page)).mix.levels.snare_drum).toBe(0);
  await page.keyboard.press('End');
  expect((await project(page)).mix.levels.snare_drum).toBe(1);

  // The step keys: arrows move along them, Enter presses.
  await stepKey(page, 0).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(stepKey(page, 2)).toBeFocused();
  await page.keyboard.press('Enter');
  expect((await project(page)).panel.pattern).toBe(2);
  await page.keyboard.press('ArrowLeft');
  await expect(stepKey(page, 1)).toBeFocused();
  await stepKey(page, 0).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(stepKey(page, 15)).toBeFocused();

  // A key that stays down, from the keyboard, and Esc to let it up.
  await page.getByTestId('panel-shift').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('panel-shift')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-shift')).toHaveAttribute('aria-pressed', 'false');
});

test('what a control did is said aloud', async ({ page }) => {
  await openEditor(page);
  const spoken = page.getByTestId('spoken');
  await expect(spoken).toHaveAttribute('aria-live', 'polite');
  await stepKey(page, 3).click();
  await expect(spoken).toHaveText('Pattern A4.');
  await setMode(page, 'pattern_step');
  await expect(spoken).toHaveText('Pattern write, by step.');
  await functionKey(page, 'last_step').click();
  await expect(spoken).toHaveText('Last step is down: press the step key to end the pattern on.');
  await stepKey(page, 7).click();
  await expect(spoken).toHaveText('Last step 8.');
  await functionKey(page, 'scale').click();
  await expect(spoken).toHaveText('Scale: sixteenth-note triplets.');
});

test('the mouse wheel never moves a fader or the tempo knob', async ({ page }) => {
  await openEditor(page);
  const before = await project(page);
  for (const id of ['panel-tempo', 'panel-fader-volume', 'panel-fader-bass_drum']) {
    await page.getByTestId(id).hover();
    await page.mouse.wheel(0, 240);
    await page.mouse.wheel(0, -480);
  }
  const after = await project(page);
  expect(after.tempo).toBe(before.tempo);
  expect(after.mix).toEqual(before.mix);
});
