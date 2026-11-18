import type { EditorState, EditorStore, EngineMeasure, MachineHost, MachineSession, StartPlan } from '@boombapbot/editor';
import {
  GROUPS,
  KEY_SOUNDS,
  SCALES,
  SHUFFLES,
  STEPS,
  TRACK_COUNT,
  TRACK_MEASURES,
  TRACK_NAMES,
  clampBpm,
  clampKnob,
  createEmptyGroups,
  createEmptyPattern,
  createEmptyTracks,
  createStarterGroups,
  createStarterTracks,
  getPattern,
  getRow,
  isEmptyPattern,
  isInstrumentId,
  isPaired,
  isPatternWrite,
  isStepOn,
  isTrackMode,
  patternAt,
  selectedTrack,
  shownPattern,
  soundRow,
  trackCursor,
  withLevel,
  withRow,
  withStep,
  type FaderId,
  type Group,
  type Mode,
  type PanelState,
  type Pattern,
  type Project,
  type RowId,
  type Scale,
  type Shuffle,
  type SoundId,
  type Track,
} from './document';
import { trackSong } from './engine';

/**
 * The keys that work together with another key. On the machine they are held
 * down; here one stays down by itself until the key that completes it is
 * pressed, or it is pressed again.
 */
export const HELD_KEYS = ['shift', 'instrument', 'last_step', 'shuffle', 'clear', 'copy'] as const;
export type HeldKey = (typeof HELD_KEYS)[number];

/** With SHIFT down, the step keys lettered COPY, INS and DEL. */
export const COPY_KEY = 10;
export const INSERT_KEY = 11;
export const DELETE_KEY = 12;

/** What the 707 holds between gestures and does not save. */
export interface Transient707 {
  held: HeldKey | null;
  /** The measure of the track now playing, counted from 0, or -1. */
  playingMeasure: number;
}

export const RESTING: Transient707 = { held: null, playingMeasure: -1 };

export type Store707 = EditorStore<Project, Transient707>;
export type State707 = EditorState<Project, Transient707>;

/** What the machine remembers, and so what undo brings back. */
type Memory = Pick<Project, 'groups' | 'tracks'>;

export function memoryOf(project: Project): Memory {
  return { groups: project.groups, tracks: project.tracks };
}

/** Whether the machine remembers anything: a step, a pattern's length or scale, a measure of a track. */
export function remembersAnything(project: Project): boolean {
  return (
    !GROUPS.every((group) => project.groups[group].every(isEmptyPattern)) ||
    project.tracks.some((track) => track.measures.length > 0)
  );
}

interface PatternAt {
  group: Group;
  pattern: number;
}

/** The pattern the step keys write: the one sounding, or the one the panel is on. */
export function editTarget(state: Pick<State707, 'project' | 'currentPattern'>): PatternAt {
  return shownPattern(state.project, state.currentPattern);
}

/** The 707 at work in one editor: what its keys and faders do, and how it plays and records. */
export class Session707 implements MachineSession<Project, Transient707> {
  /** The patterns as they were when a take of tapping began, so the whole take is one undo step. */
  private beforeTake: Project['groups'] | null = null;
  /** A tap that fell late in a step is written once the next step has sounded, so it is not heard twice. */
  private waiting: Array<{ at: PatternAt; row: RowId; step: number }> = [];
  /** The measure of its track that the song the engine was given begins on. */
  private songStart = 0;

  constructor(private readonly host: MachineHost<Project, Transient707>) {}

  private get store(): Store707 {
    return this.host.store;
  }

  private get state(): State707 {
    return this.store.getState();
  }

  private adjustPanel(change: Partial<PanelState>): void {
    const { project } = this.state;
    const panel = { ...project.panel, ...change };
    if (JSON.stringify(panel) === JSON.stringify(project.panel)) return;
    this.store.adjust({ ...project, panel });
  }

  private hold(held: HeldKey | null): void {
    this.store.setTransient({ held });
  }

  private toggleHeld(key: HeldKey): void {
    this.hold(this.state.transient.held === key ? null : key);
  }

  private withPattern(project: Project, at: PatternAt, change: (pattern: Pattern) => Pattern): Project['groups'] {
    return {
      ...project.groups,
      [at.group]: project.groups[at.group].map((pattern, index) => (index === at.pattern ? change(pattern) : pattern)),
    };
  }

