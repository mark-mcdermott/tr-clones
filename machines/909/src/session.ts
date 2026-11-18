import type { EditorState, EditorStore, EngineMeasure, MachineHost, MachineSession, StartPlan } from '@boombapbot/editor';
import {
  KEY_INSTRUMENTS,
  PATTERN_TRACKS,
  SHUFFLE_MAX,
  STEPS,
  TRACK_MEASURES,
  activeGroup,
  chainOf,
  clampBpm,
  clampKnob,
  createEmptyPattern,
  createEmptyPatterns,
  createEmptyTracks,
  createStarterPatterns,
  createStarterTracks,
  getTrack,
  isEmptyPattern,
  isInstrumentId,
  isStepOn,
  isTrackMode,
  nextScale,
  nextStep,
  selectedPattern,
  stepsPerBeat,
  withKnob,
  withPattern,
  withPatternTrack,
  withStep,
  type Group,
  type KnobId,
  type Mode,
  type PanelState,
  type Pattern,
  type Project,
  type TrackId,
  type WriteMode,
} from './document';

/** A function key that is down, waiting for the step key it works on. */
export type Held = 'instrument' | 'last_step' | 'shuffle' | 'clear';

/** What the display shows in the track modes. In the pattern modes it is always the tempo. */
export type Display = 'measure' | 'tempo' | 'available';

/** What the 909 holds between gestures and does not save. */
export interface Transient909 {
  /** SHIFT is down: the next key with a second function takes it. */
  shift: boolean;
  held: Held | null;
  /** The measure of the track the display counts, from 0: the one being written, or the one playing. */
  measure: number;
  display: Display;
}

export const RESTING: Transient909 = { shift: false, held: null, measure: 0, display: 'measure' };

export type Store909 = EditorStore<Project, Transient909>;
export type State909 = EditorState<Project, Transient909>;

/** What the machine remembers, and so what undo brings back. */
type Memory = Pick<Project, 'patterns' | 'patternTracks'>;

export function memoryOf(project: Project): Memory {
  return { patterns: project.patterns, patternTracks: project.patternTracks };
}

/** Whether the machine remembers anything: a step, a pattern's shape, a measure of a track. */
export function remembersAnything(project: Project): boolean {
  return (
    !project.patterns.every((group) => group.every(isEmptyPattern)) ||
    project.patternTracks.some((track) => track.measures.length > 0 || track.group !== 0)
  );
}

/** What pressing a step key did. */
export type StepPress =
  | { kind: 'step'; on: boolean }
  | { kind: 'pattern' | 'chain' | 'instrument' | 'last_step' | 'shuffle' | 'clear' | 'tap' | 'none' };

/** Where the cursor of a track being written may stand: on a measure, or just past the last to add one. */
function cursorLimit(measures: readonly number[]): number {
  return Math.min(measures.length, TRACK_MEASURES - 1);
}

/** The 909 at work in one editor: what its keys and knobs do, and how it plays and records. */
export class Session909 implements MachineSession<Project, Transient909> {
  /** The patterns as they were when tapping began, so the whole take is one undo step. */
  private beforeTake: Pattern[][] | null = null;
  /** A tap that fell late in a step is written once the next step has sounded, so it is not heard twice. */
  private waiting: { track: TrackId; step: number }[] = [];
  /** A chain was given to the engine as a song at start, and nothing has taken its place. */
  private chainPlaying = false;

  constructor(private readonly host: MachineHost<Project, Transient909>) {}

  private get store(): Store909 {
    return this.host.store;
  }

  private get state(): State909 {
    return this.store.getState();
  }

  private adjustPanel(change: Partial<PanelState>): void {
    const { project } = this.state;
    const panel = { ...project.panel, ...change };
    if ((Object.keys(change) as Array<keyof PanelState>).every((key) => panel[key] === project.panel[key])) return;
    this.store.adjust({ ...project, panel });
  }

  /** Changes the pattern the panel is on. One undo step, and none when nothing changed. */
  private commitPattern(change: (pattern: Pattern) => Pattern, number = this.state.project.panel.pattern): void {
    const { project } = this.state;
    const group = activeGroup(project);
    const before = project.patterns[group]![number]!;
    const after = change(before);
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    this.store.commit(withPattern(project, group, number, after));
  }

  /** Takes SHIFT, if it is down: it works on one key and comes up. */
  private takeShift(): boolean {
    const { shift } = this.state.transient;
    if (shift) this.store.setTransient({ shift: false });
    return shift;
  }

  private release(): void {
    this.store.setTransient({ shift: false, held: null });
  }

