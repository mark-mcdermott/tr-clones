import { describe, expect, it } from 'vitest';
import { createEmptyPatterns, createProject } from '../src/document';
import { displayView, isTapping, keyActions, keyLamps, shownScale, statusLine, stepKeyViews, stepKeysLabel } from '../src/ui/keys';
import { loadFixture, makeMachine } from './helpers';

// What the panel shows and says, worked out from the machine's state alone.

const lit = (views: ReturnType<typeof stepKeyViews>) => views.flatMap((view, index) => (view.lit ? [index] : []));

function writing() {
  const machine = makeMachine();
  machine.session.pressShift();
  machine.session.pressGroup(0);
  return machine;
}

describe('the step keys', () => {
  it('in pattern play show the selected pattern, or the chain', () => {
    const { store, session } = makeMachine();
    expect(lit(stepKeyViews(store.getState()))).toEqual([0]);
    expect(stepKeyViews(store.getState())[0]).toEqual({ lit: true, now: false, flash: false, idle: false, label: 'Pattern 1, selected' });
    expect(stepKeysLabel(store.getState())).toBe('Patterns');
    session.pressStep(2);
    session.pressShift();
    expect(stepKeyViews(store.getState())[6]!.label).toBe('Chain patterns 3 to 7');
    expect(stepKeyViews(store.getState())[0]!.label).toBe('Chain patterns 1 to 3');
    session.pressStep(6);
    expect(lit(stepKeyViews(store.getState()))).toEqual([2, 3, 4, 5, 6]);
    expect(stepKeyViews(store.getState())[4]!.label).toBe('Pattern 5, in the chain');
  });

  it('mark the pattern that plays, and flash one that waits for the bar line', () => {
    const { store, session, start, at } = makeMachine();
    start();
    at(3, 0);
    expect(stepKeyViews(store.getState())[0]).toMatchObject({ lit: true, now: true, flash: false, label: 'Pattern 1, selected, playing' });
    session.pressStep(4);
    const waiting = stepKeyViews(store.getState());
    expect(waiting[4]).toMatchObject({ lit: true, now: false, flash: true });
    expect(waiting[0]).toMatchObject({ lit: false, now: true, label: 'Pattern 1, playing' });
    // The engine reports patterns by their place in its bank: pattern 5 of group 1 is its 8.
    at(0, 8);
    expect(stepKeyViews(store.getState())[4]).toMatchObject({ lit: true, now: true, flash: false });
  });

  it('in pattern write are patterns while stopped and steps of the instrument while running', () => {
    const { store, start, at } = writing();
    expect(stepKeyViews(store.getState())[0]!.label).toBe('Pattern 1, selected');
    start();
    at(4, 0);
    const views = stepKeyViews(store.getState());
    expect(lit(views)).toEqual([0, 4, 8, 12]);
    expect(views[4]).toMatchObject({ now: true, label: 'Bass Drum, step 5, on' });
    expect(views[5]).toMatchObject({ now: false, label: 'Bass Drum, step 6, off' });
    expect(stepKeysLabel(store.getState())).toBe('Bass Drum steps');
  });

  it('are instruments in tap write, and show the row being heard', () => {
    const { store, session, start } = writing();
    session.pressShift();
    session.pressBack();
    expect(isTapping(store.getState())).toBe(false);
    start();
    expect(isTapping(store.getState())).toBe(true);
    const views = stepKeyViews(store.getState());
    expect(views.map((view) => view.label).slice(10)).toEqual([
      'Tap Rim Shot',
      'Tap Hand Clap',
      'Tap Closed Hi-Hat',
      'Tap Open Hi-Hat',
      'Tap Crash',
      'Tap Ride',
    ]);
    expect(stepKeysLabel(store.getState())).toBe('Instruments to tap');
    // A function key that is down takes the keys back.
    session.pressFunction('clear');
    expect(isTapping(store.getState())).toBe(false);
  });

  it('follow a function key that is down', () => {
    const { store, session, start } = writing();
    session.pressFunction('instrument');
    expect(lit(stepKeyViews(store.getState()))).toEqual([0, 1]);
    expect(stepKeyViews(store.getState())[1]!.label).toBe('Select Bass Drum, selected');
    expect(stepKeysLabel(store.getState())).toBe('Instruments');
    session.pressFunction('last_step');
    expect(lit(stepKeyViews(store.getState()))).toEqual([15]);
    expect(stepKeyViews(store.getState())[15]!.label).toBe('Step 16, the last step');
    session.pressFunction('shuffle');
    const shuffle = stepKeyViews(store.getState());
    expect(lit(shuffle)).toEqual([0]);
    expect(shuffle.map((view) => view.idle)).toEqual([...Array(7).fill(false), ...Array(9).fill(true)]);
    session.pressFunction('clear');
    expect(lit(stepKeyViews(store.getState()))).toEqual([]);
    expect(stepKeyViews(store.getState())[3]!.label).toBe('Clear pattern 4');
    expect(stepKeysLabel(store.getState())).toBe('Clear a pattern');
    start();
    expect(stepKeyViews(store.getState())[3]!.label).toBe('Clear Snare Drum from the pattern');
    expect(stepKeysLabel(store.getState())).toBe('Clear an instrument');
  });

  it('in the track modes show the pattern of the measure, and do nothing while a track plays', () => {
    const { store, session, start, at } = makeMachine(loadFixture());
    session.pressTrack(0);
    const stopped = stepKeyViews(store.getState());
    expect(lit(stopped)).toEqual([0]);
    expect(stopped.every((view) => view.idle)).toBe(true);
    expect(stopped[0]!.label).toBe('Pattern 1, next to play');
    start();
    at(0, 6);
    expect(stepKeyViews(store.getState())[3]).toMatchObject({ lit: true, now: true, label: 'Pattern 4, playing' });
    // An empty track shows nothing.
    session.pressTrack(3);
    expect(lit(stepKeyViews(store.getState()))).toEqual([]);

    session.pressShift();
    session.pressTrack(0);
    session.pressForward();
    const cursor = stepKeyViews(store.getState());
    expect(lit(cursor)).toEqual([1]);
    expect(cursor[1]).toMatchObject({ idle: false, label: 'Pattern 2 for measure 2, selected' });
  });
});

