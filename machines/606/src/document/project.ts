import { z } from 'zod';
import { PROJECT_FORMAT, type ParseResult as DocumentParseResult } from '@boombapbot/contracts';
import {
  BPM_MAX,
  BPM_MIN,
  CHAIN_BLOCK,
  DEFAULT_LEVEL,
  DEFAULT_SCALE,
  EMPTY_ROW,
  GROUPS,
  GROUP_PATTERNS,
  INSTRUMENT_IDS,
  LEVEL_IDS,
  SONG_TRACKS,
  STEPS,
  TRACK_IDS,
  TRACK_MEASURES,
  clampBpm,
  countSteps,
  type Group,
} from './machine';
import { createStarterPatterns, createStarterTracks } from './starter';

/**
 * The 606's project document: everything the machine remembers. Thirty-two
 * patterns in two groups of sixteen, eight tracks that each list the pattern
 * of every measure, and where every knob and switch of the panel stands.
 *
 * This is the plain JSON project used for local drafts and JSON import and
 * export. It is not the future portable `.boombapbot` bundle.
 */
export const MACHINE_ID = '606';
export const PROJECT_SCHEMA_VERSION = 1;

/** Positions of the mode selector, as the panel reads them from the top. */
export const MODES = ['track_write', 'track_play', 'pattern_play', 'pattern_write'] as const;
export type Mode = (typeof MODES)[number];

const knobSchema = z.number().min(0).max(1);
const rowSchema = z.string().regex(new RegExp(`^[.x]{${STEPS}}$`), `a row is ${STEPS} steps of "x" or "."`);
const scaleSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const patternNumberSchema = z.number().int().min(0).max(GROUP_PATTERNS - 1);

export const patternSchema = z.object({
  /** Steps to the beat: 1 is four, 2 is eight, 3 is three, 4 is six. */
  scale: scaleSchema,
  /** How many of the sixteen steps play. */
  lastStep: z.number().int().min(1).max(STEPS),
  steps: z.record(z.enum(TRACK_IDS), rowSchema),
});

export const panelSchema = z
  .object({
    mode: z.enum(MODES),
    /** The instrument and track selector: 0 is AC or track 1, 7 is CH or track 8. */
    selector: z.number().int().min(0).max(TRACK_IDS.length - 1),
    /** The pattern group: 0 is I, 1 is II. */
    group: z.union([z.literal(0), z.literal(1)]),
    /** The selected pattern, 0 to 15: the first of a chain. */
    pattern: patternNumberSchema,
    /** The last pattern of the chain. The same as `pattern` when one is selected alone. */
    chainEnd: patternNumberSchema,
    /** Where the scale switch stands. A pattern keeps its own once stored. */
    scale: scaleSchema,
  })
  .refine((panel) => panel.chainEnd >= panel.pattern && chainBlock(panel.chainEnd) === chainBlock(panel.pattern), {
    path: ['chainEnd'],
    message: `a chain runs upward within one block of ${CHAIN_BLOCK} patterns`,
  });

export const projectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  machine: z.literal(MACHINE_ID),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Beats a minute. */
  tempo: z.number().int().min(BPM_MIN).max(BPM_MAX),
  mix: z.object({
    volume: knobSchema,
    /** The level knobs. The accent's is how much louder an accented step plays. */
    levels: z.record(z.enum(LEVEL_IDS), knobSchema),
  }),
  /** Group I, then group II: sixteen patterns each. */
  patterns: z.array(z.array(patternSchema).length(GROUP_PATTERNS)).length(GROUPS),
  /** For each track, the pattern (0 to 15) played in each measure. */
  tracks: z.array(z.array(patternNumberSchema).max(TRACK_MEASURES)).length(SONG_TRACKS),
  panel: panelSchema,
});

export type Pattern = z.infer<typeof patternSchema>;
export type PanelState = z.infer<typeof panelSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ParseResult = DocumentParseResult<Project>;

function describeIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

/** Validates a 606 project. Never throws. */
export function parseProject(input: unknown): ParseResult {
  const version = typeof input === 'object' && input !== null ? (input as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (version !== undefined && version !== PROJECT_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [`This project uses schema version ${String(version)}. This build reads version ${PROJECT_SCHEMA_VERSION}.`],
    };
  }
  const result = projectSchema.safeParse(input);
  if (!result.success) return { ok: false, errors: describeIssues(result.error) };
  return { ok: true, project: result.data, changes: [] };
}

export function serializeProject(project: Project): string {
  return `${JSON.stringify(projectSchema.parse(project), null, 2)}\n`;
}

function forEach<Key extends string, Value>(keys: readonly Key[], value: (key: Key) => Value): Record<Key, Value> {
  return Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<Key, Value>;
}

// ---- Patterns -----------------------------------------------------------------

/** A pattern as PATTERN CLEAR leaves it: nothing on, sixteen steps, four to the beat. */
export function createEmptyPattern(): Pattern {
  return { scale: DEFAULT_SCALE, lastStep: STEPS, steps: forEach(TRACK_IDS, () => EMPTY_ROW) };
}

/** Both groups with nothing in them. */
export function createEmptyPatterns(): Pattern[][] {
  return Array.from({ length: GROUPS }, () => Array.from({ length: GROUP_PATTERNS }, createEmptyPattern));
}

/** Eight tracks with no measures. */
export function createEmptyTracks(): number[][] {
  return Array.from({ length: SONG_TRACKS }, () => []);
}

