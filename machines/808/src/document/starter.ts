import {
  EMPTY_ROW,
  TRACK_IDS,
  withStep,
  type InstrumentId,
  type PreScale,
  type TrackId,
} from './machine';
import {
  createEmptyRhythm,
  createEmptyRhythms,
  createEmptyTracks,
  type Rhythm,
  type RhythmVariation,
} from './project';

type Hits = Partial<Record<TrackId, number[]>>;

function variation(hits: Hits): RhythmVariation {
  const rows = Object.fromEntries(TRACK_IDS.map((id) => [id, EMPTY_ROW])) as RhythmVariation;
  for (const [track, steps] of Object.entries(hits) as Array<[TrackId, number[]]>) {
    for (const step of steps) rows[track] = withStep(rows[track], step, true);
  }
  return rows;
}

interface Shape {
  preScale?: PreScale;
  firstLength?: number;
  secondLength?: number;
}

function rhythm(a: Hits, b: Hits, shape: Shape = {}): Rhythm {
  return { ...createEmptyRhythm(), ...shape, a: variation(a), b: variation(b) };
}

const EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14];
const BEATS = [0, 4, 8, 12];
const OFFBEATS = [2, 6, 10, 14];

/** Every instrument on every beat: for setting levels and hearing each sound. */
function everySound(): Hits {
  const instruments: InstrumentId[] = TRACK_IDS.filter((id): id is InstrumentId => id !== 'accent');
  return Object.fromEntries(instruments.map((id) => [id, BEATS]));
}

/**
 * What a new machine remembers, so the first press of start is audible and
 * the play modes have something to play. Written for boombapbot; these are not
 * the hardware's factory rhythms. Basic Rhythms 9 to 11 are left empty.
 */
