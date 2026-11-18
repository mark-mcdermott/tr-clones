import { describe, expect, it } from 'vitest';
import type { EngineMeasure } from '@boombapbot/editor';
import {
  KNOB_IDS,
  TRACK_MEASURES,
  createEmptyPatterns,
  createProject,
  isEmptyPattern,
  type Project,
} from '../src/document';
import { RESTING, memoryOf, remembersAnything } from '../src/session';
import { loadFixture, makeMachine, newProject, panelOf, patternOf, stepsOn } from './helpers';

/** A new machine in pattern write, on pattern 1 of group 1, as SHIFT then PATTERN 1 leaves it. */
function writing(project: Project = newProject()) {
  const machine = makeMachine(project);
  machine.session.pressShift();
  machine.session.pressGroup(0);
  return machine;
}

const measure = (position: number, pattern = 0): EngineMeasure => ({
  frame: 0,
  ordinal: position + 1,
  pattern,
  kind: 'basic',
  position,
});

describe('the mode keys', () => {
  it('a TRACK key plays that track, and with SHIFT writes it', () => {
    const { store, session } = makeMachine();
    session.pressTrack(2);
    expect(panelOf(store)).toMatchObject({ mode: 'track_play', track: 2 });
    session.pressShift();
    expect(store.getState().transient.shift).toBe(true);
    session.pressTrack(0);
    expect(panelOf(store)).toMatchObject({ mode: 'track_write', track: 0 });
    // SHIFT works on one key and comes up.
    expect(store.getState().transient.shift).toBe(false);
    session.pressTrack(0);
    expect(panelOf(store).mode).toBe('track_play');
    session.pressTrack(9);
    expect(panelOf(store).track).toBe(0);
  });

  it('a PATTERN key plays patterns of that group, and with SHIFT writes them', () => {
    const { store, session } = makeMachine();
    session.pressGroup(1);
    expect(panelOf(store)).toMatchObject({ mode: 'pattern_play', group: 1 });
    session.pressShift();
    session.pressGroup(0);
    expect(panelOf(store)).toMatchObject({ mode: 'pattern_write', group: 0 });
    session.pressGroup(0);
    expect(panelOf(store).mode).toBe('pattern_play');
  });

  it('SHIFT pressed twice comes up without doing anything', () => {
    const { store, session } = makeMachine();
    const before = store.getState().project;
    session.pressShift();
    session.pressShift();
    expect(store.getState().transient).toEqual(RESTING);
    expect(store.getState().project).toBe(before);
  });

  it('a change of mode lets a chain go and the function keys up, and is never an undo step', () => {
    const { store, session } = makeMachine();
    session.pressStep(2);
    session.pressShift();
    session.pressStep(5);
    expect(panelOf(store)).toMatchObject({ pattern: 2, chain: 5 });
    // The other group keeps the chain: it is still pattern play.
    session.pressGroup(1);
    expect(panelOf(store)).toMatchObject({ group: 1, pattern: 2, chain: 5 });
    session.pressShift();
    session.pressGroup(1);
    expect(panelOf(store)).toMatchObject({ mode: 'pattern_write', pattern: 2, chain: 2 });
    session.pressFunction('last_step');
    expect(store.getState().transient.held).toBe('last_step');
    session.pressTrack(1);
    expect(store.getState().transient).toEqual(RESTING);
    expect(store.getState().canUndo).toBe(false);
  });

  it('the strip can set a mode outright, keeping the track and the group', () => {
    const { store, session } = makeMachine(loadFixture());
    session.setMode('track_write');
    expect(panelOf(store)).toMatchObject({ mode: 'track_write', track: 1, group: 1 });
  });
});