/** A pattern after PATTERN CLEAR. The scale is the one thing it keeps. */
export function clearedPattern(pattern: Pattern): Pattern {
  return { ...createEmptyPattern(), scale: pattern.scale };
}

/** Whether a pattern is as PATTERN CLEAR would leave it. */
export function isCleared(pattern: Pattern): boolean {
  return JSON.stringify(pattern) === JSON.stringify(clearedPattern(pattern));
}

/** A pattern with its last step set. Steps count from 1. */
export function withLastStep(pattern: Pattern, steps: number): Pattern {
  return { ...pattern, lastStep: Math.min(STEPS, Math.max(1, Math.round(steps))) };
}

/** The step played after `step`. */
export function nextStep(pattern: Pattern, step: number): number {
  return step + 1 < pattern.lastStep ? step + 1 : 0;
}

/** The step a tap belongs to: the one sounding, or the next once that one is more than half over. */
export function tappedStep(pattern: Pattern, step: number, fraction: number): number {
  return fraction > 0.5 ? nextStep(pattern, step) : step;
}

/** Hits a pattern plays, across every instrument. Accents are not hits. */
export function countHits(pattern: Pattern): number {
  return INSTRUMENT_IDS.reduce((total, id) => total + countSteps(pattern.steps[id], pattern.lastStep), 0);
}

// ---- Selecting patterns ---------------------------------------------------------

function chainBlock(pattern: number): number {
  return Math.floor(pattern / CHAIN_BLOCK);
}

type Selection = Pick<PanelState, 'pattern' | 'chainEnd'>;

/**
 * What two step keys pressed together select: every pattern from one to the
 * other when both are in one block of four, and otherwise only the second.
 */
export function selectionOf(first: number, last = first): Selection {
  if (chainBlock(first) !== chainBlock(last)) return { pattern: last, chainEnd: last };
  return { pattern: Math.min(first, last), chainEnd: Math.max(first, last) };
}

/** The patterns the panel has selected, in the order they play. */
export function chainOf(panel: Selection): number[] {
  return Array.from({ length: panel.chainEnd - panel.pattern + 1 }, (_, index) => panel.pattern + index);
}

/**
 * The pattern the step keys write and show: the one of the selected chain
 * that is playing, or its first.
 */
export function editedPattern(panel: PanelState, playingPattern = -1): number {
  if (playingPattern >= 0 && playingPattern % GROUPS === panel.group) {
    const playing = Math.floor(playingPattern / GROUPS);
    if (playing >= panel.pattern && playing <= panel.chainEnd) return playing;
  }
  return panel.pattern;
}

// ---- Tracks ---------------------------------------------------------------------

/** Modes that work on a track: the selector then chooses a track, not an instrument. */
export function isTrackMode(mode: Mode): boolean {
  return mode === 'track_write' || mode === 'track_play';
}

/** The last bar a track can stand at, from 0: one past its end, or its last when it is full. */
export function lastBar(track: readonly number[]): number {
  return Math.min(track.length, TRACK_MEASURES - 1);
}

/** A track with a pattern written at a bar. A bar at its end is added to it. */
export function withMeasure(track: readonly number[], bar: number, pattern: number): number[] {
  if (bar < 0 || bar > lastBar(track)) return [...track];
  return [...track.slice(0, bar), pattern, ...track.slice(bar + 1)];
}

/** A track that ends with a pattern at a bar: what came after it is gone. */
export function endingAt(track: readonly number[], bar: number, pattern: number): number[] {
  return withMeasure(track, bar, pattern).slice(0, bar + 1);
}

/** A track with a bar taken out and the rest moved up. */
export function withoutMeasure(track: readonly number[], bar: number): number[] {
  return track.filter((_, index) => index !== bar);
}

/** A track with a pattern put in at a bar and the rest moved down. A full track is left as it is. */
export function withInsertedMeasure(track: readonly number[], bar: number, pattern: number): number[] {
  if (track.length >= TRACK_MEASURES || bar < 0 || bar > track.length) return [...track];
  return [...track.slice(0, bar), pattern, ...track.slice(bar)];
}

// ---- A new project --------------------------------------------------------------

export function createDefaultPanel(): PanelState {
  return {
    mode: 'pattern_write',
    selector: TRACK_IDS.indexOf('kick'),
    group: 0,
    pattern: 0,
    chainEnd: 0,
    scale: DEFAULT_SCALE,
  };
}

export interface NewProjectOptions {
  id: string;
  now: Date;
  name?: string;
  bpm?: number;
  patterns?: Pattern[][];
}

/** A new project with every knob at rest. It gets the starter beat unless it is given patterns. */
export function createProject(options: NewProjectOptions): Project {
  const timestamp = options.now.toISOString();
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    machine: MACHINE_ID,
    id: options.id,
    name: options.name ?? 'Untitled beat',
    createdAt: timestamp,
    updatedAt: timestamp,
    tempo: clampBpm(options.bpm ?? 120),
    mix: { volume: DEFAULT_LEVEL, levels: forEach(LEVEL_IDS, () => DEFAULT_LEVEL) },
    patterns: options.patterns ?? createStarterPatterns(),
    // The starter tracks play the starter patterns, so they come only with them.
    tracks: options.patterns ? createEmptyTracks() : createStarterTracks(),
    panel: createDefaultPanel(),
  };
}

/** The pattern a panel is on, in its group. */
export function patternAt(project: Project, pattern: number, group: Group = project.panel.group): Pattern {
  const found = project.patterns[group]?.[pattern];
  if (!found) throw new Error(`the machine has no pattern ${pattern + 1} in group ${group + 1}`);
  return found;
}
