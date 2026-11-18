import { expect, type Locator, type Page } from '@playwright/test';
import { debug as sharedDebug, type DebugSnapshot } from '../helpers';

// The 909's own helpers.

export * from '../helpers';

/** The engine's tracks, in order. The total accent is track 0. */
export const TRACK_IDS = [
  'accent',
  'bass_drum',
  'snare_drum',
  'low_tom',
  'mid_tom',
  'hi_tom',
  'rim_shot',
  'hand_clap',
  'closed_hat',
  'open_hat',
  'crash',
  'ride',
] as const;
export type TrackId = (typeof TRACK_IDS)[number];

export const DRAFT_KEY = 'tr-clones.909.draft.v1';
/** The first pattern of group 1 the starter beat leaves empty: pattern 9, as a step key. */
export const EMPTY_PATTERN = 8;

export interface PatternSnapshot {
  scale: number;
  lastStep: number;
  shuffle: number;
  steps: Record<TrackId, string>;
}

export interface ProjectSnapshot {
  schemaVersion: number;
  machine: string;
  name: string;
  updatedAt: string;
  tempo: number;
  knobs: Record<string, number>;
  patterns: PatternSnapshot[][];
  patternTracks: Array<{ group: number; measures: number[] }>;
  panel: {
    mode: string;
    track: number;
    group: number;
    pattern: number;
    chain: number;
    write: string;
    instrument: string;
    cycle: boolean;
  };
}

export function debug(page: Page): Promise<DebugSnapshot<ProjectSnapshot>> {
  return sharedDebug<ProjectSnapshot>(page);
}

export async function project(page: Page): Promise<ProjectSnapshot> {
  return (await debug(page)).project;
}

/** A pattern of a group as the page holds it now. */
export function patternOf(snapshot: ProjectSnapshot, number = snapshot.panel.pattern, group = snapshot.panel.group): PatternSnapshot {
  return snapshot.patterns[group]![number]!;
}

/** The steps that are on in one row of a pattern. */
export function stepsOn(pattern: PatternSnapshot, track: TrackId): number[] {
  return [...pattern.steps[track]].flatMap((mark, index) => (mark === 'x' ? [index] : []));
}

/** Hits on the instrument rows of a pattern, among the steps it plays. */
export function hitCount(pattern: PatternSnapshot): number {
  return TRACK_IDS.slice(1).reduce(
    (total, track) => total + stepsOn(pattern, track).filter((step) => step < pattern.lastStep).length,
    0,
  );
}

/** One of the sixteen step keys. */
export function stepKey(page: Page, index: number): Locator {
  return page.getByTestId('panel').locator(`[data-panel-step="${index}"]`);
}

/** The lamp in a step key's cap. */
export function stepLamp(page: Page, index: number): Locator {
  return page.getByTestId('panel').locator(`[data-panel-lamp="${index}"]`);
}

/** One of the small keys, by the name its test id ends in. */
export function key(page: Page, name: string): Locator {
  return page.getByTestId(`panel-key-${name}`);
}

/** Presses SHIFT, then a key: its second function. */
export async function shifted(page: Page, target: Locator): Promise<void> {
  await key(page, 'shift').click();
  await expect(key(page, 'shift')).toHaveAttribute('aria-pressed', 'true');
  await target.click();
  await expect(key(page, 'shift')).toHaveAttribute('aria-pressed', 'false');
}

/** Puts the machine in pattern write on a pattern of a group, stopped. */
export async function writePattern(page: Page, pattern: number, group = 0): Promise<void> {
  await shifted(page, page.getByTestId(`panel-group-${group}`));
  await stepKey(page, pattern).click();
  await expect(stepKey(page, pattern)).toHaveAttribute('aria-pressed', 'true');
}

/** Chooses the instrument on a step key, with INSTRUMENT SELECT. */
export async function selectInstrument(page: Page, onKey: number): Promise<void> {
  await key(page, 'instrument').click();
  await stepKey(page, onKey).click();
  await expect(key(page, 'instrument')).toHaveAttribute('aria-pressed', 'false');
}

export async function start(page: Page): Promise<void> {
  await page.getByTestId('panel-start').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'true');
}

export async function stop(page: Page): Promise<void> {
  await page.getByTestId('panel-stop').click();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-playing', 'false');
}

/**
 * Replaces the project with a changed copy of the one on the page, through
 * the import a person would use. `fast` runs it at 290 beats a minute, so a
 * sixteen-step measure lasts 0.83 seconds.
 */
export async function importChanged(
  page: Page,
  change: (project: ProjectSnapshot) => void,
  { fast = false } = {},
): Promise<void> {
  const next = structuredClone(await project(page));
  if (fast) next.tempo = 290;
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
    async poll(): Promise<number[]> {
      const pattern = await page.evaluate(() => window.__boombapbot!.playing().pattern);
      if (pattern >= 0 && seen[seen.length - 1] !== pattern) seen.push(pattern);
      return seen;
    },
    /** Waits until the engine is playing this pattern. */
    async until(pattern: number): Promise<void> {
      await expect.poll(async () => (await this.poll()).at(-1), { intervals: [20] }).toBe(pattern);
    },
  };
}