  private commitPattern(at: PatternAt, change: (pattern: Pattern) => Pattern): void {
    const { project } = this.state;
    const groups = this.withPattern(project, at, change);
    if (JSON.stringify(groups[at.group][at.pattern]) === JSON.stringify(getPattern(project, at))) return;
    this.store.commit({ ...project, groups });
  }

  /** Changes the selected track and where the panel stands in it, as one undo step. */
  private commitTrack(change: (track: Track) => Track, panel: Partial<PanelState> = {}): void {
    const { project } = this.state;
    const tracks = project.tracks.map((track, index) => (index === project.panel.track ? change(track) : track));
    if (JSON.stringify(tracks) === JSON.stringify(project.tracks)) {
      this.adjustPanel(panel);
      return;
    }
    this.store.commit({ ...project, tracks, panel: { ...project.panel, ...panel } });
  }

  // ---- The function keys -------------------------------------------------------

  /** SHIFT: down until the key it shifts is pressed. */
  pressShift(): void {
    this.toggleHeld('shift');
  }

  /** Lets up whichever key is down. */
  releaseHeld(): void {
    this.hold(null);
  }

  /** TRACK or PATTERN: play, or with SHIFT, write. PATTERN with SHIFT again changes between step and tap. */
  pressModeKey(key: 'track' | 'pattern'): void {
    const shifted = this.state.transient.held === 'shift';
    const { mode } = this.state.project.panel;
    if (!shifted) this.setMode(key === 'track' ? 'track_play' : 'pattern_play');
    else if (key === 'track') this.setMode('track_write');
    else this.setMode(mode === 'pattern_step' ? 'pattern_tap' : 'pattern_step');
  }

  setMode(mode: Mode): void {
    this.hold(null);
    const { panel } = this.state.project;
    if (mode === panel.mode) return;
    this.finishTake();
    // A chain is something pattern play does.
    this.adjustPanel({ mode, chain: mode === 'pattern_play' ? panel.chain : null });
  }

  /** CLEAR: down until a step key names the pattern to clear, or ENTER empties the track. */
  pressClear(): void {
    const { mode } = this.state.project.panel;
    if (isPatternWrite(mode) || mode === 'track_write') this.toggleHeld('clear');
  }

  /** SCALE, which is BACK in the track modes. */
  pressScale(): void {
    const { mode } = this.state.project.panel;
    this.hold(null);
    if (isTrackMode(mode)) this.moveMeasure(-1);
    else if (isPatternWrite(mode)) this.cycleScale();
  }

  /** LAST STEP, which is FWD in the track modes. */
  pressLastStep(): void {
    const { mode } = this.state.project.panel;
    if (isPatternWrite(mode)) {
      this.toggleHeld('last_step');
      return;
    }
    this.hold(null);
    if (isTrackMode(mode)) this.moveMeasure(1);
  }

  /** INSTRUMENT, which is LAST MEAS while a track is written. */
  pressInstrument(): void {
    const { mode } = this.state.project.panel;
    if (isPatternWrite(mode)) {
      this.toggleHeld('instrument');
      return;
    }
    this.hold(null);
    if (mode === 'track_write') this.endTrackHere();
  }

  /** SHUFFLE: down until step key 1 to 5 sets how much. */
  pressShuffle(): void {
    this.toggleHeld('shuffle');
  }

  /** TEMPO/MEAS: the display's number changes between the tempo and the measure. */
  pressTempoMeasure(): void {
    this.hold(null);
    this.adjustPanel({ readout: this.state.project.panel.readout === 'tempo' ? 'measure' : 'tempo' });
  }

  /**
   * One of the four keys A to D. With SHIFT it chooses track I to IV. Alone,
   * A and B choose a pattern group; C and D have none to choose here.
   */
  pressGroup(key: number): void {
    const shifted = this.state.transient.held === 'shift';
    this.hold(null);
    if (shifted) this.selectTrack(key);
    else if (GROUPS[key]) this.selectGroup(GROUPS[key]);
  }

