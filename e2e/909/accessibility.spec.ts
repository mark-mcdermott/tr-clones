import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { key, openEditor, openSettings, shifted, start, writePattern } from './helpers';

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
  // In pattern play, as it opens.
  expect(summarize((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
  // In pattern write, running, with a function key down.
  await writePattern(page, 0);
  await start(page);
  await key(page, 'instrument').click();
  expect(summarize((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
  // And writing a track.
  await page.keyboard.press('Escape');
  await shifted(page, page.getByTestId('panel-track-0'));
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
  const unnamed = () =>
    page.evaluate(() => {
      const controls = document.querySelectorAll('button, input, [role="slider"], [role="radio"], [role="switch"], [role="img"]');
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
  expect(await unnamed()).toEqual([]);
  await writePattern(page, 0);
  await key(page, 'shuffle').click();
  expect(await unnamed()).toEqual([]);
  await page.getByTestId('panel-track-0').click();
  expect(await unnamed()).toEqual([]);
  await openSettings(page);
  expect(await unnamed()).toEqual([]);
});

test('the machine says what it is doing to a screen reader, and the display has words', async ({ page }) => {
  await openEditor(page);
  const status = page.getByTestId('panel-status');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveText('Pattern play, group 1: pattern 1');
  await writePattern(page, 2);
  await expect(status).toHaveText(/^Pattern write, group 1, pattern 3\. The step keys choose a pattern/);
  await key(page, 'last-step').click();
  await expect(status).toContainText('Last step is down');
  await expect(page.getByTestId('panel-display')).toHaveAttribute('role', 'img');
  await expect(page.getByTestId('panel-display')).toHaveAccessibleName('Tempo: 125 beats per minute');
  // The lamps are for the eye only.
  const exposed = await page.getByTestId('panel').locator('.sb-panel-led:not([aria-hidden="true"])').count();
  expect(exposed).toBe(0);
});

test('focus can be seen on the light panel', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('panel-power').focus();
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toHaveAttribute('role', 'slider');
  const style = await focused.evaluate((node) => {
    const computed = getComputedStyle(node);
    return { outline: computed.outlineStyle, colour: computed.outlineColor, width: parseFloat(computed.outlineWidth) };
  });
  expect(style.outline).toBe('solid');
  expect(style.colour).toBe('rgb(28, 34, 48)');
  expect(style.width).toBeGreaterThan(1.5);
});
