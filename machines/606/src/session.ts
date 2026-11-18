import type { EditorState, EditorStore, EngineMeasure, MachineHost, MachineSession, StartPlan } from '@boombapbot/editor';
import {
  SCALES,
  STEPS,
  TRACK_IDS,
  chainOf,
  clampBpm,
  clampKnob,
  clearedPattern,
  createEmptyPatterns,
  createEmptyTracks,
  createStarterPatterns,
  createStarterTracks,
  editedPattern,
  endingAt,
  getTrack,
  isInstrumentId,
  isStepOn,
  isTrackMode,
  lastBar,
  patternAt,
  selectionOf,
  stepsPerBeat,
  tappedStep,
  withInsertedMeasure,
  withLastStep,
  withMeasure,
  withStep,
  withoutMeasure,
  type LevelId,
  type Mode,
  type PanelState,
  type Pattern,
  type Project,
  type Scale,
  type TrackId,
} from './document';

/** What the 606 holds between gestures and does not save. */
export interface Transient606 {
  /** FUNCTION is down: the next step key is read by its second lettering. */
  functionHeld: boolean;
  /** CLEAR is down in pattern write: the next step key names the pattern to clear. */
  clearArmed: boolean;
  /** The bar the selected track stands at, from 0. */
  bar: number;
}

export const RESTING: Transient606 = { functionHeld: false, clearArmed: false, bar: 0 };

export type Store606 = EditorStore<Project, Transient606>;
export type State606 = EditorState<Project, Transient606>;

/** What the machine remembers, and so what undo brings back. */
type Memory = Pick<Project, 'patterns' | 'tracks'>;

export function memoryOf(project: Project): Memory {
  return { patterns: project.patterns, tracks: project.tracks };
}

const EMPTY_MEMORY = JSON.stringify({ patterns: createEmptyPatterns(), tracks: createEmptyTracks() } satisfies Memory);

/** Whether the machine remembers anything: a step, a last step, a scale, a measure of a track. */
export function remembersAnything(project: Project): boolean {
  return JSON.stringify(memoryOf(project)) !== EMPTY_MEMORY;
}

/** With FUNCTION down in track write, the last two step keys take a bar out and put one in. */
export const DELETE_KEY = STEPS - 2;
export const INSERT_KEY = STEPS - 1;

/** What pressing a step key did. */
export type StepPress =
  | { kind: 'step'; on: boolean }
  | { kind: 'pattern' }
  | { kind: 'last_step' }
  | { kind: 'cleared' }
  | { kind: 'bar' }
  | { kind: 'none' };

const NOTHING: StepPress = { kind: 'none' };

/** The track the selector is on, read as an instrument. */
export function selectedTrack(project: Project): TrackId {
  return TRACK_IDS[project.panel.selector]!;
}

/** The pattern the step keys write and show, as its number in the group the panel is on. */
export function shownPattern(state: Pick<State606, 'project' | 'currentPattern'>): number {
  return editedPattern(state.project.panel, state.currentPattern);
}

/** Whether the step keys are steps: only while a pattern runs in pattern write. Stopped, they choose patterns. */
export function keysAreSteps(state: Pick<State606, 'project' | 'playing'>): boolean {
  return state.project.panel.mode === 'pattern_write' && state.playing;
}

