import {
  GROUPS,
  KEY_INSTRUMENTS,
  SHUFFLE_MAX,
  STEPS,
  TRACK_MEASURES,
  activeGroup,
  countSteps,
  getTrack,
  isStepOn,
  isTrackMode,
  isWriteMode,
  selectedPattern,
  stepsPerBeat,
  type Scale,
} from '../document';
import type { Held, State909 } from '../session';

/**
 * What the panel shows and says, worked out from the machine's state: the
 * sixteen step keys, the lamps in the small keys, and the display. Nothing
 * here touches the page, so it can be checked without one.
 */

export interface StepKeyView {
  /** Its lamp is on. */
  lit: boolean;
  /** Its lamp is the step, or the pattern, now sounding. */
  now: boolean;
  /** Its lamp flashes: the pattern that waits for the bar line. */
  flash: boolean;
  /** Pressing it does nothing as the machine stands. */
  idle: boolean;
  label: string;
}

const view = (label: string, lit = false, rest: Partial<StepKeyView> = {}): StepKeyView => ({
  lit,
  now: false,
  flash: false,
  idle: false,
  label,
  ...rest,
});

const selected = (on: boolean) => (on ? ', selected' : '');

/** The pattern the engine is on, as a step key: its number within its group. */
function playingPattern(state: State909): number {
  return state.playing && state.currentPattern >= 0 ? state.currentPattern >> 1 : -1;
}

function writeKey(state: State909, key: number): StepKeyView {
  const { project, transient, playing, currentStep } = state;
  const { panel } = project;
  const pattern = selectedPattern(project);
  const onKey = getTrack(KEY_INSTRUMENTS[key]!).label;
  switch (transient.held) {
    case 'instrument': {
      const on = KEY_INSTRUMENTS[key] === panel.instrument;
      return view(`Select ${onKey}${selected(on)}`, on);
    }
    case 'last_step': {
      const on = key === pattern.lastStep - 1;
      return view(on ? `Step ${key + 1}, the last step` : `Make step ${key + 1} the last step`, on);
    }
    case 'shuffle': {
      if (key > SHUFFLE_MAX) return view(`Key ${key + 1}, no shuffle setting`, false, { idle: true });
      const on = key === pattern.shuffle;
      return view(`${key === 0 ? 'No shuffle' : `Shuffle ${key}`}${selected(on)}`, on);
    }
    case 'clear':
      return view(playing ? `Clear ${onKey} from the pattern` : `Clear pattern ${key + 1}`);
    case null:
      break;
  }
  if (!playing) {
    const on = key === panel.pattern;
    return view(`Pattern ${key + 1}${selected(on)}`, on);
  }
  const on = isStepOn(pattern.steps[panel.instrument], key);
  const now = currentStep === key;
  if (panel.write === 'tap') return view(`Tap ${onKey}`, on, { now });
  return view(`${getTrack(panel.instrument).label}, step ${key + 1}, ${on ? 'on' : 'off'}`, on, { now });
}

function playKey(state: State909, key: number): StepKeyView {
  const { panel } = state.project;
  const chained = panel.chain > panel.pattern;
  if (state.transient.shift) {
    const first = Math.min(panel.pattern, key);
    const last = Math.max(panel.pattern, key);
    return view(`Chain patterns ${first + 1} to ${last + 1}`, key >= panel.pattern && key <= panel.chain);
  }
  const on = key >= panel.pattern && key <= panel.chain;
  const sounding = playingPattern(state);
  const now = sounding === key;
  // A pattern chosen while another plays waits for the bar line.
  const flash = on && !chained && sounding >= 0 && !now;
  const said = on ? (chained ? ', in the chain' : ', selected') : '';
  return view(`Pattern ${key + 1}${said}${now ? ', playing' : ''}`, on, { now, flash });
}

function trackKey(state: State909, key: number): StepKeyView {
  const { project, transient } = state;
  const { panel } = project;
  if (panel.mode === 'track_write') {
    const on = key === panel.pattern;
    return view(`Pattern ${key + 1} for measure ${transient.measure + 1}${selected(on)}`, on);
  }
  const { measures } = project.patternTracks[panel.track]!;
  const sounding = playingPattern(state);
  const on = key === (sounding >= 0 ? sounding : measures[Math.min(transient.measure, measures.length - 1)]);
  return view(`Pattern ${key + 1}${on ? (sounding >= 0 ? ', playing' : ', next to play') : ''}`, on, {
    now: on && sounding >= 0,
    idle: true,
  });
}

/** What each of the sixteen step keys shows and is called, as the machine stands. */
export function stepKeyViews(state: State909): StepKeyView[] {
  const { mode } = state.project.panel;
  const one = mode === 'pattern_write' ? writeKey : mode === 'pattern_play' ? playKey : trackKey;
  return Array.from({ length: STEPS }, (_, key) => one(state, key));
}

