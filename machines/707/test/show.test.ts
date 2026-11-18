import { describe, expect, it } from 'vitest';
import { patternIndex, type Project } from '../src/document';
import { RESTING, type HeldKey } from '../src/session';
import {
  announce,
  describeDisplay,
  displayLines,
  heldPrompt,
  keysArePatterns,
  modeWords,
  readout,
  rowName,
  stepKeyName,
  stepLamp,
  trackPosition,
  type Shown,
} from '../src/ui/show';
import { blankProject, loadFixture, newProject } from './helpers';

function shown(project: Project, change: Partial<Omit<Shown, 'project' | 'transient'>> & { held?: HeldKey; playingMeasure?: number } = {}): Shown {
  const { held = null, playingMeasure = -1, ...rest } = change;
  return { project, transient: { ...RESTING, held, playingMeasure }, playing: false, currentPattern: -1, ...rest };
}

function at(project: Project, panel: Partial<Project['panel']>): Project {
  return { ...project, panel: { ...project.panel, chain: null, ...panel } };
}

const lit = (view: Shown): number[] => Array.from({ length: 16 }, (_, key) => key).filter((key) => stepLamp(view, key).on);
const flashing = (view: Shown): number[] => Array.from({ length: 16 }, (_, key) => key).filter((key) => stepLamp(view, key).flash);

describe('the lines of the display', () => {
  it('are ten: the cymbals share one and the hi-hats another, the second of each drawn as an outline', () => {
    const lines = displayLines(newProject());
    expect(lines.map((line) => line.label)).toEqual([
      'CYMBAL',
      'HI HAT',
      'HAND CLAP',
      'RIM SHOT',
      'HI TOM',
      'MID TOM',
      'LOW TOM',
      'SNARE DRUM 1',
      'BASS DRUM 1',
      'ACCENT',
    ]);
    expect(lines[0]).toMatchObject({ solid: 'crash', outline: 'ride' });
    expect(lines[1]).toMatchObject({ solid: 'closed_hat', outline: 'open_hat' });
    // Every row of a pattern is on one line, and only once.
    const rows = lines.flatMap((line) => [line.solid, ...(line.outline ? [line.outline] : [])]);
    expect(new Set(rows).size).toBe(12);
  });

  it('are named for the sounds the project chose', () => {
    const lines = displayLines(loadFixture());
    expect(lines.map((line) => line.short)).toEqual(['CY', 'HH', 'TMB', 'COW', 'HT', 'MT', 'LT', 'SD1', 'BD2', 'AC']);
    expect(rowName('bass_drum', loadFixture())).toBe('Bass Drum 2');
    expect(rowName('accent', loadFixture())).toBe('Accent');
  });
});

