import type { EditorState, EditorStore, EngineMeasure, MachineHost, MachineSession, StartPlan } from '@boombapbot/editor';
import {
  BASIC_RHYTHMS,
  PART_STEPS,
  TEMPO_STOPS,
  TRACK_IDS,
  clampKnob,
  clearRhythm,
  clearedVersions,
  composition,
  compositionCapacity,
  createEmptyRhythms,
  createEmptyTracks,
  createStarterRhythms,
  createStarterTracks,
  getTrack,
  isInstrumentId,
  isPerformMode,
  isStepOn,
  isTrackMode,
  knobPosition,
  panelTarget,
  selectsRhythms,
  stepsPerBeat,
  tappedStep,
  tempoBpm,
  withComposition,
  withKnob,
  withPartLength,
  withStep,
  writePart,
  type AutoFill,
  type KnobParam,
  type Mode,
  type PanelState,
  type PreScale,
  type Project,
  type Rhythm,
  type SwitchedId,
  type Tempo,
  type TrackId,
  type Variation,
} from './document';

/** What the 808 holds between gestures and does not save. */
export interface Transient808 {
  /** CLEAR is down in a write mode: the next step button sets the part's last step. */
  clearArmed: boolean;
  /** TAP was pressed in a play mode: the intro/fill-in plays next, once. */
  fillArmed: boolean;
}

export const RESTING: Transient808 = { clearArmed: false, fillArmed: false };

export type Store808 = EditorStore<Project, Transient808>;
export type State808 = EditorState<Project, Transient808>;

/** What the machine remembers, and so what undo brings back. */
type Memory = Pick<Project, 'rhythms' | 'rhythmTracks'>;

export function memoryOf(project: Project): Memory {
  return { rhythms: project.rhythms, rhythmTracks: project.rhythmTracks };
}

const EMPTY_MEMORY = JSON.stringify({ rhythms: createEmptyRhythms(), rhythmTracks: createEmptyTracks() } satisfies Memory);

/** Whether the machine remembers anything: a step, a part's length, a measure of a track. */
export function remembersAnything(project: Project): boolean {
  return JSON.stringify(memoryOf(project)) !== EMPTY_MEMORY;
}

/** What pressing a step button did. */
export type StepPress = { kind: 'step'; on: boolean } | { kind: 'length' } | { kind: 'rhythm' } | { kind: 'none' };

/** Where the step buttons write: a version of a rhythm, a track and a part. */
export interface EditTarget {
  rhythm: number;
  variation: Variation;
  track: TrackId;
  /** Step of the first button: 0 in the 1st part, 16 in the 2nd. */
  offset: number;
}

export function editTarget(project: Project, playingPattern = -1): EditTarget {
  const { panel } = project;
  return {
    ...panelTarget(panel, playingPattern),
    track: TRACK_IDS[panel.selector]!,
    offset: writePart(panel.mode) === 1 ? PART_STEPS : 0,
  };
}

function sameRhythm(a: Rhythm, b: Rhythm): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The 808 at work in one editor: what its controls do, and how it plays and composes. */
export class Session808 implements MachineSession<Project, Transient808> {
  /**
   * A rhythm track being composed: the track it starts on, and the rhythm of
   * each measure so far. It is stored when the machine stops, as one change.
   * A take on an empty track grows; one on a written track edits it in place.
   */
  private take: { start: number; fresh: boolean; measures: number[] } | null = null;
  /** What the engine was last told about the intro/fill-in. */
  private fillSent = false;

  constructor(private readonly host: MachineHost<Project, Transient808>) {}

  private get store(): Store808 {
    return this.host.store;
  }

  private get state(): State808 {
    return this.store.getState();
  }

  private adjustPanel(change: Partial<PanelState>): void {
    const { project } = this.state;
    const panel = { ...project.panel, ...change };
    if ((Object.keys(change) as Array<keyof PanelState>).every((key) => panel[key] === project.panel[key])) return;
    this.store.adjust({ ...project, panel });
  }

