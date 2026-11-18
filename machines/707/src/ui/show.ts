import {
  KEY_SOUNDS,
  ROW_IDS,
  SCALE_NAMES,
  SHUFFLES,
  TRACK_NAMES,
  activeGroup,
  getPattern,
  getRow,
  getSound,
  isInstrumentId,
  isPatternWrite,
  isStepOn,
  isTrackMode,
  patternName,
  rowSound,
  selectedTrack,
  shownPattern,
  trackCursor,
  type Mode,
  type Pattern,
  type Project,
  type RowId,
} from '../document';
import { COPY_KEY, DELETE_KEY, INSERT_KEY, editTarget, type HeldKey, type State707 } from '../session';

/**
 * What the panel shows and says for a state of the machine: the lines of its
 * display, what each step key's lamp is doing and what the key is called,
 * and the words a screen reader is given. All of it is plain reading of the
 * state, so the lamps, the display and the spoken words cannot disagree.
 */

/** What the panel needs of the editor's state to show itself. */
export type Shown = Pick<State707, 'project' | 'transient' | 'playing' | 'currentPattern'>;

export const MODE_NAMES: Record<Mode, string> = {
  track_play: 'Track play',
  track_write: 'Track write',
  pattern_play: 'Pattern play',
  pattern_step: 'Pattern write, by step',
  pattern_tap: 'Pattern write, by tapping',
};

/** The mode as the display letters it: what, played or written, and how. */
export function modeWords(mode: Mode): { what: 'TRACK' | 'PATTERN'; does: 'PLAY' | 'WRITE'; by: 'STEP' | 'TAP' | null } {
  const what = isTrackMode(mode) ? 'TRACK' : 'PATTERN';
  if (mode === 'track_play' || mode === 'pattern_play') return { what, does: 'PLAY', by: null };
  return { what, does: 'WRITE', by: mode === 'pattern_tap' ? 'TAP' : mode === 'pattern_step' ? 'STEP' : null };
}

/** What a row is called now: the sound the project chose for it. */
export function rowName(row: RowId, project: Project): string {
  return isInstrumentId(row) ? getSound(rowSound(row, project.sounds)).name : getRow(row).label;
}

/** A line of the display's grid. The hi-hats share one, and the cymbals another. */
export interface DisplayLine {
  /** Lettered in full, and as the phone's display abbreviates it. */
  label: string;
  short: string;
  /** The row drawn solid, and the one drawn as an outline over it. */
  solid: RowId;
  outline?: RowId;
}

/** The ten lines of the display, top to bottom, named for the sounds the project chose. */
export function displayLines(project: Project): DisplayLine[] {
  const chosen = (row: 'bass_drum' | 'snare_drum' | 'rim_cowbell' | 'clap_tambourine') => getSound(project.sounds[row]);
  return [
    { label: 'CYMBAL', short: 'CY', solid: 'crash', outline: 'ride' },
    { label: 'HI HAT', short: 'HH', solid: 'closed_hat', outline: 'open_hat' },
    { label: chosen('clap_tambourine').name.toUpperCase(), short: chosen('clap_tambourine').short, solid: 'clap_tambourine' },
    { label: chosen('rim_cowbell').name.toUpperCase(), short: chosen('rim_cowbell').short, solid: 'rim_cowbell' },
    { label: 'HI TOM', short: 'HT', solid: 'hi_tom' },
    { label: 'MID TOM', short: 'MT', solid: 'mid_tom' },
    { label: 'LOW TOM', short: 'LT', solid: 'low_tom' },
    { label: chosen('snare_drum').name.toUpperCase(), short: chosen('snare_drum').short, solid: 'snare_drum' },
    { label: chosen('bass_drum').name.toUpperCase(), short: chosen('bass_drum').short, solid: 'bass_drum' },
    { label: 'ACCENT', short: 'AC', solid: 'accent' },
  ];
}

