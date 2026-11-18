import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openEditor, openSettings, selectTrack } from './helpers';

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
  // With the accent selected, and with an instrument selected and running.
  await selectTrack(page, 'accent');
  expect(summarize((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
  await selectTrack(page, 'open_hat');
  await page.getByTestId('panel-toggle').click();
  expect(summarize((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
});

test('the settings sheet has no detectable accessibility violations', async ({ page }) => {
  await openEditor(page);
  await openSettings(page);
  await page.getByTestId('panel-pending').locator('summary').click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(summarize(results.violations)).toEqual([]);
});

test('every control has an accessible name', async ({ page }) => {
  await openEditor(page);
  await openSettings(page);
  const unnamed = await page.evaluate(() => {
    const controls = document.querySelectorAll('button, input, [role="slider"], [role="radio"]');
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
