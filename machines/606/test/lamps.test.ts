import { describe, expect, it } from 'vitest';
import { bankIndex } from '../src/document';
import { playingPattern, statusText, stepLamps, stepNames, type StepLamp } from '../src/lamps';
import { makeMachine, selectorOf } from './helpers';

type Machine = ReturnType<typeof makeMachine>;

const lampsOf = (machine: Machine) => stepLamps(machine.store.getState());
const namesOf = (machine: Machine) => stepNames(machine.store.getState());
const statusOf = (machine: Machine) => statusText(machine.store.getState());
/** The lamps that are lit, flashing or bright, by key. */
const lit = (lamps: StepLamp[], what: keyof StepLamp = 'on') => lamps.flatMap((lamp, key) => (lamp[what] ? [key] : []));

describe('the lamps over the step keys', () => {
  it('stopped in a pattern mode they are the selection, and the pattern that will play flashes', () => {
    for (const mode of ['pattern_write', 'pattern_play'] as const) {
      const machine = makeMachine();
      machine.session.setMode(mode);
      expect(lit(lampsOf(machine))).toEqual([0]);
      expect(lit(lampsOf(machine), 'flash')).toEqual([0]);
      machine.session.pressSteps(4, 6);
      expect(lit(lampsOf(machine))).toEqual([4, 5, 6]);
      expect(lit(lampsOf(machine), 'flash')).toEqual([4]);
      expect(lit(lampsOf(machine), 'now')).toEqual([]);
      expect(namesOf(machine)[4]).toBe('Pattern 5, selected');
      expect(namesOf(machine)[7]).toBe('Pattern 8');
    }
  });

  it('playing a chain, the pattern now playing is the bright one', () => {
    const machine = makeMachine();
    machine.session.setMode('pattern_play');
    machine.session.pressSteps(0, 3);
    machine.run();
    machine.at(5, bankIndex(2, 0));
    expect(playingPattern(machine.store.getState())).toBe(2);
    expect(lit(lampsOf(machine))).toEqual([0, 1, 2, 3]);
    expect(lit(lampsOf(machine), 'now')).toEqual([2]);
    expect(lit(lampsOf(machine), 'flash')).toEqual([]);
    expect(namesOf(machine)[2]).toBe('Pattern 3, playing');
    expect(statusOf(machine)).toBe('Patterns 1 to 4, group I');
  });

  it('writing a running pattern they are the selected instrument, with the step sounding bright', () => {
    const machine = makeMachine();
    machine.run();
    machine.at(6, bankIndex(0, 0));
    // The bass drum of the starter's first pattern.
    expect(lit(lampsOf(machine))).toEqual([0, 6, 8, 10]);
    expect(lit(lampsOf(machine), 'now')).toEqual([6]);
    expect(namesOf(machine)[0]).toBe('Bass Drum, step 1, on');
    expect(namesOf(machine)[1]).toBe('Bass Drum, step 2, off');
    machine.session.turnSelector(selectorOf('snare'));
    expect(lit(lampsOf(machine))).toEqual([4, 12]);
    expect(statusOf(machine)).toBe('Pattern 1, group I: 16 steps at scale 1, Snare Drum on 2');
  });

  it('nothing shows, and nothing is named a step, past a pattern last step', () => {
    const machine = makeMachine();
    machine.session.pressStep(12);
    machine.run();
    machine.session.turnSelector(selectorOf('closed_hat'));
    expect(lit(lampsOf(machine)).every((key) => key < 12)).toBe(true);
    expect(namesOf(machine)[12]).toBe('Step 13, past the last step');
  });

  it('with FUNCTION down in pattern write they are the quarter notes, and the last step flashes', () => {
    const machine = makeMachine();
    machine.session.pressFunction();
    expect(lit(lampsOf(machine))).toEqual([0, 4, 8, 12, 15]);
    expect(lit(lampsOf(machine), 'flash')).toEqual([15]);
    expect(namesOf(machine)[11]).toBe('Make step 12 the last step');
    machine.session.pressStep(11);

    // Pattern 9 of the starter is in triplets, twelve steps long.
    machine.session.pressStep(8);
    machine.session.setScale(3);
    machine.session.pressFunction();
    expect(lit(lampsOf(machine))).toEqual([0, 3, 6, 9, 11]);
    expect(lit(lampsOf(machine), 'flash')).toEqual([11]);
  });

  it('with CLEAR down each key says which pattern it would clear', () => {
    const machine = makeMachine();
    machine.session.pressClear();
    expect(namesOf(machine)[8]).toBe('Clear pattern 9');
    expect(lit(lampsOf(machine))).toEqual([0]);
  });

  it('writing a track they are the pattern chosen for the bar, and with FUNCTION down the bar number', () => {
    const machine = makeMachine();
    machine.session.setMode('track_write');
    machine.session.turnSelector(7);
    machine.session.pressStep(5);
    expect(lit(lampsOf(machine))).toEqual([5]);
    expect(namesOf(machine)[5]).toBe('Pattern 6, chosen for bar 1');
    expect(statusOf(machine)).toBe('Track 8: empty, at bar 1, group I');

    // Bar 4: no tens, and the lamp over the 4 flashes.
    for (let bar = 0; bar < 3; bar += 1) machine.session.pressTap();
    machine.session.pressFunction();
    expect(lit(lampsOf(machine))).toEqual([3]);
    expect(lit(lampsOf(machine), 'flash')).toEqual([3]);
    expect(namesOf(machine).slice(13)).toEqual(['Step key 14', 'Delete bar 4', 'Insert a bar at 4']);
    machine.session.pressFunction();

    // Bar 10: the 1 steady and the 0, which is the tenth key, flashing.
    for (let bar = 3; bar < 9; bar += 1) machine.session.pressTap();
    machine.session.pressFunction();
    expect(lit(lampsOf(machine))).toEqual([0, 9]);
    expect(lit(lampsOf(machine), 'flash')).toEqual([9]);
    machine.session.pressFunction();

    // Bar 23.
    for (let bar = 9; bar < 22; bar += 1) machine.session.pressTap();
    machine.session.pressFunction();
    expect(lit(lampsOf(machine))).toEqual([1, 2]);
    expect(lit(lampsOf(machine), 'flash')).toEqual([2]);
    expect(statusOf(machine)).toBe('Track 8: 22 measures, at bar 23, group I');
  });

  it('playing a track they follow the pattern of each bar, and waiting they flash its first', () => {
    const machine = makeMachine();
    machine.session.setMode('track_play');
    machine.session.turnSelector(0);
    expect(lit(lampsOf(machine))).toEqual([0]);
    expect(lit(lampsOf(machine), 'flash')).toEqual([0]);
    expect(statusOf(machine)).toBe('Track 1: 8 measures, group I');
    machine.run();
    machine.at(0, bankIndex(3, 0));
    machine.session.measures([{ frame: 0, ordinal: 4, pattern: bankIndex(3, 0), kind: 'basic', position: 3 }]);
    expect(lit(lampsOf(machine))).toEqual([3]);
    expect(lit(lampsOf(machine), 'now')).toEqual([3]);
    expect(namesOf(machine)[3]).toBe('Pattern 4, playing');
    expect(statusOf(machine)).toBe('Track 1: 8 measures, at bar 4, group I');

    // An empty track has nothing to show.
    machine.stop();
    machine.session.turnSelector(5);
    expect(lit(lampsOf(machine))).toEqual([]);
    expect(statusOf(machine)).toBe('Track 6: empty, group I');
  });
});