describe('what the display reads', () => {
  it('letters the mode as what is played or written, and how', () => {
    expect(modeWords('track_play')).toEqual({ what: 'TRACK', does: 'PLAY', by: null });
    expect(modeWords('track_write')).toEqual({ what: 'TRACK', does: 'WRITE', by: null });
    expect(modeWords('pattern_play')).toEqual({ what: 'PATTERN', does: 'PLAY', by: null });
    expect(modeWords('pattern_step')).toEqual({ what: 'PATTERN', does: 'WRITE', by: 'STEP' });
    expect(modeWords('pattern_tap')).toEqual({ what: 'PATTERN', does: 'WRITE', by: 'TAP' });
  });

  it('counts the tempo, or the measure of a track or of a chain', () => {
    const fixture = loadFixture();
    expect(readout(shown(at(fixture, { readout: 'tempo' })))).toEqual({ caption: 'TEMPO', value: '132' });
    const track = at(fixture, { mode: 'track_play', track: 0, measure: 2, readout: 'measure' });
    expect(readout(shown(track))).toEqual({ caption: 'MEASURE', value: '3' });
    expect(readout(shown(track, { playing: true, playingMeasure: 4 }))).toEqual({ caption: 'MEASURE', value: '5' });
    expect(trackPosition(shown(track))).toEqual({ measure: 3, of: 5 });
    const chain = { ...fixture, panel: { ...fixture.panel, pattern: 0 } };
    expect(readout(shown(chain))).toEqual({ caption: 'MEASURE', value: '1' });
    expect(readout(shown(chain, { playing: true, currentPattern: patternIndex('a', 2) }))).toEqual({ caption: 'MEASURE', value: '3' });
    expect(readout(shown(at(fixture, { readout: 'measure', pattern: 9 })))).toEqual({ caption: 'MEASURE', value: '1' });
  });

  it('says what a key that is down waits for', () => {
    expect(heldPrompt('clear', 'track_write')).toEqual({ key: 'CLEAR', then: 'ENTER' });
    expect(heldPrompt('clear', 'pattern_step')).toEqual({ key: 'CLEAR', then: 'STEP KEY' });
    for (const held of ['shift', 'instrument', 'last_step', 'shuffle', 'copy'] as const) {
      expect(heldPrompt(held, 'pattern_step').key.length).toBeGreaterThan(0);
    }
  });

  it('puts the whole of it in words', () => {
    const fresh = shown(newProject());
    expect(describeDisplay(fresh)).toBe(
      'Pattern play. Pattern A1. 16 steps of sixteenth notes. Tempo 120. No shuffle. ' +
        'Accent on 1, 5, 9, 13. Bass Drum 1 on 1, 5, 9, 13. Snare Drum 1 on 5, 13. Hand Clap on 5, 13. ' +
        'Closed Hi-Hat on 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16. Open Hi-Hat on 3, 7, 11, 15.',
    );
    const fixture = loadFixture();
    expect(describeDisplay(shown(fixture, { playing: true, currentPattern: patternIndex('a', 2) }))).toContain(
      'Pattern play. Pattern A3, playing. Chain A1 to A4. 16 steps of sixteenth notes. Tempo 132. Shuffle 2.',
    );
    expect(describeDisplay(shown(at(fixture, { mode: 'pattern_step', group: 'b', pattern: 1, row: 'rim_cowbell' })))).toBe(
      'Pattern write, by step. Pattern B2. 7 steps of sixteenth notes. Tempo 132. Shuffle 2. Writing Cowbell. ' +
        'Accent on 7. Bass Drum 2 on 1, 4, 7. Low Tom on 2, 5. Mid Tom on 3, 6. Hi Tom on 7. Open Hi-Hat on 1.',
    );
    expect(describeDisplay(shown(at(fixture, { mode: 'track_play', track: 0, measure: 3 })))).toContain(
      'Track play. Track I, measure 4 of 5. Pattern A3.',
    );
    expect(describeDisplay(shown(at(fixture, { mode: 'track_write', track: 0, measure: 5 })))).toContain(
      'Track I, 5 measures, at the end.',
    );
    expect(describeDisplay(shown(at(fixture, { mode: 'track_write', track: 2, pattern: 15 })))).toBe(
      'Track write. Track III, empty. Pattern A16. 16 steps of sixteenth notes. Tempo 132. Shuffle 2. No steps are on.',
    );
  });
});

describe('the lamps of the step keys', () => {
  it('show the pattern the panel is on, and all of a chain', () => {
    const project = blankProject();
    expect(lit(shown(at(project, { pattern: 6 })))).toEqual([6]);
    expect(lit(shown({ ...project, panel: { ...project.panel, pattern: 2, chain: { first: 2, last: 5 } } }))).toEqual([2, 3, 4, 5]);
    expect(keysArePatterns(shown(project))).toBe(true);
  });

  it('flash on a pattern that waits for the bar line while another plays', () => {
    const waiting = shown(at(blankProject(), { pattern: 6 }), { playing: true, currentPattern: patternIndex('a', 2) });
    expect(lit(waiting)).toEqual([2, 6]);
    expect(flashing(waiting)).toEqual([6]);
    const arrived = shown(at(blankProject(), { pattern: 6 }), { playing: true, currentPattern: patternIndex('a', 6) });
    expect(lit(arrived)).toEqual([6]);
    expect(flashing(arrived)).toEqual([]);
    // A pattern of the other group has no key in this one.
    const other = shown(at(blankProject(), { group: 'b', pattern: 6 }), { playing: true, currentPattern: patternIndex('a', 2) });
    expect(lit(other)).toEqual([6]);
    expect(flashing(other)).toEqual([6]);
  });

  it('show the steps of the chosen row while a pattern is written', () => {
    const project = at(newProject(), { mode: 'pattern_step', row: 'snare_drum' });
    expect(lit(shown(project))).toEqual([4, 12]);
    expect(lit(shown(at(project, { mode: 'pattern_tap', row: 'open_hat' })))).toEqual([2, 6, 10, 14]);
    expect(lit(shown(at(project, { mode: 'pattern_step', row: 'accent' })))).toEqual([0, 4, 8, 12]);
    expect(keysArePatterns(shown(project))).toBe(false);
  });

  it('follow the measure of a track', () => {
    const fixture = at(loadFixture(), { mode: 'track_play', track: 0, measure: 3 });
    expect(lit(shown(fixture))).toEqual([2]);
    expect(lit(shown(fixture, { playing: true, currentPattern: patternIndex('a', 1), playingMeasure: 1 }))).toEqual([1]);
  });

  it('show what a key that is down is about', () => {
    const fixture = at(loadFixture(), { mode: 'pattern_step', group: 'b', pattern: 1, row: 'bass_drum' });
    // Bass Drum 2 is the chosen sound: its key, the second.
    expect(lit(shown(fixture, { held: 'instrument' }))).toEqual([1]);
    expect(lit(shown(at(fixture, { mode: 'pattern_step', row: 'closed_hat' }), { held: 'instrument' }))).toEqual([11, 12]);
    expect(lit(shown(at(fixture, { mode: 'pattern_step', row: 'accent' }), { held: 'instrument' }))).toEqual([]);
    expect(lit(shown(fixture, { held: 'shuffle' }))).toEqual([2]);
    expect(lit(shown(fixture, { held: 'last_step' }))).toEqual([6]);
    expect(flashing(shown(fixture, { held: 'clear' }))).toEqual([1]);
    expect(flashing(shown(fixture, { held: 'copy' }))).toEqual([1]);
    expect(keysArePatterns(shown(fixture, { held: 'clear' }))).toBe(true);
    expect(keysArePatterns(shown(fixture, { held: 'instrument' }))).toBe(false);
  });
});

