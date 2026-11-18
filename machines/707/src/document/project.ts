import { z } from 'zod';
import { PROJECT_FORMAT, type ParseResult as DocumentParseResult } from '@boombapbot/contracts';
import {
  BPM_MAX,
  BPM_MIN,
  DEFAULT_LEVEL,
  DEFAULT_SCALE,
  EMPTY_ROW,
  FADER_IDS,
  GROUPS,
  GROUP_PATTERNS,
  INSTRUMENT_IDS,
  PAIRED_IDS,
  ROW_IDS,
  SOUND_IDS,
  STEPS,
  TRACK_COUNT,
  TRACK_MEASURES,
  countSteps,
  isPaired,
  patternAt,
  rowSounds,
  type FaderId,
  type Group,
  type InstrumentId,
  type PairedId,
  type RowId,
  type SoundId,
} from './machine';
import { createStarterGroups, createStarterTracks } from './starter';

/**
 * The 707's project document: two groups of sixteen patterns, four tracks
 * that chain them, where every fader stands, which sound each paired
 * instrument plays, and where the panel's keys have left the machine.
 */
export const MACHINE_ID = '707';
export const PROJECT_SCHEMA_VERSION = 1;

/** The machine's modes: a track or a pattern, played or written, and a pattern written by step or by tapping. */
export const MODES = ['track_play', 'track_write', 'pattern_play', 'pattern_step', 'pattern_tap'] as const;
export type Mode = (typeof MODES)[number];

/** What the display's number shows. */
export const READOUTS = ['tempo', 'measure'] as const;
export type Readout = (typeof READOUTS)[number];

const knobSchema = z.number().min(0).max(1);
const rowSchema = z.string().regex(new RegExp(`^[.x]{${STEPS}}$`), `a row is ${STEPS} steps of "x" or "."`);
const patternNumberSchema = z
  .number()
  .int()
  .min(0)
  .max(GROUP_PATTERNS - 1);

const patternSchema = z.object({
  /** Steps to the beat. */
  scale: z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8)]),
  /** How many of its sixteen steps the pattern plays. */
  lastStep: z.number().int().min(1).max(STEPS),
  /** The accent and every instrument, a row each. */
  steps: z.record(z.enum(ROW_IDS), rowSchema),
});

const trackSchema = z.object({
  /** The group every measure of the track takes its pattern from. */
  group: z.enum(GROUPS),
  /** The pattern played in each measure. */
  measures: z.array(patternNumberSchema).max(TRACK_MEASURES),
});

const chainSchema = z
  .object({ first: patternNumberSchema, last: patternNumberSchema })
  .refine((chain) => chain.first < chain.last, 'a chain runs from one pattern to a later one');

const panelSchema = z
  .object({
    mode: z.enum(MODES),
    group: z.enum(GROUPS),
    /** The pattern the panel is on. While a chain plays it is the one cued to play next. */
    pattern: patternNumberSchema,
    /** Patterns played one after the other in pattern play, or null for one alone. */
    chain: chainSchema.nullable(),
    /** The row the step keys write. */
    row: z.enum(ROW_IDS),
    track: z
      .number()
      .int()
      .min(0)
      .max(TRACK_COUNT - 1),
    /** Where the selected track is being played or written: 0 is its first measure. */
    measure: z.number().int().min(0).max(TRACK_MEASURES),
    readout: z.enum(READOUTS),
  })
  .refine(
    (panel) => panel.chain === null || (panel.pattern >= panel.chain.first && panel.pattern <= panel.chain.last),
    'the pattern the panel is on must be one of its chain',
  );

/** Which of its two sounds each paired instrument plays. */
const soundChoiceSchema = z
  .record(z.enum(PAIRED_IDS), z.enum(SOUND_IDS))
  .refine(
    (choice) => PAIRED_IDS.every((id) => rowSounds(id).includes(choice[id])),
    'a paired instrument plays one of its own two sounds',
  );

const projectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  machine: z.literal(MACHINE_ID),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Beats a minute. */
  tempo: z.number().int().min(BPM_MIN).max(BPM_MAX),
  /** 0 for none, up to 4. */
  shuffle: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  mix: z.object({
    volume: knobSchema,
    /** How much louder an accented step is. */
    accent: knobSchema,
    levels: z.record(z.enum(FADER_IDS), knobSchema),
  }),
  sounds: soundChoiceSchema,
  /** Sixteen patterns in each group. */
  groups: z.record(z.enum(GROUPS), z.array(patternSchema).length(GROUP_PATTERNS)),
  tracks: z.array(trackSchema).length(TRACK_COUNT),
  panel: panelSchema,
});

export type Pattern = z.infer<typeof patternSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Chain = z.infer<typeof chainSchema>;
export type PanelState = z.infer<typeof panelSchema>;
export type SoundChoice = Record<PairedId, SoundId>;
export type Mix = z.infer<typeof projectSchema>['mix'];
export type Project = z.infer<typeof projectSchema>;
export type ParseResult = DocumentParseResult<Project>;

function describeIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

/** Validates a 707 project. Never throws. */
export function parseProject(input: unknown): ParseResult {
  const result = projectSchema.safeParse(input);
  if (!result.success) return { ok: false, errors: describeIssues(result.error) };
  return { ok: true, project: result.data, changes: [] };
}

