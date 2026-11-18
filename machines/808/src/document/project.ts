import { z } from 'zod';
import {
  MAX_PROJECT_BYTES,
  PROJECT_FORMAT,
  type ParseResult as DocumentParseResult,
} from '@boombapbot/contracts';
import { readV1, type V1Beat } from './legacy';
import {
  DEFAULT_LEVEL,
  DEFAULT_PRE_SCALE,
  EMPTY_ROW,
  INSTRUMENT_IDS,
  MAX_STEPS,
  PART_STEPS,
  RHYTHM_COUNT,
  RHYTHM_TRACKS,
  RHYTHM_TRACK_MEASURES,
  BASIC_RHYTHMS,
  SOUND_PARAMS,
  SWITCHED_IDS,
  TEMPO_STOPS,
  clampKnob,
  TRACK_IDS,
  countSteps,
  patternIndex,
  tempoFromBpm,
  type InstrumentId,
  type KnobParam,
  type SoundParam,
  type SwitchedId,
  type TrackId,
  type Variation,
} from './machine';
import { createStarterRhythms, createStarterTracks } from './starter';

/**
 * The project document: everything the 808 remembers. Its sound settings, its
 * sixteen rhythms (each with an A and a B version), its twelve rhythm tracks
 * and where the panel's switches stand.
 *
 * This is the plain JSON project used for local drafts and JSON import and
 * export. It is not the future portable `.boombapbot` bundle.
 */
export const PROJECT_SCHEMA_VERSION = 2;

/** Positions of the mode selector, clockwise from the lower left. */
export const MODES = ['pattern_clear', 'write_first', 'write_second', 'manual_play', 'play', 'compose'] as const;
export type Mode = (typeof MODES)[number];

/** Positions of the auto fill-in selector, in measures. 0 is manual. */
export const AUTO_FILLS = [0, 16, 12, 8, 4, 2] as const;
export type AutoFill = (typeof AUTO_FILLS)[number];

const knobSchema = z.number().min(0).max(1);
const rowSchema = z.string().regex(new RegExp(`^[.x]{${MAX_STEPS}}$`), 'a row is 32 steps of "x" or "."');
const variationSchema = z.record(z.enum(TRACK_IDS), rowSchema);
const preScaleSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const rhythmSchema = z.object({
  /** Steps to the beat: 1 is three, 2 is six, 3 is four, 4 is eight. */
  preScale: preScaleSchema,
  /** Steps in the 1st part. */
  firstLength: z.number().int().min(1).max(PART_STEPS),
  /** Steps in the 2nd part, which follows the 1st. 0 when it is not used. */
  secondLength: z.number().int().min(0).max(PART_STEPS),
  a: variationSchema,
  b: variationSchema,
});

export const soundSchema = z.object({
  master: knobSchema,
  /** How much louder an accented step is. */
  accent: knobSchema,
  levels: z.record(z.enum(INSTRUMENT_IDS), knobSchema),
  /** The tone, decay, tuning and snappy knobs of each column. */
  knobs: z.record(z.enum(INSTRUMENT_IDS), z.record(z.enum(SOUND_PARAMS), knobSchema)),
  /** True where a voice switch selects the alternate sound. */
  alternates: z.record(z.enum(SWITCHED_IDS), z.boolean()),
});

export const panelSchema = z.object({
  mode: z.enum(MODES),
  /** Instrument and track selector: 0 is AC or track 1, 11 is CH or track 12. */
  selector: z.number().int().min(0).max(TRACK_IDS.length - 1),
  /** Selected Basic Rhythm, 0 to 11. */
  basicRhythm: z.number().int().min(0).max(BASIC_RHYTHMS - 1),
  /** Selected Intro/Fill-in, 12 to 15. */
  fillRhythm: z.number().int().min(BASIC_RHYTHMS).max(RHYTHM_COUNT - 1),
  basicVariation: z.enum(['a', 'ab', 'b']),
  fillVariation: z.enum(['a', 'b']),
  autoFill: z.union([z.literal(0), z.literal(16), z.literal(12), z.literal(8), z.literal(4), z.literal(2)]),
  /** Where the pre-scale switch stands. A rhythm keeps its own once stored. */
  preScale: preScaleSchema,
  /** Which of the two selected rhythms the write modes work on. */
  writeTarget: z.enum(['basic', 'fill']).default('basic'),
});

