import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TRACK_MEASURES,
  bankIndex,
  createEmptyPatterns,
  createEmptyTracks,
  createProject,
  createStarterPatterns,
  createStarterTracks,
  isCleared,
} from '../src/document';
import { RESTING, barOf, keysAreSteps, memoryOf, remembersAnything, selectedTrack, shownPattern } from '../src/session';
import { loadFixture, makeMachine, newProject, rowOf, selectorOf, stepsOn } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Lets a hit that waits on audio starting be played. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Tells the machine of every change to its store, as the runtime does. */
function watched(machine: ReturnType<typeof makeMachine>): void {
  let previous = machine.store.getState();
  machine.store.subscribe(() => {
    const before = previous;
    previous = machine.store.getState();
    machine.session.changed(before, previous);
  });
}

const panelOf = (machine: ReturnType<typeof makeMachine>) => machine.store.getState().project.panel;
const trackOf = (machine: ReturnType<typeof makeMachine>, index = panelOf(machine).selector) =>
  machine.store.getState().project.tracks[index]!;

describe('choosing patterns', () => {
  it('stopped in pattern write or pattern play, a step key chooses a pattern, and that is nothing to undo', () => {
    for (const mode of ['pattern_write', 'pattern_play'] as const) {
      const machine = makeMachine();
      machine.session.setMode(mode);
      expect(machine.session.pressStep(4)).toEqual({ kind: 'pattern' });
      expect(panelOf(machine)).toMatchObject({ pattern: 4, chainEnd: 4 });
      expect(shownPattern(machine.store.getState())).toBe(4);
      expect(machine.store.getState().canUndo).toBe(false);
      expect(machine.session.pressStep(16)).toEqual({ kind: 'none' });
      expect(machine.session.pressStep(-1)).toEqual({ kind: 'none' });
    }
  });

  it('two keys pressed together chain the patterns between them, within a block of four', () => {
    const machine = makeMachine();
    expect(machine.session.pressSteps(0, 3)).toEqual({ kind: 'pattern' });
    expect(panelOf(machine)).toMatchObject({ pattern: 0, chainEnd: 3 });
    machine.session.pressSteps(6, 5);
    expect(panelOf(machine)).toMatchObject({ pattern: 5, chainEnd: 6 });
    // Across blocks only the second key counts.
    machine.session.pressSteps(3, 4);
    expect(panelOf(machine)).toMatchObject({ pattern: 4, chainEnd: 4 });
    // One key by itself lets a chain go.
    machine.session.pressSteps(8, 11);
    machine.session.pressStep(9);
    expect(panelOf(machine)).toMatchObject({ pattern: 9, chainEnd: 9 });
  });

  it('hands a chain to the engine as a song that goes round, and one pattern as no song at all', () => {
    const machine = makeMachine();
    machine.session.setMode('pattern_play');
    expect(machine.run()).toEqual({ song: [], loop: false });
    machine.stop();
    machine.session.pressSteps(0, 3);
    expect(machine.run()).toEqual({ song: [0, 1, 2, 3], loop: true });
  });

  it('running, a key chooses one pattern, and the chain that is playing is not left for its own first', () => {
    const machine = makeMachine();
    machine.session.setMode('pattern_play');
    machine.session.pressSteps(0, 3);
    machine.run();
    // Its own first pattern: the engine is on the chain already, and stays on it.
    expect(machine.session.pressStep(0)).toEqual({ kind: 'none' });
    expect(panelOf(machine)).toMatchObject({ pattern: 0, chainEnd: 3 });
    // Two keys together are read as the second alone while it runs.
    expect(machine.session.pressSteps(4, 6)).toEqual({ kind: 'pattern' });
    expect(panelOf(machine)).toMatchObject({ pattern: 6, chainEnd: 6 });
    // The chain is over now, so its old first pattern is a choice like any other.
    expect(machine.session.pressStep(0)).toEqual({ kind: 'pattern' });
    expect(panelOf(machine)).toMatchObject({ pattern: 0, chainEnd: 0 });
    expect(machine.store.getState().playing).toBe(true);
    expect(machine.host.stops).toBe(0);
  });

  it('the pattern group button changes groups only while the machine is stopped', () => {
    const machine = makeMachine();
    machine.session.pressGroup();
    expect(panelOf(machine).group).toBe(1);
    machine.run();
    machine.session.pressGroup();
    expect(panelOf(machine).group).toBe(1);
    machine.stop();
    machine.session.pressGroup();
    expect(panelOf(machine).group).toBe(0);
    expect(machine.store.getState().canUndo).toBe(false);
  });
});

