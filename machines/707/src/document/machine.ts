import { z } from 'zod';
import machineDocument from '../../data/707.machine.json';

/**
 * The 707 as sounds and rows. It has fifteen sounds. A row is one line of
 * its pattern display and one engine track: the accent, or an instrument.
 * Four instruments have two sounds and play one of them at a time.
 *
 * "Track" is the machine's own word for a chain of patterns, so a line of
 * steps is called a row here.
 *
 * A sound's place in SOUND_IDS is its sound number and its sound slot in the
 * engine. A row's place in ROW_IDS is its engine track. Never reorder either.
 */
export const SOUND_IDS = [
  'bass_drum_1',
  'bass_drum_2',
  'snare_drum_1',
  'snare_drum_2',
  'low_tom',
  'mid_tom',
  'hi_tom',
  'rim_shot',
  'cowbell',
  'hand_clap',
  'tambourine',
  'closed_hat',
  'open_hat',
  'crash',
  'ride',
] as const;
export type SoundId = (typeof SOUND_IDS)[number];

export const INSTRUMENT_IDS = [
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
export const ROW_IDS = ['accent', ...INSTRUMENT_IDS] as const;
/** Instruments with two sounds: the project says which one each plays. */
export const PAIRED_IDS = ['bass_drum', 'snare_drum', 'rim_cowbell', 'clap_tambourine'] as const;
/** The level faders. The two hi-hats share one. */
export const FADER_IDS = [
  'bass_drum',
  'snare_drum',
  'low_tom',
  'mid_tom',
  'hi_tom',
  'rim_cowbell',
  'clap_tambourine',
  'hi_hat',
  'crash',
  'ride',
] as const;

export type InstrumentId = (typeof INSTRUMENT_IDS)[number];
export type RowId = (typeof ROW_IDS)[number];
export type PairedId = (typeof PAIRED_IDS)[number];
export type FaderId = (typeof FADER_IDS)[number];

const knobSchema = z.number().min(0).max(1);

const soundSchema = z.object({
  id: z.enum(SOUND_IDS),
  /** As the display abbreviates it where there is little room. */
  short: z.string().min(1).max(3),
  name: z.string().min(1).max(40),
  gmNote: z.number().int().min(0).max(127),
  /** Where the voice's four knobs stand. The panel has none: this is the machine's voicing. */
  knobs: z.object({ tune: knobSchema, tone: knobSchema, decay: knobSchema, snappy: knobSchema }),
});

const rowSchema = z.object({
  id: z.enum(ROW_IDS),
  label: z.string().min(1).max(40),
  /** The sounds this row can play. The accent has none; a paired instrument has two. */
  sounds: z.array(z.enum(SOUND_IDS)).min(1).max(2).optional(),
  fader: z.enum(FADER_IDS).optional(),
  /** Gain with the row's fader at its resting position. */
  trim: z.number().min(0).max(4).default(1),
  pan: z.number().min(-1).max(1).default(0),
  /** 0 is no choke. A hit in group N cuts off sounding voices of group N. */
  chokeGroup: z.number().int().min(0).max(15).default(0),
});

/** Step keys on the panel, and the most steps a pattern holds. */
export const STEPS = 16;

const machineSchema = z.object({
  format: z.literal('boombapbot.machine'),
  schemaVersion: z.literal(1),
  id: z.literal('707'),
  sounds: z.array(soundSchema).length(SOUND_IDS.length),
  rows: z.array(rowSchema).length(ROW_IDS.length),
  /** The sound lettered under each step key: what the key chooses and what it plays when tapped. */
  keys: z.array(z.enum(SOUND_IDS)).length(STEPS),
});

export type Sound = z.infer<typeof soundSchema> & {
  /** Sound number, which is also its slot in the engine. */
  index: number;
};

export type Row = z.infer<typeof rowSchema> & {
  /** Engine track: 0 is the accent, 1 to 11 the instruments. */
  index: number;
};

function loadMachine(): { sounds: Sound[]; rows: Row[]; keys: SoundId[] } {
  const machine = machineSchema.parse(machineDocument);
  const sounds = machine.sounds.map((sound, index) => {
    if (sound.id !== SOUND_IDS[index]) throw new Error(`707.machine.json lists ${sound.id} where ${SOUND_IDS[index]} belongs`);
    return { ...sound, index };
  });
  const rows = machine.rows.map((row, index) => {
    if (row.id !== ROW_IDS[index]) throw new Error(`707.machine.json lists ${row.id} where ${ROW_IDS[index]} belongs`);
    const instrument = row.id !== 'accent';
    if (instrument !== (row.sounds !== undefined && row.fader !== undefined)) {
      throw new Error(`row ${row.id} of 707.machine.json has the wrong sounds or fader`);
    }
    const paired = (PAIRED_IDS as readonly string[]).includes(row.id);
    if (instrument && paired !== (row.sounds?.length === 2)) throw new Error(`row ${row.id} has the wrong number of sounds`);
    return { ...row, index };
  });
  const played = rows.flatMap((row) => row.sounds ?? []);
  if (played.length !== SOUND_IDS.length || SOUND_IDS.some((id) => !played.includes(id))) {
    throw new Error('707.machine.json must give every sound to exactly one row');
  }
  return { sounds, rows, keys: machine.keys };
}

const MACHINE = loadMachine();

export const SOUNDS: readonly Sound[] = MACHINE.sounds;
export const ROWS: readonly Row[] = MACHINE.rows;
/** The sound of each step key, 1 to 16. The closed hi-hat has two keys. */
export const KEY_SOUNDS: readonly SoundId[] = MACHINE.keys;

export function getSound(id: SoundId): Sound {
  return SOUNDS[SOUND_IDS.indexOf(id)]!;
}

export function getRow(id: RowId): Row {
  return ROWS[ROW_IDS.indexOf(id)]!;
}

export function isInstrumentId(id: RowId): id is InstrumentId {
  return id !== 'accent';
}

export function isPaired(id: RowId): id is PairedId {
  return (PAIRED_IDS as readonly string[]).includes(id);
}

/** The sounds an instrument can play, in the order of their step keys. */
export function rowSounds(id: InstrumentId): readonly SoundId[] {
  return getRow(id).sounds ?? [];
}

/** The instrument whose row a sound is played on. */
export function soundRow(sound: SoundId): InstrumentId {
  const row = INSTRUMENT_IDS.find((id) => rowSounds(id).includes(sound));
  if (!row) throw new Error(`no row plays ${sound}`);
  return row;
}

/** The fader that sets an instrument's level. */
export function rowFader(id: InstrumentId): FaderId {
  const { fader } = getRow(id);
  if (!fader) throw new Error(`row ${id} has no fader`);
  return fader;
}

// ---- Patterns ----------------------------------------------------------------

/**
 * The machine has four groups of sixteen patterns. The engine holds
 * thirty-two, so this one has two: A and B.
 */
export const GROUPS = ['a', 'b'] as const;
export type Group = (typeof GROUPS)[number];
export const GROUP_PATTERNS = 16;
export const PATTERN_COUNT = GROUPS.length * GROUP_PATTERNS;

/**
 * Where the engine keeps a pattern. Pattern n of group A is 2n and of group
 * B 2n + 1, so that a track, which keeps to one group, is a song the engine
 * can play by itself: its rhythm r is pattern 2r plus the version.
 */
export function patternIndex(group: Group, pattern: number): number {
  return pattern * 2 + GROUPS.indexOf(group);
}

/** The group and number of an engine pattern. */
export function patternAt(index: number): { group: Group; pattern: number } {
  return { group: GROUPS[index % 2]!, pattern: index >> 1 };
}

/** What a pattern is called: its group and its step key. */
export function patternName(group: Group, pattern: number): string {
  return `${group.toUpperCase()}${pattern + 1}`;
}

/**
 * Steps to the beat, in the order of the chart above the step keys: triplet
 * sixteenths, triplet eighths, thirty-seconds and sixteenths.
 */
export const SCALES = [6, 3, 8, 4] as const;
export type Scale = (typeof SCALES)[number];
export const DEFAULT_SCALE: Scale = 4;

export const SCALE_NAMES: Record<Scale, string> = {
  6: 'sixteenth-note triplets',
  3: 'eighth-note triplets',
  8: 'thirty-second notes',
  4: 'sixteenth notes',
};

/** A row of steps: 'x' on, '.' off. */
export const STEP_ON = 'x';
export const STEP_OFF = '.';
export const EMPTY_ROW = STEP_OFF.repeat(STEPS);

export function isStepOn(row: string, step: number): boolean {
  return row[step] === STEP_ON;
}

export function withStep(row: string, step: number, on: boolean): string {
  if (step < 0 || step >= STEPS) return row;
  return `${row.slice(0, step)}${on ? STEP_ON : STEP_OFF}${row.slice(step + 1)}`;
}

/** A row as the engine takes it: bit n is step n. */
export function rowMask(row: string): number {
  let mask = 0;
  for (let step = 0; step < STEPS; step += 1) if (isStepOn(row, step)) mask |= 1 << step;
  return mask;
}

/** Steps that are on among the first `length`. */
export function countSteps(row: string, length: number = STEPS): number {
  let count = 0;
  for (let step = 0; step < length; step += 1) if (isStepOn(row, step)) count += 1;
  return count;
}

// ---- Tracks ------------------------------------------------------------------

export const TRACK_COUNT = 4;
/** Lettered as on the panel. */
export const TRACK_NAMES = ['I', 'II', 'III', 'IV'] as const;
/** The most measures one track holds. Four of them fill the engine's longest song. */
export const TRACK_MEASURES = 192;

// ---- Tempo and shuffle -------------------------------------------------------

export const BPM_MIN = 40;
export const BPM_MAX = 240;

export function clampBpm(bpm: number): number {
  return Number.isFinite(bpm) ? Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm))) : 120;
}