/** What the step keys are, as a group, for a screen reader. */
export function stepKeysLabel(state: State909): string {
  const { project, transient, playing } = state;
  const { panel } = project;
  if (panel.mode !== 'pattern_write') return 'Patterns';
  if (transient.held === 'instrument') return 'Instruments';
  if (transient.held === 'last_step') return 'Last step';
  if (transient.held === 'shuffle') return 'Shuffle';
  if (transient.held === 'clear') return playing ? 'Clear an instrument' : 'Clear a pattern';
  if (!playing) return 'Patterns';
  return panel.write === 'tap' ? 'Instruments to tap' : `${getTrack(panel.instrument).label} steps`;
}

export interface KeyLamp {
  on: boolean;
  /** A write mode flashes where a play mode is steady. */
  flash?: boolean;
}

export interface KeyLamps {
  tracks: KeyLamp[];
  groups: KeyLamp[];
  tempo: KeyLamp;
  back: KeyLamp;
  available: KeyLamp;
  cycle: KeyLamp;
  lastStep: KeyLamp;
  shuffle: KeyLamp;
  clear: KeyLamp;
  instrument: KeyLamp;
  shift: KeyLamp;
  enter: KeyLamp;
}

/** The lamps in the small keys and in ENTER: where the machine is, and which keys are down. */
export function keyLamps(state: State909): KeyLamps {
  const { project, transient } = state;
  const { panel } = project;
  const tracks = isTrackMode(panel.mode);
  const writing = panel.mode === 'pattern_write';
  const group = activeGroup(project);
  return {
    tracks: project.patternTracks.map((_, index) => ({
      on: tracks && index === panel.track,
      flash: panel.mode === 'track_write',
    })),
    groups: project.patterns.map((_, index) => ({ on: index === group, flash: writing })),
    tempo: { on: tracks ? transient.display === 'tempo' : writing && panel.write === 'step' },
    back: { on: writing && panel.write === 'tap' },
    available: { on: tracks && transient.display === 'available' },
    cycle: { on: tracks && panel.cycle },
    lastStep: { on: transient.held === 'last_step' },
    shuffle: { on: transient.held === 'shuffle' },
    clear: { on: transient.held === 'clear' },
    instrument: { on: transient.held === 'instrument' },
    shift: { on: transient.shift },
    // ENTER is lit while it has something to store, and as the accent row while that is selected.
    enter: { on: panel.mode === 'track_write' || (writing && panel.instrument === 'accent') },
  };
}

export interface DisplayView {
  /** What the three digits show. A space is a dark digit. */
  digits: string;
  /** The same in words. */
  label: string;
}

function digits(value: number): string {
  return String(Math.min(999, Math.max(0, Math.round(value)))).padStart(3, ' ');
}

/** The display: the tempo, or in the track modes the measure, or the measures a track has left. */
export function displayView(state: State909): DisplayView {
  const { project, transient, power } = state;
  const { panel } = project;
  if (!power) return { digits: '   ', label: 'The display is dark' };
  const tempo = { digits: digits(project.tempo), label: `Tempo: ${project.tempo} beats per minute` };
  if (!isTrackMode(panel.mode) || transient.display === 'tempo') return tempo;
  const track = panel.track + 1;
  const written = project.patternTracks[panel.track]!.measures.length;
  if (transient.display === 'available') {
    const left = TRACK_MEASURES - written;
    return { digits: digits(left), label: `Track ${track} has ${left} measures left` };
  }
  const measure = transient.measure + 1;
  const of = written === 0 ? 'empty' : `${written} ${written === 1 ? 'measure' : 'measures'} written`;
  return { digits: digits(measure), label: `Track ${track}, measure ${measure}: ${of}` };
}

/** The scale the chart's lamps show: the playing pattern's in a play mode, the selected pattern's otherwise. */
export function shownScale(state: State909): Scale {
  const { project, playing, currentPattern } = state;
  const sounding = playing && currentPattern >= 0 && !isWriteMode(project.panel.mode);
  const pattern = sounding ? project.patterns[currentPattern % GROUPS]?.[currentPattern >> 1] : undefined;
  return (pattern ?? selectedPattern(project)).scale;
}

export interface KeyAction {
  /** What pressing the key does as the machine stands. */
  label: string;
  /** Pressing it does nothing as the machine stands. */
  idle: boolean;
}

export interface KeyActions {
  tracks: KeyAction[];
  groups: KeyAction[];
  tempo: KeyAction;
  back: KeyAction;
  forward: KeyAction;
  available: KeyAction;
  cycle: KeyAction;
  lastStep: KeyAction;
  scale: KeyAction;
  shuffle: KeyAction;
  clear: KeyAction;
  instrument: KeyAction;
  shift: KeyAction;
  enter: KeyAction;
}