describe('writing a pattern', () => {
  it('the keys are steps only while the pattern runs in pattern write', () => {
    const machine = makeMachine();
    expect(keysAreSteps(machine.store.getState())).toBe(false);
    machine.run();
    expect(keysAreSteps(machine.store.getState())).toBe(true);
    machine.session.setMode('pattern_play');
    expect(keysAreSteps(machine.store.getState())).toBe(false);
  });

  it('a step key puts a step of the selected instrument on and takes it off, one undo step each', () => {
    const machine = makeMachine();
    machine.session.pressStep(15);
    machine.run();
    expect(selectedTrack(machine.store.getState().project)).toBe('kick');
    expect(machine.session.pressStep(2)).toEqual({ kind: 'step', on: true });
    expect(machine.session.pressStep(6)).toEqual({ kind: 'step', on: true });
    expect(stepsOn(rowOf(machine.store, 'kick', 15))).toEqual([2, 6]);
    expect(machine.session.pressStep(2)).toEqual({ kind: 'step', on: false });
    expect(stepsOn(rowOf(machine.store, 'kick', 15))).toEqual([6]);
    machine.store.undo();
    machine.store.undo();
    expect(stepsOn(rowOf(machine.store, 'kick', 15))).toEqual([2]);
    machine.store.redo();
    expect(stepsOn(rowOf(machine.store, 'kick', 15))).toEqual([2, 6]);
  });

  it('writes the track the selector is on, the accent included, in the group the panel is on', () => {
    const machine = makeMachine();
    machine.session.pressGroup();
    machine.session.pressStep(3);
    machine.run();
    machine.session.turnSelector(selectorOf('accent'));
    machine.session.pressStep(0);
    machine.session.turnSelector(selectorOf('closed_hat'));
    machine.session.pressStep(9);
    expect(stepsOn(rowOf(machine.store, 'accent', 3, 1))).toEqual([0]);
    expect(stepsOn(rowOf(machine.store, 'closed_hat', 3, 1))).toEqual([9]);
    // The same pattern of the other group, and every other pattern, are as they were.
    expect(machine.store.getState().project.patterns[0]).toEqual(createStarterPatterns()[0]);
    expect(machine.store.getState().project.patterns[1]!.filter((pattern) => !isCleared(pattern))).toHaveLength(1);
    // Turning the selector is not something to undo.
    machine.store.undo();
    machine.store.undo();
    expect(machine.store.getState().canUndo).toBe(false);
    expect(panelOf(machine).selector).toBe(selectorOf('closed_hat'));
  });

  it('writes the pattern of a chain that is playing', () => {
    const machine = makeMachine();
    machine.session.pressSteps(12, 15);
    expect(machine.run()).toEqual({ song: [12, 13, 14, 15], loop: true });
    machine.at(0, bankIndex(14, 0));
    expect(shownPattern(machine.store.getState())).toBe(14);
    machine.session.pressStep(1);
    expect(stepsOn(rowOf(machine.store, 'kick', 14))).toEqual([1]);
    expect(stepsOn(rowOf(machine.store, 'kick', 13))).toEqual([]);
  });

  it('FUNCTION stores the scale the switch stands on, and the next step key is the last step', () => {
    const machine = makeMachine();
    machine.session.pressStep(15);
    machine.session.setScale(3);
    expect(panelOf(machine).scale).toBe(3);
    expect(machine.store.getState().canUndo).toBe(false);

    machine.session.pressFunction();
    expect(machine.store.getState().transient.functionHeld).toBe(true);
    expect(machine.store.getState().project.patterns[0]![15]).toMatchObject({ scale: 3, lastStep: 16 });
    expect(machine.session.pressStep(11)).toEqual({ kind: 'last_step' });
    expect(machine.store.getState().project.patterns[0]![15]).toMatchObject({ scale: 3, lastStep: 12 });
    // FUNCTION comes up once it has done its work, and nothing was chosen or toggled.
    expect(machine.store.getState().transient.functionHeld).toBe(false);
    expect(panelOf(machine).pattern).toBe(15);

    // The scale and the last step are each a step to undo.
    machine.store.undo();
    expect(machine.store.getState().project.patterns[0]![15]).toMatchObject({ scale: 3, lastStep: 16 });
    machine.store.undo();
    expect(machine.store.getState().project.patterns[0]![15]).toMatchObject({ scale: 1, lastStep: 16 });
    expect(machine.store.getState().canUndo).toBe(false);

    // Pressed again with no step key between, it comes up.
    machine.session.pressFunction();
    machine.session.pressFunction();
    expect(machine.store.getState().transient.functionHeld).toBe(false);
    // A scale that is not one of the four is ignored.
    machine.session.setScale(5 as never);
    expect(panelOf(machine).scale).toBe(3);
  });

  it('a step past the last step cannot be written', () => {
    const machine = makeMachine();
    machine.session.pressStep(12);
    machine.run();
    expect(machine.store.getState().project.patterns[0]![12]!.lastStep).toBe(12);
    expect(machine.session.pressStep(12)).toEqual({ kind: 'none' });
    expect(machine.session.pressStep(11)).toMatchObject({ kind: 'step' });
  });

  it('CLEAR stays down, and the next step key names the pattern to clear', () => {
    const machine = makeMachine();
    machine.session.pressClear();
    expect(machine.store.getState().transient.clearArmed).toBe(true);
    expect(machine.session.pressStep(8)).toEqual({ kind: 'cleared' });
    expect(machine.store.getState().transient.clearArmed).toBe(false);
    // It kept its scale, went back to sixteen steps, and is now the pattern selected.
    expect(machine.store.getState().project.patterns[0]![8]).toEqual({ ...createEmptyPatterns()[0]![8]!, scale: 3 });
    expect(panelOf(machine).pattern).toBe(8);
    machine.store.undo();
    expect(machine.store.getState().project.patterns[0]![8]).toEqual(createStarterPatterns()[0]![8]);
    expect(machine.store.getState().canUndo).toBe(false);

    // Pressed again it comes up; FUNCTION and CLEAR are never both down; running, CLEAR does nothing.
    machine.session.pressClear();
    machine.session.pressFunction();
    expect(machine.store.getState().transient).toMatchObject({ functionHeld: true, clearArmed: false });
    machine.session.pressClear();
    expect(machine.store.getState().transient).toMatchObject({ functionHeld: false, clearArmed: true });
    machine.session.pressClear();
    machine.run();
    machine.session.pressClear();
    expect(machine.store.getState().transient.clearArmed).toBe(false);
  });

  it('Escape lets FUNCTION and CLEAR up, and takes no other key', () => {
    const machine = makeMachine();
    machine.session.pressFunction();
    expect(machine.session.keyDown({ key: 'Escape' } as KeyboardEvent)).toBe(true);
    expect(machine.store.getState().transient).toEqual(RESTING);
    expect(machine.session.keyDown({ key: 'a' } as KeyboardEvent)).toBe(false);
  });

  it('TAP writes the selected instrument on the step sounding, or on the next once it is half over', () => {
    const machine = makeMachine();
    machine.session.pressStep(15);
    machine.session.turnSelector(selectorOf('snare'));
    machine.run();
    // 126 beats a minute at four steps to the beat: a step lasts about 119 ms.
    const clock = vi.spyOn(performance, 'now');
    machine.at(4, bankIndex(15, 0));
    machine.host.stepStarted = 1000;
    clock.mockReturnValue(1020);
    machine.host.triggered.length = 0;
    machine.session.pressTap();
    expect(stepsOn(rowOf(machine.store, 'snare', 15))).toEqual([4]);
    // The step had already sounded, so the tap is heard now.
    expect(machine.host.triggered).toEqual([2]);

    clock.mockReturnValue(1100);
    machine.session.pressTap();
    expect(stepsOn(rowOf(machine.store, 'snare', 15))).toEqual([4, 5]);
    // The next step has yet to sound: the engine will play it.
    expect(machine.host.triggered).toEqual([2]);

    // Late on the last step it belongs to the first.
    machine.at(15, bankIndex(15, 0));
    machine.session.pressTap();
    expect(stepsOn(rowOf(machine.store, 'snare', 15))).toEqual([0, 4, 5]);
    // A tap on a step that is already on writes nothing.
    const before = machine.store.getState().project;
    machine.session.pressTap();
    expect(machine.store.getState().project).toBe(before);
  });

  it('every tap of one take is a single undo step, stored when the machine stops', () => {
    const machine = makeMachine();
    watched(machine);
    machine.session.pressStep(15);
    machine.run();
    vi.spyOn(performance, 'now').mockReturnValue(0);
    for (const step of [0, 3, 6]) {
      machine.at(step, bankIndex(15, 0));
      machine.session.pressTap();
    }
    expect(stepsOn(rowOf(machine.store, 'kick', 15))).toEqual([0, 3, 6]);
    expect(machine.store.getState().canUndo).toBe(false);
    machine.stop();
    expect(stepsOn(rowOf(machine.store, 'kick', 15))).toEqual([0, 3, 6]);
    expect(machine.store.getState().canUndo).toBe(true);
    machine.store.undo();
    expect(stepsOn(rowOf(machine.store, 'kick', 15))).toEqual([]);
    expect(machine.store.getState().canUndo).toBe(false);
    machine.store.redo();
    expect(stepsOn(rowOf(machine.store, 'kick', 15))).toEqual([0, 3, 6]);
  });

  it('a step key pressed between taps ends the take, so undo goes back through them in order', () => {
    const machine = makeMachine();
    watched(machine);
    machine.session.pressStep(15);
    machine.run();
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const tapAt = (step: number) => {
      machine.at(step, bankIndex(15, 0));
      machine.session.pressTap();
    };
    tapAt(0);
    tapAt(2);
    machine.session.pressStep(8);
    tapAt(12);
    machine.stop();
    expect(stepsOn(rowOf(machine.store, 'kick', 15))).toEqual([0, 2, 8, 12]);
    machine.store.undo();
    expect(stepsOn(rowOf(machine.store, 'kick', 15))).toEqual([0, 2, 8]);
    machine.store.undo();
    expect(stepsOn(rowOf(machine.store, 'kick', 15))).toEqual([0, 2]);
    machine.store.undo();
    expect(stepsOn(rowOf(machine.store, 'kick', 15))).toEqual([]);
    expect(machine.store.getState().canUndo).toBe(false);
  });

  it('an undo in the middle of a take takes its taps with it and leaves nothing to store', () => {
    const machine = makeMachine();
    watched(machine);
    machine.session.pressStep(15);
    machine.run();
    vi.spyOn(performance, 'now').mockReturnValue(0);
    machine.session.pressStep(4);
    machine.at(9, bankIndex(15, 0));
    machine.session.pressTap();
    expect(stepsOn(rowOf(machine.store, 'kick', 15))).toEqual([4, 9]);
    machine.store.undo();
    expect(stepsOn(rowOf(machine.store, 'kick', 15))).toEqual([]);
    machine.stop();
    expect(stepsOn(rowOf(machine.store, 'kick', 15))).toEqual([]);
    expect(machine.store.getState().canUndo).toBe(false);
  });

  it('stopped, TAP plays the selected instrument and writes nothing', async () => {
    const machine = makeMachine();
    machine.session.pressTap();
    await settled();
    expect(machine.host.triggered).toEqual([1]);
    expect(machine.store.getState().canUndo).toBe(false);
    // The accent is not a sound, and a machine that is switched off plays none.
    machine.session.turnSelector(selectorOf('accent'));
    machine.session.pressTap();
    machine.store.setPower(false);
    await machine.session.audition('snare');
    expect(machine.host.triggered).toEqual([1]);
  });

  it('in the play modes FUNCTION, CLEAR and TAP have nothing to do', () => {
    for (const mode of ['pattern_play', 'track_play'] as const) {
      const machine = makeMachine();
      machine.session.setMode(mode);
      const before = machine.store.getState();
      machine.session.pressFunction();
      machine.session.pressClear();
      machine.session.pressTap();
      expect(machine.store.getState().transient).toEqual(RESTING);
      expect(machine.store.getState().project).toBe(before.project);
      expect(machine.host.triggered).toEqual([]);
    }
  });
});

