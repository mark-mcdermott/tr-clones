import { z } from 'zod';
import { PROJECT_FORMAT, type ParseResult as DocumentParseResult } from '@boombapbot/contracts';
import {
  BPM_MAX,
  BPM_MIN,
  DEFAULT_SCALE,
  EMPTY_ROW,
  GROUPS,
  GROUP_PATTERNS,
  INSTRUMENT_IDS,
  KNOBS,
  KNOB_IDS,
  PATTERN_TRACKS,
  SHUFFLE_MAX,
  STEPS,
  TRACK_IDS,
  TRACK_MEASURES,
  clampKnob,
  countSteps,
  type Group,
  type KnobId,
  type Scale,
  type TrackId,
} from './machine';
import { createStarterPatterns, createStarterTracks } from './starter';

/**
 * The 909's project document: everything it remembers. Two groups of sixteen
 * patterns, four tracks that play them a measure at a time, where every knob
 * stands, and where the panel was left.
 */
export const MACHINE_ID = '909';
export const PROJECT_SCHEMA_VERSION = 1;

/** What the TRACK and PATTERN keys put the machine in, with and without SHIFT. */
export const MODES = ['track_play', 'track_write', 'pattern_play', 'pattern_write'] as const;
export type Mode = (typeof MODES)[number];

/** How a pattern is written: a step at a time on the step keys, or by tapping the instruments in time. */
export const WRITE_MODES = ['step', 'tap'] as const;
export type WriteMode = (typeof WRITE_MODES)[number];

const knobSchema = z.number().min(0).max(1);
const rowSchema = z.string().regex(new RegExp(`^[.x]{${STEPS}}$`), `a row is ${STEPS} steps of "x" or "."`);
const groupSchema = z.union([z.literal(0), z.literal(1)]);
const patternNumberSchema = z.number().int().min(0).max(GROUP_PATTERNS - 1);

export const patternSchema = z.object({
  /** Row of the scale chart: 1 is six steps to the beat, 2 three, 3 eight, 4 four. */
  scale: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  /** Steps the pattern plays, counted from 1. */
  lastStep: z.number().int().min(1).max(STEPS),
  /** How late every second step plays: 0 is straight. */
  shuffle: z.number().int().min(0).max(SHUFFLE_MAX),
  steps: z.record(z.enum(TRACK_IDS), rowSchema),
});

export const patternTrackSchema = z.object({
  /** The pattern group its measures are played from. */
  group: groupSchema,
  /** The pattern of each measure, 0 to 15. */
  measures: z.array(patternNumberSchema).max(TRACK_MEASURES),
});

export const panelSchema = z
  .object({
    mode: z.enum(MODES),
    /** The TRACK key last pressed, 0 to 3. */
    track: z.number().int().min(0).max(PATTERN_TRACKS - 1),
    /** The PATTERN key last pressed: the group the pattern modes work in. */
    group: groupSchema,
    /** The selected pattern, and the first of a chain. */
    pattern: patternNumberSchema,
    /** The last pattern of the chain pattern play runs through. The same as `pattern` when there is no chain. */
    chain: patternNumberSchema,
    write: z.enum(WRITE_MODES),
    /** The row the step keys write: an instrument, or the total accent. */
    instrument: z.enum(TRACK_IDS),
    /** Whether a track starts again when it reaches its end. */
    cycle: z.boolean(),
  })
  .refine((panel) => panel.chain >= panel.pattern, { message: 'a chain ends at or after the pattern it starts on', path: ['chain'] });

export const projectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  machine: z.literal(MACHINE_ID),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Beats a minute, as the display shows them. */
  tempo: z.number().int().min(BPM_MIN).max(BPM_MAX),
  /** Where every knob but the tempo stands, from 0 to 1. */
  knobs: z.record(z.enum(KNOB_IDS), knobSchema),
  /** The pattern groups: sixteen patterns each. */
  patterns: z.array(z.array(patternSchema).length(GROUP_PATTERNS)).length(GROUPS),
  patternTracks: z.array(patternTrackSchema).length(PATTERN_TRACKS),
  panel: panelSchema,
});

export type Pattern = z.infer<typeof patternSchema>;
export type PatternTrack = z.infer<typeof patternTrackSchema>;
export type PanelState = z.infer<typeof panelSchema>;
export type Knobs = Record<KnobId, number>;
export type Project = z.infer<typeof projectSchema>;
export type ParseResult = DocumentParseResult<Project>;

function describeIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

