import { EMPTY_ROW, INSTRUMENT_IDS, TRACK_IDS, withStep, type TrackId } from './machine';
import { createEmptyPattern, createEmptyPatterns, createEmptyTracks, type Pattern, type PatternTrack } from './project';

type Hits = Partial<Record<TrackId, number[]>>;
type Shape = Partial<Pick<Pattern, 'scale' | 'lastStep' | 'shuffle'>>;

function pattern(hits: Hits, shape: Shape = {}): Pattern {
  const steps = Object.fromEntries(TRACK_IDS.map((id) => [id, EMPTY_ROW])) as Pattern['steps'];
  for (const [track, on] of Object.entries(hits) as Array<[TrackId, number[]]>) {
    for (const step of on) steps[track] = withStep(steps[track], step, true);
  }
  return { ...createEmptyPattern(), ...shape, steps };
}

const BEATS = [0, 4, 8, 12];
const OFFBEATS = [2, 6, 10, 14];
const EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14];
/** Every sixteenth but the off-beats, which the open hi-hat takes. */
const AROUND_OFFBEATS = [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15];
const EVERY_STEP = Array.from({ length: 16 }, (_, step) => step);

/**
 * What a new machine remembers, so the first press of start is audible and
 * the track keys have something to play. Written for this machine; these are
 * not the hardware's factory patterns. Group 1 has patterns 1 to 8 and 16,
 * group 2 has patterns 1 and 2, and the rest are left empty.
 */
export function createStarterPatterns(): Pattern[][] {
  const [first, second] = createEmptyPatterns() as [Pattern[], Pattern[]];

  // 1: the beat the page opens on. Four on the floor, a clap and the open hat between.
  first[0] = pattern({
    accent: BEATS,
    bass_drum: BEATS,
    hand_clap: [4, 12],
    closed_hat: AROUND_OFFBEATS,
    open_hat: OFFBEATS,
    rim_shot: [7, 10],
  });

  // 2: the same floor with the snare joining and a push into the next bar.
  first[1] = pattern({
    accent: [0, 4, 8, 12, 15],
    bass_drum: [0, 4, 8, 12, 14],
    snare_drum: [4, 12, 15],
    hand_clap: [4, 12],
    closed_hat: EIGHTHS,
    open_hat: OFFBEATS,
    crash: [0],
  });

  // 3: the ride takes over and the toms answer each other.
  first[2] = pattern({
    accent: [0, 8],
    bass_drum: BEATS,
    hand_clap: [4, 12],
    ride: OFFBEATS,
    closed_hat: BEATS,
    low_tom: [3, 11],
    mid_tom: [6],
    hi_tom: [9, 14],
    rim_shot: [2, 15],
  });

  // 4: a fill. The toms come down, then the snare runs up to the bar line.
  first[3] = pattern({
    accent: [0, 12, 13, 14, 15],
    bass_drum: [0, 4, 8],
    hi_tom: [4, 5],
    mid_tom: [6],
    low_tom: [7],
    snare_drum: [8, 10, 12, 13, 14, 15],
    closed_hat: [0, 2],
    open_hat: [3],
  });

  // 5: a broken beat, shuffled.
  first[4] = pattern(
    {
      accent: [4, 12],
      bass_drum: [0, 3, 10],
      snare_drum: [4, 12],
      closed_hat: EIGHTHS,
      open_hat: [7],
      rim_shot: [9, 14],
      ride: [0],
    },
    { shuffle: 4 },
  );

  // 6: triplets: twelve steps of three to the beat.
  first[5] = pattern(
    {
      accent: [0, 6],
      bass_drum: [0, 5, 6],
      snare_drum: [3, 9],
      closed_hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      open_hat: [11],
      ride: [0, 3, 6, 9],
    },
    { scale: 2, lastStep: 12 },
  );

  // 7: half a bar of thirty-second notes: a hat roll into a snare roll.
  first[6] = pattern(
    {
      accent: [0, 8, 12, 14],
      bass_drum: [0, 8],
      hand_clap: [8],
      closed_hat: [0, 1, 2, 3, 4, 5, 6, 7],
      snare_drum: [10, 12, 13, 14, 15],
      crash: [0],
    },
    { scale: 3 },
  );

  // 8: seven steps, for a bar that turns round early.
  first[7] = pattern(
    {
      accent: [0, 4],
      bass_drum: [0, 3, 6],
      snare_drum: [4],
      closed_hat: EVERY_STEP.slice(0, 7),
      hi_tom: [2, 5],
    },
    { lastStep: 7 },
  );

  // 16: every sound together, for setting levels and hearing each one.
  first[15] = pattern(Object.fromEntries(INSTRUMENT_IDS.map((id) => [id, BEATS])));

  // Group 2. 1: the floor stripped back to the bass drum, the rim and the ride.
  second[0] = pattern({
    accent: [0],
    bass_drum: BEATS,
    rim_shot: [3, 6, 11, 14],
    ride: EIGHTHS,
    hi_tom: [10],
  });

  // Group 2. 2: its answer, with the clap and a crash to come back in on.
  second[1] = pattern({
    accent: [0, 12],
    bass_drum: [0, 4, 8, 11, 12],
    hand_clap: [4, 12],
    rim_shot: [3, 6, 14],
    ride: EIGHTHS,
    low_tom: [13, 15],
    crash: [0],
  });

  return [first, second];
}

/**
 * The track a new machine has under TRACK 1, so track play has something to
 * play: two eight-measure phrases of group 1, each ending in the fill.
 */
export function createStarterTracks(): PatternTrack[] {
  const tracks = createEmptyTracks();
  const phrase = (basic: number, turn: number) => [basic, basic, basic, turn, basic, basic, basic, 3];
  tracks[0] = { group: 0, measures: [...phrase(0, 1), ...phrase(2, 1)] };
  return tracks;
}
