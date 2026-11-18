import { z } from 'zod';
import machineDocument from '../../data/machine-808.json';
import { ROLE_IDS, getRole, type Role, type RoleId } from './roles';

/**
 * The 808 as a set of tracks. A track is one position of the instrument
 * selector and one row of a rhythm: the accent, or an instrument. An
 * instrument plays one sound (a role), and five of them can be switched to
 * an alternate sound that shares the track's steps and knobs.
 */
export const INSTRUMENT_IDS = [
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
export const TRACK_IDS = ['accent', ...INSTRUMENT_IDS] as const;
/** Instruments with a switch that selects an alternate sound. */
export const SWITCHED_IDS = ['low_tom', 'mid_tom', 'high_tom', 'rim_shot', 'clap'] as const;

export type InstrumentId = (typeof INSTRUMENT_IDS)[number];
export type TrackId = (typeof TRACK_IDS)[number];
export type SwitchedId = (typeof SWITCHED_IDS)[number];

/** The sound knobs a panel column can have, besides its level. */
export const SOUND_PARAMS = ['tune', 'tone', 'decay', 'snappy'] as const;
export type SoundParam = (typeof SOUND_PARAMS)[number];

/** Every knob a panel column can have. The accent column has a level and nothing else. */
export const KNOB_PARAMS = ['level', ...SOUND_PARAMS] as const;
export type KnobParam = (typeof KNOB_PARAMS)[number];

/** What each knob is called on the panel. */
export const KNOB_PARAM_LABELS: Record<KnobParam, string> = {
  level: 'level',
  tune: 'tuning',
  tone: 'tone',
  decay: 'decay',
  snappy: 'snappy',
};

const trackSchema = z.object({
  id: z.enum(TRACK_IDS),
  short: z.string().min(1).max(4),
  label: z.string().min(1).max(40),
  /** The sound this track plays. The accent track has none. */
  sound: z.enum(ROLE_IDS).optional(),
  /** The sound it plays with its voice switch thrown. */
  alternate: z.enum(ROLE_IDS).optional(),
  /** Fixed mix gain with the level knob at its default. */
  trim: z.number().min(0).max(4).default(1),
  pan: z.number().min(-1).max(1).default(0),
  /** 0 is no choke. A hit in group N releases sounding voices of group N. */
  chokeGroup: z.number().int().min(0).max(15).default(0),
  knobs: z.array(z.enum(SOUND_PARAMS)).default([]),
});

const machineSchema = z.object({
  format: z.literal('boombapbot.machine'),
  schemaVersion: z.literal(1),
  id: z.literal('808'),
  tracks: z.array(trackSchema).length(TRACK_IDS.length),
});

export type Track = z.infer<typeof trackSchema> & {
  /** Engine track number: 0 is the accent, 1 to 11 the instruments. */
  index: number;
};

function loadTracks(): Track[] {
  const { tracks } = machineSchema.parse(machineDocument);
  return tracks.map((track, index) => {
    if (track.id !== TRACK_IDS[index]) throw new Error('data/machine-808.json does not match TRACK_IDS');
    const instrument = track.id !== 'accent';
    if (instrument !== (track.sound !== undefined)) throw new Error(`track ${track.id} has the wrong sound`);
    const switched = (SWITCHED_IDS as readonly string[]).includes(track.id);
    if (switched !== (track.alternate !== undefined)) throw new Error(`track ${track.id} has the wrong alternate`);
    return { ...track, index };
  });
}

export const TRACKS: readonly Track[] = loadTracks();

const tracksById = new Map<TrackId, Track>(TRACKS.map((track) => [track.id, track]));

export function getTrack(id: TrackId): Track {
  const track = tracksById.get(id);
  if (!track) throw new Error(`unknown track: ${id}`);
  return track;
}

export function isSwitched(id: TrackId): id is SwitchedId {
  return (SWITCHED_IDS as readonly string[]).includes(id);
}

/** The sound an instrument plays, given where its voice switch stands. */
export function trackRole(id: InstrumentId, alternate: boolean): Role {
  const track = getTrack(id);
  return getRole((alternate && track.alternate ? track.alternate : track.sound) as RoleId);
}

// ---- Rhythm geometry -------------------------------------------------------

/** Step buttons, and the most steps one part of a rhythm can hold. */
export const PART_STEPS = 16;
/** A rhythm is a 1st part and a 2nd part played one after the other. */
export const MAX_STEPS = PART_STEPS * 2;
/** Basic Rhythm buttons 1 to 12. */
export const BASIC_RHYTHMS = 12;
/** Intro/Fill-in buttons 1 to 4. */
export const FILL_RHYTHMS = 4;
export const RHYTHM_COUNT = BASIC_RHYTHMS + FILL_RHYTHMS;
/** Every rhythm has an A and a B version, so the engine holds this many patterns. */
export const PATTERN_COUNT = RHYTHM_COUNT * 2;
export const RHYTHM_TRACKS = 12;
export const RHYTHM_TRACK_MEASURES = 64;

export const PRE_SCALES = [1, 2, 3, 4] as const;
export type PreScale = (typeof PRE_SCALES)[number];
/** The pre-scale after a clear: four steps to the beat. */
export const DEFAULT_PRE_SCALE: PreScale = 3;

const STEPS_PER_BEAT: Record<PreScale, number> = { 1: 3, 2: 6, 3: 4, 4: 8 };

/** Steps in one quarter note at a pre-scale. */
export function stepsPerBeat(preScale: PreScale): number {
  return STEPS_PER_BEAT[preScale];
}

export type Variation = 'a' | 'b';

/** Where the engine keeps one version of a rhythm. */
export function patternIndex(rhythm: number, variation: Variation): number {
  return rhythm * 2 + (variation === 'b' ? 1 : 0);
}

// ---- Rows of steps ----------------------------------------------------------

export const STEP_ON = 'x';
export const STEP_OFF = '.';
/** One track of one version of a rhythm: a character per step. */
export const EMPTY_ROW = STEP_OFF.repeat(MAX_STEPS);

export function isStepOn(row: string, step: number): boolean {
  return row[step] === STEP_ON;
}

export function withStep(row: string, step: number, on: boolean): string {
  if (step < 0 || step >= MAX_STEPS) return row;
  return row.slice(0, step) + (on ? STEP_ON : STEP_OFF) + row.slice(step + 1);
}

/** The row as the engine takes it: bit n is step n. */
export function rowMask(row: string): number {
  let mask = 0;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (row[step] === STEP_ON) mask |= 1 << step;
  }
  return mask >>> 0;
}