/** Validates a 909 project. Never throws. */
export function parseProject(input: unknown): ParseResult {
  if (typeof input === 'object' && input !== null) {
    const { schemaVersion } = input as { schemaVersion?: unknown };
    if (schemaVersion !== PROJECT_SCHEMA_VERSION) {
      return {
        ok: false,
        errors: [
          `This project uses schema version ${String(schemaVersion)}. This build reads version ${PROJECT_SCHEMA_VERSION}.`,
        ],
      };
    }
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

/** A pattern as CLEAR leaves it: sixteen steps of four to the beat, straight, with nothing on them. */
export function createEmptyPattern(): Pattern {
  return { scale: DEFAULT_SCALE, lastStep: STEPS, shuffle: 0, steps: forEach(TRACK_IDS, () => EMPTY_ROW) };
}

/** Both groups with nothing in them. */
export function createEmptyPatterns(): Pattern[][] {
  return Array.from({ length: GROUPS }, () => Array.from({ length: GROUP_PATTERNS }, createEmptyPattern));
}

/** Four tracks with no measures. */
export function createEmptyTracks(): PatternTrack[] {
  return Array.from({ length: PATTERN_TRACKS }, () => ({ group: 0 as const, measures: [] }));
}

/** Every knob where a new machine has it. */
export function createDefaultKnobs(): Knobs {
  return Object.fromEntries(KNOBS.map((knob) => [knob.id, knob.rest])) as Knobs;
}

export function createDefaultPanel(): PanelState {
  return {
    mode: 'pattern_play',
    track: 0,
    group: 0,
    pattern: 0,
    chain: 0,
    write: 'step',
    instrument: 'bass_drum',
    cycle: false,
  };
}

export interface NewProjectOptions {
  id: string;
  now: Date;
  name?: string;
  bpm?: number;
  patterns?: Pattern[][];
}

/** A new project with every knob at rest. It gets the starter patterns and track unless it is given patterns. */
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
    tempo: options.bpm ?? 125,
    knobs: createDefaultKnobs(),
    patterns: options.patterns ?? createStarterPatterns(),
    // The starter track plays the starter patterns, so it comes only with them.
    patternTracks: options.patterns ? createEmptyTracks() : createStarterTracks(),
    panel: createDefaultPanel(),
  };
}

/** The knobs with one of them turned. Positions run from 0 to 1. */
export function withKnob(knobs: Knobs, id: KnobId, value: number): Knobs {
  return { ...knobs, [id]: clampKnob(value) };
}

// ---- Where the panel stands ------------------------------------------------------

export function isTrackMode(mode: Mode): boolean {
  return mode === 'track_play' || mode === 'track_write';
}

export function isWriteMode(mode: Mode): boolean {
  return mode === 'track_write' || mode === 'pattern_write';
}

/** The group whose patterns play and show: the selected track's in the track modes, the PATTERN key's otherwise. */
export function activeGroup(project: Project): Group {
  const { panel } = project;
  return isTrackMode(panel.mode) ? project.patternTracks[panel.track]!.group : panel.group;
}

/** The pattern the panel is on: what pattern write writes and the function keys work on. */
export function selectedPattern(project: Project): Pattern {
  return project.patterns[activeGroup(project)]![project.panel.pattern]!;
}

/** The patterns pattern play runs through, in order: one, or a chain of neighbours. */
export function chainOf(panel: Pick<PanelState, 'pattern' | 'chain'>): number[] {
  return Array.from({ length: panel.chain - panel.pattern + 1 }, (_, index) => panel.pattern + index);
}

/** The project with one pattern of a group replaced. */
export function withPattern(project: Project, group: Group, number: number, pattern: Pattern): Project {
  return {
    ...project,
    patterns: project.patterns.map((patterns, g) =>
      g === group ? patterns.map((old, index) => (index === number ? pattern : old)) : patterns,
    ),
  };
}

/** The project with one of its tracks replaced. */
export function withPatternTrack(project: Project, index: number, track: PatternTrack): Project {
  return { ...project, patternTracks: project.patternTracks.map((old, i) => (i === index ? track : old)) };
}

/** The step played after `step`. */
export function nextStep(pattern: Pattern, step: number): number {
  return step + 1 < pattern.lastStep ? step + 1 : 0;
}

/** Hits on the instrument rows of a pattern, among the steps it plays. */
export function countHits(pattern: Pattern): number {
  return INSTRUMENT_IDS.reduce((total, id) => total + countSteps(pattern.steps[id], pattern.lastStep), 0);
}

/** Whether a pattern is as CLEAR leaves it. */
export function isEmptyPattern(pattern: Pattern): boolean {
  const empty = createEmptyPattern();
  return (
    pattern.scale === empty.scale &&
    pattern.lastStep === empty.lastStep &&
    pattern.shuffle === empty.shuffle &&
    TRACK_IDS.every((id: TrackId) => pattern.steps[id] === EMPTY_ROW)
  );
}

/** The scale after this one on the chart, round and round. */
export function nextScale(scale: Scale): Scale {
  return ((scale % 4) + 1) as Scale;
}