/** The measure a track is at and how many it has, both counted from 1. */
export function trackPosition(shown: Shown): { measure: number; of: number } {
  const { project, transient } = shown;
  const of = selectedTrack(project).measures.length;
  const at = transient.playingMeasure >= 0 ? transient.playingMeasure : trackCursor(project);
  return { measure: at + 1, of };
}

/** What the display's number reads: the tempo, or where the machine is in its track or chain. */
export function readout(shown: Shown): { caption: 'TEMPO' | 'MEASURE'; value: string } {
  const { project } = shown;
  const { panel } = project;
  if (panel.readout === 'tempo') return { caption: 'TEMPO', value: String(project.tempo) };
  if (isTrackMode(panel.mode)) return { caption: 'MEASURE', value: String(trackPosition(shown).measure) };
  const at = shownPattern(project, shown.playing ? shown.currentPattern : -1).pattern;
  return { caption: 'MEASURE', value: String(panel.chain ? at - panel.chain.first + 1 : 1) };
}

/** What a key that is down is waiting for, as the display says it. */
export function heldPrompt(held: HeldKey, mode: Mode): { key: string; then: string } {
  switch (held) {
    case 'shift':
      return { key: 'SHIFT', then: 'THEN A KEY' };
    case 'instrument':
      return { key: 'INSTRUMENT', then: 'STEP KEY / ENTER' };
    case 'last_step':
      return { key: 'LAST STEP', then: 'STEP KEY' };
    case 'shuffle':
      return { key: 'SHUFFLE', then: 'STEP KEY 1-5' };
    case 'clear':
      return { key: 'CLEAR', then: mode === 'track_write' ? 'ENTER' : 'STEP KEY' };
    case 'copy':
      return { key: 'COPY TO', then: 'STEP KEY' };
  }
}

// ---- The step keys -------------------------------------------------------------

export interface StepLamp {
  on: boolean;
  /** Flashing: the pattern that waits for the bar line, or the one a held key is about. */
  flash: boolean;
}

const DARK: StepLamp = { on: false, flash: false };
const LIT: StepLamp = { on: true, flash: false };

/** The lamp of a step key when the keys stand for patterns. */
function patternLamp(shown: Shown, key: number): StepLamp {
  const { project, playing, currentPattern } = shown;
  const { panel } = project;
  const sounding = shownPattern(project, playing ? currentPattern : -1);
  const inGroup = sounding.group === activeGroup(project);
  if (panel.mode === 'track_play') return inGroup && key === sounding.pattern ? LIT : DARK;
  if (panel.chain) return key >= panel.chain.first && key <= panel.chain.last ? LIT : DARK;
  // A pattern chosen while another plays waits for the bar line, flashing.
  const waiting = playing && currentPattern >= 0 && !(inGroup && sounding.pattern === panel.pattern);
  if (key === panel.pattern) return { on: true, flash: waiting };
  return waiting && inGroup && key === sounding.pattern ? LIT : DARK;
}

/** What the lamp of a step key shows. */
export function stepLamp(shown: Shown, key: number): StepLamp {
  const { project, transient } = shown;
  const { panel } = project;
  switch (transient.held) {
    case 'instrument':
      return isInstrumentId(panel.row) && KEY_SOUNDS[key] === rowSound(panel.row, project.sounds) ? LIT : DARK;
    case 'shuffle':
      return key === project.shuffle ? LIT : DARK;
    case 'last_step':
      return key === getPattern(project, editTarget(shown)).lastStep - 1 ? LIT : DARK;
    case 'clear':
    case 'copy':
      return key === editTarget(shown).pattern ? { on: true, flash: true } : DARK;
    default:
      break;
  }
  if (!isPatternWrite(panel.mode)) return patternLamp(shown, key);
  return isStepOn(getPattern(project, editTarget(shown)).steps[panel.row], key) ? LIT : DARK;
}

