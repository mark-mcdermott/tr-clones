import { expect, type Locator, type Page } from '@playwright/test';
import { debug as sharedDebug, type DebugSnapshot } from '../helpers';

// The 707's own helpers.

export * from '../helpers';

/** The rows of a pattern, in engine order. The accent is track 0. */
export const ROW_IDS = [
  'accent',
  'bass_drum',
  'snare_drum',
  'low_tom',
  'mid_tom',
  'hi_tom',
  'rim_cowbell',
  'clap_tambourine',
  'closed_hat',
  'open_hat',
  'crash',
  'ride',
] as const;
export type RowId = (typeof ROW_IDS)[number];
export type Group = 'a' | 'b';
export type Mode = 'track_play' | 'track_write' | 'pattern_play' | 'pattern_step' | 'pattern_tap';

export const DRAFT_KEY = 'tr-clones.707.draft.v1';
export const FIXTURE = 'machines/707/fixtures/every-control.project.json';
/** A beat of the 808, which this machine must refuse. */
export const OTHER_MACHINE_FIXTURE = 'machines/808/fixtures/mixed-rhythms.project.json';

export interface PatternSnapshot {
  scale: number;
  lastStep: number;
  steps: Record<RowId, string>;
}

export interface ProjectSnapshot {
  schemaVersion: number;
  machine: string;
  name: string;
  updatedAt: string;
  tempo: number;
  shuffle: number;
  mix: { volume: number; accent: number; levels: Record<string, number> };
  sounds: Record<'bass_drum' | 'snare_drum' | 'rim_cowbell' | 'clap_tambourine', string>;
  groups: Record<Group, PatternSnapshot[]>;
  tracks: Array<{ group: Group; measures: number[] }>;
  panel: {
    mode: Mode;
    group: Group;
    pattern: number;
    chain: { first: number; last: number } | null;
    row: RowId;
    track: number;
    measure: number;
    readout: 'tempo' | 'measure';
  };
}

export function debug(page: Page): Promise<DebugSnapshot<ProjectSnapshot>> {
  return sharedDebug<ProjectSnapshot>(page);
}

export async function project(page: Page): Promise<ProjectSnapshot> {
  return (await debug(page)).project;
}

/** Where the engine keeps a pattern: A1 is 0, B1 is 1, A2 is 2. */
export function patternIndex(group: Group, pattern: number): number {
  return pattern * 2 + (group === 'b' ? 1 : 0);
}

/** Steps that are on in one row of a pattern. */
export function stepsOn(snapshot: ProjectSnapshot, row: RowId, pattern = 0, group: Group = 'a'): number[] {
  return [...snapshot.groups[group][pattern]!.steps[row]].flatMap((mark, index) => (mark === 'x' ? [index] : []));
}

/** Hits a pattern plays: every instrument's steps up to its last step. */
export function hitCount(snapshot: ProjectSnapshot, pattern = 0, group: Group = 'a'): number {
  const { lastStep } = snapshot.groups[group][pattern]!;
  return ROW_IDS.slice(1).reduce(
    (total, row) => total + stepsOn(snapshot, row, pattern, group).filter((step) => step < lastStep).length,
    0,
  );
}

/** Whether a project remembers nothing: no steps anywhere and no measures in any track. */
export function remembersNothing(snapshot: ProjectSnapshot): boolean {
  const empty = (pattern: PatternSnapshot) => Object.values(pattern.steps).every((row) => !row.includes('x'));
  return (
    snapshot.groups.a.every(empty) && snapshot.groups.b.every(empty) && snapshot.tracks.every((track) => track.measures.length === 0)
  );
}

/** One of the sixteen step keys, counted from 0. */
export function stepKey(page: Page, index: number): Locator {
  return page.getByTestId('panel').locator(`[data-panel-step="${index}"]`);
}

/** The lamp over a step key. */
export function stepLamp(page: Page, index: number): Locator {
  return page.getByTestId(`lamp-step-${index}`);
}

/** The step keys whose lamps are lit. */
export async function litSteps(page: Page): Promise<number[]> {
  const lamps = await page.locator('[data-testid^="lamp-step-"]').evaluateAll((all) => all.map((lamp) => lamp.getAttribute('data-on')));
  return lamps.flatMap((on, index) => (on === 'true' ? [index] : []));
}

/** One of the small keys above the scale chart. */
export function functionKey(page: Page, key: string): Locator {
  return page.getByTestId(`panel-key-${key}`);
}

/** Puts the machine in a mode with the keys a person would press. */
export async function setMode(page: Page, mode: Mode): Promise<void> {
  const shifted = mode !== 'track_play' && mode !== 'pattern_play';
  if (shifted) await page.getByTestId('panel-shift').click();
  await functionKey(page, mode.startsWith('track') ? 'track' : 'pattern').click();
  if (mode === 'pattern_tap' && (await project(page)).panel.mode !== 'pattern_tap') {
    await page.getByTestId('panel-shift').click();
    await functionKey(page, 'pattern').click();
  }
  await expect.poll(async () => (await project(page)).panel.mode).toBe(mode);
}

/** Chooses an instrument as the machine has it done: INSTRUMENT, then the step key lettered for it. */
export async function chooseInstrument(page: Page, key: number): Promise<void> {
  await functionKey(page, 'instrument').click();
  await stepKey(page, key).click();
}

/**
 * Replaces the project with a changed copy of the one on the page, through
 * the import a person would use. `fast` runs it at 240 beats a minute, so a
 * sixteen-step measure lasts a second.
 */
export async function importChanged(
  page: Page,
  change: (project: ProjectSnapshot) => void,
  { fast = false } = {},
): Promise<void> {
  const next = structuredClone(await project(page));
  if (fast) next.tempo = 240;
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
    /** Waits until the engine is playing this pattern. */
    async until(pattern: number): Promise<void> {
      await expect.poll(async () => (await this.poll()).at(-1), { intervals: [20] }).toBe(pattern);
    },
  };
}

/** How much of the display is drawn in its dark ink, from 0 to 1. Blank glass has none. */
export function displayInk(page: Page, testId = 'display-canvas'): Promise<number> {
  return page.getByTestId(testId).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 200 && data[i]! < 80) dark += 1;
    return dark / (data.length / 4);
  });
}