  // ---- Mode keys --------------------------------------------------------------

  /**
   * Puts the machine in a mode. What was tapped is stored first, the function
   * keys come up, and a chain is let go: it belongs to pattern play.
   */
  setMode(mode: Mode, change: Partial<PanelState> = {}): void {
    this.finishTake();
    const { project } = this.state;
    const { panel } = project;
    const next = { ...panel, ...change, mode };
    const moved = mode !== panel.mode || next.track !== panel.track;
    // Writing a track starts on the pattern its first measure holds, if it has one.
    if (mode === 'track_write' && moved) next.pattern = project.patternTracks[next.track]!.measures[0] ?? next.pattern;
    if (mode !== 'pattern_play') next.chain = next.pattern;
    this.store.setTransient({ shift: false, held: null, ...(moved ? { measure: 0, display: 'measure' as const } : {}) });
    this.adjustPanel(next);
  }

  /** A TRACK key: it plays that track, or with SHIFT writes it, from its first measure. */
  pressTrack(track: number): void {
    const write = this.takeShift();
    if (track < 0 || track >= PATTERN_TRACKS) return;
    this.setMode(write ? 'track_write' : 'track_play', { track });
  }

  /** Goes to another track without leaving the track mode the machine is in. */
  chooseTrack(track: number): void {
    if (track < 0 || track >= PATTERN_TRACKS) return;
    this.setMode(this.state.project.panel.mode === 'track_write' ? 'track_write' : 'track_play', { track });
  }

  /**
   * A PATTERN key: pattern play in that group, or with SHIFT pattern write.
   * While a track is being written it chooses the group the track plays from.
   */
  pressGroup(group: Group): void {
    const shift = this.takeShift();
    if (this.state.project.panel.mode === 'track_write' && !shift) this.chooseGroup(group);
    else this.setMode(shift ? 'pattern_write' : 'pattern_play', { group });
  }

  /** Chooses a group without leaving the mode: for the track being written, or for the pattern modes. */
  chooseGroup(group: Group): void {
    const { project } = this.state;
    const { panel } = project;
    if (panel.mode === 'track_write') {
      const track = project.patternTracks[panel.track]!;
      if (track.group !== group) this.store.commit(withPatternTrack(project, panel.track, { ...track, group }));
    } else if (!isTrackMode(panel.mode)) {
      this.setMode(panel.mode, { group });
    }
  }

  /** SHIFT: down until the next key, or until it is pressed again. */
  pressShift(): void {
    this.store.setTransient({ shift: !this.state.transient.shift });
  }

  // ---- Function keys ------------------------------------------------------------

  /**
   * INSTRUMENT SELECT, LAST STEP, SHUFFLE or CLEAR. In pattern write the key
   * goes down and waits for a step key; pressed again, it comes up. CLEAR in
   * track write empties the track.
   */
  pressFunction(key: Held): void {
    this.takeShift();
    const { project, transient } = this.state;
    if (key === 'clear' && project.panel.mode === 'track_write') {
      this.clearTrack();
      return;
    }
    if (project.panel.mode !== 'pattern_write') return;
    this.store.setTransient({ held: transient.held === key ? null : key });
  }

  /** SCALE: the pattern takes the next scale of the chart. */
  pressScale(): void {
    this.takeShift();
    if (this.state.project.panel.mode !== 'pattern_write') return;
    this.commitPattern((pattern) => ({ ...pattern, scale: nextScale(pattern.scale) }));
  }

  // ---- Step keys ----------------------------------------------------------------

  /**
   * Presses a step key. In pattern play it chooses a pattern, or with SHIFT
   * the end of a chain. In track write it chooses the pattern of the measure.
   * In pattern write it works a function key that is down; otherwise it
   * chooses the pattern while the machine is stopped, and writes it while it
   * runs. Playing a track, the keys only show what plays.
   */
  pressStep(button: number): StepPress {
    if (button < 0 || button >= STEPS) return { kind: 'none' };
    const shift = this.takeShift();
    const { mode } = this.state.project.panel;
    if (mode === 'track_play') return { kind: 'none' };
    if (mode === 'pattern_write') return this.pressWriteStep(button);
    if (mode === 'pattern_play' && shift) {
      this.selectChain(button);
      return { kind: 'chain' };
    }
    this.selectPattern(button);
    return { kind: 'pattern' };
  }

