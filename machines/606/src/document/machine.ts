import { z } from 'zod';
import machineDocument from '../../data/606.machine.json';

/**
 * The 606 as a set of tracks. A track is one position of the instrument
 * selector and one row of a pattern: the accent, or an instrument. An
 * instrument's place in INSTRUMENT_IDS is its sound number in the engine and
 * its sound slot, and one less than its engine track. Never reorder it.
 */
export const INSTRUMENT_IDS = ['kick', 'snare', 'low_tom', 'high_tom', 'cymbal', 'open_hat', 'closed_hat'] as const;
export const TRACK_IDS = ['accent', ...INSTRUMENT_IDS] as const;
/** The level knobs, left to right. The two toms share one, and so do the two hi-hats. */
export const LEVEL_IDS = ['accent', 'bass_drum', 'snare_drum', 'toms', 'cymbal', 'hi_hat'] as const;

export type InstrumentId = (typeof INSTRUMENT_IDS)[number];
export type TrackId = (typeof TRACK_IDS)[number];
export type LevelId = (typeof LEVEL_IDS)[number];
/** A level knob that sets how loud instruments are. The accent's sets how much louder an accented step is. */
export type InstrumentLevelId = Exclude<LevelId, 'accent'>;

const trackSchema = z.object({
  id: z.enum(TRACK_IDS),
  /** As it is lettered beside the selector. */
  short: z.string().min(1).max(4),
  label: z.string().min(1).max(40),
  /** The level knob the instrument answers to. The accent track has none. */
  level: z.enum(LEVEL_IDS).exclude(['accent']).optional(),
  gmNote: z.number().int().min(0).max(127).default(0),
  /** Mix gain with the level knob at its default. */
  trim: z.number().min(0).max(4).default(1),
  /** 0 is no choke. A hit in group N cuts sounding voices of group N. */
  chokeGroup: z.number().int().min(0).max(15).default(0),
});

const machineSchema = z.object({
  format: z.literal('boombapbot.machine'),
  schemaVersion: z.literal(1),
  id: z.literal('606'),
  tracks: z.array(trackSchema).length(TRACK_IDS.length),
});

export type Track = z.infer<typeof trackSchema> & {
  /** Engine track number: 0 is the accent, 1 to 7 the instruments. */
  index: number;
};
export type Instrument = Track & { id: InstrumentId; level: InstrumentLevelId };

function loadTracks(): Track[] {
  const { tracks } = machineSchema.parse(machineDocument);
  return tracks.map((track, index) => {
    if (track.id !== TRACK_IDS[index]) throw new Error(`606.machine.json lists ${track.id} where ${TRACK_IDS[index]} belongs`);
    if ((track.id === 'accent') !== (track.level === undefined)) throw new Error(`track ${track.id} has the wrong level knob`);
    return { ...track, index };
  });
}

export const TRACKS: readonly Track[] = loadTracks();
export const INSTRUMENTS: readonly Instrument[] = TRACKS.filter((track): track is Instrument => track.id !== 'accent');

const tracksById = new Map<TrackId, Track>(TRACKS.map((track) => [track.id, track]));

export function getTrack(id: TrackId): Track {
  const track = tracksById.get(id);
  if (!track) throw new Error(`unknown track: ${id}`);
  return track;
}

export function isInstrumentId(id: TrackId): id is InstrumentId {
  return id !== 'accent';
}

// ---- Patterns, groups and tracks ----------------------------------------------

/** Step keys, and the most steps a pattern holds. */
export const STEPS = 16;
/** Pattern groups, as the panel letters them. */
export const GROUP_NAMES = ['I', 'II'] as const;
export const GROUPS = GROUP_NAMES.length;
export type Group = 0 | 1;
/** Patterns in a group: one to a step key. */
export const GROUP_PATTERNS = 16;
/** Patterns the machine holds, which is all the engine's bank has room for. */
export const PATTERN_COUNT = GROUPS * GROUP_PATTERNS;
/** Neighbouring patterns chain within a block of this many: 1 to 4, 5 to 8, 9 to 12 and 13 to 16. */
export const CHAIN_BLOCK = 4;
/** Tracks: one to a position of the selector. */
export const SONG_TRACKS = TRACK_IDS.length;
/** Measures a track holds. */
export const TRACK_MEASURES = 64;

/** Where the engine keeps a pattern: the two groups take turns through its bank. */
export function bankIndex(pattern: number, group: Group): number {
  return pattern * GROUPS + group;
}

export const SCALES = [1, 2, 3, 4] as const;
export type Scale = (typeof SCALES)[number];
/** The scale a cleared pattern has: four steps to the beat. */
export const DEFAULT_SCALE: Scale = 1;

const STEPS_PER_BEAT: Record<Scale, number> = { 1: 4, 2: 8, 3: 3, 4: 6 };

/** Steps in one quarter note at a scale. */
export function stepsPerBeat(scale: Scale): number {
  return STEPS_PER_BEAT[scale];
}

// ---- Rows of steps ------------------------------------------------------------

export const STEP_ON = 'x';
export const STEP_OFF = '.';
/** One track of a pattern: a character per step. */
export const EMPTY_ROW = STEP_OFF.repeat(STEPS);

export function isStepOn(row: string, step: number): boolean {
  return row[step] === STEP_ON;
}

export function withStep(row: string, step: number, on: boolean): string {
  if (step < 0 || step >= STEPS) return row;
  return row.slice(0, step) + (on ? STEP_ON : STEP_OFF) + row.slice(step + 1);
}

/** The row as the engine takes it: bit n is step n. */
export function rowMask(row: string): number {
  let mask = 0;
  for (let step = 0; step < STEPS; step += 1) if (isStepOn(row, step)) mask |= 1 << step;
  return mask;
}

/** Steps that are on among the first `length`. */
export function countSteps(row: string, length: number): number {
  let count = 0;
  for (let step = 0; step < length; step += 1) if (isStepOn(row, step)) count += 1;
  return count;
}

// ---- Tempo --------------------------------------------------------------------

export const BPM_MIN = 40;
export const BPM_MAX = 300;

export function clampKnob(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

export function clampBpm(bpm: number): number {
  return Number.isFinite(bpm) ? Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm))) : 120;
}

// ---- Mix ----------------------------------------------------------------------

export const DEFAULT_LEVEL = 0.75;
/** How loud a hit with no accent is, against a fully accented one. */
const PLAIN_HIT = 0.6;

/** Gain of an instrument: silent with its knob fully left, its trim at the default level. */
export function levelGain(id: InstrumentId, level: number): number {
  const turn = clampKnob(level) / DEFAULT_LEVEL;
  return getTrack(id).trim * turn * turn;
}

/** Gains of a plain and an accented hit, for the accent knob. */
export function accentGains(level: number): { plain: number; accented: number } {
  return { plain: PLAIN_HIT, accented: PLAIN_HIT + (1 - PLAIN_HIT) * clampKnob(level) };
}

export function masterGain(volume: number): number {
  return Math.pow(clampKnob(volume), 1.5);
}