describe('writing a track', () => {
  const inTrackWrite = (track: number) => {
    const machine = makeMachine();
    machine.session.setMode('track_write');
    machine.session.turnSelector(track);
    return machine;
  };

  it('WRITE/NEXT writes the chosen pattern into the bar and moves on, a bar to each undo step', () => {
    const machine = inTrackWrite(4);
    expect(trackOf(machine)).toEqual([]);
    expect(machine.session.pressStep(8)).toEqual({ kind: 'pattern' });
    machine.session.pressTap();
    machine.session.pressTap();
    machine.session.pressStep(12);
    machine.session.pressTap();
    expect(trackOf(machine)).toEqual([8, 8, 12]);
    expect(barOf(machine.store.getState())).toBe(3);
    machine.store.undo();
    expect(trackOf(machine)).toEqual([8, 8]);
    // The other tracks are as they were.
    expect(machine.store.getState().project.tracks.filter((_, index) => index !== 4)).toEqual(
      createStarterTracks().filter((_, index) => index !== 4),
    );
  });

  it('shows what a written bar holds as it comes to it, so stepping through a track changes nothing', () => {
    const machine = inTrackWrite(0);
    // Track 1 of the starter: 1, 2, 1, 4, 1, 2, 3, 4.
    expect(barOf(machine.store.getState())).toBe(0);
    expect(panelOf(machine).pattern).toBe(0);
    machine.session.pressTap();
    expect(panelOf(machine).pattern).toBe(1);
    machine.session.pressTap();
    machine.session.pressTap();
    expect(barOf(machine.store.getState())).toBe(3);
    expect(panelOf(machine).pattern).toBe(3);
    expect(trackOf(machine)).toEqual(createStarterTracks()[0]);
    expect(machine.store.getState().canUndo).toBe(false);
    // A bar is changed by choosing another pattern for it.
    machine.session.pressStep(5);
    machine.session.pressTap();
    expect(trackOf(machine)).toEqual([0, 1, 0, 5, 0, 1, 2, 3]);
  });

  it('CLEAR is BAR RESET, and with FUNCTION down it is D.C., which makes this bar the last', () => {
    const machine = inTrackWrite(0);
    machine.session.pressTap();
    machine.session.pressTap();
    machine.session.pressClear();
    expect(barOf(machine.store.getState())).toBe(0);
    expect(machine.store.getState().canUndo).toBe(false);

    machine.session.pressTap();
    machine.session.pressTap();
    machine.session.pressStep(9);
    machine.session.pressFunction();
    machine.session.pressClear();
    expect(trackOf(machine)).toEqual([0, 1, 9]);
    expect(machine.store.getState().transient.functionHeld).toBe(false);
    expect(barOf(machine.store.getState())).toBe(2);
    machine.store.undo();
    expect(trackOf(machine)).toEqual(createStarterTracks()[0]);
  });

  it('with FUNCTION down the last two step keys take a bar out and put one in', () => {
    const machine = inTrackWrite(0);
    machine.session.pressTap();
    machine.session.pressFunction();
    // Any other key does nothing, and FUNCTION stays down for the one that counts.
    expect(machine.session.pressStep(3)).toEqual({ kind: 'none' });
    expect(machine.store.getState().transient.functionHeld).toBe(true);
    expect(machine.session.pressStep(14)).toEqual({ kind: 'bar' });
    expect(trackOf(machine)).toEqual([0, 0, 3, 0, 1, 2, 3]);
    expect(machine.store.getState().transient.functionHeld).toBe(false);
    // The track stands at the same bar, on what moved up into it.
    expect(barOf(machine.store.getState())).toBe(1);
    expect(panelOf(machine).pattern).toBe(0);

    machine.session.pressStep(12);
    machine.session.pressFunction();
    expect(machine.session.pressStep(15)).toEqual({ kind: 'bar' });
    expect(trackOf(machine)).toEqual([0, 12, 0, 3, 0, 1, 2, 3]);
    machine.store.undo();
    machine.store.undo();
    expect(trackOf(machine)).toEqual(createStarterTracks()[0]);
  });

  it('a track holds sixty-four bars and no more', () => {
    const machine = inTrackWrite(7);
    machine.session.pressStep(4);
    for (let bar = 0; bar < TRACK_MEASURES + 3; bar += 1) machine.session.pressTap();
    expect(trackOf(machine)).toHaveLength(TRACK_MEASURES);
    expect(barOf(machine.store.getState())).toBe(TRACK_MEASURES - 1);
    machine.session.pressFunction();
    machine.session.pressStep(15);
    expect(trackOf(machine)).toHaveLength(TRACK_MEASURES);
  });

  it('a bar is one pattern: two keys together, and a chain brought in from a pattern mode, are one', () => {
    const machine = makeMachine();
    machine.session.pressSteps(4, 7);
    machine.session.setMode('track_write');
    machine.session.turnSelector(5);
    expect(panelOf(machine)).toMatchObject({ pattern: 4, chainEnd: 4 });
    expect(machine.session.pressSteps(0, 2)).toEqual({ kind: 'pattern' });
    expect(panelOf(machine)).toMatchObject({ pattern: 2, chainEnd: 2 });
    // Running, the chosen pattern goes round by itself for the ear, with no song.
    expect(machine.run()).toEqual({ song: [], loop: false });
  });

  it('goes back to the first bar when the selector turns to another track, or undo shortens this one', () => {
    const machine = inTrackWrite(1);
    machine.session.pressTap();
    machine.session.pressTap();
    expect(barOf(machine.store.getState())).toBe(2);
    machine.session.turnSelector(0);
    expect(barOf(machine.store.getState())).toBe(0);
    machine.session.turnSelector(3);
    machine.session.pressTap();
    machine.session.pressTap();
    machine.store.undo();
    machine.store.undo();
    // The track is empty again, so there is no bar 3 to stand at.
    expect(barOf(machine.store.getState())).toBe(0);
  });
});