  /**
   * ENTER. Writing a track it stores the chosen pattern in the measure and
   * moves on. It is also the accent: with INSTRUMENT down it gives the step
   * keys the accent row, and tapped while a pattern is written by tapping it
   * accents the step.
   */
  pressEnter(): void {
    const { held } = this.state.transient;
    const { mode } = this.state.project.panel;
    this.hold(null);
    if (held === 'instrument') this.selectRow('accent');
    else if (held === 'clear' && mode === 'track_write') this.clearTrack();
    else if (held !== null) return;
    else if (mode === 'track_write') this.writeMeasure();
    else if (mode === 'pattern_tap') this.tapRow('accent');
  }

  /**
   * A step key, 0 to 15. What it does depends on the key that is down, and
   * otherwise on the mode: it chooses a pattern, writes a step, or is tapped.
   */
  pressStep(key: number): void {
    if (key < 0 || key >= STEPS) return;
    const { held } = this.state.transient;
    const { mode } = this.state.project.panel;
    if (held) {
      this.hold(null);
      this.completeHeld(held, key, mode);
    } else if (mode === 'pattern_play' || mode === 'track_write') this.selectPattern(key);
    else if (mode === 'pattern_step') this.toggleStep(key);
    else if (mode === 'pattern_tap') this.tapSound(KEY_SOUNDS[key]!);
  }

  private completeHeld(held: HeldKey, key: number, mode: Mode): void {
    const writing = isPatternWrite(mode);
    if (held === 'instrument') this.chooseSound(KEY_SOUNDS[key]!);
    else if (held === 'shuffle') {
      if (key < SHUFFLES.length) this.setShuffle(SHUFFLES[key]!);
    } else if (held === 'last_step') {
      if (writing) this.setLastStep(key + 1);
    } else if (held === 'clear') {
      if (writing) this.clearPattern(key);
    } else if (held === 'copy') {
      if (writing) this.copyPattern(key);
    } else if (mode === 'pattern_play') this.chain(this.state.project.panel.chain?.first ?? this.state.project.panel.pattern, key);
    else if (writing && key === COPY_KEY) this.hold('copy');
    else if (mode === 'track_write' && key === INSERT_KEY) this.insertMeasure();
    else if (mode === 'track_write' && key === DELETE_KEY) this.deleteMeasure();
  }

  // ---- Patterns ----------------------------------------------------------------

  /** Chooses the pattern the panel is on. Playing, it takes over at the bar line. */
  selectPattern(pattern: number): void {
    this.adjustPanel({ pattern, chain: null });
  }

  /**
   * Chains the patterns from one step key to another, to play one after the
   * other in pattern play. One key alone is that pattern, and no chain.
   */
  chain(from: number, to: number): void {
    const first = Math.min(from, to);
    const last = Math.max(from, to);
    const { panel } = this.state.project;
    if (first === last || panel.mode !== 'pattern_play') {
      this.selectPattern(to);
      return;
    }
    // A chain made while the machine plays carries on from where it is, if that is inside it.
    const inside = this.state.playing && panel.pattern >= first && panel.pattern <= last;
    this.adjustPanel({ chain: { first, last }, pattern: inside ? panel.pattern : first });
  }

  /** Group A or B. In pattern modes it is the panel's; writing a track, the track's own. */
  selectGroup(group: Group): void {
    const { mode } = this.state.project.panel;
    if (mode === 'track_write') this.commitTrack((track) => ({ ...track, group }));
    else if (mode !== 'track_play') this.adjustPanel({ group, chain: null });
  }

  /** Writes or removes a step of the row the step keys are on. A step put on is heard if nothing is playing. */
  private toggleStep(step: number): void {
    const { project, playing } = this.state;
    const { row } = project.panel;
    const at = editTarget(this.state);
    const on = !isStepOn(getPattern(project, at).steps[row], step);
    this.commitPattern(at, (pattern) => withRow(pattern, row, withStep(pattern.steps[row], step, on)));
    if (on && !playing) this.auditionIfRunning(row);
  }