  private commitRhythm(index: number, rhythm: Rhythm): void {
    const { project } = this.state;
    if (sameRhythm(rhythm, project.rhythms[index]!)) return;
    this.store.commit({ ...project, rhythms: project.rhythms.map((old, i) => (i === index ? rhythm : old)) });
  }

  // ---- Memory edits ---------------------------------------------------------

  /**
   * Presses a step button. In a write mode it toggles that step of the
   * selected track, or sets the part's last step while CLEAR is down. In
   * pattern clear, manual play and compose it selects a rhythm: 1 to 12 are
   * Basic Rhythms, 13 to 16 Intro/Fill-ins. Playing a rhythm track, the
   * buttons only show what plays.
   */
  pressStep(button: number): StepPress {
    const { project, transient, currentPattern } = this.state;
    const part = writePart(project.panel.mode);
    if (part === null) {
      if (!selectsRhythms(project.panel.mode)) return { kind: 'none' };
      this.selectRhythm(button);
      return { kind: 'rhythm' };
    }
    const target = editTarget(project, currentPattern);
    const rhythm = project.rhythms[target.rhythm]!;
    if (transient.clearArmed) {
      this.store.setTransient({ clearArmed: false });
      this.commitRhythm(target.rhythm, withPartLength(rhythm, part, button + 1));
      return { kind: 'length' };
    }
    const step = target.offset + button;
    const on = !isStepOn(rhythm[target.variation][target.track], step);
    this.setStep(target.rhythm, target.variation, target.track, step, on);
    return { kind: 'step', on };
  }

  /** Writes the selected track at a step of the rhythm the panel is on, as TAP does. */
  tapStep(step: number): void {
    const target = editTarget(this.state.project, this.state.currentPattern);
    this.setStep(target.rhythm, target.variation, target.track, step, true);
  }

  setStep(rhythmIndex: number, variation: Variation, track: TrackId, step: number, on: boolean): void {
    const rhythm = this.state.project.rhythms[rhythmIndex];
    if (!rhythm) return;
    const row = rhythm[variation][track];
    this.commitRhythm(rhythmIndex, { ...rhythm, [variation]: { ...rhythm[variation], [track]: withStep(row, step, on) } });
  }

  /**
   * Presses CLEAR. In pattern clear it wipes the rhythm the panel is on. In a
   * write mode it stores the pre-scale switch in that rhythm and stays down,
   * so the next step button sets the last step; pressed again, it comes up.
   * In compose it empties the rhythm track the selector is on.
   */
  pressClear(): void {
    const { project, transient } = this.state;
    const { mode } = project.panel;
    if (mode === 'pattern_clear') {
      this.clearRhythm();
    } else if (mode === 'compose') {
      this.commitComposition(project.panel.selector, []);
    } else if (writePart(mode) !== null) {
      const { rhythm: index } = panelTarget(project.panel);
      this.store.setTransient({ clearArmed: !transient.clearArmed });
      if (!transient.clearArmed) this.commitRhythm(index, { ...project.rhythms[index]!, preScale: project.panel.preScale });
    }
  }

  releaseClear(): void {
    this.store.setTransient({ clearArmed: false });
  }

  /** Wipes the rhythm the panel is on: both versions when its variation switch is on AB. */
  clearRhythm(): void {
    const { panel, rhythms } = this.state.project;
    const { rhythm: index } = panelTarget(panel);
    this.commitRhythm(index, clearRhythm(rhythms[index]!, clearedVersions(panel)));
  }

  /**
   * Stores a composition from a rhythm track onward: sixty-four measures to a
   * track, going on into the next. One undo step, however long it is.
   */
  commitComposition(start: number, measures: readonly number[]): void {
    const { project } = this.state;
    const rhythmTracks = withComposition(project.rhythmTracks, start, measures);
    if (JSON.stringify(rhythmTracks) === JSON.stringify(project.rhythmTracks)) return;
    this.store.commit({ ...project, rhythmTracks });
  }

