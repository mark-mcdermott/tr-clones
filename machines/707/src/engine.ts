import type {
  EnginePanel,
  EnginePattern,
  EngineSetup,
  EngineTrack,
  ExportPlan,
  PatternPlan,
  SongPlan,
  SynthSound,
} from '@boombapbot/editor/engine';
import {
  GROUPS,
  GROUP_PATTERNS,
  INSTRUMENT_IDS,
  PATTERN_COUNT,
  ROWS,
  SOUNDS,
  TRACK_NAMES,
  accentGains,
  activeGroup,
  chainPatterns,
  getRow,
  getSound,
  isTrackMode,
  levelGain,
  masterGain,
  patternIndex,
  rowFader,
  rowMask,
  rowSound,
  selectedTrack,
  shuffleSwing,
  trackCursor,
  type Group,
  type Mix,
  type Pattern,
  type Project,
  type Shuffle,
  type SoundChoice,
} from './document';

/** The 707's project document as the engine takes it. */

/** Every sound, voiced as the machine file says. The panel has no knobs to change them. */
export function engineSounds(): SynthSound[] {
  return SOUNDS.map((sound) => ({ sound: sound.index, ...sound.knobs }));
}

/** A track for each instrument, playing the sound the project chose for it. The hi-hats share a fader. */
export function engineTracks(mix: Mix, sounds: SoundChoice): EngineTrack[] {
  return INSTRUMENT_IDS.map((id) => {
    const row = getRow(id);
    return {
      track: row.index,
      slot: getSound(rowSound(id, sounds)).index,
      pan: row.pan,
      chokeGroup: row.chokeGroup,
      gain: levelGain(id, mix.levels[rowFader(id)]),
    };
  });
}

/** One pattern as the engine holds it. The shuffle is the machine's, so every pattern takes the same. */
export function enginePattern(pattern: Pattern, shuffle: Shuffle): EnginePattern {
  return {
    rows: ROWS.map((row) => rowMask(pattern.steps[row.id])),
    firstLength: pattern.lastStep,
    secondLength: 0,
    stepsPerBeat: pattern.scale,
    swing: shuffleSwing(shuffle),
  };
}

/** The whole pattern bank, in engine order: A1, B1, A2, B2 and so on. */
export function enginePatterns(project: Project): EnginePattern[] {
  const bank = Array.from({ length: GROUP_PATTERNS }, (_, pattern) =>
    GROUPS.map((group) => enginePattern(project.groups[group][pattern]!, project.shuffle)),
  ).flat();
  if (bank.length !== PATTERN_COUNT) throw new Error(`a project has ${PATTERN_COUNT} patterns, not ${bank.length}`);
  return bank;
}

/**
 * The switches that make the engine play a song of pattern numbers from one
 * group. Nothing cuts in: there is no fill-in on this machine.
 */
function songPanel(group: Group, rhythm: number): EnginePanel {
  const variation = group;
  return { rhythm, variation, fillRhythm: rhythm, fillVariation: variation, autoFill: 0, firstBeatRule: false };
}

/**
 * What the engine follows. Playing a track it is given the track as a song,
 * and takes only the group from here. Anywhere else it plays the pattern the
 * panel is on, round and round, and a newly chosen one takes over at the bar
 * line.
 */
function follow(project: Project): EngineSetup['follow'] {
  const group = activeGroup(project);
  if (project.panel.mode !== 'track_play') return { cue: patternIndex(group, project.panel.pattern) };
  // The rhythm here plays only if the engine has no song, which it always has.
  return { panel: songPanel(group, selectedTrack(project).measures[0] ?? 0) };
}

/** Everything the engine is asked for, for one project. */
export function engineSetup(project: Project): EngineSetup {
  return {
    tempo: project.tempo,
    sounds: engineSounds(),
    tracks: engineTracks(project.mix, project.sounds),
    accent: accentGains(project.mix.accent),
    master: masterGain(project.mix.volume),
    patterns: enginePatterns(project),
    follow: follow(project),
  };
}

/** The measures of the selected track from where it stands, as the song the engine plays. */
export function trackSong(project: Project): number[] {
  const { measures } = selectedTrack(project);
  const from = trackCursor(project);
  return measures.slice(from >= measures.length ? 0 : from);
}

/** MIDI note of each engine track, for the sounds the project chose. The accent has none. */
export function trackNotes(sounds: SoundChoice): number[] {
  return ROWS.map((row) => (row.id === 'accent' ? 0 : getSound(rowSound(row.id, sounds)).gmNote));
}

/** MIDI velocities of a plain and an accented hit. */
export function midiVelocities(mix: Mix): { plain: number; accented: number } {
  const gains = accentGains(mix.accent);
  return { plain: Math.round(gains.plain * 127), accented: Math.round(gains.accented * 127) };
}

/**
 * What an export holds. In the track modes it is the whole of the selected
 * track, once through. In the pattern modes it is the pattern the panel is
 * on as a loop, or its chain as one.
 */
export function exportPlan(project: Project): ExportPlan<SongPlan | PatternPlan> | { error: string } {
  const { panel } = project;
  const midi = { notes: trackNotes(project.sounds), velocities: midiVelocities(project.mix) };
  const group = activeGroup(project);
  if (isTrackMode(panel.mode)) {
    const { measures } = selectedTrack(project);
    if (measures.length === 0) return { error: `track ${TRACK_NAMES[panel.track]} is empty.` };
    return { ...midi, panel: songPanel(group, measures[0]!), rhythms: measures, loop: false };
  }
  if (panel.chain) {
    return { ...midi, panel: songPanel(group, panel.chain.first), rhythms: chainPatterns(panel.chain), loop: true };
  }
  return { ...midi, pattern: patternIndex(group, panel.pattern), loop: true };
}
