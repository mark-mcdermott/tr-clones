import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { debug as sharedDebug, type DebugSnapshot } from '../helpers';

// The 808's own helpers.

export * from '../helpers';

/** The engine's tracks, in panel order. The accent is track 0. */
export const TRACK_IDS = [
  'accent',
  'kick',
  'snare',
  'low_tom',
  'mid_tom',
  'high_tom',
  'rim_shot',
  'clap',
  'cowbell',
  'cymbal',
  'open_hat',
  'closed_hat',
] as const;
export type TrackId = (typeof TRACK_IDS)[number];

export const DRAFT_KEY = 'boombapbot.draft.v2';
export const LEGACY_DRAFT_KEY = 'boombapbot.draft.v1';
export const LEGACY_FIXTURE = 'machines/808/fixtures/v1-kick-snare-hat.project.json';

export interface RhythmSnapshot {
  preScale: number;
  firstLength: number;
  secondLength: number;
  a: Record<TrackId, string>;
  b: Record<TrackId, string>;
}

export interface ProjectSnapshot {
  schemaVersion: number;
  name: string;
  updatedAt: string;
  tempo: { coarse: number; fine: number };
  sound: {
    master: number;
    accent: number;
    levels: Record<string, number>;
    knobs: Record<string, Record<'tune' | 'tone' | 'decay' | 'snappy', number>>;
    alternates: Record<string, boolean>;
  };
  rhythms: RhythmSnapshot[];
  rhythmTracks: number[][];
  panel: {
    mode: string;
    selector: number;
    basicRhythm: number;
    fillRhythm: number;
    basicVariation: string;
    fillVariation: string;
    preScale: number;
    autoFill: number;
    writeTarget: string;
  };
}

/** The faceplate image this build ships, from the asset manifest. */
export async function faceplate(page: Page): Promise<string | null> {
  const response = await page.request.get('/boombapbot-assets.json');
  const manifest = (await response.json()) as { faceplate?: string | null };
  return manifest.faceplate ?? null;
}

/** Whether the faceplate is a credited photograph or our own drawing. */
export function faceplateIsCredited(): boolean {
  const manifest = JSON.parse(readFileSync('machines/808/data/808.panel.json', 'utf8')) as {
    faceplate: { credit?: unknown };
  };
  return manifest.faceplate.credit !== undefined;
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
  if (fast) next.tempo = { coarse: 39, fine: 1 };
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
    /**
     * Waits until the measure playing is past its first beat. A rhythm chosen
     * during the first beat takes that measure over; chosen after it, the next.
     */
    async pastFirstBeat(): Promise<void> {
      await expect
        .poll(() => page.evaluate(() => window.__boombapbot!.playing().step), { intervals: [10] })
        .toBeGreaterThanOrEqual(6);
    },
    /** Waits until the engine is playing this pattern. */
    async until(pattern: number): Promise<void> {
      await expect.poll(async () => (await this.poll()).at(-1), { intervals: [20] }).toBe(pattern);
    },
  };
}

export function debug(page: Page): Promise<DebugSnapshot<ProjectSnapshot>> {
  return sharedDebug<ProjectSnapshot>(page);
}

export async function project(page: Page): Promise<ProjectSnapshot> {
  return (await debug(page)).project;
}

/** Steps that are on in one track of version A of a rhythm. */
export function stepsOn(snapshot: ProjectSnapshot, track: TrackId, rhythm = 0): number[] {
  return [...snapshot.rhythms[rhythm]!.a[track]].flatMap((mark, index) => (mark === 'x' ? [index] : []));
}

/** Hits on the instrument tracks of version A of a rhythm. */
export function hitCount(snapshot: ProjectSnapshot, rhythm = 0): number {
  return TRACK_IDS.slice(1).reduce((total, track) => total + stepsOn(snapshot, track, rhythm).length, 0);
}

/** Tempo in beats per minute: 40 click stops across 40 to 300, plus the fine knob. */
export function bpmOf(snapshot: ProjectSnapshot): number {
  const bpm = 40 + ((snapshot.tempo.coarse + snapshot.tempo.fine) * 260) / 39;
  return Math.min(300, Math.max(40, bpm));
}

/** Turns the instrument selector on the faceplate. */
export async function selectTrack(page: Page, track: TrackId): Promise<void> {
  await page.getByTestId(`panel-voice-${track}`).click();
  await expect(page.getByTestId(`panel-voice-${track}`)).toHaveAttribute('aria-checked', 'true');
}

/** One of the sixteen step buttons. */
export function stepButton(page: Page, index: number) {
  return page.getByTestId('panel').locator(`[data-panel-step="${index}"]`);
}