describe('playing a track', () => {
  it('hands the track to the engine as a song that goes round, from its first bar', () => {
    const machine = makeMachine();
    machine.session.setMode('track_play');
    machine.session.turnSelector(1);
    expect(machine.run()).toEqual({ song: [4, 4, 4, 5], loop: true });
    // The step keys only show what plays.
    expect(machine.session.pressStep(9)).toEqual({ kind: 'none' });
    expect(panelOf(machine).pattern).toBe(0);
  });

  it('follows the bar the engine has reached, and is back at the first when it stops', () => {
    const machine = makeMachine();
    machine.session.setMode('track_play');
    machine.run();
    machine.session.measures([{ frame: 0, ordinal: 1, pattern: 0, kind: 'basic', position: 0 }]);
    expect(barOf(machine.store.getState())).toBe(0);
    machine.session.measures([
      { frame: 1, ordinal: 2, pattern: 2, kind: 'basic', position: 1 },
      { frame: 2, ordinal: 3, pattern: 0, kind: 'basic', position: 2 },
    ]);
    expect(barOf(machine.store.getState())).toBe(2);
    machine.stop();
    expect(barOf(machine.store.getState())).toBe(0);
    // In a pattern mode the engine's measures move no track.
    machine.session.setMode('pattern_play');
    machine.session.measures([{ frame: 0, ordinal: 1, pattern: 0, kind: 'basic', position: -1 }]);
    expect(machine.store.getState().transient.bar).toBe(0);
  });

  it('does not start on an empty track, and says how to write one', () => {
    const machine = makeMachine();
    machine.session.setMode('track_play');
    machine.session.turnSelector(6);
    expect(machine.run()).toBeNull();
    expect(machine.store.getState().playing).toBe(false);
    expect(machine.store.getState().notice).toMatchObject({ kind: 'info' });
    expect(machine.store.getState().notice!.message).toContain('Track 7 is empty');
  });

  it('stops when the mode selector turns into or out of a track mode, or the selector to another track', () => {
    const crossings = [
      ['pattern_play', 'track_play'],
      ['pattern_write', 'track_write'],
      ['track_play', 'pattern_play'],
      ['track_write', 'track_play'],
    ] as const;
    for (const [from, to] of crossings) {
      const machine = makeMachine();
      machine.session.setMode(from);
      watched(machine);
      machine.run();
      machine.session.setMode(to);
      expect(machine.host.stops, `${from} to ${to}`).toBe(1);
      expect(machine.store.getState().playing).toBe(false);
    }

    const machine = makeMachine();
    watched(machine);
    // Between the two pattern modes it plays on.
    machine.session.setMode('pattern_play');
    machine.run();
    machine.session.setMode('pattern_write');
    machine.session.turnSelector(3);
    expect(machine.host.stops).toBe(0);
    machine.stop();
    // Another track in track play is another song.
    machine.session.setMode('track_play');
    machine.session.turnSelector(0);
    machine.run();
    machine.session.turnSelector(1);
    expect(machine.host.stops).toBe(1);
  });
});

