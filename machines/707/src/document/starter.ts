import { DEFAULT_SCALE, EMPTY_ROW, GROUP_PATTERNS, ROW_IDS, STEPS, type RowId, type Scale } from './machine';
import type { Pattern, Project, Track } from './project';

/** A row from a drawing of it, with spaces to keep the beats apart. Steps it leaves out are off. */
function row(drawing: string): string {
  return drawing.replace(/\s/g, '').padEnd(STEPS, '.');
}

function pattern(steps: Partial<Record<RowId, string>>, scale: Scale = DEFAULT_SCALE, lastStep: number = STEPS): Pattern {
  return {
    scale,
    lastStep,
    steps: Object.fromEntries(ROW_IDS.map((id) => [id, row(steps[id] ?? EMPTY_ROW)])) as Record<RowId, string>,
  };
}

function group(written: Pattern[]): Pattern[] {
  return Array.from({ length: GROUP_PATTERNS }, (_, index) => written[index] ?? pattern({}));
}

/**
 * What a new project opens with. A1 is a beat, A2 a busier turn of it, A3 a
 * fill on the toms and A4 a broken beat on the ride. B1 is a shuffle in
 * triplets, twelve steps long. The rest are left empty to write on. These
 * are written for this machine.
 */
export function createStarterGroups(): Project['groups'] {
  return {
    a: group([
      pattern({
        accent: 'x... x... x... x...',
        bass_drum: 'x... x... x... x...',
        snare_drum: '.... x... .... x...',
        clap_tambourine: '.... x... .... x...',
        closed_hat: 'xx.x xx.x xx.x xx.x',
        open_hat: '..x. ..x. ..x. ..x.',
      }),
      pattern({
        accent: 'x... x... x... x.x.',
        bass_drum: 'x... x... x.x. x...',
        snare_drum: '.... x... .... x..x',
        clap_tambourine: '.... x... .... x...',
        rim_cowbell: '..x. .x.. x..x ..x.',
        closed_hat: 'xx.x xx.x xx.x xx.x',
        open_hat: '..x. ..x. ..x. ..x.',
      }),
      pattern({
        accent: 'x... x... x... x..x',
        bass_drum: 'x... .... x... ....',
        snare_drum: '.... x... .... x.xx',
        hi_tom: '.... ..x. x... ....',
        mid_tom: '.... ...x .x.. x...',
        low_tom: '.... .... ..xx .x..',
        closed_hat: 'x.x. x.x. .... ....',
      }),
      pattern({
        accent: 'x... x... x... x...',
        bass_drum: 'x..x .... .xx. ....',
        snare_drum: '.... x... .... x...',
        rim_cowbell: '.... ..x. .... ..x.',
        crash: 'x... .... .... ....',
        ride: 'x.x. x.x. x.x. x.xx',
      }),
    ]),
    b: group([
      pattern(
        {
          accent: 'x.. x.. x.. x..',
          bass_drum: 'x.. ..x x.. ...',
          snare_drum: '... x.. ... x..',
          clap_tambourine: '... x.. ... x..',
          closed_hat: 'x.x x.x x.x x..',
          open_hat: '... ... ... ..x',
        },
        3,
        12,
      ),
    ]),
  };
}

/** Track I plays the beat with its turn and its fill: eight measures. The other three are empty. */
export function createStarterTracks(): Track[] {
  return [
    { group: 'a', measures: [0, 0, 0, 1, 0, 0, 0, 2] },
    { group: 'a', measures: [] },
    { group: 'a', measures: [] },
    { group: 'a', measures: [] },
  ];
}