  /** Makes a sound the one its row plays, and its row the one the step keys are on. */
  private pickSound(sound: SoundId): RowId {
    const { project } = this.state;
    const row = soundRow(sound);
    const sounds = isPaired(row) && project.sounds[row] !== sound ? { ...project.sounds, [row]: sound } : project.sounds;
    if (sounds !== project.sounds || project.panel.row !== row) {
      this.store.adjust({ ...project, sounds, panel: { ...project.panel, row } });
    }
    return row;
  }

  /** Chooses an instrument by its sound, as INSTRUMENT and a step key do, and plays it. */
  chooseSound(sound: SoundId): void {
    void this.audition(this.pickSound(sound));
  }

  /** Gives the step keys a row: an instrument, which is heard, or the accent. */
  selectRow(row: RowId): void {
    this.adjustPanel({ row });
    void this.audition(row);
  }

  /** The next scale of the chart for the pattern being written. */
  cycleScale(): void {
    const { scale } = getPattern(this.state.project, editTarget(this.state));
    this.setScale(SCALES[(SCALES.indexOf(scale) + 1) % SCALES.length]!);
  }

  setScale(scale: Scale): void {
    this.commitPattern(editTarget(this.state), (pattern) => ({ ...pattern, scale }));
  }

  /** How many of its sixteen steps the pattern being written plays. */
  setLastStep(lastStep: number): void {
    if (lastStep < 1 || lastStep > STEPS) return;
    this.commitPattern(editTarget(this.state), (pattern) => ({ ...pattern, lastStep }));
  }

  setShuffle(shuffle: Shuffle): void {
    const { project } = this.state;
    if (shuffle !== project.shuffle) this.store.adjust({ ...project, shuffle });
  }

  /** Empties a pattern of the panel's group: the one it is on unless another is named. One undo step. */
  clearPattern(pattern: number = editTarget(this.state).pattern): void {
    this.commitPattern({ group: editTarget(this.state).group, pattern }, createEmptyPattern);
  }

  /** Copies the pattern being written over another of its group. One undo step. */
  copyPattern(to: number): void {
    const at = editTarget(this.state);
    const source = getPattern(this.state.project, at);
    this.commitPattern({ group: at.group, pattern: to }, () => source);
  }

  /** Puts the starter beat back in place of everything the machine remembers. */
  loadStarterBeat(): void {
    this.store.commit({ ...this.state.project, groups: createStarterGroups(), tracks: createStarterTracks() });
  }

  /** Wipes everything the machine remembers: both groups and all four tracks. One undo step. */
  clearEverything(): void {
    const { project } = this.state;
    if (!remembersAnything(project)) return;
    this.store.commit({ ...project, groups: createEmptyGroups(), tracks: createEmptyTracks() });
  }

  // ---- Tracks ------------------------------------------------------------------

  /** Track I to IV, from its first measure. */
  selectTrack(track: number): void {
    if (track < 0 || track >= TRACK_COUNT) return;
    this.adjustPanel({ track, measure: 0, ...this.patternOfMeasure(this.state.project.tracks[track]!, 0) });
  }

  /** Writing a track, the panel goes to the pattern of the measure it is moved to, if that measure is written. */
  private patternOfMeasure(track: Track, measure: number): Partial<PanelState> {
    const pattern = track.measures[measure];
    return this.state.project.panel.mode === 'track_write' && pattern !== undefined ? { pattern } : {};
  }

  /** BACK and FWD: steps through the measures of the track while the machine is stopped. */
  moveMeasure(by: number): void {
    const { project, playing } = this.state;
    const { measures } = selectedTrack(project);
    if (playing && project.panel.mode === 'track_play') return;
    // Writing, the track can stand one past its last measure, where the next is added.
    const end = project.panel.mode === 'track_write' ? measures.length : Math.max(0, measures.length - 1);
    const measure = Math.min(end, Math.max(0, trackCursor(project) + by));
    this.adjustPanel({ measure, ...this.patternOfMeasure(selectedTrack(project), measure) });
  }

  /** Stores the chosen pattern in the measure the track is at, and moves to the next. */
  writeMeasure(): void {
    const { project } = this.state;
    const { measures } = selectedTrack(project);
    const at = trackCursor(project);
    if (at >= TRACK_MEASURES) {
      this.store.notify('info', `Track ${TRACK_NAMES[project.panel.track]} is full: it holds ${TRACK_MEASURES} measures.`);
      return;
    }
    const written = { ...selectedTrack(project), measures: [...measures.slice(0, at), project.panel.pattern, ...measures.slice(at + 1)] };
    this.commitTrack(() => written, { measure: at + 1, ...this.patternOfMeasure(written, at + 1) });
  }