export function createStarterRhythms(): Rhythm[] {
  const rhythms = createEmptyRhythms();

  // 1: the beat the page opens on.
  rhythms[0] = rhythm(
    {
      accent: [0, 8],
      kick: [0, 4, 7, 8, 10, 12],
      snare: [4, 12],
      closed_hat: [0, 2, 4, 6, 8, 10, 12, 13],
      open_hat: [14],
      clap: [12],
      low_tom: [15],
      high_tom: [11],
    },
    {
      accent: [0, 8, 12],
      kick: [0, 3, 7, 8, 10],
      snare: [4, 12, 15],
      closed_hat: [0, 2, 4, 6, 8, 10, 12],
      open_hat: [14],
      clap: [4, 12],
      cowbell: [6],
    },
  );

  // 2: four on the floor.
  rhythms[1] = rhythm(
    { accent: [4, 12], kick: BEATS, clap: [4, 12], open_hat: OFFBEATS, closed_hat: BEATS },
    { accent: [4, 12], kick: [0, 4, 8, 12, 14], clap: [4, 12], snare: [15], open_hat: OFFBEATS, cowbell: [3, 11] },
  );

  // 3: a broken electro pattern.
  rhythms[2] = rhythm(
    { accent: [0, 4, 12], kick: [0, 3, 6, 10], snare: [4, 12], closed_hat: EIGHTHS, cowbell: [2, 8, 11] },
    { accent: [4, 12], kick: [0, 3, 6, 10, 11], snare: [4, 12, 14], closed_hat: EIGHTHS, clap: [12] },
  );

  // 4: half time.
  rhythms[3] = rhythm(
    { accent: [0, 8], kick: [0, 10], snare: [8], closed_hat: EIGHTHS, open_hat: [6], rim_shot: [3, 13] },
    { accent: [0, 8], kick: [0, 7, 10], snare: [8, 15], closed_hat: EIGHTHS, cymbal: [0] },
  );

  // 5: a clave figure with the toms answering. Try it with the congas and claves switched in.
  rhythms[4] = rhythm(
    {
      accent: [0],
      kick: [0, 6, 8, 14],
      rim_shot: [0, 3, 6, 10, 12],
      cowbell: BEATS,
      high_tom: [3, 11],
      mid_tom: [6, 14],
      low_tom: [7, 15],
      closed_hat: EIGHTHS,
    },
    {
      accent: [0, 8],
      kick: [0, 6, 8, 14],
      rim_shot: [2, 4, 8, 11, 14],
      cowbell: BEATS,
      high_tom: [3, 10, 11],
      mid_tom: [6, 13],
      low_tom: [7, 15],
      clap: [12],
      closed_hat: EIGHTHS,
    },
  );

  // 6: a shuffle in triplets: twelve steps of three to the beat.
  const shuffle: Shape = { preScale: 1, firstLength: 12 };
  rhythms[5] = rhythm(
    { accent: [3, 9], kick: [0, 6], snare: [3, 9], closed_hat: [0, 2, 3, 5, 6, 8, 9, 11] },
    { accent: [3, 9], kick: [0, 5, 6], snare: [3, 9, 11], closed_hat: [0, 2, 3, 5, 6, 8, 9], open_hat: [11] },
    shuffle,
  );

  // 7: five beats, which takes the 2nd part: sixteen steps and four more.
  const five: Shape = { firstLength: 16, secondLength: 4 };
  rhythms[6] = rhythm(
    { accent: [0, 16], kick: [0, 6, 10, 16], snare: [4, 12, 18], closed_hat: [...EIGHTHS, 16, 18] },
    { accent: [0, 16], kick: [0, 6, 10, 16, 17], snare: [4, 12, 18, 19], closed_hat: EIGHTHS, open_hat: [16] },
    five,
  );

  // 8: toms carrying the beat.
  rhythms[7] = rhythm(
    { accent: [0, 12], kick: [0, 8], clap: [4], low_tom: [4, 6], mid_tom: [10], high_tom: [12, 13, 14], closed_hat: BEATS },
    { accent: [0, 12], kick: [0, 8, 11], clap: [4, 12], low_tom: [6, 7], mid_tom: [10, 14], high_tom: [12, 13], closed_hat: BEATS },
  );

  // 12: every sound together.
  rhythms[11] = rhythm(everySound(), everySound());

  // Intro/Fill-ins 1 to 4.
  rhythms[12] = rhythm(
    { accent: [12, 14], kick: [0, 4], closed_hat: [0, 2, 4, 6], snare: [8, 10, 12, 13, 14, 15] },
    { accent: [8, 12], kick: [0, 4, 8], closed_hat: [0, 2, 4, 6], snare: [10, 11, 12, 13, 14, 15], open_hat: [8] },
  );
  rhythms[13] = rhythm(
    { accent: [8, 12], kick: [0, 4, 8], high_tom: [8, 9], mid_tom: [10, 11], low_tom: [12, 13, 14], snare: [15] },
    { accent: [0, 12], kick: [0, 6], high_tom: [4, 5, 12], mid_tom: [8, 9, 13], low_tom: [10, 14, 15], cymbal: [0] },
  );
  rhythms[14] = rhythm(
    { accent: [12], kick: [0, 3, 6], clap: [8, 10, 12, 14], open_hat: [15] },
    { accent: [8, 12], kick: [0, 3, 6, 10], clap: [8, 12, 13, 14, 15], cowbell: [0, 2, 4, 6] },
  );
  rhythms[15] = rhythm(
    { accent: [0], cymbal: [0], kick: [0, 8], snare: [4, 12, 14, 15], closed_hat: OFFBEATS.slice(0, 3) },
    { accent: [0, 12], cymbal: [0], kick: [0, 8, 10], snare: [12, 13, 14, 15], rim_shot: [4, 6] },
  );
  return rhythms;
}

/**
 * The rhythm track a new machine has in track 1, so play has something to
 * play: an intro, two eight-measure phrases with fill-ins, and an ending.
 */
export function createStarterTracks(): number[][] {
  const tracks = createEmptyTracks();
  const phrase = (basic: number, turn: number, end: number) => [basic, basic, basic, turn, basic, basic, basic, end];
  tracks[0] = [12, ...phrase(0, 0, 13), ...phrase(1, 14, 12), ...phrase(2, 2, 15)];
  return tracks;
}