export const projectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  tempo: z.object({
    coarse: z.number().int().min(0).max(TEMPO_STOPS - 1),
    fine: z.number().min(-1).max(1),
  }),
  sound: soundSchema,
  rhythms: z.array(rhythmSchema).length(RHYTHM_COUNT),
  /** For each rhythm track, the rhythm played in each measure. */
  rhythmTracks: z
    .array(z.array(z.number().int().min(0).max(RHYTHM_COUNT - 1)).max(RHYTHM_TRACK_MEASURES))
    .length(RHYTHM_TRACKS),
  panel: panelSchema,
});

export type RhythmVariation = z.infer<typeof variationSchema>;
export type Rhythm = z.infer<typeof rhythmSchema>;
export type SoundSettings = z.infer<typeof soundSchema>;
export type SoundKnobs = Record<SoundParam, number>;
export type PanelState = z.infer<typeof panelSchema>;
export type Project = z.infer<typeof projectSchema>;

export type ParseResult = DocumentParseResult<Project>;

function describeIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

/** Validates an already-parsed value, bringing an older project up to date. Never throws. */
export function parseProject(input: unknown): ParseResult {
  let value = input;
  let changes: string[] = [];
  if (typeof input === 'object' && input !== null) {
    const header = input as { format?: unknown; schemaVersion?: unknown };
    if (header.format !== PROJECT_FORMAT) {
      return { ok: false, errors: ['This is not a boombapbot project file.'] };
    }
    if (header.schemaVersion === 1) {
      const old = readV1(input);
      if (!old.ok) return old;
      value = fromV1(old.beat);
      changes = old.changes;
    } else if (header.schemaVersion !== PROJECT_SCHEMA_VERSION) {
      return {
        ok: false,
        errors: [
          `This project uses schema version ${String(header.schemaVersion)}. ` +
            `This build reads versions 1 and ${PROJECT_SCHEMA_VERSION}.`,
        ],
      };
    }
  }
  const result = projectSchema.safeParse(value);
  if (!result.success) return { ok: false, errors: describeIssues(result.error) };
  return { ok: true, project: result.data, changes };
}

/** Parses project JSON text. Never throws. */
export function parseProjectText(text: string): ParseResult {
  if (text.length > MAX_PROJECT_BYTES) {
    return { ok: false, errors: ['The file is too large to be a boombapbot project.'] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['The file is not valid JSON.'] };
  }
  return parseProject(value);
}

export function serializeProject(project: Project): string {
  return `${JSON.stringify(projectSchema.parse(project), null, 2)}\n`;
}

function forEach<Key extends string, Value>(keys: readonly Key[], value: (key: Key) => Value): Record<Key, Value> {
  return Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<Key, Value>;
}

export function createEmptyVariation(): RhythmVariation {
  return forEach(TRACK_IDS, () => EMPTY_ROW);
}

/** A rhythm as CLEAR leaves it: sixteen steps in the 1st part, none in the 2nd. */
export function createEmptyRhythm(): Rhythm {
  return {
    preScale: DEFAULT_PRE_SCALE,
    firstLength: PART_STEPS,
    secondLength: 0,
    a: createEmptyVariation(),
    b: createEmptyVariation(),
  };
}

/** Sixteen rhythms with nothing in them. */
export function createEmptyRhythms(): Rhythm[] {
  return Array.from({ length: RHYTHM_COUNT }, createEmptyRhythm);
}

/** Twelve rhythm tracks with no measures. */
export function createEmptyTracks(): number[][] {
  return Array.from({ length: RHYTHM_TRACKS }, () => []);
}