describe('pattern play', () => {
  it('a step key selects a pattern, and the function keys do nothing', () => {
    const { store, session } = makeMachine();
    const memory = memoryOf(store.getState().project);
    expect(session.pressStep(3)).toEqual({ kind: 'pattern' });
    expect(panelOf(store)).toMatchObject({ pattern: 3, chain: 3 });
    for (const key of ['instrument', 'last_step', 'shuffle', 'clear'] as const) session.pressFunction(key);
    session.pressScale();
    session.pressEnter();
    session.pressBack();
    session.pressForward();
    expect(store.getState().transient).toEqual(RESTING);
    expect(memoryOf(store.getState().project)).toEqual(memory);
    expect(store.getState().canUndo).toBe(false);
    expect(session.pressStep(16)).toEqual({ kind: 'none' });
    expect(session.pressStep(-1)).toEqual({ kind: 'none' });
  });

  it('SHIFT and a second key make a chain, whichever end is pressed first', () => {
    const { store, session } = makeMachine();
    session.pressStep(6);
    session.pressShift();
    expect(session.pressStep(2)).toEqual({ kind: 'chain' });
    expect(panelOf(store)).toMatchObject({ pattern: 2, chain: 6 });
    expect(store.getState().transient.shift).toBe(false);
    // A plain key afterwards is one pattern again.
    session.pressStep(4);
    expect(panelOf(store)).toMatchObject({ pattern: 4, chain: 4 });
  });

  it('starts a single pattern on the panel, and a chain as a song that goes round', () => {
    const { session } = makeMachine();
    expect(session.start()).toEqual({ song: [], loop: false });
    session.pressShift();
    session.pressStep(3);
    expect(session.start()).toEqual({ song: [0, 1, 2, 3], loop: true });
  });
});

