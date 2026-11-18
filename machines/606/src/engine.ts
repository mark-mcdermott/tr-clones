import type { EnginePanel, EnginePattern, EngineSetup, EngineTrack, ExportPlan, SongPlan } from '@boombapbot/editor/engine';
import {
  GROUP_PATTERNS,
  INSTRUMENTS,
  PATTERN_COUNT,
  TRACKS,
  accentGains,
  chainOf,
  isTrackMode,
  levelGain,
  masterGain,
  rowMask,
  stepsPerBeat,
  type Pattern,
  type Project,
} from './document';

/** The 606's project document as the engine takes it. */

/** Tracks the engine has. The accent is track 0, the seven instruments follow, and the rest are unused. */
const ENGINE_TRACKS = 12;
const UNUSED_TRACKS = Array.from({ length: ENGINE_TRACKS - TRACKS.length }, () => 0);

/** The machine has no knob that shapes a sound, so the engine's four stand where its voices ignore them. */
const NO_KNOBS = { tune: 0.5, tone: 0.5, decay: 0.5, snappy: 0.5 };

/** Two instruments on one level knob get the same turn of it, each from its own trim. */
export function engineTracks(levels: Project['mix']['levels']): EngineTrack[] {
  return INSTRUMENTS.map((instrument) => ({
    track: instrument.index,
    slot: instrument.index - 1,
    // The machine has one output and no stereo field.
    pan: 0,
    chokeGroup: instrument.chokeGroup,
    gain: levelGain(instrument.id, levels[instrument.level]),
  }));
}

/** One pattern of the bank: its steps up to the last one, at its scale. The machine does not swing. */
export function enginePattern(pattern: Pattern): EnginePattern {
  return {
    rows: [...TRACKS.map((track) => rowMask(pattern.steps[track.id])), ...UNUSED_TRACKS],
    firstLength: pattern.lastStep,
    secondLength: 0,
    stepsPerBeat: stepsPerBeat(pattern.scale),
    swing: 0,
  };
}

/** The whole pattern bank, in engine order: pattern n of group g is at n * 2 + g. */
export function enginePatterns(patterns: Project['patterns']): EnginePattern[] {
  const bank = Array.from({ length: GROUP_PATTERNS }, (_, number) =>
    patterns.map((group) => enginePattern(group[number]!)),
  ).flat();
  if (bank.length !== PATTERN_COUNT) throw new Error(`a project has ${PATTERN_COUNT} patterns, not ${bank.length}`);
  return bank;
}

/**
 * What the engine is asked to play. The engine's rhythm is the selected
 * pattern and its two variation switches are the pattern group, so a chain
 * or a track handed over as a song plays its patterns in that group, and a
 * pattern chosen while the machine runs takes over at the bar line.
 */
export function enginePanel(project: Project): EnginePanel {
  const { panel } = project;
  const group = panel.group === 1 ? 'b' : 'a';
  return {
    rhythm: panel.pattern,
    variation: group,
    fillRhythm: panel.pattern,
    fillVariation: group,
    autoFill: 0,
    firstBeatRule: false,
  };
}

/** MIDI note of each engine track. The accent has none. */
export function trackNotes(): number[] {
  return [...TRACKS.map((track) => track.gmNote), ...UNUSED_TRACKS];
}

/** MIDI velocities of a plain and an accented hit. */
export function midiVelocities(accent: number): { plain: number; accented: number } {
  const gains = accentGains(accent);
  return { plain: Math.round(gains.plain * 127), accented: Math.round(gains.accented * 127) };
}

/** Everything the engine is asked for, for one project. */
export function engineSetup(project: Project): EngineSetup {
  const { levels, volume } = project.mix;
  return {
    tempo: project.tempo,
    sounds: INSTRUMENTS.map((instrument) => ({ sound: instrument.index - 1, ...NO_KNOBS })),
    tracks: engineTracks(levels),
    accent: accentGains(levels.accent),
    master: masterGain(volume),
    patterns: enginePatterns(project.patterns),
    follow: { panel: enginePanel(project) },
  };
}

/**
 * What an export holds. In the track modes it is the track the selector is
 * on, played once through. Otherwise it is what the panel has selected as a
 * loop: one pattern, or a chain from its first to its last.
 */
export function exportPlan(project: Project): ExportPlan<SongPlan> | { error: string } {
  const { panel } = project;
  const midi = { notes: trackNotes(), velocities: midiVelocities(project.mix.levels.accent) };
  if (!isTrackMode(panel.mode)) return { ...midi, panel: enginePanel(project), rhythms: chainOf(panel), loop: true };
  const measures = project.tracks[panel.selector] ?? [];
  if (measures.length === 0) return { error: `track ${panel.selector + 1} is empty.` };
  return { ...midi, panel: enginePanel(project), rhythms: [...measures], loop: false };
}
