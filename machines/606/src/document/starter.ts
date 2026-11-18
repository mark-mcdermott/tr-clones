import { STEPS, STEP_OFF, TRACK_IDS, type Scale, type TrackId } from './machine';
import { createEmptyPatterns, createEmptyTracks, type Pattern } from './project';

/** A row from a drawing of it: spaces keep the beats apart, and steps left off the end are off. */
function row(drawing = ''): string {
  return drawing.replace(/\s/g, '').padEnd(STEPS, STEP_OFF);
}

function pattern(rows: Partial<Record<TrackId, string>>, shape: { scale?: Scale; lastStep?: number } = {}): Pattern {
  return {
    scale: shape.scale ?? 1,
    lastStep: shape.lastStep ?? STEPS,
    steps: Object.fromEntries(TRACK_IDS.map((id) => [id, row(rows[id])])) as Record<TrackId, string>,
  };
}

/**
 * What a new machine remembers, so the first press of RUN is audible and the
 * track modes have something to play. Written for this machine; these are
 * not the hardware's factory patterns. In group I, patterns 1 to 4 are one
 * four-bar phrase to chain, 5 and 6 are four on the floor, 9 is in triplets,
 * 10 is a two-beat fill at eight steps to the beat and 13 is in three. The
 * rest of group I, and all of group II, are left empty to write on.
 */
export function createStarterPatterns(): Pattern[][] {
  const patterns = createEmptyPatterns();
  const one = patterns[0]!;

  one[0] = pattern({
    accent: 'x... x... x... x...',
    kick: 'x... ..x. x.x. ....',
    snare: '.... x... .... x...',
    closed_hat: 'xx.x xxxx xx.x xxxx',
    open_hat: '..x. .... ..x. ....',
  });
  one[1] = pattern({
    accent: 'x... x... x... x.x.',
    kick: 'x... ..x. x..x ....',
    snare: '.... x... .... x.x.',
    closed_hat: 'xx.x xxxx xx.x xx.x',
    open_hat: '..x. .... ..x. ..x.',
    low_tom: '.... .... .... ...x',
  });
  one[2] = pattern({
    accent: 'x... x... x... x...',
    kick: 'x..x ..x. x.x. ....',
    snare: '.... x... .... x...',
    cymbal: 'x... .... .... ....',
    closed_hat: '.x.x xxxx xx.x xxxx',
    open_hat: '..x. .... ..x. ....',
  });
  one[3] = pattern({
    accent: 'x... x... x.x. x.x.',
    kick: 'x... ..x. x... ....',
    snare: '.... x... ..x. x.xx',
    high_tom: '.... .... x.x. ....',
    low_tom: '.... .... .... .x..',
    closed_hat: 'xx.x xxxx .... ....',
    open_hat: '..x. .... .... ....',
  });

  one[4] = pattern({
    accent: '..x. ..x. ..x. ..x.',
    kick: 'x... x... x... x...',
    snare: '.... x... .... x...',
    closed_hat: 'xx.. xx.. xx.. xx..',
    open_hat: '..x. ..x. ..x. ..x.',
  });
  one[5] = pattern({
    accent: '..x. ..x. ..x. x.x.',
    kick: 'x... x... x... x...',
    snare: '.... x... .... x...',
    high_tom: '.... ...x .x.. ....',
    low_tom: '.... .... ...x ..x.',
    closed_hat: 'xx.. xx.. xx.. xx..',
    open_hat: '..x. ..x. ..x. ..x.',
  });

  one[8] = pattern(
    {
      accent: 'x.. x.. x.. x..',
      kick: 'x.. ..x x.. ...',
      snare: '... x.. ... x.x',
      closed_hat: 'x.x x.x x.x x.x',
      cymbal: 'x.. ... ... ...',
    },
    { scale: 3, lastStep: 12 },
  );
  one[9] = pattern(
    {
      accent: 'x... .... x... x.x.',
      kick: 'x... .... .... ....',
      snare: '.... .... x... x.xx',
      closed_hat: 'x.x. x.xx .... ....',
    },
    { scale: 2 },
  );
  one[12] = pattern(
    {
      accent: 'x... .... ....',
      kick: 'x... .... ..x.',
      snare: '.... x... x...',
      closed_hat: 'x.x. x.x. x.x.',
      open_hat: '.... .... ...x',
    },
    { lastStep: 12 },
  );

  return patterns;
}

/** Track 1 plays the four-bar phrase twice, and track 2 the four on the floor. The other six are empty. */
export function createStarterTracks(): number[][] {
  const tracks = createEmptyTracks();
  tracks[0] = [0, 1, 0, 3, 0, 1, 2, 3];
  tracks[1] = [4, 4, 4, 5];
  return tracks;
}