export function countSteps(row: string, length: number): number {
  let count = 0;
  for (let step = 0; step < length; step += 1) if (row[step] === STEP_ON) count += 1;
  return count;
}

// ---- Tempo -----------------------------------------------------------------

export const BPM_MIN = 40;
export const BPM_MAX = 300;
/** Click stops of the tempo knob. */
export const TEMPO_STOPS = 40;
const BPM_PER_STOP = (BPM_MAX - BPM_MIN) / (TEMPO_STOPS - 1);

export interface Tempo {
  /** Click stop of the tempo knob, 0 to 39. */
  coarse: number;
  /** The fine knob, from -1 to 1: up to one click stop either way. */
  fine: number;
}

export function tempoBpm(tempo: Tempo): number {
  const bpm = BPM_MIN + (tempo.coarse + tempo.fine) * BPM_PER_STOP;
  return Math.min(BPM_MAX, Math.max(BPM_MIN, bpm));
}

/** The knob positions for a tempo: the nearest click stop, then the fine knob. */
export function tempoFromBpm(bpm: number): Tempo {
  const wanted = Number.isFinite(bpm) ? Math.min(BPM_MAX, Math.max(BPM_MIN, bpm)) : 120;
  const stops = (wanted - BPM_MIN) / BPM_PER_STOP;
  const coarse = Math.round(stops);
  return { coarse, fine: Math.round((stops - coarse) * 1000) / 1000 };
}

// ---- Mix -------------------------------------------------------------------

export const DEFAULT_LEVEL = 0.75;
/** How loud a hit with no accent is, against a fully accented one. */
const PLAIN_HIT = 0.6;

export function clampKnob(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

/** Gain of an instrument: silent fully left, its trim at the default level. */
export function levelGain(id: InstrumentId, level: number): number {
  const turn = clampKnob(level) / DEFAULT_LEVEL;
  return getTrack(id).trim * turn * turn;
}

/** Gains of a plain and an accented hit, for the accent level knob. */
export function accentGains(level: number): { plain: number; accented: number } {
  return { plain: PLAIN_HIT, accented: PLAIN_HIT + (1 - PLAIN_HIT) * clampKnob(level) };
}

export function masterGain(volume: number): number {
  return Math.pow(clampKnob(volume), 1.5);
}