/** Whether the step keys stand for patterns now, and not for steps or instruments. */
export function keysArePatterns(shown: Shown): boolean {
  const { held } = shown.transient;
  if (held === 'clear' || held === 'copy') return true;
  return held === null && !isPatternWrite(shown.project.panel.mode);
}

/** What a step key is called, for what it will do if pressed now. */
export function stepKeyName(shown: Shown, key: number): string {
  const { project, transient } = shown;
  const { panel } = project;
  const number = key + 1;
  const group = activeGroup(project);
  const pattern = patternName(group, key);
  const sound = getSound(KEY_SOUNDS[key]!).name;
  switch (transient.held) {
    case 'instrument':
      return `Choose ${sound}`;
    case 'shuffle':
      return key >= SHUFFLES.length ? `Step key ${number}` : key === 0 ? 'Shuffle off' : `Shuffle ${key}`;
    case 'last_step':
      return `Make step ${number} the last step`;
    case 'clear':
      return isPatternWrite(panel.mode) ? `Clear pattern ${pattern}` : `Step key ${number}`;
    case 'copy':
      return `Copy this pattern to ${pattern}`;
    case 'shift':
      if (panel.mode === 'pattern_play') return `Chain patterns through ${pattern}`;
      if (isPatternWrite(panel.mode) && key === COPY_KEY) return 'Copy this pattern';
      if (panel.mode === 'track_write' && key === INSERT_KEY) return 'Insert a measure here';
      if (panel.mode === 'track_write' && key === DELETE_KEY) return 'Delete this measure';
      return `Step key ${number}`;
    default:
      break;
  }
  if (panel.mode === 'pattern_tap') return `Tap ${sound}`;
  if (panel.mode === 'pattern_step') {
    const on = isStepOn(getPattern(project, editTarget(shown)).steps[panel.row], key);
    return `${rowName(panel.row, project)}, step ${number}, ${on ? 'on' : 'off'}`;
  }
  const lamp = patternLamp(shown, key);
  if (panel.mode === 'track_play') return `Pattern ${pattern}${lamp.on ? (shown.playing ? ', playing' : ', in this measure') : ''}`;
  if (panel.chain && lamp.on) return `Pattern ${pattern}, in the chain`;
  return `Pattern ${pattern}${key === panel.pattern ? ', selected' : ''}`;
}

// ---- Words ---------------------------------------------------------------------

function listSteps(row: string, length: number): string {
  const on = Array.from({ length }, (_, step) => step).filter((step) => isStepOn(row, step));
  return on.map((step) => step + 1).join(', ');
}

function describePattern(pattern: Pattern, project: Project): string[] {
  const lines = ROW_IDS.map((row) => ({ row, steps: listSteps(pattern.steps[row], pattern.lastStep) }))
    .filter((line) => line.steps !== '')
    .map((line) => `${rowName(line.row, project)} on ${line.steps}.`);
  return lines.length > 0 ? lines : ['No steps are on.'];
}

/** The display in words: the mode, where the machine is, and every row of the pattern it shows. */
export function describeDisplay(shown: Shown): string {
  const { project, playing, currentPattern } = shown;
  const { panel } = project;
  const at = shownPattern(project, playing ? currentPattern : -1);
  const pattern = getPattern(project, at);
  const words = [`${MODE_NAMES[panel.mode]}.`];
  if (isTrackMode(panel.mode)) {
    const { measure, of } = trackPosition(shown);
    const track = TRACK_NAMES[panel.track];
    if (of === 0) words.push(`Track ${track}, empty.`);
    else if (measure > of) words.push(`Track ${track}, ${of} ${of === 1 ? 'measure' : 'measures'}, at the end.`);
    else words.push(`Track ${track}, measure ${measure} of ${of}.`);
  }
  words.push(`Pattern ${patternName(at.group, at.pattern)}${playing ? ', playing' : ''}.`);
  if (panel.chain) {
    words.push(`Chain ${patternName(at.group, panel.chain.first)} to ${patternName(at.group, panel.chain.last)}.`);
  }
  words.push(`${pattern.lastStep} ${pattern.lastStep === 1 ? 'step' : 'steps'} of ${SCALE_NAMES[pattern.scale]}.`);
  words.push(`Tempo ${project.tempo}.`, project.shuffle === 0 ? 'No shuffle.' : `Shuffle ${project.shuffle}.`);
  if (isPatternWrite(panel.mode)) words.push(`Writing ${rowName(panel.row, project)}.`);
  return [...words, ...describePattern(pattern, project)].join(' ');
}