  private pressWriteStep(button: number): StepPress {
    const { project, transient, playing } = this.state;
    const { panel } = project;
    const held = transient.held;
    if (held === 'shuffle' && button > SHUFFLE_MAX) return { kind: 'none' };
    if (held) this.store.setTransient({ held: null });
    if (held === 'instrument') {
      this.chooseInstrument(KEY_INSTRUMENTS[button]!);
      return { kind: 'instrument' };
    }
    if (held === 'last_step') {
      this.commitPattern((pattern) => ({ ...pattern, lastStep: button + 1 }));
      return { kind: 'last_step' };
    }
    if (held === 'shuffle') {
      this.commitPattern((pattern) => ({ ...pattern, shuffle: button }));
      return { kind: 'shuffle' };
    }
    if (held === 'clear') {
      // Stopped, the key is a pattern. Running, it is the instrument on it.
      if (playing) this.clearRow(KEY_INSTRUMENTS[button]!);
      else this.commitPattern(createEmptyPattern, button);
      return { kind: 'clear' };
    }
    if (!playing) {
      this.selectPattern(button);
      return { kind: 'pattern' };
    }
    if (panel.write === 'tap') {
      this.tap(KEY_INSTRUMENTS[button]!);
      return { kind: 'tap' };
    }
    const on = !isStepOn(selectedPattern(project).steps[panel.instrument], button);
    this.setStep(panel.instrument, button, on);
    return { kind: 'step', on };
  }

  /** Puts a step of a row of the selected pattern on or off. */
  setStep(track: TrackId, step: number, on: boolean): void {
    this.commitPattern((pattern) => ({
      ...pattern,
      steps: { ...pattern.steps, [track]: withStep(pattern.steps[track], step, on) },
    }));
  }

  private clearRow(track: TrackId): void {
    this.commitPattern((pattern) => ({ ...pattern, steps: { ...pattern.steps, [track]: createEmptyPattern().steps[track] } }));
  }

  /** Selects one pattern of the group. Playing, it takes over at the bar line. */
  selectPattern(pattern: number): void {
    if (pattern < 0 || pattern >= STEPS) return;
    this.adjustPanel({ pattern, chain: pattern });
  }

  /** Makes a chain between the selected pattern and another: they play in order, round and round. */
  selectChain(other: number): void {
    const { pattern } = this.state.project.panel;
    if (other < 0 || other >= STEPS) return;
    this.adjustPanel({ pattern: Math.min(pattern, other), chain: Math.max(pattern, other) });
  }

  /** Makes a row the one the step keys write, and sounds it. */
  chooseInstrument(track: TrackId): void {
    this.adjustPanel({ instrument: track });
    void this.audition(track);
  }

  // ---- The keys beside the display ---------------------------------------------

  /**
   * ENTER, which is also the TOTAL ACCENT key. In track write it stores the
   * selected pattern in the measure and moves on. In pattern write it is the
   * accent row: chosen with INSTRUMENT SELECT, cleared with CLEAR, or tapped.
   */
  pressEnter(): void {
    this.takeShift();
    const { project, transient, playing } = this.state;
    const { panel } = project;
    if (panel.mode === 'track_write') {
      this.writeMeasure();
      return;
    }
    if (panel.mode !== 'pattern_write') return;
    const held = transient.held;
    if (held === 'instrument') {
      this.store.setTransient({ held: null });
      this.adjustPanel({ instrument: 'accent' });
    } else if (held === 'clear' && playing) {
      this.store.setTransient({ held: null });
      this.clearRow('accent');
    } else if (!held && playing && panel.write === 'tap') {
      this.tap('accent');
    }
  }

  /** TEMPO, and with SHIFT the STEP write mode. In the track modes TEMPO puts the tempo on the display. */
  pressTempoKey(): void {
    if (this.takeShift()) {
      this.setWriteMode('step');
      return;
    }
    this.toggleDisplay('tempo');
  }

  /** BACK, and with SHIFT the TAP write mode. BACK goes to the measure before, in track write. */
  pressBack(): void {
    if (this.takeShift()) {
      this.setWriteMode('tap');
      return;
    }
    this.stepMeasure(-1);
  }

  /** FWD goes to the next measure, in track write. */
  pressForward(): void {
    this.takeShift();
    this.stepMeasure(1);
  }

  /** AVAILABLE MEAS puts the measures the track has left on the display. */
  pressAvailable(): void {
    this.takeShift();
    this.toggleDisplay('available');
  }