describe('pattern write', () => {
  it('stopped, the step keys choose the pattern to write', () => {
    const { store, session } = writing();
    expect(session.pressStep(8)).toEqual({ kind: 'pattern' });
    expect(panelOf(store)).toMatchObject({ mode: 'pattern_write', pattern: 8, chain: 8 });
    expect(store.getState().canUndo).toBe(false);
    // SHIFT makes no chain here.
    session.pressShift();
    session.pressStep(10);
    expect(panelOf(store)).toMatchObject({ pattern: 10, chain: 10 });
  });

  it('running in step write, a step key puts a step of the selected instrument on or off', () => {
    const { store, session, start } = writing();
    session.pressStep(8);
    expect(isEmptyPattern(patternOf(store))).toBe(true);
    expect(start()).toBe(true);
    expect(session.pressStep(0)).toEqual({ kind: 'step', on: true });
    expect(session.pressStep(4)).toEqual({ kind: 'step', on: true });
    expect(stepsOn(patternOf(store), 'bass_drum')).toEqual([0, 4]);
    expect(session.pressStep(0)).toEqual({ kind: 'step', on: false });
    expect(stepsOn(patternOf(store), 'bass_drum')).toEqual([4]);
    // Still on pattern 9: the keys write now.
    expect(panelOf(store).pattern).toBe(8);

    // Each press is one undo step.
    store.undo();
    expect(stepsOn(patternOf(store), 'bass_drum')).toEqual([0, 4]);
    store.undo();
    store.undo();
    expect(isEmptyPattern(patternOf(store))).toBe(true);
    expect(store.getState().canUndo).toBe(false);
    store.redo();
    expect(stepsOn(patternOf(store), 'bass_drum')).toEqual([0]);
  });

  it('writes the group the PATTERN key chose, and no other pattern', () => {
    const machine = makeMachine();
    machine.session.pressShift();
    machine.session.pressGroup(1);
    machine.session.pressStep(9);
    const before = machine.store.getState().project.patterns;
    machine.start();
    machine.session.pressStep(3);
    const after = machine.store.getState().project.patterns;
    expect(stepsOn(after[1]![9]!, 'bass_drum')).toEqual([3]);
    expect(after[0]).toBe(before[0]);
    expect(after[1]!.filter((pattern, index) => pattern !== before[1]![index])).toHaveLength(1);
  });

  it('INSTRUMENT SELECT then a step key chooses the instrument on it, and sounds it', async () => {
    const { store, session, host } = writing();
    session.pressFunction('instrument');
    expect(store.getState().transient.held).toBe('instrument');
    expect(session.pressStep(2)).toEqual({ kind: 'instrument' });
    expect(panelOf(store).instrument).toBe('snare_drum');
    expect(store.getState().transient.held).toBeNull();
    await Promise.resolve();
    expect(host.triggered).toEqual([2]);
    // Both keys of a pair are one instrument; the hi-hats have a key each.
    const pick = (key: number) => {
      session.pressFunction('instrument');
      session.pressStep(key);
      return panelOf(store).instrument;
    };
    expect([0, 1, 4, 5, 6, 8, 10, 11, 12, 13, 14, 15].map(pick)).toEqual([
      'bass_drum',
      'bass_drum',
      'low_tom',
      'low_tom',
      'mid_tom',
      'hi_tom',
      'rim_shot',
      'hand_clap',
      'closed_hat',
      'open_hat',
      'crash',
      'ride',
    ]);
    // The pattern is where it was: the key chose an instrument, not a pattern.
    expect(panelOf(store).pattern).toBe(0);
    expect(store.getState().canUndo).toBe(false);
  });

  it('INSTRUMENT SELECT then TOTAL ACCENT chooses the accent row, which makes no sound', async () => {
    const { store, session, host, start } = writing();
    session.pressStep(8);
    session.pressFunction('instrument');
    session.pressEnter();
    expect(panelOf(store).instrument).toBe('accent');
    expect(store.getState().transient.held).toBeNull();
    await Promise.resolve();
    expect(host.triggered).toEqual([]);
    start();
    session.pressStep(4);
    expect(stepsOn(patternOf(store), 'accent')).toEqual([4]);
    expect(stepsOn(patternOf(store), 'bass_drum')).toEqual([]);
  });

  it('a function key pressed again comes up, and only one is down at a time', () => {
    const { store, session } = writing();
    session.pressFunction('shuffle');
    session.pressFunction('clear');
    expect(store.getState().transient.held).toBe('clear');
    session.pressFunction('clear');
    expect(store.getState().transient.held).toBeNull();
  });

  it('LAST STEP then a step key sets how many steps the pattern plays', () => {
    const { store, session } = writing();
    session.pressFunction('last_step');
    expect(session.pressStep(11)).toEqual({ kind: 'last_step' });
    expect(patternOf(store).lastStep).toBe(12);
    expect(store.getState().transient.held).toBeNull();
    store.undo();
    expect(patternOf(store).lastStep).toBe(16);
  });

  it('SHUFFLE then one of the first seven keys sets the shuffle, and the others do nothing', () => {
    const { store, session } = writing();
    session.pressFunction('shuffle');
    expect(session.pressStep(9)).toEqual({ kind: 'none' });
    expect(store.getState().transient.held).toBe('shuffle');
    expect(session.pressStep(5)).toEqual({ kind: 'shuffle' });
    expect(patternOf(store).shuffle).toBe(5);
    session.pressFunction('shuffle');
    session.pressStep(0);
    expect(patternOf(store).shuffle).toBe(0);
    store.undo();
    store.undo();
    expect(patternOf(store).shuffle).toBe(0);
    expect(store.getState().canUndo).toBe(false);
  });

  it('SCALE steps the pattern through the four scales', () => {
    const { store, session } = writing();
    const seen = [patternOf(store).scale];
    for (let press = 0; press < 4; press += 1) {
      session.pressScale();
      seen.push(patternOf(store).scale);
    }
    expect(seen).toEqual([4, 1, 2, 3, 4]);
    store.undo();
    expect(patternOf(store).scale).toBe(3);
  });

  it('CLEAR then a key clears that pattern while stopped, and that instrument while running', () => {
    const { store, session, start, host } = writing();
    expect(isEmptyPattern(patternOf(store, 1))).toBe(false);
    session.pressFunction('clear');
    expect(session.pressStep(1)).toEqual({ kind: 'clear' });
    expect(isEmptyPattern(patternOf(store, 1))).toBe(true);
    // The selected pattern was not the one cleared, and is as it was.
    expect(panelOf(store).pattern).toBe(0);
    expect(isEmptyPattern(patternOf(store, 0))).toBe(false);
    store.undo();
    expect(isEmptyPattern(patternOf(store, 1))).toBe(false);

    start();
    const before = patternOf(store);
    expect(stepsOn(before, 'closed_hat').length).toBeGreaterThan(0);
    session.pressFunction('clear');
    session.pressStep(12);
    expect(stepsOn(patternOf(store), 'closed_hat')).toEqual([]);
    expect(stepsOn(patternOf(store), 'open_hat')).toEqual(stepsOn(before, 'open_hat'));
    expect(stepsOn(patternOf(store), 'accent')).toEqual(stepsOn(before, 'accent'));
    session.pressFunction('clear');
    session.pressEnter();
    expect(stepsOn(patternOf(store), 'accent')).toEqual([]);
    expect(stepsOn(patternOf(store), 'bass_drum')).toEqual(stepsOn(before, 'bass_drum'));
    expect(host.stops).toBe(0);
  });

  it('STEP and TAP are SHIFT with the TEMPO and BACK keys', () => {
    const { store, session } = writing();
    expect(panelOf(store).write).toBe('step');
    session.pressShift();
    session.pressBack();
    expect(panelOf(store).write).toBe('tap');
    expect(store.getState().transient.shift).toBe(false);
    session.pressShift();
    session.pressTempoKey();
    expect(panelOf(store).write).toBe('step');
    // Without SHIFT they are for the tracks, and do nothing here.
    session.pressBack();
    session.pressTempoKey();
    expect(panelOf(store).write).toBe('step');
    expect(store.getState().transient).toEqual(RESTING);
  });
});