const HELD_WORDS: Record<HeldKey, string> = {
  shift: 'Shift is down.',
  instrument: 'Instrument is down: press the step key of an instrument, or Enter for the accent.',
  last_step: 'Last step is down: press the step key to end the pattern on.',
  shuffle: 'Shuffle is down: press step key 1 for none, up to 5 for the most.',
  clear: 'Clear is down.',
  copy: 'Copy is down: press the step key of the pattern to copy onto.',
};

/**
 * What a change of state is worth saying aloud, or null. One thing at a
 * time: the first of these that changed.
 */
export function announce(previous: Shown, next: Shown): string | null {
  const before = previous.project;
  const after = next.project;
  const from = before.panel;
  const to = after.panel;
  if (previous.transient.held !== next.transient.held && next.transient.held) {
    if (next.transient.held !== 'clear') return HELD_WORDS[next.transient.held];
    return to.mode === 'track_write'
      ? `Clear is down: press Enter to empty track ${TRACK_NAMES[to.track]}.`
      : 'Clear is down: press the step key of the pattern to clear.';
  }
  if (from.mode !== to.mode) return `${MODE_NAMES[to.mode]}.`;
  if (from.track !== to.track) return `Track ${TRACK_NAMES[to.track]}.`;
  const group = activeGroup(after);
  if (activeGroup(before) !== group) return `Pattern group ${group.toUpperCase()}.`;
  if (JSON.stringify(from.chain) !== JSON.stringify(to.chain) && to.chain) {
    return `Chain ${patternName(group, to.chain.first)} to ${patternName(group, to.chain.last)}.`;
  }
  // Moving through a track changes the pattern too: the measure says both.
  if (isTrackMode(to.mode) && !next.playing && (before.tracks !== after.tracks || from.measure !== to.measure)) {
    const { measure, of } = trackPosition(next);
    const there = selectedTrack(after).measures[measure - 1];
    if (of === 0) return `Track ${TRACK_NAMES[to.track]} is empty.`;
    if (there === undefined) return `Measure ${measure}, after the last of ${of}.`;
    return `Measure ${measure} of ${of}: pattern ${patternName(group, there)}.`;
  }
  // A chain moves the panel on by itself as it plays; that is not worth saying each measure.
  if (from.pattern !== to.pattern && !(next.playing && to.chain)) return `Pattern ${patternName(group, to.pattern)}.`;
  if (from.row !== to.row || JSON.stringify(before.sounds) !== JSON.stringify(after.sounds)) return `${rowName(to.row, after)}.`;
  if (before.shuffle !== after.shuffle) return after.shuffle === 0 ? 'No shuffle.' : `Shuffle ${after.shuffle}.`;
  if (from.readout !== to.readout) return to.readout === 'tempo' ? 'The display shows the tempo.' : 'The display shows the measure.';
  const shownBefore = getPattern(before, editTarget(previous));
  const shownAfter = getPattern(after, editTarget(next));
  if (shownBefore.scale !== shownAfter.scale) return `Scale: ${SCALE_NAMES[shownAfter.scale]}.`;
  if (shownBefore.lastStep !== shownAfter.lastStep) return `Last step ${shownAfter.lastStep}.`;
  return null;
}