describe('the lamps in the keys', () => {
  it('show the mode, steady for play and flashing for write', () => {
    const { store, session } = makeMachine(loadFixture());
    session.pressGroup(1);
    let lamps = keyLamps(store.getState());
    expect(lamps.groups).toEqual([{ on: false, flash: false }, { on: true, flash: false }]);
    expect(lamps.tracks.every((lamp) => !lamp.on)).toBe(true);
    session.pressShift();
    expect(keyLamps(store.getState()).shift.on).toBe(true);
    session.pressGroup(0);
    lamps = keyLamps(store.getState());
    expect(lamps.groups[0]).toEqual({ on: true, flash: true });
    expect(lamps.shift.on).toBe(false);

    // In a track mode the PATTERN lamp is the group the track plays from.
    session.pressTrack(1);
    lamps = keyLamps(store.getState());
    expect(lamps.tracks.map((lamp) => lamp.on)).toEqual([false, true, false, false]);
    expect(lamps.tracks[1]!.flash).toBe(false);
    expect(lamps.groups.map((lamp) => lamp.on)).toEqual([false, true]);
    expect(lamps.cycle.on).toBe(true);
    session.pressShift();
    session.pressTrack(1);
    expect(keyLamps(store.getState()).tracks[1]).toEqual({ on: true, flash: true });
    expect(keyLamps(store.getState()).enter.on).toBe(true);
  });

  it('show the write mode, the function key that is down, and the accent row', () => {
    const { store, session } = writing();
    expect(keyLamps(store.getState())).toMatchObject({ tempo: { on: true }, back: { on: false }, enter: { on: false } });
    session.pressShift();
    session.pressBack();
    expect(keyLamps(store.getState())).toMatchObject({ tempo: { on: false }, back: { on: true } });
    for (const [held, lamp] of [['instrument', 'instrument'], ['last_step', 'lastStep'], ['shuffle', 'shuffle'], ['clear', 'clear']] as const) {
      session.pressFunction(held);
      const lamps = keyLamps(store.getState());
      expect(['instrument', 'lastStep', 'shuffle', 'clear'].filter((name) => lamps[name as 'clear'].on)).toEqual([lamp]);
    }
    session.pressFunction('instrument');
    session.pressEnter();
    expect(keyLamps(store.getState()).enter.on).toBe(true);
    expect(keyLamps(store.getState()).instrument.on).toBe(false);
  });

  it('show on TEMPO and AVAILABLE MEAS what the display was asked for', () => {
    const { store, session } = makeMachine();
    session.pressTrack(0);
    session.pressTempoKey();
    expect(keyLamps(store.getState())).toMatchObject({ tempo: { on: true }, available: { on: false } });
    session.pressAvailable();
    expect(keyLamps(store.getState())).toMatchObject({ tempo: { on: false }, available: { on: true } });
  });

  it('the scale chart shows the pattern on the panel, or the one that plays', () => {
    const { store, session, start, at } = makeMachine(loadFixture());
    session.pressGroup(0);
    session.pressStep(2);
    expect(shownScale(store.getState())).toBe(2);
    start();
    // Pattern 4 of group 1, which is the engine's pattern 6, is in thirty-seconds.
    at(0, 6);
    expect(shownScale(store.getState())).toBe(3);
    // Writing, it is the pattern being written that counts.
    session.pressShift();
    session.pressGroup(0);
    expect(shownScale(store.getState())).toBe(2);
  });
});

