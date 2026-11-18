import { GROUPS, GROUP_NAMES, STEPS, chainOf, getTrack, countSteps, isStepOn, patternAt, stepsPerBeat } from './document';
import { DELETE_KEY, INSERT_KEY, barOf, keysAreSteps, selectedTrack, shownPattern, type State606 } from './session';

/** What the machine shows: its sixteen step lamps, and the same thing in words. */

export interface StepLamp {
  on: boolean;
  /** Brighter: the step sounding, or the pattern playing. */
  now: boolean;
  /** Flashing: what will play when the machine starts, the last step, the units of a bar number. */
  flash: boolean;
}

type LampState = Pick<State606, 'project' | 'transient' | 'playing' | 'currentStep' | 'currentPattern'>;

/** The pattern the engine is playing, as its number in its group, or -1. */
export function playingPattern(state: Pick<State606, 'playing' | 'currentPattern'>): number {
  return state.playing && state.currentPattern >= 0 ? Math.floor(state.currentPattern / GROUPS) : -1;
}

/** The lamp a digit of a bar number lights, read against the BAR lettering: 1 to 9, then 0. */
function digitLamp(digit: number): number {
  return digit === 0 ? 9 : digit - 1;
}

/**
 * The sixteen lamps over the step keys.
 *
 * Writing a running pattern they are the selected instrument's steps, with
 * the step now sounding brighter. With FUNCTION down in pattern write they
 * are the pattern's quarter notes, and its last step flashes. Choosing
 * patterns they are the selection: the pattern that will play flashes while
 * the machine waits, and the one playing is brighter. Writing a track they
 * are the pattern chosen for the bar, or with FUNCTION down the bar's
 * number: its tens steady and its units flashing. Playing a track they
 * follow the pattern of each bar.
 */
export function stepLamps(state: LampState): StepLamp[] {
  const { project, transient, playing, currentStep } = state;
  const { panel } = project;
  const lamps: StepLamp[] = Array.from({ length: STEPS }, () => ({ on: false, now: false, flash: false }));
  const light = (index: number, change: Partial<StepLamp> = {}) => {
    const lamp = lamps[index];
    if (lamp) Object.assign(lamp, { on: true }, change);
  };
  const playingNow = playingPattern(state);
  const selection = () => {
    for (const number of chainOf(panel)) light(number);
    if (playingNow >= 0) light(playingNow, { now: true });
    else light(panel.pattern, { flash: true });
  };

  switch (panel.mode) {
    case 'pattern_write': {
      const pattern = patternAt(project, shownPattern(state));
      if (transient.functionHeld) {
        for (let step = 0; step < pattern.lastStep; step += stepsPerBeat(pattern.scale)) light(step);
        light(pattern.lastStep - 1, { flash: true });
      } else if (keysAreSteps(state)) {
        const row = pattern.steps[selectedTrack(project)];
        for (let step = 0; step < pattern.lastStep; step += 1) if (isStepOn(row, step)) light(step);
        const sounding = lamps[currentStep];
        if (sounding) sounding.now = true;
      } else {
        selection();
      }
      break;
    }
    case 'pattern_play':
      selection();
      break;
    case 'track_write':
      if (transient.functionHeld) {
        const number = barOf(state) + 1;
        if (number >= 10) light(digitLamp(Math.floor(number / 10)));
        light(digitLamp(number % 10), { flash: true });
      } else {
        light(panel.pattern);
        if (playingNow >= 0) light(playingNow, { now: true });
      }
      break;
    case 'track_play': {
      const first = project.tracks[panel.selector]![0];
      if (playingNow >= 0) light(playingNow, { now: true });
      else if (first !== undefined) light(first, { flash: !playing });
      break;
    }
  }
  return lamps;
}

/**
 * What each step key is called just now, for a screen reader: a step of the
 * selected instrument, a pattern, a last step, or a bar to take out or put in.
 */
export function stepNames(state: LampState): string[] {
  const { project, transient } = state;
  const { panel } = project;
  const lamps = stepLamps(state);
  const bar = barOf(state) + 1;
  const pattern = patternAt(project, shownPattern(state));
  const track = selectedTrack(project);
  const patternName = (key: number, chosen: string): string => {
    const lamp = lamps[key]!;
    return `Pattern ${key + 1}${lamp.now ? ', playing' : lamp.on ? `, ${chosen}` : ''}`;
  };
  return lamps.map((lamp, key) => {
    switch (panel.mode) {
      case 'pattern_write':
        if (transient.functionHeld) return `Make step ${key + 1} the last step`;
        if (keysAreSteps(state)) {
          if (key >= pattern.lastStep) return `Step ${key + 1}, past the last step`;
          return `${getTrack(track).label}, step ${key + 1}, ${lamp.on ? 'on' : 'off'}`;
        }
        if (transient.clearArmed) return `Clear pattern ${key + 1}`;
        return patternName(key, 'selected');
      case 'pattern_play':
        return patternName(key, 'selected');
      case 'track_write':
        if (!transient.functionHeld) return patternName(key, `chosen for bar ${bar}`);
        if (key === DELETE_KEY) return `Delete bar ${bar}`;
        if (key === INSERT_KEY) return `Insert a bar at ${bar}`;
        return `Step key ${key + 1}`;
      case 'track_play':
        return patternName(key, 'in the first bar');
    }
  });
}

/** What the selector is on and where the machine stands, in a few words, for the phone strip and settings. */
export function statusText(state: LampState): string {
  const { project } = state;
  const { panel } = project;
  const group = `group ${GROUP_NAMES[panel.group]}`;
  if (panel.mode === 'track_write' || panel.mode === 'track_play') {
    const measures = project.tracks[panel.selector]!.length;
    const length = measures === 0 ? 'empty' : `${measures} ${measures === 1 ? 'measure' : 'measures'}`;
    const where = panel.mode === 'track_write' || state.playing ? `, at bar ${barOf(state) + 1}` : '';
    return `Track ${panel.selector + 1}: ${length}${where}, ${group}`;
  }
  const chain = chainOf(panel);
  const selected = chain.length > 1 ? `Patterns ${chain[0]! + 1} to ${chain[chain.length - 1]! + 1}` : `Pattern ${panel.pattern + 1}`;
  if (panel.mode === 'pattern_play') return `${selected}, ${group}`;
  const number = shownPattern(state);
  const pattern = patternAt(project, number);
  const track = selectedTrack(project);
  const writing = chain.length > 1 ? `, writing ${number + 1}` : '';
  const steps = countSteps(pattern.steps[track], pattern.lastStep);
  return `${selected}, ${group}${writing}: ${pattern.lastStep} steps at scale ${pattern.scale}, ${getTrack(track).label} on ${steps}`;
}
