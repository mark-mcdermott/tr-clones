import {
  INSTRUMENT_IDS,
  PATTERN_COUNT,
  ROLES,
  TRACKS,
  accentGains,
  composition,
  getTrack,
  isPerformMode,
  isSwitched,
  isTrackMode,
  levelGain,
  masterGain,
  panelTarget,
  patternIndex,
  rowMask,
  stepsPerBeat,
  tempoBpm,
  trackRole,
  type InstrumentId,
  type Project,
  type Rhythm,
  type Role,
  type SoundSettings,
  type TrackId,
  type Variation,
} from './document';
import {
  exportSongMidi,
  renderSong,
  type EnginePanel,
  type EnginePattern,
  type EngineSetup,
  type EngineTrack,
  type ExportPlan,
  type LoopRender,
  type SongPlan,
  type SnareWasm,
  type SynthSound,
} from '@boombapbot/editor/engine';

/** The 808's project document as the engine takes it. */

/** The instrument whose panel column a sound belongs to. */
const OWNERS = new Map<number, InstrumentId>(
  INSTRUMENT_IDS.flatMap((id) => {
    const track = getTrack(id);
    return [track.sound, track.alternate]
      .filter((role) => role !== undefined)
      .map((role) => [ROLES.find((candidate) => candidate.id === role)!.index, id] as const);
  }),
);

export function soundOwner(role: Role): InstrumentId {
  const owner = OWNERS.get(role.index);
  if (!owner) throw new Error(`no track plays ${role.id}`);
  return owner;
}

/** A sound and the knobs of its column. A tom and its conga share a tuning knob. */
export function synthSound(role: Role, sound: SoundSettings): SynthSound {
  return { sound: role.index, ...sound.knobs[soundOwner(role)] };
}

function isAlternate(id: InstrumentId, sound: SoundSettings): boolean {
  return isSwitched(id) && sound.alternates[id];
}

/** The sound each instrument plays now, given its voice switch. */
export function instrumentRole(id: InstrumentId, sound: SoundSettings): Role {
  return trackRole(id, isAlternate(id, sound));
}

/** What a track is called now: the sound its voice switch selects. */
export function trackLabel(id: TrackId, sound: SoundSettings): string {
  return id === 'accent' ? getTrack(id).label : instrumentRole(id, sound).name;
}

export function engineTracks(sound: SoundSettings): EngineTrack[] {
  return INSTRUMENT_IDS.map((id) => {
    const track = getTrack(id);
    return {
      track: track.index,
      slot: instrumentRole(id, sound).index,
      pan: track.pan,
      chokeGroup: track.chokeGroup,
      gain: levelGain(id, sound.levels[id]),
    };
  });
}

export function engineMix(sound: SoundSettings): { plain: number; accented: number; master: number } {
  return { ...accentGains(sound.accent), master: masterGain(sound.master) };
}

export function enginePattern(rhythm: Rhythm, variation: Variation): EnginePattern {
  return {
    rows: TRACKS.map((track) => rowMask(rhythm[variation][track.id])),
    firstLength: rhythm.firstLength,
    secondLength: rhythm.secondLength,
    stepsPerBeat: stepsPerBeat(rhythm.preScale),
    swing: 0,
  };
}

/** Both versions of a rhythm, with where the engine keeps them. */
export function rhythmPatterns(rhythm: Rhythm, index: number): Array<{ index: number; pattern: EnginePattern }> {
  return (['a', 'b'] as const).map((variation) => ({
    index: patternIndex(index, variation),
    pattern: enginePattern(rhythm, variation),
  }));
}

/** The whole pattern bank, in engine order. */
export function enginePatterns(rhythms: Rhythm[]): EnginePattern[] {
  const bank = rhythms.flatMap((rhythm, index) => rhythmPatterns(rhythm, index).map((entry) => entry.pattern));
  if (bank.length !== PATTERN_COUNT) throw new Error(`a project has ${PATTERN_COUNT} patterns, not ${bank.length}`);
  return bank;
}