describe('knobs and switches', () => {
  it('turn without leaving anything to undo, and stay inside their travel', () => {
    const machine = makeMachine();
    const project = () => machine.store.getState().project;
    machine.session.setTempo(174.4);
    expect(project().tempo).toBe(174);
    machine.session.setTempo(1000);
    expect(project().tempo).toBe(300);
    machine.session.setLevel('toms', 0.31);
    machine.session.setLevel('accent', 2);
    machine.session.setVolume(-1);
    expect(project().mix).toEqual({ volume: 0, levels: { ...newProject().mix.levels, toms: 0.31, accent: 1 } });
    machine.session.turnSelector(7);
    machine.session.turnSelector(8);
    expect(project().panel.selector).toBe(7);
    expect(machine.store.getState().canUndo).toBe(false);
    // Nothing the machine remembers moved.
    expect(memoryOf(project())).toEqual(memoryOf(newProject()));
  });

  it('a knob turned to where it already stands does not touch the project', () => {
    const machine = makeMachine();
    const before = machine.store.getState().project;
    machine.session.setTempo(before.tempo);
    machine.session.setLevel('cymbal', before.mix.levels.cymbal);
    machine.session.setVolume(before.mix.volume);
    machine.session.setScale(before.panel.scale);
    machine.session.setMode(before.panel.mode);
    machine.session.turnSelector(before.panel.selector);
    expect(machine.store.getState().project).toBe(before);
  });

  it('turning the mode selector lets everything up and takes a track back to its first bar', () => {
    const machine = makeMachine();
    machine.session.setMode('track_write');
    machine.session.pressTap();
    machine.session.pressFunction();
    expect(machine.store.getState().transient).toMatchObject({ functionHeld: true, bar: 1 });
    machine.session.setMode('pattern_write');
    expect(machine.store.getState().transient).toEqual(RESTING);
  });
});