export function createDefaultSound(): SoundSettings {
  return {
    master: DEFAULT_LEVEL,
    accent: DEFAULT_LEVEL,
    levels: forEach(INSTRUMENT_IDS, () => DEFAULT_LEVEL),
    knobs: forEach(INSTRUMENT_IDS, () => forEach(SOUND_PARAMS, () => 0.5)),
    alternates: forEach(SWITCHED_IDS, () => false),
  };
}

export function createDefaultPanel(): PanelState {
  return {
    mode: 'write_first',
    selector: TRACK_IDS.indexOf('kick'),
    basicRhythm: 0,
    fillRhythm: BASIC_RHYTHMS,
    basicVariation: 'a',
    fillVariation: 'a',
    autoFill: 0,
    preScale: DEFAULT_PRE_SCALE,
    writeTarget: 'basic',
  };
}

export interface NewProjectOptions {
  id: string;
  now: Date;
  name?: string;
  bpm?: number;
  rhythms?: Rhythm[];
}

export function createProject(options: NewProjectOptions): Project {
  const timestamp = options.now.toISOString();
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: options.id,
    name: options.name ?? 'Untitled beat',
    createdAt: timestamp,
    updatedAt: timestamp,
    tempo: tempoFromBpm(options.bpm ?? 120),
    sound: createDefaultSound(),
    rhythms: options.rhythms ?? createStarterRhythms(),
    // The starter track plays the starter rhythms, so it comes only with them.
    rhythmTracks: options.rhythms ? createEmptyTracks() : createStarterTracks(),
    panel: createDefaultPanel(),
  };
}

/** A version 1 beat as a current project: it becomes Basic Rhythm 1, version A. */
function fromV1(beat: V1Beat): Project {
  const rhythms = createEmptyRhythms();
  rhythms[0] = { ...createEmptyRhythm(), a: beat.variation };
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: beat.id,
    name: beat.name,
    createdAt: beat.createdAt,
    updatedAt: beat.updatedAt,
    tempo: tempoFromBpm(beat.bpm),
    sound: createDefaultSound(),
    rhythms,
    rhythmTracks: createEmptyTracks(),
    panel: createDefaultPanel(),
  };
}

/** Where a knob of a panel column stands. The accent column has only a level. */
export function knobPosition(sound: SoundSettings, track: TrackId, param: KnobParam): number {
  if (track === 'accent') return sound.accent;
  return param === 'level' ? sound.levels[track] : sound.knobs[track][param];
}

/** The sound settings with one knob turned. Positions run from 0 to 1. */
export function withKnob(sound: SoundSettings, track: TrackId, param: KnobParam, value: number): SoundSettings {
  const position = clampKnob(value);
  if (track === 'accent') return { ...sound, accent: position };
  if (param === 'level') return { ...sound, levels: { ...sound.levels, [track]: position } };
  return { ...sound, knobs: { ...sound.knobs, [track]: { ...sound.knobs[track], [param]: position } } };
}

/** Modes in which the step buttons write steps, and the part each writes. */
export function writePart(mode: Mode): 0 | 1 | null {
  return mode === 'write_first' ? 0 : mode === 'write_second' ? 1 : null;
}

/**
 * Modes played by hand: the step buttons choose the Basic Rhythm, and TAP
 * brings in the intro or a fill-in. Composing is manual play that is recorded.
 */
export function isPerformMode(mode: Mode): boolean {
  return mode === 'manual_play' || mode === 'compose';
}

/** Modes that work on a rhythm track: the selector then chooses a track, not an instrument. */
export function isTrackMode(mode: Mode): boolean {
  return mode === 'play' || mode === 'compose';
}

/** Whether the step buttons choose a rhythm in this mode. In play they only show what the track plays. */
export function selectsRhythms(mode: Mode): boolean {
  return mode === 'pattern_clear' || isPerformMode(mode);
}

/**
 * The measures a composition plays when it starts on a track: that track, and
 * each following one for as long as the one before it is full.
 */