  /** INS: puts the chosen pattern in ahead of the measure the track is at. */
  insertMeasure(): void {
    const { project } = this.state;
    const { measures } = selectedTrack(project);
    if (measures.length >= TRACK_MEASURES) return;
    const at = trackCursor(project);
    this.commitTrack((track) => ({ ...track, measures: [...measures.slice(0, at), project.panel.pattern, ...measures.slice(at)] }));
  }

  /** DEL: takes out the measure the track is at. */
  deleteMeasure(): void {
    const { project } = this.state;
    const { measures } = selectedTrack(project);
    const at = trackCursor(project);
    const shorter = { ...selectedTrack(project), measures: measures.filter((_, index) => index !== at) };
    this.commitTrack(() => shorter, this.patternOfMeasure(shorter, at));
  }

  /** LAST MEAS: the measure the track is at becomes its last. */
  endTrackHere(): void {
    const at = trackCursor(this.state.project);
    this.commitTrack((track) => ({ ...track, measures: track.measures.slice(0, at + 1) }));
  }

  /** Empties the selected track. One undo step. */
  clearTrack(): void {
    this.commitTrack((track) => ({ ...track, measures: [] }), { measure: 0 });
  }

  /** START plays a track from its first measure; STOP/CONT carries on from where it stopped. */
  rewind(): void {
    this.adjustPanel({ measure: 0 });
  }

  // ---- Faders and the tempo knob -----------------------------------------------

  setTempo(bpm: number): void {
    const { project } = this.state;
    const tempo = clampBpm(bpm);
    if (tempo !== project.tempo) this.store.adjust({ ...project, tempo });
  }

  setLevel(fader: FaderId, value: number): void {
    const { project } = this.state;
    const level = clampKnob(value);
    if (level !== project.mix.levels[fader]) this.store.adjust({ ...project, mix: withLevel(project.mix, fader, level) });
  }

  setAccent(value: number): void {
    const { project } = this.state;
    const accent = clampKnob(value);
    if (accent !== project.mix.accent) this.store.adjust({ ...project, mix: { ...project.mix, accent } });
  }

  setVolume(value: number): void {
    const { project } = this.state;
    const volume = clampKnob(value);
    if (volume !== project.mix.volume) this.store.adjust({ ...project, mix: { ...project.mix, volume } });
  }

  // ---- Playing and tapping -------------------------------------------------------

  /**
   * A written track plays as a song, once through, from the measure it
   * stands at. Everything else plays the pattern the panel is on.
   */
  start(): StartPlan | null {
    const { project } = this.state;
    if (project.panel.mode !== 'track_play') return { song: [], loop: false };
    const song = trackSong(project);
    if (song.length === 0) {
      this.store.notify(
        'info',
        `Track ${TRACK_NAMES[project.panel.track]} is empty. To write it, press SHIFT and then TRACK, choose a pattern with a step key and press ENTER for each measure.`,
      );
      return null;
    }
    this.songStart = selectedTrack(project).measures.length - song.length;
    return { song, loop: false };
  }

  started(): void {
    this.store.setTransient({ playingMeasure: this.state.project.panel.mode === 'track_play' ? this.songStart : -1 });
  }

  /** Stores what was tapped, and leaves a track or a chain where it is to be picked up from. */
  stopped(): void {
    this.finishTake();
    const { project, transient } = this.state;
    const { panel } = project;
    if (panel.mode === 'track_play' && transient.playingMeasure >= 0) {
      // Stopped in its last measure, a track has been played: it goes back to its first.
      const last = selectedTrack(project).measures.length - 1;
      this.adjustPanel({ measure: transient.playingMeasure >= last ? 0 : transient.playingMeasure });
    }
    if (panel.chain) this.adjustPanel({ pattern: panel.chain.first });
    this.store.setTransient({ playingMeasure: -1 });
  }