describe('tap write', () => {
  function tapping() {
    const machine = writing();
    machine.session.pressStep(8);
    machine.session.pressShift();
    machine.session.pressBack();
    machine.start();
    return machine;
  }

  it('a tapped key plays its instrument at once and writes it on the step that is sounding', () => {
    const { store, session, host, at } = tapping();
    at(4);
    expect(session.pressStep(2)).toEqual({ kind: 'tap' });
    expect(host.triggered).toEqual([2]);
    expect(stepsOn(patternOf(store), 'snare_drum')).toEqual([4]);
    at(6);
    session.pressStep(12);
    session.pressStep(13);
    expect(stepsOn(patternOf(store), 'closed_hat')).toEqual([6]);
    expect(stepsOn(patternOf(store), 'open_hat')).toEqual([6]);
    expect(host.triggered).toEqual([2, 8, 9]);
  });

  it('a tap late in a step belongs to the next one, and is written once that has passed', () => {
    const { store, session, host, at } = tapping();
    at(15);
    // A sixteenth at 125 beats a minute lasts 120 ms; this tap is 100 ms into it.
    host.sinceStep = 0.1;
    session.pressStep(0);
    expect(host.triggered).toEqual([1]);
    expect(stepsOn(patternOf(store), 'bass_drum')).toEqual([]);
    at(0);
    expect(stepsOn(patternOf(store), 'bass_drum')).toEqual([0]);
  });

  it('TOTAL ACCENT taps an accent, silently', () => {
    const { store, session, host, at } = tapping();
    at(8);
    session.pressEnter();
    expect(stepsOn(patternOf(store), 'accent')).toEqual([8]);
    expect(host.triggered).toEqual([]);
  });

  it('a whole take is one undo step, stored when the machine stops', () => {
    const { store, session, host, at } = tapping();
    at(0);
    session.pressStep(0);
    at(4);
    session.pressStep(2);
    at(15);
    host.sinceStep = 0.1;
    session.pressStep(15);
    expect(store.getState().canUndo).toBe(false);
    host.stop();
    // The late tap was still waiting for its step; stopping writes it.
    expect(stepsOn(patternOf(store), 'ride')).toEqual([0]);
    expect(stepsOn(patternOf(store), 'bass_drum')).toEqual([0]);
    expect(stepsOn(patternOf(store), 'snare_drum')).toEqual([4]);
    expect(store.getState().canUndo).toBe(true);
    store.undo();
    expect(isEmptyPattern(patternOf(store))).toBe(true);
    expect(store.getState().canUndo).toBe(false);
    store.redo();
    expect(stepsOn(patternOf(store), 'snare_drum')).toEqual([4]);
  });

  it('going back to step write stores the take', () => {
    const { store, session, at } = tapping();
    at(2);
    session.pressStep(10);
    session.pressShift();
    session.pressTempoKey();
    expect(panelOf(store).write).toBe('step');
    expect(store.getState().canUndo).toBe(true);
    store.undo();
    expect(isEmptyPattern(patternOf(store))).toBe(true);
  });

  it('a tap on a step that is already on changes nothing', () => {
    const { store, session, host, at } = tapping();
    at(3);
    session.pressStep(0);
    session.pressStep(0);
    host.stop();
    store.undo();
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('writing a track', () => {
  /** A machine with no tracks written, in track write on track 2. */
  function composing() {
    const machine = makeMachine(createProject({ id: 'tracks', now: new Date(0), patterns: createEmptyPatterns() }));
    machine.session.pressShift();
    machine.session.pressTrack(1);
    return machine;
  }
  const track = (store: ReturnType<typeof composing>['store'], index = 1) => store.getState().project.patternTracks[index]!;

  it('a step key chooses a pattern and ENTER stores it in the measure and moves on', () => {
    const { store, session } = composing();
    expect(store.getState().transient.measure).toBe(0);
    expect(session.pressStep(4)).toEqual({ kind: 'pattern' });
    expect(store.getState().canUndo).toBe(false);
    session.pressEnter();
    expect(track(store).measures).toEqual([4]);
    expect(store.getState().transient.measure).toBe(1);
    // ENTER again repeats the pattern in the next measure.
    session.pressEnter();
    session.pressStep(7);
    session.pressEnter();
    expect(track(store).measures).toEqual([4, 4, 7]);
    expect(store.getState().transient.measure).toBe(3);
    store.undo();
    expect(track(store).measures).toEqual([4, 4]);
  });

  it('BACK and FWD move through the measures, and show the pattern each holds', () => {
    const { store, session } = composing();
    for (const pattern of [1, 2, 3]) {
      session.pressStep(pattern);
      session.pressEnter();
    }
    session.pressBack();
    expect(store.getState().transient.measure).toBe(2);
    expect(panelOf(store).pattern).toBe(3);
    session.pressBack();
    session.pressBack();
    session.pressBack();
    expect(store.getState().transient.measure).toBe(0);
    expect(panelOf(store).pattern).toBe(1);
    // A measure written over keeps the track's length.
    session.pressStep(9);
    session.pressEnter();
    expect(track(store).measures).toEqual([9, 2, 3]);
    expect(store.getState().transient.measure).toBe(1);
    expect(panelOf(store).pattern).toBe(2);
    // FWD stops just past the last measure, where the next is added.
    for (let press = 0; press < 5; press += 1) session.pressForward();
    expect(store.getState().transient.measure).toBe(3);
  });

  it('SHIFT and CYCLE is LAST MEAS: the track ends on the measure the display shows', () => {
    const { store, session } = composing();
    for (const pattern of [1, 2, 3, 4]) {
      session.pressStep(pattern);
      session.pressEnter();
    }
    session.pressBack();
    session.pressBack();
    session.pressBack();
    session.pressShift();
    session.pressCycle();
    expect(track(store).measures).toEqual([1, 2]);
    expect(panelOf(store).cycle).toBe(false);
    store.undo();
    expect(track(store).measures).toEqual([1, 2, 3, 4]);
  });

  it('a PATTERN key chooses the group the track plays from, and stays in track write', () => {
    const { store, session } = composing();
    session.pressGroup(1);
    expect(panelOf(store).mode).toBe('track_write');
    expect(track(store).group).toBe(1);
    // The other tracks, and the pattern modes' own group, are as they were.
    expect(track(store, 0).group).toBe(0);
    expect(panelOf(store).group).toBe(0);
    store.undo();
    expect(track(store).group).toBe(0);
    // With SHIFT it is the way to pattern write, as anywhere.
    session.pressShift();
    session.pressGroup(1);
    expect(panelOf(store)).toMatchObject({ mode: 'pattern_write', group: 1 });
  });

  it('CLEAR empties the track at once', () => {
    const { store, session } = composing();
    session.pressStep(5);
    session.pressEnter();
    session.pressEnter();
    session.pressFunction('clear');
    expect(track(store).measures).toEqual([]);
    expect(store.getState().transient).toEqual(RESTING);
    store.undo();
    expect(track(store).measures).toEqual([5, 5]);
  });

  it('opens a written track on its first measure', () => {
    const { store, session } = makeMachine(loadFixture());
    session.pressShift();
    session.pressTrack(0);
    expect(panelOf(store)).toMatchObject({ mode: 'track_write', track: 0, pattern: 0 });
    session.pressForward();
    expect(panelOf(store).pattern).toBe(1);
  });

  it('holds 192 measures and says when it is full', () => {
    const { store, session } = composing();
    session.pressStep(3);
    for (let press = 0; press < TRACK_MEASURES + 5; press += 1) session.pressEnter();
    expect(track(store).measures).toHaveLength(TRACK_MEASURES);
    expect(store.getState().transient.measure).toBe(TRACK_MEASURES - 1);
    expect(store.getState().notice).toMatchObject({ kind: 'info', message: 'Track 2 is full: it holds 192 measures.' });
  });

  it('plays the pattern being chosen round and round, not the track', () => {
    const { session } = composing();
    session.pressStep(5);
    session.pressEnter();
    expect(session.start()).toEqual({ song: [], loop: false });
  });
});

describe('playing a track', () => {
  it('plays its measures once, or round and round with CYCLE', () => {
    const { store, session } = makeMachine();
    session.pressTrack(0);
    const { measures } = store.getState().project.patternTracks[0]!;
    expect(session.start()).toEqual({ song: measures, loop: false });
    session.pressCycle();
    expect(panelOf(store).cycle).toBe(true);
    expect(session.start()).toEqual({ song: measures, loop: true });
    session.pressCycle();
    expect(panelOf(store).cycle).toBe(false);
    expect(store.getState().canUndo).toBe(false);
  });

  it('will not start an empty track, and says how to write it', () => {
    const { store, session, start } = makeMachine();
    session.pressTrack(3);
    expect(start()).toBe(false);
    expect(store.getState().playing).toBe(false);
    expect(store.getState().notice).toMatchObject({
      kind: 'info',
      message: 'Track 4 is empty. To write it, press SHIFT, then TRACK 4.',
    });
  });

  it('counts the measures as they play, and the step keys do nothing', () => {
    const { store, session, start } = makeMachine();
    session.pressTrack(0);
    start();
    session.measures([measure(0)]);
    session.measures([measure(1), measure(2)]);
    expect(store.getState().transient.measure).toBe(2);
    const before = store.getState().project;
    expect(session.pressStep(5)).toEqual({ kind: 'none' });
    expect(store.getState().project).toBe(before);
    // Starting again counts from the first measure.
    start();
    expect(store.getState().transient.measure).toBe(0);
  });

  it('the display keys choose what the display shows, in the track modes only', () => {
    const { store, session } = makeMachine();
    session.pressTempoKey();
    session.pressAvailable();
    expect(store.getState().transient.display).toBe('measure');
    session.pressTrack(0);
    session.pressTempoKey();
    expect(store.getState().transient.display).toBe('tempo');
    session.pressAvailable();
    expect(store.getState().transient.display).toBe('available');
    session.pressAvailable();
    expect(store.getState().transient.display).toBe('measure');
    // Another track starts on its own first measure.
    session.pressTempoKey();
    session.pressTrack(1);
    expect(store.getState().transient).toEqual(RESTING);
  });

  it('ignores measures reported in the pattern modes', () => {
    const { store, session } = makeMachine();
    session.measures([measure(5)]);
    expect(store.getState().transient.measure).toBe(0);
  });
});

describe('what stops a running machine', () => {
  it('a single pattern chosen in pattern play does not: the engine takes it at the bar line', () => {
    const { session, host, start } = makeMachine();
    start();
    session.pressStep(4);
    session.pressGroup(1);
    session.pressStep(1);
    expect(host.stops).toBe(0);
  });

  it('a chain chosen while running does, because the engine is given a chain when it starts', () => {
    const { store, session, host, start } = makeMachine();
    start();
    session.pressShift();
    session.pressStep(3);
    expect(host.stops).toBe(1);
    expect(store.getState().playing).toBe(false);
    expect(panelOf(store)).toMatchObject({ pattern: 0, chain: 3 });
  });

  it('a single pattern takes the place of a running chain, unless it is the one the chain began on', () => {
    const first = makeMachine();
    first.session.pressShift();
    first.session.pressStep(3);
    first.start();
    first.session.pressStep(2);
    expect(first.host.stops).toBe(0);
    // From here on it is the panel's pattern that plays, so another is no trouble either.
    first.session.pressStep(0);
    expect(first.host.stops).toBe(0);

    const second = makeMachine();
    second.session.pressShift();
    second.session.pressStep(3);
    second.start();
    second.session.pressStep(0);
    expect(second.host.stops).toBe(1);
  });

  it('going from pattern play to pattern write keeps a single pattern running, and stops a chain', () => {
    const single = makeMachine();
    single.start();
    single.session.pressShift();
    single.session.pressGroup(0);
    expect(single.host.stops).toBe(0);
    expect(single.store.getState().playing).toBe(true);

    const chained = makeMachine();
    chained.session.pressShift();
    chained.session.pressStep(2);
    chained.start();
    chained.session.pressShift();
    chained.session.pressGroup(0);
    expect(chained.host.stops).toBe(1);
  });

  it('going into or out of a track mode, or to another track, does', () => {
    const { session, host, start } = makeMachine(loadFixture());
    start();
    session.pressTrack(0);
    expect(host.stops).toBe(1);
    start();
    session.pressTrack(0);
    expect(host.stops).toBe(1);
    session.pressTrack(1);
    expect(host.stops).toBe(2);
    start();
    session.pressGroup(0);
    expect(host.stops).toBe(3);
  });

  it('choosing patterns while a track is written does not', () => {
    const { session, host, start } = makeMachine();
    session.pressShift();
    session.pressTrack(0);
    start();
    session.pressStep(3);
    session.pressEnter();
    session.pressGroup(1);
    session.pressBack();
    expect(host.stops).toBe(0);
  });

  it('knobs and the tempo never do', () => {
    const { session, host, start } = makeMachine();
    session.pressShift();
    session.pressStep(3);
    start();
    session.setTempo(140);
    session.setKnob('bass_drum_decay', 1);
    expect(host.stops).toBe(0);
  });
});

describe('knobs', () => {
  it('turn between 0 and 1, and are not undo steps', () => {
    const { store, session } = makeMachine();
    for (const id of KNOB_IDS) {
      session.setKnob(id, 0.33);
      expect(store.getState().project.knobs[id]).toBe(0.33);
    }
    session.setKnob('volume', 7);
    session.setKnob('accent', -1);
    session.setKnob('ride_tune', Number.NaN);
    expect(store.getState().project.knobs).toMatchObject({ volume: 1, accent: 0, ride_tune: 0.5 });
    expect(store.getState().canUndo).toBe(false);
  });

  it('leave the project alone when turned to where they are', () => {
    const { store, session } = makeMachine();
    const before = store.getState().project;
    session.setKnob('volume', before.knobs.volume);
    session.setTempo(before.tempo);
    expect(store.getState().project).toBe(before);
  });

  it('the tempo is whole beats a minute from 40 to 290', () => {
    const { store, session } = makeMachine();
    session.setTempo(133.4);
    expect(store.getState().project.tempo).toBe(133);
    session.setTempo(10);
    expect(store.getState().project.tempo).toBe(40);
    session.setTempo(900);
    expect(store.getState().project.tempo).toBe(290);
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('the buttons in settings', () => {
  it('clear the pattern the panel is on, as one undo step', () => {
    const { store, session } = makeMachine();
    const before = store.getState().project.patterns;
    session.clearPattern();
    expect(isEmptyPattern(patternOf(store))).toBe(true);
    expect(store.getState().project.patterns[0]!.slice(1)).toEqual(before[0]!.slice(1));
    // Nothing to clear is nothing to undo.
    session.clearPattern();
    store.undo();
    expect(store.getState().project.patterns).toEqual(before);
    expect(store.getState().canUndo).toBe(false);
  });

  it('clear everything the machine remembers, and nothing else', () => {
    const { store, session } = makeMachine(loadFixture());
    const before = store.getState().project;
    expect(remembersAnything(before)).toBe(true);
    session.clearEverything();
    const cleared = store.getState().project;
    expect(remembersAnything(cleared)).toBe(false);
    expect(cleared.knobs).toEqual(before.knobs);
    expect(cleared.tempo).toBe(before.tempo);
    expect(cleared.panel).toEqual(before.panel);
    session.clearEverything();
    store.undo();
    expect(memoryOf(store.getState().project)).toEqual(memoryOf(before));
    expect(store.getState().canUndo).toBe(false);
  });

  it('put the starter patterns and track back', () => {
    const { store, session } = makeMachine();
    const starter = memoryOf(store.getState().project);
    session.clearEverything();
    session.loadStarter();
    expect(memoryOf(store.getState().project)).toEqual(starter);
  });
});

describe('letting go', () => {
  it('Esc lets SHIFT and a function key up, and takes no other key', () => {
    const { store, session } = writing();
    session.pressFunction('clear');
    session.pressShift();
    expect(session.keyDown({ key: 'a' } as KeyboardEvent)).toBe(false);
    expect(store.getState().transient).toMatchObject({ shift: true, held: 'clear' });
    expect(session.keyDown({ key: 'Escape' } as KeyboardEvent)).toBe(true);
    expect(store.getState().transient).toEqual(RESTING);
  });

  it('switching the power off lets everything up, and the machine makes no sound', async () => {
    const { store, session, host } = writing();
    session.pressFunction('instrument');
    store.setPower(false);
    expect(store.getState().transient).toEqual(RESTING);
    await session.audition('bass_drum');
    expect(host.triggered).toEqual([]);
    store.setPower(true);
    await session.audition('bass_drum');
    await session.audition('accent');
    expect(host.triggered).toEqual([1]);
  });
});
