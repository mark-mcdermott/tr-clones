import { z } from 'zod';
import machineDocument from '../../data/909.machine.json';

/**
 * The 909 as a set of tracks and knobs. A track is one row of a pattern: the
 * total accent, or an instrument. An instrument plays one sound, takes its
 * level from one knob (the two hi-hats share theirs) and has the sound knobs
 * of its panel column, if it has any.
 */
export const INSTRUMENT_IDS = [
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
export const TRACK_IDS = ['accent', ...INSTRUMENT_IDS] as const;

export type InstrumentId = (typeof INSTRUMENT_IDS)[number];
export type TrackId = (typeof TRACK_IDS)[number];

/** Every knob on the panel but the tempo: total accent, volume, the levels and the sound knobs. */
export const KNOB_IDS = [
  'accent',
  'volume',
  'bass_drum_level',
  'bass_drum_tune',
  'bass_drum_attack',
  'bass_drum_decay',
  'snare_drum_level',
  'snare_drum_tune',
  'snare_drum_tone',
  'snare_drum_snappy',
  'low_tom_level',
  'low_tom_tune',
  'low_tom_decay',
  'mid_tom_level',
  'mid_tom_tune',
  'mid_tom_decay',
  'hi_tom_level',
  'hi_tom_tune',
  'hi_tom_decay',
  'rim_shot_level',
  'hand_clap_level',
  'hi_hat_level',
  'closed_hat_decay',
  'open_hat_decay',
  'crash_level',
  'crash_tune',
  'ride_level',
  'ride_tune',
] as const;
export type KnobId = (typeof KNOB_IDS)[number];

/** The engine's four sound knobs. The panel names its own: the bass drum's attack is the engine's tone. */
export const SOUND_PARAMS = ['tune', 'tone', 'decay', 'snappy'] as const;
export type SoundParam = (typeof SOUND_PARAMS)[number];

const knobSchema = z.object({
  id: z.enum(KNOB_IDS),
  /** What a screen reader calls it. */
  label: z.string().min(1).max(40),
  /** Where it stands on a new machine, from 0 to 1. */
  rest: z.number().min(0).max(1),
});

const trackSchema = z.object({
  id: z.enum(TRACK_IDS),
  short: z.string().min(1).max(4),
  label: z.string().min(1).max(40),
  /** General MIDI percussion note used for MIDI export. The accent has none. */
  note: z.number().int().min(1).max(127).optional(),
  /** Fixed mix gain with the level knob at rest. */
  trim: z.number().min(0).max(4).default(1),
  pan: z.number().min(-1).max(1).default(0),
  /** 0 is no choke. A hit in group N releases sounding voices of group N. */
  chokeGroup: z.number().int().min(0).max(15).default(0),
  /** The knob that sets its level. The accent has none here: its knob is `accent`. */
  level: z.enum(KNOB_IDS).optional(),
  /** The panel knob behind each engine knob of its sound. */
  sound: z.partialRecord(z.enum(SOUND_PARAMS), z.enum(KNOB_IDS)).default({}),
});

const machineSchema = z.object({
  format: z.literal('boombapbot.machine'),
  schemaVersion: z.literal(1),
  id: z.literal('909'),
  knobs: z.array(knobSchema).length(KNOB_IDS.length),
  tracks: z.array(trackSchema).length(TRACK_IDS.length),
});

export type PanelKnobInfo = z.infer<typeof knobSchema>;
export type Track = z.infer<typeof trackSchema> & {
  /** Engine track number: 0 is the accent, 1 to 11 the instruments. */
  index: number;
};
export type Instrument = Track & { id: InstrumentId; note: number; level: KnobId };

const machine = machineSchema.parse(machineDocument);

function loadKnobs(): PanelKnobInfo[] {
  machine.knobs.forEach((knob, index) => {
    if (knob.id !== KNOB_IDS[index]) throw new Error('data/909.machine.json does not match KNOB_IDS');
  });
  return machine.knobs;
}

function loadTracks(): Track[] {
  return machine.tracks.map((track, index) => {
    if (track.id !== TRACK_IDS[index]) throw new Error('data/909.machine.json does not match TRACK_IDS');
    const instrument = track.id !== 'accent';
    if (instrument !== (track.note !== undefined) || instrument !== (track.level !== undefined)) {
      throw new Error(`track ${track.id} has the wrong note or level`);
    }
    return { ...track, index };
  });
}

export const KNOBS: readonly PanelKnobInfo[] = loadKnobs();
export const TRACKS: readonly Track[] = loadTracks();
export const INSTRUMENTS = TRACKS.filter((track): track is Instrument => track.id !== 'accent');

const tracksById = new Map<TrackId, Track>(TRACKS.map((track) => [track.id, track]));
const knobsById = new Map<KnobId, PanelKnobInfo>(KNOBS.map((knob) => [knob.id, knob]));

export function getTrack(id: TrackId): Track {
  const track = tracksById.get(id);
  if (!track) throw new Error(`unknown track: ${id}`);
  return track;
}

export function getKnob(id: KnobId): PanelKnobInfo {
  const knob = knobsById.get(id);
  if (!knob) throw new Error(`unknown knob: ${id}`);
  return knob;
}

export function isInstrumentId(id: TrackId): id is InstrumentId {
  return id !== 'accent';
}

// ---- Patterns, groups and tracks ---------------------------------------------

/** Step keys, and the most steps a pattern can hold. */
export const STEPS = 16;
/** Pattern groups. The engine's bank is 32 patterns: two groups of sixteen. */
export const GROUPS = 2;
export const GROUP_PATTERNS = STEPS;
export const PATTERN_COUNT = GROUPS * GROUP_PATTERNS;
/** TRACK keys: a track is a list of patterns, a measure each. */
export const PATTERN_TRACKS = 4;
/** Measures a track can hold: the four together are the longest song the engine takes. */
export const TRACK_MEASURES = 192;

export type Group = 0 | 1;

/**
 * Where the engine keeps a pattern: the two groups are interleaved, so the
 * patterns of one group are the engine's sixteen rhythms in one version.
 */
export function patternIndex(group: number, pattern: number): number {
  return pattern * GROUPS + group;
}

/** The scales, as the chart above the step keys lists them from the top. */
export const SCALES = [1, 2, 3, 4] as const;
export type Scale = (typeof SCALES)[number];
/** The scale of a cleared pattern: four steps to the beat. */
export const DEFAULT_SCALE: Scale = 4;

const STEPS_PER_BEAT: Record<Scale, number> = { 1: 6, 2: 3, 3: 8, 4: 4 };

/** Steps in one quarter note at a scale. */
export function stepsPerBeat(scale: Scale): number {
  return STEPS_PER_BEAT[scale];
}

/** Shuffle settings: 0 is none, on step keys 1 to 7. */
export const SHUFFLE_MAX = 6;
/** The engine's swing with the shuffle as far as it goes: every second step half a step late. */
const ENGINE_SWING_MAX = 128;

/** The engine's swing byte for a shuffle setting. */
export function engineSwing(shuffle: number): number {
  return Math.round((Math.min(SHUFFLE_MAX, Math.max(0, shuffle)) * ENGINE_SWING_MAX) / SHUFFLE_MAX);
}

/**
 * The instrument on each step key, for selecting one and for tap write. On
 * the machine the open hi-hat is keys 13 and 14 together; here it is key 14.
 */
export const KEY_INSTRUMENTS: readonly InstrumentId[] = [
  'bass_drum',
  'bass_drum',
  'snare_drum',
  'snare_drum',
  'low_tom',
  'low_tom',
  'mid_tom',
  'mid_tom',
  'hi_tom',
  'hi_tom',
  'rim_shot',
  'hand_clap',
  'closed_hat',
  'open_hat',
  'crash',
  'ride',
];

// ---- Rows of steps -------------------------------------------------------------

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
  for (let step = 0; step < STEPS; step += 1) {
    if (row[step] === STEP_ON) mask |= 1 << step;
  }
  return mask;
}