  /**
   * CYCLE, and with SHIFT in track write LAST MEAS. CYCLE makes a track start
   * again at its end. LAST MEAS ends the track on the measure the display shows.
   */
  pressCycle(): void {
    const shift = this.takeShift();
    const { panel } = this.state.project;
    if (!isTrackMode(panel.mode)) return;
    if (shift && panel.mode === 'track_write') this.endTrackHere();
    else if (!shift) this.adjustPanel({ cycle: !panel.cycle });
  }

  setWriteMode(write: WriteMode): void {
    this.finishTake();
    this.adjustPanel({ write });
  }

  private toggleDisplay(display: Display): void {
    if (!isTrackMode(this.state.project.panel.mode)) return;
    this.store.setTransient({ display: this.state.transient.display === display ? 'measure' : display });
  }

  // ---- Writing a track ----------------------------------------------------------

  private stepMeasure(by: number): void {
    if (this.state.project.panel.mode === 'track_write') this.goToMeasure(this.state.transient.measure + by);
  }

  /** Moves the cursor of the track being written. On a written measure the panel shows its pattern. */
  private goToMeasure(to: number): void {
    const { project } = this.state;
    const { measures } = project.patternTracks[project.panel.track]!;
    const measure = Math.min(cursorLimit(measures), Math.max(0, to));
    this.store.setTransient({ measure });
    const written = measures[measure];
    if (written !== undefined) this.adjustPanel({ pattern: written, chain: written });
  }

  /** Stores the selected pattern in the measure the cursor is on, and moves to the next. */
  private writeMeasure(): void {
    const { project, transient } = this.state;
    const { panel } = project;
    const track = project.patternTracks[panel.track]!;
    const at = Math.min(transient.measure, track.measures.length);
    if (at >= TRACK_MEASURES) return;
    const measures = [...track.measures];
    measures[at] = panel.pattern;
    if (measures[at] !== track.measures[at]) this.store.commit(withPatternTrack(project, panel.track, { ...track, measures }));
    if (at === TRACK_MEASURES - 1) {
      this.store.notify('info', `Track ${panel.track + 1} is full: it holds ${TRACK_MEASURES} measures.`);
      return;
    }
    this.goToMeasure(at + 1);
  }

  /** Ends the track on the measure the cursor is on: the measures after it are dropped. */
  private endTrackHere(): void {
    const { project, transient } = this.state;
    const index = project.panel.track;
    const track = project.patternTracks[index]!;
    if (transient.measure + 1 >= track.measures.length) return;
    this.store.commit(withPatternTrack(project, index, { ...track, measures: track.measures.slice(0, transient.measure + 1) }));
  }

  /** Empties the selected track. One undo step. */
  clearTrack(): void {
    const { project } = this.state;
    const index = project.panel.track;
    const track = project.patternTracks[index]!;
    this.store.setTransient({ measure: 0 });
    if (track.measures.length > 0) this.store.commit(withPatternTrack(project, index, { ...track, measures: [] }));
  }

  // ---- Settings -----------------------------------------------------------------

  /** Empties the pattern the panel is on. One undo step. */
  clearPattern(): void {
    this.commitPattern(createEmptyPattern);
  }

  /** Puts the starter patterns and track back in place of everything the machine remembers. */
  loadStarter(): void {
    this.store.setTransient({ measure: 0 });
    this.store.commit({ ...this.state.project, patterns: createStarterPatterns(), patternTracks: createStarterTracks() });
  }

  /** Wipes everything the machine remembers: both pattern groups and every track. One undo step. */
  clearEverything(): void {
    const { project } = this.state;
    if (!remembersAnything(project)) return;
    this.store.setTransient({ measure: 0 });
    this.store.commit({ ...project, patterns: createEmptyPatterns(), patternTracks: createEmptyTracks() });
  }

  // ---- Knobs --------------------------------------------------------------------

  /** Turns the tempo knob: whole beats a minute, as the display shows them. */
  setTempo(bpm: number): void {
    const { project } = this.state;
    const tempo = clampBpm(bpm);
    if (tempo !== project.tempo) this.store.adjust({ ...project, tempo });
  }

  /** Turns a level, a sound knob, the total accent or the volume. Positions run from 0 to 1. */
  setKnob(id: KnobId, value: number): void {
    const { project } = this.state;
    if (project.knobs[id] === clampKnob(value)) return;
    this.store.adjust({ ...project, knobs: withKnob(project.knobs, id, value) });
  }

  // ---- Playing and recording ----------------------------------------------------

