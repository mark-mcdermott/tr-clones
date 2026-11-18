import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_ROW,
  TRACK_MEASURES,
  createEmptyPattern,
  createStarterGroups,
  createStarterTracks,
  getRow,
  isEmptyPattern,
  patternIndex,
  type Project,
} from '../src/document';
import { COPY_KEY, DELETE_KEY, INSERT_KEY, RESTING, editTarget, memoryOf, remembersAnything } from '../src/session';
import { blankProject, loadFixture, makeMachine, measure, newProject, panelOf, play, rowOf, stop } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A machine in a mode, on a project that remembers nothing unless it is given one. */
function inMode(mode: Project['panel']['mode'], project: Project = blankProject()) {
  const machine = makeMachine(project);
  machine.session.setMode(mode);
  return machine;
}

const escape = { key: 'Escape' } as KeyboardEvent;

/** Lets a sound that had to wait for audio be played. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('the mode keys', () => {
  it('play a track or a pattern, and with SHIFT write one', () => {
    const { store, session } = makeMachine();
    session.pressModeKey('track');
    expect(panelOf(store).mode).toBe('track_play');
    session.pressModeKey('pattern');
    expect(panelOf(store).mode).toBe('pattern_play');
    session.pressShift();
    session.pressModeKey('track');
    expect(panelOf(store).mode).toBe('track_write');
    expect(store.getState().transient.held).toBeNull();
  });

  it('change a pattern between step and tap with SHIFT and PATTERN', () => {
    const { store, session } = makeMachine();
    const shiftPattern = () => {
      session.pressShift();
      session.pressModeKey('pattern');
      return panelOf(store).mode;
    };
    expect(shiftPattern()).toBe('pattern_step');
    expect(shiftPattern()).toBe('pattern_tap');
    expect(shiftPattern()).toBe('pattern_step');
  });

  it('are not undo steps, and leave the pattern the panel was on', () => {
    const { store, session } = makeMachine();
    session.selectPattern(3);
    session.setMode('pattern_step');
    expect(panelOf(store)).toMatchObject({ mode: 'pattern_step', pattern: 3 });
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('the keys that stay down', () => {
  it('stay down until pressed again, and only one at a time', () => {
    const { store, session } = inMode('pattern_step');
    const held = () => store.getState().transient.held;
    session.pressShift();
    expect(held()).toBe('shift');
    session.pressShift();
    expect(held()).toBeNull();
    session.pressInstrument();
    expect(held()).toBe('instrument');
    session.pressLastStep();
    expect(held()).toBe('last_step');
    session.pressShuffle();
    expect(held()).toBe('shuffle');
    session.pressClear();
    expect(held()).toBe('clear');
    session.pressClear();
    expect(held()).toBeNull();
  });

  it('come up with Esc, which is otherwise left for the page', () => {
    const { store, session } = inMode('pattern_step');
    expect(session.keyDown(escape)).toBe(false);
    session.pressInstrument();
    expect(session.keyDown({ key: 'a' } as KeyboardEvent)).toBe(false);
    expect(session.keyDown(escape)).toBe(true);
    expect(store.getState().transient.held).toBeNull();
  });

  it('do nothing in a mode they have no part in', () => {
    const { store, session } = inMode('pattern_play');
    session.pressClear();
    session.pressInstrument();
    session.pressLastStep();
    expect(store.getState().transient.held).toBeNull();
    session.pressScale();
    expect(store.getState().project.groups.a[0]!.scale).toBe(4);
    expect(store.getState().canUndo).toBe(false);
  });

  it('come up when the mode changes', () => {
    const { store, session } = inMode('pattern_step');
    session.pressShuffle();
    session.setMode('pattern_play');
    expect(store.getState().transient.held).toBeNull();
  });
});

describe('choosing a pattern', () => {
  it('is what a step key does in pattern play', () => {
    const { store, session } = inMode('pattern_play');
    session.pressStep(6);
    expect(panelOf(store)).toMatchObject({ group: 'a', pattern: 6, chain: null });
    session.pressStep(16);
    session.pressStep(-1);
    expect(panelOf(store).pattern).toBe(6);
    expect(store.getState().canUndo).toBe(false);
  });

  it('takes its group from keys A and B; C and D have none', () => {
    const { store, session } = inMode('pattern_play');
    session.pressGroup(1);
    expect(panelOf(store).group).toBe('b');
    session.pressGroup(2);
    session.pressGroup(3);
    expect(panelOf(store).group).toBe('b');
    session.pressGroup(0);
    expect(panelOf(store).group).toBe('a');
  });

  it('chains from the pattern the panel is on through the step key pressed with SHIFT', () => {
    const { store, session } = inMode('pattern_play');
    session.pressStep(2);
    session.pressShift();
    session.pressStep(5);
    expect(panelOf(store)).toMatchObject({ pattern: 2, chain: { first: 2, last: 5 } });
    expect(store.getState().transient.held).toBeNull();
    // SHIFT again moves the end of the chain, whichever side it is on.
    session.pressShift();
    session.pressStep(0);
    expect(panelOf(store)).toMatchObject({ pattern: 0, chain: { first: 0, last: 2 } });
  });

  it('chains two step keys pressed together, and one key alone ends the chain', () => {
    const { store, session } = inMode('pattern_play');
    session.chain(7, 4);
    expect(panelOf(store)).toMatchObject({ pattern: 4, chain: { first: 4, last: 7 } });
    session.chain(3, 3);
    expect(panelOf(store)).toMatchObject({ pattern: 3, chain: null });
    session.chain(1, 2);
    session.pressStep(9);
    expect(panelOf(store)).toMatchObject({ pattern: 9, chain: null });
    session.chain(1, 2);
    session.pressGroup(1);
    expect(panelOf(store)).toMatchObject({ group: 'b', chain: null });
  });

  it('keeps a chain to pattern play', () => {
    const { store, session } = inMode('pattern_play');
    session.chain(1, 4);
    session.setMode('pattern_step');
    expect(panelOf(store)).toMatchObject({ pattern: 1, chain: null });
    session.chain(1, 4);
    expect(panelOf(store)).toMatchObject({ pattern: 4, chain: null });
  });
});

describe('writing a pattern by step', () => {
  it('puts a step of the chosen row on and takes it off, one undo step each', () => {
    const { store, session, host } = inMode('pattern_step');
    session.pressStep(4);
    expect(rowOf(store, 'bass_drum', 0)).toBe('....x...........');
    // Stopped, with audio running, a step put on is heard.
    expect(host.triggered).toEqual([getRow('bass_drum').index]);
    session.pressStep(4);
    expect(rowOf(store, 'bass_drum', 0)).toBe(EMPTY_ROW);
    expect(host.triggered).toHaveLength(1);
    store.undo();
    expect(rowOf(store, 'bass_drum', 0)).toBe('....x...........');
    store.undo();
    expect(rowOf(store, 'bass_drum', 0)).toBe(EMPTY_ROW);
    expect(store.getState().canUndo).toBe(false);
  });

  it('writes the pattern the panel was on, in its group', () => {
    const { store, session } = inMode('pattern_play');
    session.pressGroup(1);
    session.pressStep(9);
    session.setMode('pattern_step');
    session.pressStep(0);
    expect(rowOf(store, 'bass_drum', 9, 'b')).toBe('x...............');
    expect(rowOf(store, 'bass_drum', 9, 'a')).toBe(EMPTY_ROW);
  });

  it('writes the pattern that is sounding while another waits for the bar line', () => {
    const machine = inMode('pattern_step');
    const { store, session, host } = machine;
    play(machine);
    store.setPosition(2, patternIndex('a', 0));
    session.pressGroup(1);
    expect(editTarget(store.getState())).toEqual({ group: 'a', pattern: 0 });
    session.pressStep(1);
    expect(rowOf(store, 'bass_drum', 0, 'a')).toBe('.x..............');
    // Playing, the engine sounds the step when it comes round.
    expect(host.triggered).toEqual([]);
  });

  it('chooses the row with INSTRUMENT and the step key lettered for it', async () => {
    const { store, session, host } = inMode('pattern_step');
    session.pressInstrument();
    session.pressStep(2);
    expect(panelOf(store).row).toBe('snare_drum');
    expect(store.getState().transient.held).toBeNull();
    expect(store.getState().project.sounds.snare_drum).toBe('snare_drum_1');
    session.pressStep(8);
    expect(rowOf(store, 'snare_drum', 0)).toBe('........x.......');
    // Both closed hi-hat keys choose the closed hi-hat.
    for (const key of [11, 12]) {
      session.pressInstrument();
      session.pressStep(key);
      expect(panelOf(store).row).toBe('closed_hat');
    }
    session.pressInstrument();
    session.pressStep(15);
    expect(panelOf(store).row).toBe('ride');
    // Each choice is heard; none of them is a step written.
    await settle();
    expect(host.triggered.filter((track) => track === getRow('closed_hat').index)).toHaveLength(2);
    expect(rowOf(store, 'ride', 0)).toBe(EMPTY_ROW);
  });

  it('gives a paired row the sound of the key that chose it, for the whole project', async () => {
    const { store, session, host } = inMode('pattern_step');
    const choose = (key: number) => {
      session.pressInstrument();
      session.pressStep(key);
      return store.getState().project;
    };
    expect(choose(1)).toMatchObject({ sounds: { bass_drum: 'bass_drum_2' }, panel: { row: 'bass_drum' } });
    expect(choose(3)).toMatchObject({ sounds: { snare_drum: 'snare_drum_2' }, panel: { row: 'snare_drum' } });
    expect(choose(8)).toMatchObject({ sounds: { rim_cowbell: 'cowbell' }, panel: { row: 'rim_cowbell' } });
    expect(choose(10)).toMatchObject({ sounds: { clap_tambourine: 'tambourine' }, panel: { row: 'clap_tambourine' } });
    expect(choose(0).sounds.bass_drum).toBe('bass_drum_1');
    // A switch, not something the machine remembers.
    expect(store.getState().canUndo).toBe(false);
    await settle();
    expect(host.triggered).toHaveLength(5);
  });

  it('gives the step keys the accent row with INSTRUMENT and ENTER', () => {
    const { store, session, host } = inMode('pattern_step');
    session.pressInstrument();
    session.pressEnter();
    expect(panelOf(store).row).toBe('accent');
    expect(store.getState().transient.held).toBeNull();
    session.pressStep(0);
    expect(rowOf(store, 'accent', 0)).toBe('x...............');
    expect(host.triggered).toEqual([]);
  });

  it('sets the last step with LAST STEP and a step key', () => {
    const { store, session } = inMode('pattern_step');
    session.pressLastStep();
    session.pressStep(11);
    expect(store.getState().project.groups.a[0]!.lastStep).toBe(12);
    expect(rowOf(store, 'bass_drum', 0)).toBe(EMPTY_ROW);
    expect(store.getState().transient.held).toBeNull();
    session.setLastStep(0);
    session.setLastStep(17);
    expect(store.getState().project.groups.a[0]!.lastStep).toBe(12);
    store.undo();
    expect(store.getState().project.groups.a[0]!.lastStep).toBe(16);
  });

  it('steps through the scales of the chart with SCALE', () => {
    const { store, session } = inMode('pattern_step');
    const scale = () => store.getState().project.groups.a[0]!.scale;
    expect(scale()).toBe(4);
    const seen = [1, 2, 3, 4].map(() => {
      session.pressScale();
      return scale();
    });
    expect(seen).toEqual([6, 3, 8, 4]);
    store.undo();
    expect(scale()).toBe(8);
  });

  it('clears the pattern named with CLEAR and a step key', () => {
    const { store, session } = inMode('pattern_step', newProject());
    session.pressClear();
    session.pressStep(1);
    expect(isEmptyPattern(store.getState().project.groups.a[1]!)).toBe(true);
    expect(isEmptyPattern(store.getState().project.groups.a[0]!)).toBe(false);
    expect(store.getState().transient.held).toBeNull();
    store.undo();
    expect(store.getState().project.groups.a[1]).toEqual(createStarterGroups().a[1]);
    // Clearing a pattern that holds nothing is not a step to undo.
    session.clearPattern(15);
    expect(store.getState().canUndo).toBe(false);
  });

  it('copies the pattern being written with SHIFT, COPY and a step key', () => {
    const { store, session } = inMode('pattern_step', newProject());
    session.pressShift();
    session.pressStep(COPY_KEY);
    expect(store.getState().transient.held).toBe('copy');
    session.pressStep(9);
    const { a } = store.getState().project.groups;
    expect(a[9]).toEqual(a[0]);
    expect(store.getState().transient.held).toBeNull();
    store.undo();
    expect(isEmptyPattern(store.getState().project.groups.a[9]!)).toBe(true);
  });

  it('lets SHIFT up when the step key it is pressed with has nothing to shift', () => {
    const { store, session } = inMode('pattern_step');
    session.pressShift();
    session.pressStep(3);
    expect(store.getState().transient.held).toBeNull();
    expect(rowOf(store, 'bass_drum', 0)).toBe(EMPTY_ROW);
  });
});

describe('shuffle, the faders and the tempo knob', () => {
  it('sets the shuffle with SHUFFLE and step keys 1 to 5, in any mode', () => {
    const { store, session } = inMode('pattern_play');
    session.pressShuffle();
    session.pressStep(3);
    expect(store.getState().project.shuffle).toBe(3);
    expect(panelOf(store).pattern).toBe(0);
    session.pressShuffle();
    session.pressStep(9);
    expect(store.getState().project.shuffle).toBe(3);
    expect(store.getState().transient.held).toBeNull();
    session.pressShuffle();
    session.pressStep(0);
    expect(store.getState().project.shuffle).toBe(0);
  });

  it('moves a level, the accent and the volume, each kept inside its travel', () => {
    const { store, session } = makeMachine();
    session.setLevel('hi_hat', 0.3);
    session.setLevel('ride', 7);
    session.setAccent(-1);
    session.setVolume(0.25);
    expect(store.getState().project.mix).toMatchObject({ volume: 0.25, accent: 0, levels: { hi_hat: 0.3, ride: 1, bass_drum: 0.75 } });
  });

  it('turns the tempo knob in whole beats a minute, from 40 to 240', () => {
    const { store, session } = makeMachine();
    session.setTempo(133.4);
    expect(store.getState().project.tempo).toBe(133);
    session.setTempo(5);
    expect(store.getState().project.tempo).toBe(40);
    session.setTempo(900);
    expect(store.getState().project.tempo).toBe(240);
  });

  it('changes what the display counts with TEMPO/MEAS', () => {
    const { store, session } = makeMachine();
    session.pressTempoMeasure();
    expect(panelOf(store).readout).toBe('measure');
    session.pressTempoMeasure();
    expect(panelOf(store).readout).toBe('tempo');
  });

  it('are none of them undo steps, and undo brings back only what the machine remembers', () => {
    const { store, session } = inMode('pattern_step');
    session.pressStep(0);
    session.setTempo(90);
    session.setVolume(0.1);
    session.setLevel('crash', 0.2);
    session.setShuffle(4);
    session.pressInstrument();
    session.pressStep(1);
    store.undo();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().project).toMatchObject({
      tempo: 90,
      shuffle: 4,
      mix: { volume: 0.1, levels: { crash: 0.2 } },
      sounds: { bass_drum: 'bass_drum_2' },
    });
    expect(rowOf(store, 'bass_drum', 0)).toBe(EMPTY_ROW);
    expect(memoryOf(store.getState().project)).toEqual({
      groups: store.getState().project.groups,
      tracks: store.getState().project.tracks,
    });
  });
});

describe('writing a track', () => {
  const track = (store: ReturnType<typeof makeMachine>['store'], index = panelOf(store).track) => store.getState().project.tracks[index]!;

  it('chooses the track with SHIFT and one of the four keys', () => {
    const { store, session } = inMode('track_write');
    for (const key of [1, 2, 3, 0]) {
      session.pressShift();
      session.pressGroup(key);
      expect(panelOf(store)).toMatchObject({ track: key, measure: 0 });
      expect(store.getState().transient.held).toBeNull();
    }
  });

  it('stores the chosen pattern with ENTER and moves on to the next measure', () => {
    const { store, session } = inMode('track_write');
    session.pressStep(3);
    session.pressEnter();
    session.pressEnter();
    session.pressStep(7);
    session.pressEnter();
    expect(track(store)).toEqual({ group: 'a', measures: [3, 3, 7] });
    expect(panelOf(store)).toMatchObject({ measure: 3, pattern: 7 });
    store.undo();
    expect(track(store).measures).toEqual([3, 3]);
    // Undo leaves the panel where it was; it never stands past the end.
    session.pressEnter();
    expect(track(store).measures).toEqual([3, 3, 7]);
  });

  it('steps through the measures with BACK and FWD, showing the pattern of each', () => {
    const { store, session } = inMode('track_write', loadFixture());
    session.selectTrack(0);
    expect(panelOf(store)).toMatchObject({ track: 0, measure: 0, pattern: 0 });
    session.pressLastStep();
    expect(panelOf(store)).toMatchObject({ measure: 1, pattern: 1 });
    for (let press = 0; press < 9; press += 1) session.pressLastStep();
    // One past the last measure, where the next is added; the pattern stays the last one shown.
    expect(panelOf(store)).toMatchObject({ measure: 5, pattern: 3 });
    session.pressScale();
    expect(panelOf(store)).toMatchObject({ measure: 4, pattern: 3 });
    for (let press = 0; press < 9; press += 1) session.pressScale();
    expect(panelOf(store)).toMatchObject({ measure: 0, pattern: 0 });
    expect(store.getState().canUndo).toBe(false);
  });

  it('writes over a measure it has been moved back to', () => {
    const { store, session } = inMode('track_write', loadFixture());
    session.selectTrack(0);
    session.pressLastStep();
    session.pressStep(9);
    session.pressEnter();
    expect(track(store).measures).toEqual([0, 9, 0, 2, 3]);
    expect(panelOf(store)).toMatchObject({ measure: 2, pattern: 0 });
  });

  it('inserts and deletes a measure with SHIFT and the keys lettered INS and DEL', () => {
    const { store, session } = inMode('track_write', loadFixture());
    session.selectTrack(0);
    session.moveMeasure(2);
    session.pressStep(12);
    session.pressShift();
    session.pressStep(INSERT_KEY);
    expect(track(store).measures).toEqual([0, 1, 12, 0, 2, 3]);
    expect(panelOf(store).measure).toBe(2);
    session.pressShift();
    session.pressStep(DELETE_KEY);
    expect(track(store).measures).toEqual([0, 1, 0, 2, 3]);
    store.undo();
    store.undo();
    expect(track(store).measures).toEqual([0, 1, 0, 2, 3]);
    expect(store.getState().canUndo).toBe(false);
  });

  it('ends the track at the measure it stands on with LAST MEAS', () => {
    const { store, session } = inMode('track_write', loadFixture());
    session.selectTrack(0);
    session.moveMeasure(2);
    session.pressInstrument();
    expect(track(store).measures).toEqual([0, 1, 0]);
    // At the end already, there is nothing to cut.
    session.moveMeasure(5);
    session.pressInstrument();
    expect(track(store).measures).toEqual([0, 1, 0]);
  });

  it('empties the track with CLEAR and ENTER', () => {
    const { store, session } = inMode('track_write', loadFixture());
    session.selectTrack(0);
    session.moveMeasure(3);
    session.pressClear();
    expect(store.getState().transient.held).toBe('clear');
    session.pressEnter();
    expect(track(store).measures).toEqual([]);
    expect(panelOf(store).measure).toBe(0);
    store.undo();
    expect(track(store).measures).toEqual([0, 1, 0, 2, 3]);
  });

  it('gives the whole track the group of key A or B', () => {
    const { store, session } = inMode('track_write', loadFixture());
    session.selectTrack(0);
    session.pressGroup(1);
    expect(track(store)).toEqual({ group: 'b', measures: [0, 1, 0, 2, 3] });
    // The panel's own group, which the pattern modes use, is left alone.
    expect(panelOf(store).group).toBe('a');
    store.undo();
    expect(track(store).group).toBe('a');
  });

  it('says so when a track is full', () => {
    const full = { ...blankProject() };
    full.tracks = [{ group: 'a', measures: Array.from({ length: TRACK_MEASURES }, () => 0) }, ...full.tracks.slice(1)];
    const { store, session } = inMode('track_write', full);
    session.moveMeasure(TRACK_MEASURES);
    session.pressEnter();
    expect(track(store).measures).toHaveLength(TRACK_MEASURES);
    expect(store.getState().notice?.message).toBe('Track I is full: it holds 192 measures.');
    session.insertMeasure();
    expect(track(store).measures).toHaveLength(TRACK_MEASURES);
  });

  it('leaves the pattern keys alone when a track is chosen from a pattern mode', () => {
    const { store, session } = inMode('pattern_play', loadFixture());
    session.pressStep(5);
    session.pressShift();
    session.pressGroup(3);
    expect(panelOf(store)).toMatchObject({ track: 3, pattern: 5 });
  });
});

describe('playing', () => {
  it('plays the pattern the panel is on in every mode but track play', () => {
    for (const mode of ['pattern_play', 'pattern_step', 'pattern_tap', 'track_write'] as const) {
      const { session } = inMode(mode, loadFixture());
      expect(session.start(), mode).toEqual({ song: [], loop: false });
    }
  });

  it('plays a track once through, from the measure it stands at', () => {
    const machine = inMode('track_play', loadFixture());
    const { store, session } = machine;
    session.selectTrack(0);
    expect(session.start()).toEqual({ song: [0, 1, 0, 2, 3], loop: false });
    session.moveMeasure(3);
    expect(session.start()).toEqual({ song: [2, 3], loop: false });
    expect(play(machine)).toBe(true);
    expect(store.getState().transient.playingMeasure).toBe(3);
    session.measures([measure(patternIndex('a', 2), 0, 1)]);
    expect(store.getState().transient.playingMeasure).toBe(3);
    session.measures([measure(patternIndex('a', 3), 1, 2)]);
    expect(store.getState().transient.playingMeasure).toBe(4);
  });

  it('stops where it was stopped, to carry on from, and goes back to the top once played through', () => {
    const machine = inMode('track_play', loadFixture());
    const { store, session } = machine;
    session.selectTrack(0);
    play(machine);
    session.measures([measure(0, 0, 1), measure(2, 1, 2)]);
    stop(machine);
    expect(panelOf(store).measure).toBe(1);
    expect(store.getState().transient.playingMeasure).toBe(-1);
    expect(session.start()).toEqual({ song: [1, 0, 2, 3], loop: false });
    play(machine);
    session.measures([measure(6, 3, 4)]);
    expect(store.getState().transient.playingMeasure).toBe(4);
    stop(machine);
    expect(panelOf(store).measure).toBe(0);
    // START is the top whatever the track was doing.
    session.moveMeasure(2);
    session.rewind();
    expect(panelOf(store).measure).toBe(0);
  });

  it('will not move through a track while it plays', () => {
    const machine = inMode('track_play', loadFixture());
    const { store, session } = machine;
    session.selectTrack(0);
    play(machine);
    session.pressLastStep();
    session.pressScale();
    expect(panelOf(store).measure).toBe(0);
    stop(machine);
    session.pressLastStep();
    expect(panelOf(store).measure).toBe(1);
    // Playing, a track stands on a measure it has: never past the last.
    session.moveMeasure(99);
    expect(panelOf(store).measure).toBe(4);
  });

  it('will not start an empty track, and says how to write one', () => {
    const machine = inMode('track_play');
    const { store, session } = machine;
    session.selectTrack(2);
    expect(session.start()).toBeNull();
    expect(play(machine)).toBe(false);
    expect(store.getState().notice).toMatchObject({ kind: 'info' });
    expect(store.getState().notice?.message).toContain('Track III is empty.');
  });

  it('does nothing with the step keys or the group keys while a track plays', () => {
    const before = loadFixture();
    const { store, session } = inMode('track_play', before);
    session.pressStep(4);
    session.pressGroup(1);
    session.pressEnter();
    expect(store.getState().project.tracks).toEqual(before.tracks);
    expect(panelOf(store)).toMatchObject({ pattern: before.panel.pattern, group: 'a' });
  });

  it('stops the machine when the mode goes into or out of track play, or to another track', () => {
    const machine = inMode('pattern_play', loadFixture());
    const { session, host } = machine;
    play(machine);
    session.setMode('pattern_step');
    session.setMode('track_write');
    expect(host.stops).toBe(0);
    session.setMode('track_play');
    expect(host.stops).toBe(1);
    session.selectTrack(0);
    play(machine);
    session.selectTrack(1);
    expect(host.stops).toBe(2);
    play(machine);
    session.setMode('pattern_play');
    expect(host.stops).toBe(3);
  });

  it('cues each next pattern of a chain as a measure begins, and starts again from its first', () => {
    const machine = inMode('pattern_play');
    const { store, session } = machine;
    session.chain(2, 4);
    play(machine);
    const cuedAfter = (pattern: number) => {
      session.measures([measure(patternIndex('a', pattern))]);
      return panelOf(store).pattern;
    };
    expect(cuedAfter(2)).toBe(3);
    expect(cuedAfter(3)).toBe(4);
    expect(cuedAfter(4)).toBe(2);
    expect(cuedAfter(2)).toBe(3);
    // A pattern from outside the chain, still sounding when the chain was made, leads into its first.
    expect(cuedAfter(9)).toBe(2);
    stop(machine);
    expect(panelOf(store)).toMatchObject({ pattern: 2, chain: { first: 2, last: 4 } });
    expect(store.getState().canUndo).toBe(false);
  });

  it('carries a chain made while playing on from the pattern it is at', () => {
    const machine = inMode('pattern_play');
    const { store, session } = machine;
    session.pressStep(3);
    play(machine);
    session.chain(1, 5);
    expect(panelOf(store)).toMatchObject({ pattern: 3, chain: { first: 1, last: 5 } });
    session.chain(6, 8);
    expect(panelOf(store).pattern).toBe(6);
  });

  it('leaves the pattern alone when a measure is reported with no chain, or after stopping', () => {
    const machine = inMode('pattern_play');
    const { store, session } = machine;
    session.pressStep(3);
    play(machine);
    session.measures([measure(patternIndex('a', 3))]);
    session.measures([]);
    expect(panelOf(store).pattern).toBe(3);
    session.chain(3, 5);
    stop(machine);
    session.measures([measure(patternIndex('a', 3))]);
    expect(panelOf(store).pattern).toBe(3);
  });
});

describe('writing a pattern by tapping', () => {
  /** A running pattern at a step, with the clock a tap is placed by a fraction of a step past it. */
  function running(step: number, into: number, project: Project = blankProject()) {
    const machine = inMode('pattern_tap', project);
    play(machine);
    machine.store.setPosition(step, patternIndex('a', 0));
    // At 120 with four steps to the beat, a step lasts 125 ms.
    vi.spyOn(performance, 'now').mockReturnValue(1000 + into * 125);
    machine.host.stepStarted = 1000;
    return machine;
  }

  it('plays the sound of a step key when the pattern is not running, and writes nothing', async () => {
    const { store, session, host } = inMode('pattern_tap');
    session.pressStep(4);
    await settle();
    expect(host.triggered).toEqual([getRow('low_tom').index]);
    expect(panelOf(store).row).toBe('low_tom');
    expect(rowOf(store, 'low_tom', 0)).toBe(EMPTY_ROW);
    expect(store.getState().canUndo).toBe(false);
  });

  it('writes a tap in the first half of a step on that step, and sounds it at once', () => {
    const { store, session, host } = running(5, 0.3);
    session.pressStep(2);
    expect(host.triggered).toEqual([getRow('snare_drum').index]);
    expect(rowOf(store, 'snare_drum', 0)).toBe('.....x..........');
  });

  it('writes a tap in the second half of a step on the next, once that step has passed', () => {
    const { store, session, host } = running(5, 0.7);
    session.pressStep(2);
    expect(host.triggered).toEqual([getRow('snare_drum').index]);
    expect(rowOf(store, 'snare_drum', 0)).toBe(EMPTY_ROW);
    store.setPosition(6, patternIndex('a', 0));
    expect(rowOf(store, 'snare_drum', 0)).toBe('......x.........');
  });

  it('wraps a late tap on the last step round to the first', () => {
    const short = blankProject();
    short.groups = { ...short.groups, a: [{ ...createEmptyPattern(), lastStep: 12 }, ...short.groups.a.slice(1)] };
    const machine = running(11, 0.9, short);
    machine.session.pressStep(0);
    stop(machine);
    expect(rowOf(machine.store, 'bass_drum', 0)).toBe('x...............');
  });

  it('stores a whole take as one undo step when the machine stops', () => {
    const machine = running(0, 0.1);
    const { store, session } = machine;
    session.pressStep(0);
    store.setPosition(4, patternIndex('a', 0));
    session.pressStep(2);
    store.setPosition(7, patternIndex('a', 0));
    vi.spyOn(performance, 'now').mockReturnValue(1000 + 0.8 * 125);
    session.pressStep(13);
    expect(store.getState().canUndo).toBe(false);
    stop(machine);
    // The tap still waiting for its step is written before the take is stored.
    expect(rowOf(store, 'bass_drum', 0)).toBe('x...............');
    expect(rowOf(store, 'snare_drum', 0)).toBe('....x...........');
    expect(rowOf(store, 'open_hat', 0)).toBe('........x.......');
    expect(store.getState().canUndo).toBe(true);
    store.undo();
    expect(isEmptyPattern(store.getState().project.groups.a[0]!)).toBe(true);
    expect(store.getState().canUndo).toBe(false);
    store.redo();
    expect(rowOf(store, 'open_hat', 0)).toBe('........x.......');
  });

  it('stores the take when the mode leaves tap write, too', () => {
    const machine = running(3, 0.2);
    machine.session.pressStep(15);
    machine.session.setMode('pattern_step');
    expect(machine.store.getState().canUndo).toBe(true);
    expect(rowOf(machine.store, 'ride', 0)).toBe('...x............');
  });

  it('accents the step when ENTER is tapped, and makes no sound of it', () => {
    const { store, session, host } = running(8, 0.1);
    session.pressEnter();
    expect(rowOf(store, 'accent', 0)).toBe('........x.......');
    expect(host.triggered).toEqual([]);
  });

  it('plays the second sound of a pair when its key is tapped, and the row keeps it', () => {
    const { store, session } = running(2, 0.1);
    session.pressStep(1);
    expect(store.getState().project.sounds.bass_drum).toBe('bass_drum_2');
    expect(rowOf(store, 'bass_drum', 0)).toBe('..x.............');
    session.pressStep(8);
    expect(store.getState().project.sounds.rim_cowbell).toBe('cowbell');
    expect(rowOf(store, 'rim_cowbell', 0)).toBe('..x.............');
  });
});