  /** Puts the starter rhythms back in place of everything the machine remembers. */
  loadStarterRhythms(): void {
    this.store.commit({
      ...this.state.project,
      rhythms: createStarterRhythms(),
      rhythmTracks: createStarterTracks(),
    });
  }

  /** Wipes everything the machine remembers: all sixteen rhythms and every rhythm track. One undo step. */
  clearEverything(): void {
    const { project } = this.state;
    if (!remembersAnything(project)) return;
    this.store.commit({ ...project, rhythms: createEmptyRhythms(), rhythmTracks: createEmptyTracks() });
  }

  // ---- Knobs and switches ---------------------------------------------------

  /** Turns the tempo knob to a click stop, the fine knob, or both. */
  setTempo(change: Partial<Tempo>): void {
    const { project } = this.state;
    const coarse = Math.min(TEMPO_STOPS - 1, Math.max(0, Math.round(change.coarse ?? project.tempo.coarse)));
    const fine = Math.min(1, Math.max(-1, change.fine ?? project.tempo.fine));
    if (coarse === project.tempo.coarse && fine === project.tempo.fine) return;
    this.store.adjust({ ...project, tempo: { coarse, fine } });
  }

  /** Turns a knob of an instrument column, or the accent level. Positions run from 0 to 1. */
  setKnob(track: TrackId, param: KnobParam, value: number): void {
    const { project } = this.state;
    if (knobPosition(project.sound, track, param) === clampKnob(value)) return;
    this.store.adjust({ ...project, sound: withKnob(project.sound, track, param, value) });
  }

  setMasterVolume(value: number): void {
    const { project } = this.state;
    const master = clampKnob(value);
    if (master === project.sound.master) return;
    this.store.adjust({ ...project, sound: { ...project.sound, master } });
  }

  /** Throws a voice switch: on selects the column's alternate sound. */
  setAlternate(track: SwitchedId, on: boolean): void {
    const { project } = this.state;
    if (project.sound.alternates[track] === on) return;
    this.store.adjust({
      ...project,
      sound: { ...project.sound, alternates: { ...project.sound.alternates, [track]: on } },
    });
  }

  /** Turns the mode selector. */
  setMode(mode: Mode): void {
    this.releaseClear();
    // An intro or fill-in waiting to play belongs to the play modes.
    if (!isPerformMode(mode)) this.setFillArmed(false);
    this.adjustPanel({ mode });
  }

  /** Turns the auto fill-in selector: a fill-in every so many measures, or 0 for none. */
  setAutoFill(autoFill: AutoFill): void {
    this.adjustPanel({ autoFill });
  }

  setFillArmed(fillArmed: boolean): void {
    this.store.setTransient({ fillArmed });
  }

  /** Selects a rhythm with its step button: the last one pressed is the one the write modes work on. */
  selectRhythm(button: number): void {
    if (button < 0 || button >= PART_STEPS) return;
    this.adjustPanel(
      button < BASIC_RHYTHMS
        ? { basicRhythm: button, writeTarget: 'basic' }
        : { fillRhythm: button, writeTarget: 'fill' },
    );
  }

  /** Moves the pre-scale switch. A rhythm takes it when CLEAR is pressed in a write mode. */
  setPreScale(preScale: PreScale): void {
    this.adjustPanel({ preScale });
  }

  setBasicVariation(basicVariation: PanelState['basicVariation']): void {
    this.adjustPanel({ basicVariation });
  }

  setFillVariation(fillVariation: Variation): void {
    this.adjustPanel({ fillVariation });
  }

  /** Turns the instrument selector. */
  selectTrack(track: TrackId): void {
    this.adjustPanel({ selector: TRACK_IDS.indexOf(track) });
  }

  // ---- Playing and composing --------------------------------------------------

