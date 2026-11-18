import type { EnginePanel, EnginePattern, EngineSetup, EngineTrack, ExportPlan, SongPlan, SynthSound } from '@boombapbot/editor/engine';
import {
  GROUPS,
  GROUP_PATTERNS,
  INSTRUMENTS,
  PATTERN_COUNT,
  TRACKS,
  accentGains,
  activeGroup,
  chainOf,
  engineSwing,
  isTrackMode,
  levelGain,
  masterGain,
  rowMask,
  stepsPerBeat,
  type Group,
  type Instrument,
  type Knobs,
  type Pattern,
  type Project,
} from './document';

/** The 909's project document as the engine takes it. */

/** A sound and the knobs of its column. An engine knob the column does not have stays at rest. */
export function synthSound(instrument: Instrument, knobs: Knobs): SynthSound {
  const at = (param: keyof Instrument['sound']) => {
    const knob = instrument.sound[param];
    return knob === undefined ? 0.5 : knobs[knob];
  };
  return { sound: instrument.index - 1, tune: at('tune'), tone: at('tone'), decay: at('decay'), snappy: at('snappy') };
}

/** An instrument's track: its own sound, where it sits, and the gain of its level knob. */
export function engineTracks(knobs: Knobs): EngineTrack[] {
  return INSTRUMENTS.map((instrument) => ({
    track: instrument.index,
    slot: instrument.index - 1,
    pan: instrument.pan,
    chokeGroup: instrument.chokeGroup,
    gain: levelGain(instrument, knobs[instrument.level]),
  }));
}

export function enginePattern(pattern: Pattern): EnginePattern {
  return {
    rows: TRACKS.map((track) => rowMask(pattern.steps[track.id])),
    firstLength: pattern.lastStep,
    secondLength: 0,
    stepsPerBeat: stepsPerBeat(pattern.scale),
    swing: engineSwing(pattern.shuffle),
  };
}

/**
 * The whole pattern bank, in engine order: pattern n of group g is at
 * n * 2 + g, so each group is the engine's sixteen rhythms in one version.
 */
export function enginePatterns(patterns: Pattern[][]): EnginePattern[] {
  const bank = Array.from({ length: GROUP_PATTERNS }, (_, number) =>
    Array.from({ length: GROUPS }, (_, group) => enginePattern(patterns[group]![number]!)),
  ).flat();
  if (bank.length !== PATTERN_COUNT) throw new Error(`a project has ${PATTERN_COUNT} patterns, not ${bank.length}`);
  return bank;
}

/** The engine's switches for a pattern of a group: its rhythm, and the group as the version of every measure. */
function switches(pattern: number, group: Group): EnginePanel {
  const variation = group === 1 ? 'b' : 'a';
  return { rhythm: pattern, variation, fillRhythm: pattern, fillVariation: variation, autoFill: 0, firstBeatRule: false };
}

/**
 * What the engine is asked to play: the pattern the panel is on, round and
 * round, in the group that is active. A chain or a track is a song given at
 * start, which takes its group from here too.
 */
export function enginePanel(project: Project): EnginePanel {
  return switches(project.panel.pattern, activeGroup(project));
}

/** MIDI note of each engine track. The accent has none. */
export function trackNotes(): number[] {
  return TRACKS.map((track) => track.note ?? 0);
}

/** MIDI velocities of a plain and an accented hit. */
export function midiVelocities(knobs: Knobs): { plain: number; accented: number } {
  const gains = accentGains(knobs.accent);
  return { plain: Math.round(gains.plain * 127), accented: Math.round(gains.accented * 127) };
}

/**
 * What an export holds. In the track modes it is the selected track, once
 * through. Otherwise it is the selected pattern, or the chain, as a loop.
 */
export function exportPlan(project: Project): ExportPlan<SongPlan> {
  const { panel } = project;
  const plan = { notes: trackNotes(), velocities: midiVelocities(project.knobs), panel: enginePanel(project) };
  if (isTrackMode(panel.mode)) return { ...plan, rhythms: project.patternTracks[panel.track]!.measures, loop: false };
  return { ...plan, rhythms: panel.mode === 'pattern_play' ? chainOf(panel) : [panel.pattern], loop: true };
}

/** Everything the engine is asked for, for one project. */
export function engineSetup(project: Project): EngineSetup {
  const { knobs } = project;
  return {
    tempo: project.tempo,
    sounds: INSTRUMENTS.map((instrument) => synthSound(instrument, knobs)),
    tracks: engineTracks(knobs),
    accent: accentGains(knobs.accent),
    master: masterGain(knobs.volume),
    patterns: enginePatterns(project.patterns),
    follow: { panel: enginePanel(project) },
  };
}