/**
 * What the engine is asked to play. Played by hand it is the Basic Rhythm
 * with its fill-ins. A rhythm track brings its own rhythms and takes only the
 * variation switches from here. Anywhere else it is the rhythm the panel is
 * on, round and round, with nothing cutting in.
 */
export function enginePanel(project: Project): EnginePanel {
  const { panel } = project;
  const switches = {
    rhythm: panel.basicRhythm,
    variation: panel.basicVariation,
    fillRhythm: panel.fillRhythm,
    fillVariation: panel.fillVariation,
    autoFill: 0,
    firstBeatRule: false,
  };
  if (isPerformMode(panel.mode)) return { ...switches, autoFill: panel.autoFill, firstBeatRule: true };
  if (panel.mode === 'play') return switches;
  return {
    ...switches,
    rhythm: panelTarget(panel).rhythm,
    variation: panel.writeTarget === 'fill' ? panel.fillVariation : panel.basicVariation,
  };
}

/**
 * What an export holds. In the track modes it is the rhythm track the
 * selector is on, played once through. Otherwise it is the rhythm the panel
 * is on as a loop: one measure, or A then B with its lever on AB.
 */
export function exportPlan(project: Project): ExportPlan<SongPlan> {
  const { panel } = project;
  const switches = { ...enginePanel(project), autoFill: 0, firstBeatRule: false };
  const midi = { notes: trackNotes(project.sound), velocities: midiVelocities(project.sound) };
  if (isTrackMode(panel.mode)) {
    return { ...midi, panel: switches, rhythms: composition(project.rhythmTracks, panel.selector), loop: false };
  }
  const { rhythm } = panelTarget(panel);
  const both = panel.writeTarget === 'basic' && panel.basicVariation === 'ab';
  return {
    ...midi,
    panel: { ...switches, variation: panel.basicVariation },
    rhythms: both ? [rhythm, rhythm] : [rhythm],
    loop: true,
  };
}

/** MIDI note of each track, for the sounds its switches select. The accent has none. */
export function trackNotes(sound: SoundSettings): number[] {
  return TRACKS.map((track) => (track.id === 'accent' ? 0 : instrumentRole(track.id, sound).gmNote));
}

/** MIDI velocities of a plain and an accented hit. */
export function midiVelocities(sound: SoundSettings): { plain: number; accented: number } {
  const gains = accentGains(sound.accent);
  return { plain: Math.round(gains.plain * 127), accented: Math.round(gains.accented * 127) };
}

/** Everything the engine is asked for, for one project. */
export function engineSetup(project: Project): EngineSetup {
  const { sound } = project;
  const mix = engineMix(sound);
  return {
    tempo: tempoBpm(project.tempo),
    sounds: ROLES.map((role) => synthSound(role, sound)),
    tracks: engineTracks(sound),
    accent: { plain: mix.plain, accented: mix.accented },
    master: mix.master,
    patterns: enginePatterns(project.rhythms),
    follow: { panel: enginePanel(project) },
  };
}

/** The switches that make a song of one rhythm play exactly this pattern. */
function panelFor(pattern: number): EnginePanel {
  const variation = pattern % 2 === 1 ? 'b' : 'a';
  return {
    rhythm: pattern >> 1,
    variation,
    fillRhythm: pattern >> 1,
    fillVariation: variation,
    autoFill: 0,
    firstBeatRule: false,
  };
}

/** One seamless loop of a single pattern of the bank. */
export function renderLoop(wasm: SnareWasm, project: Project, pattern: number, sampleRate: number): LoopRender {
  return renderSong(wasm, engineSetup(project), { panel: panelFor(pattern), rhythms: [pattern >> 1], loop: true }, sampleRate);
}

/** Standard MIDI File of measures of the project's patterns, each named by its place in the bank. */
export function exportMidi(wasm: SnareWasm, project: Project, sequence: number[]): Uint8Array {
  return wasm.midiExport(
    enginePatterns(project.rhythms),
    sequence,
    trackNotes(project.sound),
    midiVelocities(project.sound),
    tempoBpm(project.tempo),
  );
}