  /**
   * A track plays as a song, and so does a chain of patterns. Anything else
   * follows the panel: the selected pattern, round and round.
   */
  start(): StartPlan | null {
    const { panel, patternTracks } = this.state.project;
    if (panel.mode === 'track_play') {
      const { measures } = patternTracks[panel.track]!;
      if (measures.length === 0) {
        this.store.notify('info', `Track ${panel.track + 1} is empty. To write it, press SHIFT, then TRACK ${panel.track + 1}.`);
        return null;
      }
      this.store.setTransient({ measure: 0 });
      return { song: measures, loop: panel.cycle };
    }
    const chain = panel.mode === 'pattern_play' ? chainOf(panel) : [];
    this.chainPlaying = chain.length > 1;
    return this.chainPlaying ? { song: chain, loop: true } : { song: [], loop: false };
  }

  stopped(): void {
    this.chainPlaying = false;
    this.finishTake();
  }

  /** Playing a track, the display counts its measures. */
  measures(measures: EngineMeasure[]): void {
    if (this.state.project.panel.mode !== 'track_play') return;
    const position = measures.at(-1)?.position ?? -1;
    if (position >= 0) this.store.setTransient({ measure: position });
  }

  changed(previous: State909, next: State909): void {
    this.writeDueTaps(previous, next);
    if (!previous.playing || !next.playing) return;
    const from = previous.project.panel;
    const to = next.project.panel;
    if (from === to) return;
    // A track is played from its start, and a pattern written in a track is
    // heard on its own, so going into or out of a track mode stops the machine.
    if (isTrackMode(from.mode) || isTrackMode(to.mode)) {
      if (from.mode !== to.mode || from.track !== to.track) this.host.stop();
      return;
    }
    if (from.pattern === to.pattern && from.chain === to.chain) return;
    // The engine is given a chain when it starts. A single pattern chosen
    // while one plays takes its place at the bar line, which the engine does
    // by itself, but only if it is told of a pattern it was not already on.
    if (to.chain !== to.pattern || (this.chainPlaying && from.pattern === to.pattern)) this.host.stop();
    else this.chainPlaying = false;
  }

  keyDown(event: KeyboardEvent): boolean {
    if (event.key !== 'Escape') return false;
    this.release();
    return true;
  }

  /** Plays one hit of a row. Starts audio if this is the first gesture. The accent makes no sound. */
  async audition(track: TrackId): Promise<void> {
    if (!this.state.power) return;
    if (!isInstrumentId(track) || !(await this.host.ensureAudio())) return;
    this.host.trigger(getTrack(track).index, false);
  }

  /**
   * A tap in tap write. An instrument is heard at once. In the first half of
   * a step the tap is written on that step, which has already sounded. In the
   * second half it belongs to the next step, and is written once that step
   * has passed, so the engine does not play it a second time on top of the tap.
   */
  private tap(track: TrackId): void {
    const { project, currentStep } = this.state;
    if (isInstrumentId(track)) this.host.trigger(getTrack(track).index, false);
    if (currentStep < 0) return;
    const pattern = selectedPattern(project);
    const stepMs = 60_000 / project.tempo / stepsPerBeat(pattern.scale);
    const into = (performance.now() - this.host.stepStartedAt()) / stepMs;
    if (into < 0.5) this.writeTap(track, currentStep);
    else this.waiting.push({ track, step: nextStep(pattern, currentStep) });
  }

  private writeDueTaps(previous: State909, next: State909): void {
    if (next.currentStep === previous.currentStep || this.waiting.length === 0) return;
    const due = this.waiting.filter((tap) => tap.step === next.currentStep);
    if (due.length === 0) return;
    this.waiting = this.waiting.filter((tap) => tap.step !== next.currentStep);
    for (const tap of due) this.writeTap(tap.track, tap.step);
  }

  private writeTap(track: TrackId, step: number): void {
    const { project } = this.state;
    const pattern = selectedPattern(project);
    if (isStepOn(pattern.steps[track], step)) return;
    this.beforeTake ??= project.patterns;
    const tapped = { ...pattern, steps: { ...pattern.steps, [track]: withStep(pattern.steps[track], step, true) } };
    // Not an undo step yet: the take is stored as one when it ends.
    this.store.adjust(withPattern(project, activeGroup(project), project.panel.pattern, tapped));
  }

  /** Stores what was tapped as one undo step. Taps still waiting for their step are written first. */
  private finishTake(): void {
    for (const tap of this.waiting) this.writeTap(tap.track, tap.step);
    this.waiting = [];
    const before = this.beforeTake;
    this.beforeTake = null;
    if (!before) return;
    const { project } = this.state;
    this.store.adjust({ ...project, patterns: before });
    this.store.commit({ ...project, patterns: project.patterns });
  }
}