export function composition(tracks: readonly number[][], start: number): number[] {
  const measures: number[] = [];
  for (let index = start; index < tracks.length; index += 1) {
    measures.push(...tracks[index]!);
    if (tracks[index]!.length < RHYTHM_TRACK_MEASURES) break;
  }
  return measures;
}

/** How many measures can be composed starting on a track: it and every track after it. */
export function compositionCapacity(start: number): number {
  return (RHYTHM_TRACKS - start) * RHYTHM_TRACK_MEASURES;
}

/**
 * The tracks with a composition written from `start`: sixty-four measures to
 * a track, going on into the next. Tracks it does not reach are left alone.
 */
export function withComposition(tracks: readonly number[][], start: number, measures: readonly number[]): number[][] {
  const kept = measures.slice(0, compositionCapacity(start));
  return tracks.map((track, index) => {
    const offset = (index - start) * RHYTHM_TRACK_MEASURES;
    const reached = index === start || (index > start && offset < kept.length);
    return reached ? kept.slice(offset, offset + RHYTHM_TRACK_MEASURES) : track;
  });
}

/**
 * The rhythm and version the panel is on: what the write modes edit and CLEAR
 * clears. With the variation switch on AB the machine plays A and B in turn,
 * so the version is whichever of this rhythm's patterns is playing, or A.
 */
export function panelTarget(panel: PanelState, playingPattern = -1): { rhythm: number; variation: Variation } {
  if (panel.writeTarget === 'fill') return { rhythm: panel.fillRhythm, variation: panel.fillVariation };
  const rhythm = panel.basicRhythm;
  if (panel.basicVariation !== 'ab') return { rhythm, variation: panel.basicVariation };
  const playingB = playingPattern === patternIndex(rhythm, 'b');
  return { rhythm, variation: playingB ? 'b' : 'a' };
}

/** The versions CLEAR wipes: both when the rhythm's variation switch stands on AB. */
export function clearedVersions(panel: PanelState): Variation[] {
  if (panel.writeTarget === 'basic' && panel.basicVariation === 'ab') return ['a', 'b'];
  return [panelTarget(panel).variation];
}

/**
 * A rhythm after CLEAR: the given versions emptied, and its parts back to
 * sixteen steps and none. The lengths belong to both versions.
 */
export function clearRhythm(rhythm: Rhythm, versions: readonly Variation[]): Rhythm {
  const cleared = { ...rhythm, firstLength: PART_STEPS, secondLength: 0 };
  for (const version of versions) cleared[version] = createEmptyVariation();
  return cleared;
}

/** A rhythm with the last step of one of its parts set. Steps count from 1. */
export function withPartLength(rhythm: Rhythm, part: 0 | 1, steps: number): Rhythm {
  const length = Math.min(PART_STEPS, Math.max(1, Math.round(steps)));
  return part === 0 ? { ...rhythm, firstLength: length } : { ...rhythm, secondLength: length };
}

/** The step played after `step`. The 2nd part's steps start at 16. */
export function nextStep(rhythm: Rhythm, step: number): number {
  if (step < PART_STEPS) {
    if (step + 1 < rhythm.firstLength) return step + 1;
    return rhythm.secondLength > 0 ? PART_STEPS : 0;
  }
  return step + 1 - PART_STEPS < rhythm.secondLength ? step + 1 : 0;
}

/** The step a tap belongs to: the one sounding, or the next once that one is more than half over. */
export function tappedStep(rhythm: Rhythm, step: number, fraction: number): number {
  return fraction > 0.5 ? nextStep(rhythm, step) : step;
}

/** Steps a rhythm plays in one measure. */
export function rhythmLength(rhythm: Rhythm): number {
  return rhythm.firstLength + rhythm.secondLength;
}

/** Hits on the instrument tracks of one version of a rhythm. */
export function countHits(rhythm: Rhythm, variation: Variation): number {
  const length = rhythmLength(rhythm);
  return INSTRUMENT_IDS.reduce((total, id) => total + countSteps(rhythm[variation][id], length), 0);
}

export function isInstrumentId(id: TrackId): id is InstrumentId {
  return id !== 'accent';
}

export type { SwitchedId };