describe('what the keys say they do', () => {
  it('changes with SHIFT', () => {
    const { store, session } = makeMachine();
    let actions = keyActions(store.getState());
    expect(actions.tracks.map((action) => action.label)).toEqual(['Play track 1', 'Play track 2', 'Play track 3', 'Play track 4']);
    expect(actions.groups[1]!.label).toBe('Play patterns of group 2');
    expect(actions.tempo).toEqual({ label: 'Show the tempo', idle: true });
    session.pressShift();
    actions = keyActions(store.getState());
    expect(actions.tracks[2]!.label).toBe('Write track 3');
    expect(actions.groups[0]!.label).toBe('Write patterns of group 1');
    expect(actions.tempo).toEqual({ label: 'Step write', idle: false });
    expect(actions.back).toEqual({ label: 'Tap write', idle: false });
  });

  it('leaves idle what the mode has no use for', () => {
    const { store, session } = makeMachine();
    const idle = () => Object.entries(keyActions(store.getState())).flatMap(([name, action]) => (!Array.isArray(action) && action.idle ? [name] : []));
    expect(idle()).toEqual(['tempo', 'back', 'forward', 'available', 'cycle', 'lastStep', 'scale', 'shuffle', 'clear', 'instrument', 'enter']);
    session.pressShift();
    session.pressGroup(0);
    expect(idle()).toEqual(['tempo', 'back', 'forward', 'available', 'cycle', 'enter']);
    session.pressTrack(0);
    expect(idle()).toEqual(['back', 'forward', 'lastStep', 'scale', 'shuffle', 'clear', 'instrument', 'enter']);
    session.pressShift();
    session.pressTrack(0);
    expect(idle()).toEqual(['lastStep', 'scale', 'shuffle', 'instrument']);
    expect(keyActions(store.getState()).enter.label).toBe('Enter: store pattern 1 in measure 1');
    expect(keyActions(store.getState()).clear.label).toBe('Clear track 1');
  });
});

describe('the display', () => {
  it('shows the tempo in the pattern modes', () => {
    const { store, session } = makeMachine();
    expect(displayView(store.getState())).toEqual({ digits: '125', label: 'Tempo: 125 beats per minute' });
    session.setTempo(64);
    expect(displayView(store.getState()).digits).toBe(' 64');
  });

  it('counts measures in the track modes, or shows what was asked for', () => {
    const { store, session } = makeMachine(loadFixture());
    session.pressTrack(2);
    expect(displayView(store.getState())).toEqual({ digits: '  1', label: 'Track 3, measure 1: 20 measures written' });
    session.measures([{ frame: 0, ordinal: 12, pattern: 0, kind: 'basic', position: 11 }]);
    expect(displayView(store.getState()).digits).toBe(' 12');
    session.pressAvailable();
    expect(displayView(store.getState())).toEqual({ digits: '172', label: 'Track 3 has 172 measures left' });
    session.pressTempoKey();
    expect(displayView(store.getState()).digits).toBe('132');
    session.pressTrack(3);
    expect(displayView(store.getState())).toEqual({ digits: '  1', label: 'Track 4, measure 1: empty' });
  });

  it('is dark with the power off', () => {
    const { store } = makeMachine();
    store.setPower(false);
    expect(displayView(store.getState())).toEqual({ digits: '   ', label: 'The display is dark' });
  });
});

describe('the status line', () => {
  it('says where the machine is in every mode', () => {
    const { store, session, start } = makeMachine(createProject({ id: 'status', now: new Date(0), patterns: createEmptyPatterns() }));
    expect(statusLine(store.getState())).toBe('Pattern play, group 1: pattern 1');
    session.pressShift();
    session.pressStep(3);
    expect(statusLine(store.getState())).toBe('Pattern play, group 1: patterns 1 to 4');
    session.pressShift();
    session.pressGroup(1);
    expect(statusLine(store.getState())).toBe(
      'Pattern write, group 2, pattern 1. The step keys choose a pattern; press START to write this one',
    );
    session.pressFunction('shuffle');
    expect(statusLine(store.getState())).toBe('Pattern write, group 2, pattern 1. Shuffle is down: press one of step keys 1 to 7');
    session.pressFunction('shuffle');
    start();
    session.pressStep(0);
    expect(statusLine(store.getState())).toBe('Pattern write, group 2, pattern 1. Bass Drum: 1 step on');
    session.pressShift();
    session.pressBack();
    expect(statusLine(store.getState())).toBe('Pattern write, group 2, pattern 1. Tap the instruments in time');
    session.pressTrack(0);
    expect(statusLine(store.getState())).toBe('Track 1: empty');
    session.pressShift();
    session.pressTrack(0);
    session.pressEnter();
    expect(statusLine(store.getState())).toBe('Writing track 1, measure 2: pattern 1 of group 1');
    session.pressTrack(0);
    expect(statusLine(store.getState())).toBe('Track 1: 1 measure of group 1');
  });
});