  /**
   * The engine began a measure. Of a track, the panel is told which. Of a
   * chain, the pattern after it is cued, to take over at the next bar line.
   */
  measures(measures: EngineMeasure[]): void {
    const begun = measures[measures.length - 1];
    const { project, playing } = this.state;
    if (!begun || !playing) return;
    const { mode, chain } = project.panel;
    if (mode === 'track_play') {
      if (begun.position >= 0) this.store.setTransient({ playingMeasure: this.songStart + begun.position });
    } else if (mode === 'pattern_play' && chain) {
      const { pattern } = patternAt(begun.pattern);
      this.adjustPanel({ pattern: pattern >= chain.first && pattern < chain.last ? pattern + 1 : chain.first });
    }
  }

  changed(previous: State707, next: State707): void {
    if (next.currentStep !== previous.currentStep) this.writeDueTaps(next.currentStep);
    // A track is played from a measure of its own, so going into or out of
    // track play, or to another track, stops the machine.
    const from = previous.project.panel;
    const to = next.project.panel;
    const trackPlay = from.mode === 'track_play' || to.mode === 'track_play';
    if (next.playing && trackPlay && (from.mode !== to.mode || from.track !== to.track)) this.host.stop();
  }

  keyDown(event: KeyboardEvent): boolean {
    if (event.key !== 'Escape' || this.state.transient.held === null) return false;
    this.releaseHeld();
    return true;
  }

  /** Plays one hit of a row. Starts audio if this is the first gesture. The accent makes no sound. */
  async audition(row: RowId): Promise<void> {
    if (!this.state.power || !isInstrumentId(row) || !(await this.host.ensureAudio())) return;
    this.host.trigger(getRow(row).index, false);
  }

  /** Plays a hit only if audio is already running; never starts it. */
  auditionIfRunning(row: RowId): void {
    if (isInstrumentId(row) && this.host.audioRunning()) this.host.trigger(getRow(row).index, false);
  }

  /** A step key tapped in tap write: its sound is heard, and written where it fell if the pattern is running. */
  tapSound(sound: SoundId): void {
    this.tapRow(this.pickSound(sound));
  }

  private tapRow(row: RowId): void {
    const { playing, currentStep, power } = this.state;
    if (!power) return;
    if (playing && currentStep >= 0) this.recordTap(row);
    else void this.audition(row);
  }

  /**
   * A tap while the pattern runs. It is heard at once. In the first half of a
   * step it is written on that step, which has already sounded. In the second
   * half it belongs to the next step, and is written once that step has
   * passed, so the engine does not play it a second time on top of the tap.
   */
  private recordTap(row: RowId): void {
    const { project, currentStep } = this.state;
    const at = editTarget(this.state);
    const pattern = getPattern(project, at);
    this.auditionIfRunning(row);
    const stepMs = 60_000 / project.tempo / pattern.scale;
    const into = (performance.now() - this.host.stepStartedAt()) / stepMs;
    if (into < 0.5) this.writeTap(at, row, currentStep);
    else this.waiting.push({ at, row, step: (currentStep + 1) % pattern.lastStep });
  }

  private writeDueTaps(step: number): void {
    const due = this.waiting.filter((tap) => tap.step === step);
    if (due.length === 0) return;
    this.waiting = this.waiting.filter((tap) => tap.step !== step);
    for (const tap of due) this.writeTap(tap.at, tap.row, tap.step);
  }

  private writeTap(at: PatternAt, row: RowId, step: number): void {
    const { project } = this.state;
    this.beforeTake ??= project.groups;
    const groups = this.withPattern(project, at, (pattern) => withRow(pattern, row, withStep(pattern.steps[row], step, true)));
    // Not an undo step yet: the take is stored as one when it ends.
    this.store.adjust({ ...project, groups });
  }

  /** Stores what was tapped as one undo step. Taps still waiting for their step are written first. */
  private finishTake(): void {
    for (const tap of this.waiting) this.writeTap(tap.at, tap.row, tap.step);
    this.waiting = [];
    const before = this.beforeTake;
    this.beforeTake = null;
    if (!before) return;
    const { project } = this.state;
    if (JSON.stringify(before) === JSON.stringify(project.groups)) return;
    this.store.adjust({ ...project, groups: before });
    this.store.commit({ ...project, groups: project.groups });
  }
}