describe('what the machine remembers', () => {
  it('is its patterns and its tracks', () => {
    expect(remembersAnything(blankProject())).toBe(false);
    expect(remembersAnything(newProject())).toBe(true);
    const lengthOnly = blankProject();
    lengthOnly.groups = { ...lengthOnly.groups, b: [{ ...createEmptyPattern(), lastStep: 3 }, ...lengthOnly.groups.b.slice(1)] };
    expect(remembersAnything(lengthOnly)).toBe(true);
    const trackOnly = blankProject();
    trackOnly.tracks = [{ group: 'a', measures: [0] }, ...trackOnly.tracks.slice(1)];
    expect(remembersAnything(trackOnly)).toBe(true);
  });

  it('is wiped by clear everything, and put back by the starter beat, each one undo step', () => {
    const { store, session } = makeMachine(loadFixture());
    const before = memoryOf(store.getState().project);
    session.clearEverything();
    expect(remembersAnything(store.getState().project)).toBe(false);
    session.clearEverything();
    store.undo();
    expect(memoryOf(store.getState().project)).toEqual(before);
    expect(store.getState().canUndo).toBe(false);
    session.loadStarterBeat();
    expect(memoryOf(store.getState().project)).toEqual({ groups: createStarterGroups(), tracks: createStarterTracks() });
    store.undo();
    expect(memoryOf(store.getState().project)).toEqual(before);
  });

  it('starts with nothing held and no track playing', () => {
    const { store } = makeMachine();
    expect(store.getState().transient).toEqual(RESTING);
    expect(RESTING).toEqual({ held: null, playingMeasure: -1 });
  });
});

describe('hearing an instrument', () => {
  it('starts audio to play a chosen instrument, and plays nothing with the power off', async () => {
    const { store, session, host } = inMode('pattern_step');
    await session.audition('crash');
    expect(host.triggered).toEqual([getRow('crash').index]);
    await session.audition('accent');
    store.setPower(false);
    await session.audition('crash');
    expect(host.triggered).toHaveLength(1);
  });

  it('never starts audio for a step put on', () => {
    const { session, host } = inMode('pattern_step');
    host.running = false;
    session.pressStep(0);
    expect(host.triggered).toEqual([]);
  });
});