export function countSteps(row: string, length: number): number {
  let count = 0;
  for (let step = 0; step < length; step += 1) if (row[step] === STEP_ON) count += 1;
  return count;
}

// ---- Tempo ---------------------------------------------------------------------

/** The slowest the engine plays. The machine's own knob starts a little lower. */
export const BPM_MIN = 40;
export const BPM_MAX = 290;

export function clampBpm(bpm: number): number {
  return Number.isFinite(bpm) ? Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm))) : 120;
}

// ---- Mix -----------------------------------------------------------------------

/** How loud a hit with no accent is, against a fully accented one. */
const PLAIN_HIT = 0.6;

export function clampKnob(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

/** Gain of an instrument: silent with its level fully left, its trim with the knob at rest. */
export function levelGain(instrument: Instrument, level: number): number {
  const turn = clampKnob(level) / getKnob(instrument.level).rest;
  return instrument.trim * turn * turn;
}

/** Gains of a plain and an accented hit, for the total accent knob. */
export function accentGains(accent: number): { plain: number; accented: number } {
  return { plain: PLAIN_HIT, accented: PLAIN_HIT + (1 - PLAIN_HIT) * clampKnob(accent) };
}

export function masterGain(volume: number): number {
  return Math.pow(clampKnob(volume), 1.5);
}