describe('what a step key is called', () => {
  const fixture = loadFixture();

  it('is the pattern it chooses', () => {
    const play = shown(at(fixture, { mode: 'pattern_play', group: 'b', pattern: 3 }));
    expect(stepKeyName(play, 3)).toBe('Pattern B4, selected');
    expect(stepKeyName(play, 0)).toBe('Pattern B1');
    expect(stepKeyName(shown(fixture), 2)).toBe('Pattern A3, in the chain');
    expect(stepKeyName(shown(fixture), 9)).toBe('Pattern A10');
    expect(stepKeyName(shown(at(fixture, { mode: 'track_write', track: 1, pattern: 0 })), 0)).toBe('Pattern B1, selected');
    const track = at(fixture, { mode: 'track_play', track: 0, measure: 1 });
    expect(stepKeyName(shown(track), 1)).toBe('Pattern A2, in this measure');
    expect(stepKeyName(shown(track, { playing: true, currentPattern: patternIndex('a', 0) }), 0)).toBe('Pattern A1, playing');
  });

  it('is the step it writes, or the instrument it is tapped for', () => {
    const step = shown(at(fixture, { mode: 'pattern_step', group: 'a', pattern: 0, row: 'bass_drum' }));
    expect(stepKeyName(step, 0)).toBe('Bass Drum 2, step 1, on');
    expect(stepKeyName(step, 1)).toBe('Bass Drum 2, step 2, off');
    const tap = shown(at(fixture, { mode: 'pattern_tap' }));
    expect(stepKeyName(tap, 0)).toBe('Tap Bass Drum 1');
    expect(stepKeyName(tap, 12)).toBe('Tap Closed Hi-Hat');
    expect(stepKeyName(tap, 15)).toBe('Tap Ride');
  });

  it('is what it does for the key that is down', () => {
    const writing = at(fixture, { mode: 'pattern_step', group: 'a', pattern: 0 });
    expect(stepKeyName(shown(writing, { held: 'instrument' }), 8)).toBe('Choose Cowbell');
    expect(stepKeyName(shown(writing, { held: 'last_step' }), 11)).toBe('Make step 12 the last step');
    expect(stepKeyName(shown(writing, { held: 'shuffle' }), 0)).toBe('Shuffle off');
    expect(stepKeyName(shown(writing, { held: 'shuffle' }), 4)).toBe('Shuffle 4');
    expect(stepKeyName(shown(writing, { held: 'shuffle' }), 5)).toBe('Step key 6');
    expect(stepKeyName(shown(writing, { held: 'clear' }), 2)).toBe('Clear pattern A3');
    expect(stepKeyName(shown(writing, { held: 'copy' }), 2)).toBe('Copy this pattern to A3');
    expect(stepKeyName(shown(writing, { held: 'shift' }), 10)).toBe('Copy this pattern');
    expect(stepKeyName(shown(writing, { held: 'shift' }), 3)).toBe('Step key 4');
    expect(stepKeyName(shown(at(fixture, { mode: 'pattern_play' }), { held: 'shift' }), 3)).toBe('Chain patterns through A4');
    const track = at(fixture, { mode: 'track_write', track: 0 });
    expect(stepKeyName(shown(track, { held: 'shift' }), 11)).toBe('Insert a measure here');
    expect(stepKeyName(shown(track, { held: 'shift' }), 12)).toBe('Delete this measure');
    expect(stepKeyName(shown(track, { held: 'clear' }), 0)).toBe('Step key 1');
  });
});