describe('what the machine remembers', () => {
  it('is its patterns and its tracks, and nothing else', () => {
    const fixture = loadFixture();
    expect(memoryOf(fixture)).toEqual({ patterns: fixture.patterns, tracks: fixture.tracks });
    expect(remembersAnything(fixture)).toBe(true);
    const blank = createProject({ id: 'blank', now: new Date('2026-11-17T12:00:00.000Z'), patterns: createEmptyPatterns() });
    expect(remembersAnything(blank)).toBe(false);
    expect(remembersAnything({ ...blank, tracks: blank.tracks.map((track, index) => (index === 7 ? [0] : track)) })).toBe(true);
  });

  it('clears the pattern the step keys show from settings, as one undo step', () => {
    const machine = makeMachine(loadFixture());
    machine.session.setMode('pattern_write');
    const before = machine.store.getState().project.patterns;
    machine.session.clearPattern();
    expect(isCleared(machine.store.getState().project.patterns[0]![0]!)).toBe(true);
    expect(machine.store.getState().project.patterns[0]![1]).toBe(before[0]![1]);
    machine.store.undo();
    expect(machine.store.getState().project.patterns).toEqual(before);
    // Clearing an empty pattern is not a step to undo.
    machine.session.pressStep(10);
    machine.session.clearPattern();
    expect(machine.store.getState().canUndo).toBe(false);
  });

  it('clears everything in one step that undo brings back, and leaves the knobs alone', () => {
    const machine = makeMachine(loadFixture());
    const before = machine.store.getState().project;
    machine.session.clearEverything();
    const cleared = machine.store.getState().project;
    expect(cleared.patterns).toEqual(createEmptyPatterns());
    expect(cleared.tracks).toEqual(createEmptyTracks());
    expect(cleared.mix).toEqual(before.mix);
    expect(cleared.tempo).toBe(before.tempo);
    expect(cleared.name).toBe(before.name);
    machine.store.undo();
    expect(memoryOf(machine.store.getState().project)).toEqual(memoryOf(before));
    expect(machine.store.getState().canUndo).toBe(false);

    // With nothing to clear there is nothing to undo.
    machine.session.clearEverything();
    machine.session.clearEverything();
    machine.store.undo();
    machine.store.undo();
    expect(memoryOf(machine.store.getState().project)).toEqual(memoryOf(before));
  });

  it('puts the starter beat back, undoably', () => {
    const machine = makeMachine(loadFixture());
    const before = machine.store.getState().project;
    machine.session.loadStarter();
    expect(machine.store.getState().project.patterns).toEqual(createStarterPatterns());
    expect(machine.store.getState().project.tracks).toEqual(createStarterTracks());
    machine.store.undo();
    expect(memoryOf(machine.store.getState().project)).toEqual(memoryOf(before));
  });

  it('switched off it forgets what was held down and where a track stood, and nothing it remembers', () => {
    const machine = makeMachine();
    machine.session.setMode('track_write');
    machine.session.pressTap();
    machine.session.pressFunction();
    const project = machine.store.getState().project;
    machine.store.setPower(false);
    expect(machine.store.getState().transient).toEqual(RESTING);
    expect(machine.store.getState().project).toBe(project);
  });
});