const action = (label: string, idle = false): KeyAction => ({ label, idle });

function enterAction(state: State909): KeyAction {
  const { project, transient, playing } = state;
  const { panel } = project;
  if (panel.mode === 'track_write') {
    return action(`Enter: store pattern ${panel.pattern + 1} in measure ${transient.measure + 1}`);
  }
  if (panel.mode !== 'pattern_write') return action('Enter', true);
  if (transient.held === 'instrument') return action(`Select the total accent${selected(panel.instrument === 'accent')}`);
  if (transient.held === 'clear' && playing) return action('Clear the total accent from the pattern');
  if (!transient.held && playing && panel.write === 'tap') return action('Tap a total accent');
  return action('Total accent', true);
}

/** What each small key, and ENTER, does as the machine stands. SHIFT changes the keys that have a second function. */
export function keyActions(state: State909): KeyActions {
  const { project, transient, playing } = state;
  const { panel } = project;
  const { shift } = transient;
  const tracks = isTrackMode(panel.mode);
  const trackWrite = panel.mode === 'track_write';
  const writing = panel.mode === 'pattern_write';
  const track = panel.track + 1;
  const scale = stepsPerBeat(selectedPattern(project).scale);
  return {
    tracks: project.patternTracks.map((_, index) => action(`${shift ? 'Write' : 'Play'} track ${index + 1}`)),
    groups: project.patterns.map((_, index) =>
      action(
        trackWrite && !shift
          ? `Pattern group ${index + 1} for track ${track}`
          : `${shift ? 'Write' : 'Play'} patterns of group ${index + 1}`,
      ),
    ),
    tempo: shift ? action('Step write') : action('Show the tempo', !tracks),
    back: shift ? action('Tap write') : action('Back a measure', !trackWrite),
    forward: action('Forward a measure', !trackWrite),
    available: action('Show the measures left', !tracks),
    cycle:
      shift && trackWrite
        ? action(`Last measure: end track ${track} on measure ${transient.measure + 1}`)
        : action('Cycle: play the track round and round', !tracks || shift),
    lastStep: action('Last step: then press a step key', !writing),
    scale: action(`Scale: ${scale} steps to the beat`, !writing),
    shuffle: action('Shuffle: then press one of step keys 1 to 7', !writing),
    clear: trackWrite
      ? action(`Clear track ${track}`)
      : action(`Clear: then press the key of ${playing ? 'an instrument' : 'a pattern'}`, !writing),
    instrument: action('Instrument select: then press the key of an instrument', !writing),
    shift: action('Shift'),
    enter: enterAction(state),
  };
}

/** Whether the step keys and TOTAL ACCENT are being tapped in time, and so act as they go down. */
export function isTapping(state: State909): boolean {
  const { panel } = state.project;
  return panel.mode === 'pattern_write' && panel.write === 'tap' && state.playing && state.transient.held === null;
}

const HELD_TEXT: Record<Held, string> = {
  instrument: 'Instrument select is down: press the key of an instrument, or TOTAL ACCENT',
  last_step: 'Last step is down: press the step key that is to be the last',
  shuffle: 'Shuffle is down: press one of step keys 1 to 7',
  clear: 'Clear is down: press a step key',
};

/** Where the machine is and what its step keys do, in a line. */
export function statusLine(state: State909): string {
  const { project, transient, playing } = state;
  const { panel } = project;
  const group = activeGroup(project) + 1;
  const track = project.patternTracks[panel.track]!;
  const written = track.measures.length;
  switch (panel.mode) {
    case 'pattern_play':
      return panel.chain > panel.pattern
        ? `Pattern play, group ${group}: patterns ${panel.pattern + 1} to ${panel.chain + 1}`
        : `Pattern play, group ${group}: pattern ${panel.pattern + 1}`;
    case 'pattern_write': {
      const where = `Pattern write, group ${group}, pattern ${panel.pattern + 1}`;
      if (transient.held) return `${where}. ${HELD_TEXT[transient.held]}`;
      if (!playing) return `${where}. The step keys choose a pattern; press START to write this one`;
      if (panel.write === 'tap') return `${where}. Tap the instruments in time`;
      const pattern = selectedPattern(project);
      const on = countSteps(pattern.steps[panel.instrument], pattern.lastStep);
      return `${where}. ${getTrack(panel.instrument).label}: ${on} ${on === 1 ? 'step' : 'steps'} on`;
    }
    case 'track_play':
      return `Track ${panel.track + 1}: ${written === 0 ? 'empty' : `${written} ${written === 1 ? 'measure' : 'measures'} of group ${group}`}`;
    case 'track_write':
      return `Writing track ${panel.track + 1}, measure ${transient.measure + 1}: pattern ${panel.pattern + 1} of group ${group}`;
  }
}