/** The bar the selected track stands at, from 0. Never past the bar after its last. */
export function barOf(state: Pick<State606, 'project' | 'transient'>): number {
  const track = state.project.tracks[state.project.panel.selector]!;
  return Math.min(Math.max(0, state.transient.bar), lastBar(track));
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The 606 at work in one editor: what its controls do, and how it plays and is written. */
export class Session606 implements MachineSession<Project, Transient606> {
  /**
   * The chain the engine was given as a song when it started, if it is still
   * on it. A single pattern chosen while it runs takes the chain's place.
   */
  private chainPlaying = false;
  /**
   * A take of tap writing: the patterns as they were before its first tap
   * and as its last tap left them. The taps are heard and seen at once, and
   * the take is stored as one undo step when it ends.
   */
  private take: { before: Project['patterns']; latest: Project['patterns'] } | null = null;

  constructor(private readonly host: MachineHost<Project, Transient606>) {}

  private get store(): Store606 {
    return this.host.store;
  }

  private get state(): State606 {
    return this.store.getState();
  }

  private adjustPanel(change: Partial<PanelState>): void {
    const { project } = this.state;
    const panel = { ...project.panel, ...change };
    if ((Object.keys(change) as Array<keyof PanelState>).every((key) => panel[key] === project.panel[key])) return;
    this.store.adjust({ ...project, panel });
  }

  /** The patterns with one of the group the panel is on replaced. */
  private withPattern(number: number, pattern: Pattern): Project['patterns'] {
    const { patterns, panel } = this.state.project;
    return patterns.map((group, g) => (g === panel.group ? group.map((old, n) => (n === number ? pattern : old)) : group));
  }

  private commitPattern(number: number, pattern: Pattern): void {
    this.endTake();
    const { project } = this.state;
    if (same(pattern, patternAt(project, number))) return;
    this.store.commit({ ...project, patterns: this.withPattern(number, pattern) });
  }

  private commitTrack(measures: number[]): void {
    this.endTake();
    const { project } = this.state;
    const { selector } = project.panel;
    if (same(measures, project.tracks[selector])) return;
    this.store.commit({ ...project, tracks: project.tracks.map((old, index) => (index === selector ? measures : old)) });
  }

  /** Writes a tapped step. It is not an undo step yet: the take it belongs to is stored as one when it ends. */
  private tapStep(number: number, track: TrackId, step: number): void {
    const { project } = this.state;
    const pattern = patternAt(project, number);
    if (isStepOn(pattern.steps[track], step)) return;
    const patterns = this.withPattern(number, { ...pattern, steps: { ...pattern.steps, [track]: withStep(pattern.steps[track], step, true) } });
    this.take = { before: this.take?.before ?? project.patterns, latest: patterns };
    this.store.adjust({ ...project, patterns });
  }

  /** Stores what was tapped since the last thing the machine was given to remember, as one undo step. */
  private endTake(): void {
    const take = this.take;
    this.take = null;
    if (!take) return;
    const { project } = this.state;
    this.store.adjust({ ...project, patterns: take.before });
    this.store.commit({ ...project, patterns: take.latest });
  }

  private release(): void {
    this.store.setTransient({ functionHeld: false, clearArmed: false });
  }

  // ---- The step keys ----------------------------------------------------------

  /**
   * Presses a step key. In pattern write it is a step of the selected
   * instrument while the pattern runs, and chooses a pattern while the
   * machine is stopped; with FUNCTION down it sets the last step, and with
   * CLEAR down it names the pattern to clear. In pattern play it chooses a
   * pattern. In track write it chooses the pattern of the bar, or with
   * FUNCTION down takes a bar out or puts one in. In track play the keys
   * only show what plays.
   */
  pressStep(key: number): StepPress {
    const { project, transient, playing } = this.state;
    if (key < 0 || key >= STEPS) return NOTHING;
    switch (project.panel.mode) {
      case 'pattern_write':
        if (transient.functionHeld) return this.setLastStep(key + 1);
        if (playing) return this.toggleStep(key);
        if (transient.clearArmed) return this.clearNamed(key);
        return this.choosePattern(key);
      case 'pattern_play':
        return this.choosePattern(key);
      case 'track_write':
        if (transient.functionHeld) return this.editBars(key);
        return this.choosePattern(key);
      case 'track_play':
        return NOTHING;
    }
  }

  /**
   * Presses a step key while another is held down. Stopped in a pattern mode
   * that selects a chain: every pattern from one key to the other, within
   * one block of four. Anywhere else only the second key counts.
   */
  pressSteps(held: number, key: number): StepPress {
    const { project, transient, playing } = this.state;
    const chains = !isTrackMode(project.panel.mode) && !playing && !transient.functionHeld && !transient.clearArmed;
    if (!chains || held < 0 || held >= STEPS || key < 0 || key >= STEPS) return this.pressStep(key);
    this.adjustPanel(selectionOf(held, key));
    return { kind: 'pattern' };
  }

  private choosePattern(key: number): StepPress {
    const { project, playing } = this.state;
    // The engine is on the chain that begins here and would not leave it for its own first pattern.
    if (playing && this.chainPlaying && key === project.panel.pattern) return NOTHING;
    if (playing) this.chainPlaying = false;
    this.adjustPanel(selectionOf(key));
    return { kind: 'pattern' };
  }

  private toggleStep(step: number): StepPress {
    const number = shownPattern(this.state);
    const pattern = patternAt(this.state.project, number);
    if (step >= pattern.lastStep) return NOTHING;
    const track = selectedTrack(this.state.project);
    const on = !isStepOn(pattern.steps[track], step);
    this.setStep(number, track, step, on);
    return { kind: 'step', on };
  }

  private setStep(number: number, track: TrackId, step: number, on: boolean): void {
    const pattern = patternAt(this.state.project, number);
    this.commitPattern(number, { ...pattern, steps: { ...pattern.steps, [track]: withStep(pattern.steps[track], step, on) } });
  }

  private setLastStep(steps: number): StepPress {
    const number = shownPattern(this.state);
    this.release();
    this.commitPattern(number, withLastStep(patternAt(this.state.project, number), steps));
    return { kind: 'last_step' };
  }

  private clearNamed(number: number): StepPress {
    this.release();
    this.adjustPanel(selectionOf(number));
    this.clearPattern(number);
    return { kind: 'cleared' };
  }

  /** Empties a pattern of the group the panel is on: the one the step keys show, unless another is named. */
  clearPattern(number = shownPattern(this.state)): void {
    this.commitPattern(number, clearedPattern(patternAt(this.state.project, number)));
  }

  // ---- FUNCTION, CLEAR, TAP and the pattern group --------------------------------

  /**
   * FUNCTION. It stays down until it is pressed again or has done its work.
   * In pattern write the pattern takes the scale the switch stands on as it
   * goes down, and the next step key sets the last step. In track write it
   * turns CLEAR into D.C. and the last two step keys into DEL and INS, and
   * the lamps show the number of the bar.
   */
  pressFunction(): void {
    const { project, transient } = this.state;
    const { mode } = project.panel;
    if (mode !== 'pattern_write' && mode !== 'track_write') return;
    if (mode === 'pattern_write' && !transient.functionHeld) this.storeScale();
    this.store.setTransient({ functionHeld: !transient.functionHeld, clearArmed: false });
  }

  private storeScale(): void {
    const number = shownPattern(this.state);
    this.commitPattern(number, { ...patternAt(this.state.project, number), scale: this.state.project.panel.scale });
  }

  /**
   * CLEAR. Stopped in pattern write it stays down, and the next step key
   * names the pattern to clear. In track write it is BAR RESET, back to the
   * first bar; with FUNCTION down it is D.C., which makes this bar the last.
   */
  pressClear(): void {
    const { project, transient, playing } = this.state;
    const { mode } = project.panel;
    if (mode === 'pattern_write' && !playing) {
      this.store.setTransient({ clearArmed: !transient.clearArmed, functionHeld: false });
    } else if (mode === 'track_write') {
      if (transient.functionHeld) this.endTrackHere();
      else this.goToBar(0);
    }
  }

  /**
   * TAP. While a pattern runs in pattern write it writes the selected
   * instrument on the step that is sounding, or on the next one once that
   * step is more than half over, and every tap until something else is
   * written or the machine stops is one undo step. Stopped, it plays the
   * instrument. In track write it is WRITE/NEXT.
   */
  pressTap(): void {
    const { project, playing, currentStep } = this.state;
    const { mode } = project.panel;
    if (mode === 'track_write') {
      this.writeNext();
      return;
    }
    if (mode !== 'pattern_write') return;
    const track = selectedTrack(project);
    if (!playing || currentStep < 0) {
      void this.audition(track);
      return;
    }
    const number = shownPattern(this.state);
    const pattern = patternAt(project, number);
    const stepMs = 60_000 / project.tempo / stepsPerBeat(pattern.scale);
    const step = tappedStep(pattern, currentStep, (performance.now() - this.host.stepStartedAt()) / stepMs);
    this.tapStep(number, track, step);
    // A tap on the step already sounding would otherwise be silent until the next measure.
    if (step === currentStep) this.auditionIfRunning(track);
  }

  /** The pattern group button: I to II and back. It answers only while the machine is stopped. */
  pressGroup(): void {
    const { project, playing } = this.state;
    if (playing) return;
    this.adjustPanel({ group: project.panel.group === 0 ? 1 : 0 });
  }

  // ---- Writing a track ----------------------------------------------------------

  /** Moves the selected track to a bar. In track write the step keys then show what that bar holds. */
  private goToBar(bar: number): void {
    const { project } = this.state;
    const track = project.tracks[project.panel.selector]!;
    const at = Math.min(Math.max(0, bar), lastBar(track));
    this.store.setTransient({ bar: at });
    const written = track[at];
    if (project.panel.mode === 'track_write' && written !== undefined) this.adjustPanel(selectionOf(written));
  }

  /** WRITE/NEXT: the chosen pattern is written into the bar the track stands at, and the track moves on a bar. */
  private writeNext(): void {
    const { project } = this.state;
    const bar = barOf(this.state);
    this.commitTrack(withMeasure(project.tracks[project.panel.selector]!, bar, project.panel.pattern));
    this.goToBar(bar + 1);
  }

  /** D.C.: the chosen pattern is written into this bar, and the track ends with it. */
  private endTrackHere(): void {
    const { project } = this.state;
    this.release();
    this.commitTrack(endingAt(project.tracks[project.panel.selector]!, barOf(this.state), project.panel.pattern));
  }

  private editBars(key: number): StepPress {
    if (key !== DELETE_KEY && key !== INSERT_KEY) return NOTHING;
    const { project } = this.state;
    const track = project.tracks[project.panel.selector]!;
    const bar = barOf(this.state);
    this.release();
    this.commitTrack(key === DELETE_KEY ? withoutMeasure(track, bar) : withInsertedMeasure(track, bar, project.panel.pattern));
    this.goToBar(bar);
    return { kind: 'bar' };
  }

  // ---- Settings -----------------------------------------------------------------

  /** Puts the starter beat back in place of everything the machine remembers. */
  loadStarter(): void {
    this.endTake();
    this.store.commit({ ...this.state.project, patterns: createStarterPatterns(), tracks: createStarterTracks() });
    this.goToBar(0);
  }

  /** Wipes everything the machine remembers: all thirty-two patterns and every track. One undo step. */
  clearEverything(): void {
    this.endTake();
    const { project } = this.state;
    if (!remembersAnything(project)) return;
    this.store.commit({ ...project, patterns: createEmptyPatterns(), tracks: createEmptyTracks() });
    this.goToBar(0);
  }

  // ---- Knobs and switches ---------------------------------------------------------

  /** Turns the tempo knob to a tempo in beats a minute. */
  setTempo(bpm: number): void {
    const { project } = this.state;
    const tempo = clampBpm(bpm);
    if (tempo !== project.tempo) this.store.adjust({ ...project, tempo });
  }

  /** Turns a level knob, from 0 to 1. */
  setLevel(id: LevelId, value: number): void {
    const { project } = this.state;
    const level = clampKnob(value);
    if (level === project.mix.levels[id]) return;
    this.store.adjust({ ...project, mix: { ...project.mix, levels: { ...project.mix.levels, [id]: level } } });
  }

  setVolume(value: number): void {
    const { project } = this.state;
    const volume = clampKnob(value);
    if (volume !== project.mix.volume) this.store.adjust({ ...project, mix: { ...project.mix, volume } });
  }

  /** Moves the scale switch. A pattern takes it when FUNCTION is pressed in pattern write. */
  setScale(scale: Scale): void {
    if (SCALES.includes(scale)) this.adjustPanel({ scale });
  }

  /** Turns the mode selector. Whatever was held down comes up, and a track goes back to its first bar. */
  setMode(mode: Mode): void {
    if (mode === this.state.project.panel.mode) return;
    this.endTake();
    this.store.setTransient(RESTING);
    // A bar of a track is one pattern, so a chain is let go on the way into track write.
    this.adjustPanel(mode === 'track_write' ? { mode, chainEnd: this.state.project.panel.pattern } : { mode });
    this.goToBar(0);
  }

  /** Turns the selector: to an instrument in the pattern modes, to a track in the track modes. */
  turnSelector(selector: number): void {
    if (selector < 0 || selector >= TRACK_IDS.length) return;
    this.adjustPanel({ selector });
    if (isTrackMode(this.state.project.panel.mode)) this.goToBar(0);
  }

  // ---- Playing ----------------------------------------------------------------------

  /**
   * A chain, and a track in track play, are handed to the engine as a song
   * that goes round and round. Everything else is the one pattern the panel
   * is on, which the engine follows by itself.
   */
  start(): StartPlan | null {
    const { panel, tracks } = this.state.project;
    this.chainPlaying = false;
    if (panel.mode === 'track_write') return { song: [], loop: false };
    if (panel.mode === 'track_play') {
      const measures = tracks[panel.selector]!;
      if (measures.length === 0) {
        this.store.notify(
          'info',
          `Track ${panel.selector + 1} is empty. To write it, turn the mode selector to track write, choose a pattern and press TAP.`,
        );
        return null;
      }
      return { song: [...measures], loop: true };
    }
    const chain = chainOf(panel);
    this.chainPlaying = chain.length > 1;
    return this.chainPlaying ? { song: chain, loop: true } : { song: [], loop: false };
  }

  stopped(): void {
    this.endTake();
    this.chainPlaying = false;
    // A track always plays from its first bar.
    if (this.state.project.panel.mode === 'track_play') this.store.setTransient({ bar: 0 });
  }

  /** Playing a track, the bar it has reached is the bar it stands at. */
  measures(measures: EngineMeasure[]): void {
    const latest = measures[measures.length - 1];
    if (this.state.project.panel.mode === 'track_play' && latest && latest.position >= 0) {
      this.store.setTransient({ bar: latest.position });
    }
  }

  changed(previous: State606, next: State606): void {
    // Patterns that changed by anything but a tap, an undo or an import say, are no longer the take's to store.
    if (this.take && next.project.patterns !== this.take.latest) this.take = null;
    if (!next.playing) return;
    const from = previous.project.panel;
    const to = next.project.panel;
    // A track plays from its start as a song, so turning the mode selector
    // into or out of a track mode, or to another track as one plays, stops
    // the machine.
    const leftTrackMode = from.mode !== to.mode && (isTrackMode(from.mode) || isTrackMode(to.mode));
    const leftTrack = to.mode === 'track_play' && from.selector !== to.selector;
    if (leftTrackMode || leftTrack) this.host.stop();
  }

  keyDown(event: KeyboardEvent): boolean {
    if (event.key !== 'Escape') return false;
    this.release();
    return true;
  }

  /** Plays one hit of a track. Starts audio if this is the first gesture. */
  async audition(track: TrackId): Promise<void> {
    if (!this.state.power) return;
    if (!isInstrumentId(track) || !(await this.host.ensureAudio())) return;
    this.host.trigger(getTrack(track).index, false);
  }

  /** Plays a hit only if audio is already running; never starts it. */
  auditionIfRunning(track: TrackId): void {
    if (isInstrumentId(track) && this.host.audioRunning()) this.host.trigger(getTrack(track).index, false);
  }
}
