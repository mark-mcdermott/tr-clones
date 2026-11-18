import { expect, type Locator, type Page } from '@playwright/test';
import { debug as sharedDebug, type DebugSnapshot } from '../helpers';

// The 606's own helpers.

export * from '../helpers';

/** The engine's tracks, in selector order. The accent is track 0. */
export const TRACK_IDS = ['accent', 'kick', 'snare', 'low_tom', 'high_tom', 'cymbal', 'open_hat', 'closed_hat'] as const;
export type TrackId = (typeof TRACK_IDS)[number];

export const MODES = ['track_write', 'track_play', 'pattern_play', 'pattern_write'] as const;
export type Mode = (typeof MODES)[number];

export const DRAFT_KEY = 'tr-clones.606.draft.v1';

export interface PatternSnapshot {
  scale: number;
  lastStep: number;
  steps: Record<TrackId, string>;
}

export interface ProjectSnapshot {
  schemaVersion: number;
  machine: string;
  name: string;
  updatedAt: string;
  tempo: number;
  mix: { volume: number; levels: Record<string, number> };
  /** Group I, then group II. */
  patterns: PatternSnapshot[][];
  tracks: number[][];
  panel: { mode: Mode; selector: number; group: number; pattern: number; chainEnd: number; scale: number };
}

export function debug(page: Page): Promise<DebugSnapshot<ProjectSnapshot>> {
  return sharedDebug<ProjectSnapshot>(page);
}

export async function project(page: Page): Promise<ProjectSnapshot> {
  return (await debug(page)).project;
}

/** Where the engine keeps a pattern: the two groups take turns through its bank. */
export const bankIndex = (pattern: number, group = 0): number => pattern * 2 + group;

/** Steps that are on in one track of a pattern. */
export function stepsOn(snapshot: ProjectSnapshot, track: TrackId, pattern = 0, group = 0): number[] {
  return [...snapshot.patterns[group]![pattern]!.steps[track]].flatMap((mark, index) => (mark === 'x' ? [index] : []));
}

/** Hits a pattern plays on its instrument tracks. */
export function hitCount(snapshot: ProjectSnapshot, pattern = 0, group = 0): number {
  const { lastStep } = snapshot.patterns[group]![pattern]!;
  return TRACK_IDS.slice(1).reduce((total, track) => total + stepsOn(snapshot, track, pattern, group).filter((step) => step < lastStep).length, 0);
}

/** Whether the machine remembers nothing at all. */
export function isBlank(snapshot: ProjectSnapshot): boolean {
  const empty = snapshot.patterns.flat().every((pattern) => pattern.lastStep === 16 && TRACK_IDS.every((track) => !pattern.steps[track].includes('x')));
  return empty && snapshot.tracks.every((track) => track.length === 0);
}

/** One of the sixteen step keys. */
export function stepKey(page: Page, index: number): Locator {
  return page.getByTestId('panel').locator(`[data-panel-step="${index}"]`);
}

/** The lamp over a step key. */
export function stepLamp(page: Page, index: number): Locator {
  return page.getByTestId('panel').locator(`[data-panel-lamp="${index}"]`);
}

/** The step keys whose lamps are lit. */
export function litKeys(page: Page): Promise<number[]> {
  return page
    .getByTestId('panel')
    .locator('[data-panel-lamp][data-on="true"]')
    .evaluateAll((lamps) => lamps.map((lamp) => Number((lamp as HTMLElement).dataset.panelLamp)));
}

/** Turns the selector on the faceplate to an instrument, or in a track mode to the track at its position. */
export async function selectTrack(page: Page, track: TrackId): Promise<void> {
  await page.getByTestId(`panel-voice-${track}`).click();
  await expect(page.getByTestId(`panel-voice-${track}`)).toHaveAttribute('aria-checked', 'true');
}

/** Turns the mode selector. */
export async function setMode(page: Page, mode: Mode): Promise<void> {
  await page.getByTestId(`panel-mode-${mode}`).click();
  await expect(page.getByTestId(`panel-mode-${mode}`)).toHaveAttribute('aria-checked', 'true');
}

/** Presses RUN/STOP and waits for the machine to be running. */
export async function run(page: Page): Promise<void> {
  await page.getByTestId('panel-toggle').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
}

export async function stop(page: Page): Promise<void> {
  await page.getByTestId('panel-toggle').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
}

/**
 * Replaces the project with a changed copy of the one on the page, through
 * the import a person would use. `fast` runs it at 300 beats a minute, so a
 * sixteen-step measure lasts 0.8 seconds.
 */
export async function importChanged(
  page: Page,
  change: (project: ProjectSnapshot) => void,
  { fast = false } = {},
): Promise<void> {
  const next = structuredClone(await project(page));
  if (fast) next.tempo = 300;
  change(next);
  await page.getByTestId('import-input').setInputFiles({
    name: 'seed.boombapbot.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(next)),
  });
  await expect(page.getByTestId('notice')).toContainText('Imported');
}

/** Watches the pattern the engine reports, and keeps each one it changes to. */
export function patternWatcher(page: Page) {
  const seen: number[] = [];
  return {
    seen,
    async poll(): Promise<number[]> {
      const pattern = await page.evaluate(() => window.__boombapbot!.playing().pattern);
      if (pattern >= 0 && seen[seen.length - 1] !== pattern) seen.push(pattern);
      return seen;
    },
    /** Waits until the engine is playing this pattern of the bank. */
    async until(pattern: number): Promise<void> {
      await expect.poll(async () => (await this.poll()).at(-1), { intervals: [20] }).toBe(pattern);
    },
  };
}