export function serializeProject(project: Project): string {
  return `${JSON.stringify(projectSchema.parse(project), null, 2)}\n`;
}

// ---- New projects ------------------------------------------------------------

function forEach<Key extends string, Value>(keys: readonly Key[], value: (key: Key) => Value): Record<Key, Value> {
  return Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<Key, Value>;
}

export function createEmptyPattern(): Pattern {
  return { scale: DEFAULT_SCALE, lastStep: STEPS, steps: forEach(ROW_IDS, () => EMPTY_ROW) };
}

export function createEmptyGroups(): Project['groups'] {
  return forEach(GROUPS, () => Array.from({ length: GROUP_PATTERNS }, createEmptyPattern));
}

export function createEmptyTracks(): Track[] {
  return Array.from({ length: TRACK_COUNT }, () => ({ group: 'a' as const, measures: [] }));
}

/** Every paired instrument on the first of its two sounds. */
export function createDefaultSounds(): SoundChoice {
  return forEach(PAIRED_IDS, (id) => rowSounds(id)[0]!);
}

export function createDefaultMix(): Mix {
  return { volume: 0.8, accent: 0.7, levels: forEach(FADER_IDS, () => DEFAULT_LEVEL) };
}

export interface NewProjectOptions {
  id: string;
  now: Date;
  name?: string;
  bpm?: number;
  groups?: Project['groups'];
  tracks?: Track[];
}

/** A new project with every fader at rest. It gets the starter beat unless it is given another. */
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
    tempo: options.bpm ?? 120,
    shuffle: 0,
    mix: createDefaultMix(),
    sounds: createDefaultSounds(),
    groups: options.groups ?? createStarterGroups(),
    tracks: options.tracks ?? createStarterTracks(),
    panel: { mode: 'pattern_play', group: 'a', pattern: 0, chain: null, row: 'bass_drum', track: 0, measure: 0, readout: 'tempo' },
  };
}

// ---- Reading a project -------------------------------------------------------

export function isTrackMode(mode: Mode): mode is 'track_play' | 'track_write' {
  return mode === 'track_play' || mode === 'track_write';
}

/** The modes in which the step keys and the keys beside them change a pattern. */
export function isPatternWrite(mode: Mode): mode is 'pattern_step' | 'pattern_tap' {
  return mode === 'pattern_step' || mode === 'pattern_tap';
}

/** The track the panel is on. */
export function selectedTrack(project: Project): Track {
  return project.tracks[project.panel.track]!;
}

/** The measure the selected track is at: never past the one after its last. */
export function trackCursor(project: Project): number {
  return Math.min(project.panel.measure, selectedTrack(project).measures.length);
}

/** The group the step keys choose patterns from: the track's own in the track modes. */
export function activeGroup(project: Project): Group {
  return isTrackMode(project.panel.mode) ? selectedTrack(project).group : project.panel.group;
}

/**
 * The pattern the stopped machine is on: the one its keys last chose, or,
 * playing a track, the one of the measure the track is at.
 */
export function panelPattern(project: Project): { group: Group; pattern: number } {
  const group = activeGroup(project);
  if (project.panel.mode !== 'track_play') return { group, pattern: project.panel.pattern };
  const { measures } = selectedTrack(project);
  return { group, pattern: measures[Math.min(trackCursor(project), measures.length - 1)] ?? project.panel.pattern };
}

/** The pattern the display and the step keys show: the one sounding, or the one the panel is on. */
export function shownPattern(project: Project, playingPattern = -1): { group: Group; pattern: number } {
  return playingPattern >= 0 ? patternAt(playingPattern) : panelPattern(project);
}

export function getPattern(project: Project, at: { group: Group; pattern: number }): Pattern {
  return project.groups[at.group][at.pattern]!;
}

/** The patterns of a chain, in the order they play. */
export function chainPatterns(chain: Chain): number[] {
  return Array.from({ length: chain.last - chain.first + 1 }, (_, index) => chain.first + index);
}

/** The sound an instrument plays now: for a paired one, the project's choice. */
export function rowSound(id: InstrumentId, sounds: SoundChoice): SoundId {
  return isPaired(id) ? sounds[id] : rowSounds(id)[0]!;
}

/** Hits a pattern plays, across every instrument. Accents are not hits. */
export function countHits(pattern: Pattern): number {
  return INSTRUMENT_IDS.reduce((sum, id) => sum + countSteps(pattern.steps[id], pattern.lastStep), 0);
}

/** Whether a pattern is as a cleared one: no steps, sixteen sixteenths. */
export function isEmptyPattern(pattern: Pattern): boolean {
  return (
    pattern.scale === DEFAULT_SCALE && pattern.lastStep === STEPS && ROW_IDS.every((id) => pattern.steps[id] === EMPTY_ROW)
  );
}

export function withRow(pattern: Pattern, row: RowId, steps: string): Pattern {
  return { ...pattern, steps: { ...pattern.steps, [row]: steps } };
}

export function withLevel(mix: Mix, fader: FaderId, level: number): Mix {
  return { ...mix, levels: { ...mix.levels, [fader]: level } };
}