/** The shuffle settings: 0 is none. */
export const SHUFFLES = [0, 1, 2, 3, 4] as const;
export type Shuffle = (typeof SHUFFLES)[number];

/** The engine's swing for a shuffle setting. The most there is plays every second step as a triplet would. */
export function shuffleSwing(shuffle: Shuffle): number {
  return Math.round((shuffle * 256) / 3 / (SHUFFLES.length - 1));
}

// ---- Mix ---------------------------------------------------------------------

/** Where a level fader rests: the instrument plays at its trim. */
export const DEFAULT_LEVEL = 0.75;
/** How loud a hit with no accent is, against a fully accented one. */
const PLAIN_HIT = 0.6;

export function clampKnob(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

/** Gain of an instrument: silent with its fader at the bottom, its trim at rest. */
export function levelGain(id: InstrumentId, level: number): number {
  const travel = clampKnob(level) / DEFAULT_LEVEL;
  return getRow(id).trim * travel * travel;
}

/** Gains of a plain and an accented hit, for the accent fader. */
export function accentGains(accent: number): { plain: number; accented: number } {
  return { plain: PLAIN_HIT, accented: PLAIN_HIT + (1 - PLAIN_HIT) * clampKnob(accent) };
}

export function masterGain(volume: number): number {
  return clampKnob(volume) ** 1.5;
}

/** What each level fader is called. */
export const FADER_NAMES: Record<FaderId, string> = {
  bass_drum: 'Bass Drum',
  snare_drum: 'Snare Drum',
  low_tom: 'Low Tom',
  mid_tom: 'Mid Tom',
  hi_tom: 'Hi Tom',
  rim_cowbell: 'Rim Shot and Cowbell',
  clap_tambourine: 'Hand Clap and Tambourine',
  hi_hat: 'Hi-Hat',
  crash: 'Crash',
  ride: 'Ride',
};