  /**
   * A written rhythm track plays as a song: round and round in play, once
   * through while it is edited. Everything else follows the panel.
   */
  start(): StartPlan | null {
    const { rhythmTracks, panel } = this.state.project;
    const written = isTrackMode(panel.mode) ? composition(rhythmTracks, panel.selector) : [];
    if (panel.mode === 'play' && written.length === 0) {
      this.store.notify(
        'info',
        `Rhythm track ${panel.selector + 1} is empty. To compose it, turn the mode selector to compose and press start.`,
      );
      return null;
    }
    this.take =
      panel.mode === 'compose' ? { start: panel.selector, fresh: written.length === 0, measures: [...written] } : null;
    return { song: written, loop: panel.mode === 'play' };
  }

  /** A fill-in armed before audio was running is the intro. */
  started(): void {
    this.sendFill(this.state.transient.fillArmed);
  }

  /** Stores what was composed. The measure in which the machine stopped is the last one. */
  stopped(): void {
    const take = this.take;
    this.take = null;
    if (take && take.measures.length > 0) this.commitComposition(take.start, take.measures);
  }

  measures(measures: EngineMeasure[]): void {
    // The engine lets an armed intro or fill-in go as it starts to play.
    if (measures.some((measure) => measure.kind !== 'basic')) {
      this.fillSent = false;
      this.setFillArmed(false);
    }
    this.record(measures);
  }

  changed(previous: State808, next: State808): void {
    if (next.transient.fillArmed !== this.fillSent) this.sendFill(next.transient.fillArmed);
    // A rhythm track is played or composed from its start, so turning the
    // mode selector into or out of those modes stops the machine.
    const from = previous.project.panel.mode;
    const to = next.project.panel.mode;
    if (next.playing && from !== to && (isTrackMode(from) || isTrackMode(to))) this.host.stop();
  }

  keyDown(event: KeyboardEvent): boolean {
    if (event.key !== 'Escape') return false;
    this.releaseClear();
    return true;
  }

  /** Notes the rhythm of each measure the engine began, while composing. */
  private record(measures: EngineMeasure[]): void {
    const take = this.take;
    if (!take) return;
    const capacity = compositionCapacity(take.start);
    for (const measure of measures) {
      // An empty track grows by a measure at a time. A written one keeps its
      // length: the engine says which of its measures this is.
      const index = take.fresh ? measure.ordinal - 1 : measure.position;
      if (index >= 0 && index < capacity) take.measures[index] = measure.pattern >> 1;
    }
    if (take.fresh && take.measures.length >= capacity) this.host.stop();
  }

  private sendFill(armed: boolean): void {
    this.fillSent = armed;
    this.host.armFill(armed);
  }

  /**
   * TAP. In a play mode it gives the intro/fill-in priority: it plays once,
   * as the intro or after the measure that is running. Pressed again before
   * then, it takes that back.
   *
   * While a rhythm runs in a write mode it writes the selected track on the
   * step that is sounding, or on the next one once that step is more than
   * half over. Stopped, it plays the selected instrument.
   */
  tap(): void {
    const { project, playing, currentStep, currentPattern, transient } = this.state;
    if (isPerformMode(project.panel.mode)) {
      this.setFillArmed(!transient.fillArmed);
      return;
    }
    if (writePart(project.panel.mode) === null) return;
    const target = editTarget(project, currentPattern);
    if (!playing || currentStep < 0) {
      void this.audition(target.track);
      return;
    }
    const rhythm = project.rhythms[target.rhythm]!;
    const stepMs = 60_000 / tempoBpm(project.tempo) / stepsPerBeat(rhythm.preScale);
    const step = tappedStep(rhythm, currentStep, (performance.now() - this.host.stepStartedAt()) / stepMs);
    this.tapStep(step);
    // A tap on the step already sounding would otherwise be silent until the next measure.
    if (step === currentStep) this.auditionIfRunning(target.track);
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