describe('what is said aloud when something changes', () => {
  const project = blankProject();
  const said = (before: Shown, after: Shown) => announce(before, after);
  const change = (panel: Partial<Project['panel']>, from: Project = project) => said(shown(from), shown(at(from, panel)));

  it('says the mode, the track, the group and the pattern', () => {
    expect(change({ mode: 'pattern_tap' })).toBe('Pattern write, by tapping.');
    expect(change({ track: 2 })).toBe('Track III.');
    expect(change({ group: 'b' })).toBe('Pattern group B.');
    expect(change({ pattern: 4 })).toBe('Pattern A5.');
    expect(said(shown(project), shown({ ...project, panel: { ...project.panel, chain: { first: 0, last: 3 } } }))).toBe('Chain A1 to A4.');
  });

  it('does not say every pattern of a chain as it plays', () => {
    const chain = { ...project, panel: { ...project.panel, chain: { first: 0, last: 3 } } };
    const next = { ...chain, panel: { ...chain.panel, pattern: 1 } };
    expect(said(shown(chain, { playing: true }), shown(next, { playing: true }))).toBeNull();
  });

  it('says the instrument, the shuffle, the scale and the last step', () => {
    expect(change({ row: 'ride' })).toBe('Ride.');
    expect(said(shown(project), shown({ ...project, sounds: { ...project.sounds, bass_drum: 'bass_drum_2' } }))).toBe('Bass Drum 2.');
    expect(said(shown(project), shown({ ...project, shuffle: 3 }))).toBe('Shuffle 3.');
    expect(said(shown({ ...project, shuffle: 3 }), shown(project))).toBe('No shuffle.');
    const withPattern = (edit: object): Project => ({
      ...project,
      groups: { ...project.groups, a: [{ ...project.groups.a[0]!, ...edit }, ...project.groups.a.slice(1)] },
    });
    expect(said(shown(project), shown(withPattern({ scale: 6 })))).toBe('Scale: sixteenth-note triplets.');
    expect(said(shown(project), shown(withPattern({ lastStep: 9 })))).toBe('Last step 9.');
    expect(change({ readout: 'measure' })).toBe('The display shows the measure.');
  });

  it('says where a track stands as it is written', () => {
    const fixture = at(loadFixture(), { mode: 'track_write', track: 0, measure: 0 });
    expect(said(shown(fixture), shown(at(fixture, { mode: 'track_write', track: 0, measure: 2, pattern: 0 })))).toBe(
      'Measure 3 of 5: pattern A1.',
    );
    expect(said(shown(fixture), shown(at(fixture, { mode: 'track_write', track: 0, measure: 5 })))).toBe('Measure 6, after the last of 5.');
    const emptied = { ...fixture, tracks: [{ group: 'a' as const, measures: [] }, ...fixture.tracks.slice(1)] };
    expect(said(shown(fixture), shown(emptied))).toBe('Track I is empty.');
  });

  it('says what a key that has gone down waits for, and nothing when it comes up or a step is written', () => {
    expect(said(shown(project), shown(project, { held: 'instrument' }))).toContain('Instrument is down');
    expect(said(shown(project), shown(project, { held: 'shift' }))).toBe('Shift is down.');
    const track = at(project, { mode: 'track_write', track: 1 });
    expect(said(shown(track), shown(track, { held: 'clear' }))).toBe('Clear is down: press Enter to empty track II.');
    expect(said(shown(project, { held: 'shift' }), shown(project))).toBeNull();
    const stepped: Project = {
      ...project,
      groups: {
        ...project.groups,
        a: [
          { ...project.groups.a[0]!, steps: { ...project.groups.a[0]!.steps, bass_drum: 'x...............' } },
          ...project.groups.a.slice(1),
        ],
      },
    };
    expect(said(shown(project), shown(stepped))).toBeNull();
    expect(said(shown(project), shown({ ...project, tempo: 99 }))).toBeNull();
  });
});
