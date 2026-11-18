import { describe, expect, it } from 'vitest';
import { exportSongMidi, planPatterns, renderSong, type ExportPlan } from '@boombapbot/editor/engine';
import {
  EMPTY_ROW,
  INSTRUMENT_IDS,
  SOUNDS,
  countHits,
  createEmptyPattern,
  getRow,
  getSound,
  levelGain,
  patternIndex,
  withRow,
  type Pattern,
  type Project,
} from '../src/document';
import { engineSetup, exportPlan, trackSong } from '../src/engine';
import { blankProject, loadFixture, loadWasm, newProject, parseMidi, rms } from './helpers';

const wasm = loadWasm();
const RATE = 44100;

function plan(project: Project): ExportPlan {
  const made = exportPlan(project);
  if ('error' in made) throw new Error(made.error);
  return made;
}

function withPanel(project: Project, panel: Partial<Project['panel']>): Project {
  return { ...project, panel: { ...project.panel, chain: null, ...panel } };
}

/** A project that remembers nothing but the one pattern it is on. */
function onePattern(pattern: Pattern, change: Partial<Project> = {}): Project {
  const project = blankProject();
  return { ...project, ...change, groups: { ...project.groups, a: [pattern, ...project.groups.a.slice(1)] } };
}

function rows(steps: Partial<Pattern['steps']>, change: Partial<Pattern> = {}): Pattern {
  return Object.entries(steps).reduce(
    (pattern, [row, drawn]) => withRow(pattern, row as keyof Pattern['steps'], drawn),
    { ...createEmptyPattern(), ...change },
  );
}

describe('what the 707 asks of the engine', () => {
  it('gives every instrument a track and every sound a slot, voiced as the machine file says', () => {
    const setup = engineSetup(newProject());
    expect(setup.tempo).toBe(120);
    expect(setup.sounds).toEqual(SOUNDS.map((sound) => ({ sound: sound.index, ...sound.knobs })));
    expect(setup.sounds).toHaveLength(15);
    expect(setup.tracks.map((track) => track.track)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // With the first sound of each pair chosen: both bass drums, snares, rim shot and clap sit in slots 0, 2, 7 and 9.
    expect(setup.tracks.map((track) => track.slot)).toEqual([0, 2, 4, 5, 6, 7, 9, 11, 12, 13, 14]);
    expect(setup.tracks[0]!.gain).toBeCloseTo(levelGain('bass_drum', 0.75), 10);
    expect(setup.effect).toBeUndefined();
  });

  it('plays the sound the project chose on each paired row', () => {
    const project = newProject();
    const setup = engineSetup({
      ...project,
      sounds: { bass_drum: 'bass_drum_2', snare_drum: 'snare_drum_2', rim_cowbell: 'cowbell', clap_tambourine: 'tambourine' },
    });
    expect(setup.tracks.map((track) => track.slot)).toEqual([1, 3, 4, 5, 6, 8, 10, 11, 12, 13, 14]);
  });

  it('sets both hi-hats from one fader and lets them cut each other off', () => {
    const project = newProject();
    const setup = engineSetup({ ...project, mix: { ...project.mix, levels: { ...project.mix.levels, hi_hat: 0.3 } } });
    const closed = setup.tracks[getRow('closed_hat').index - 1]!;
    const open = setup.tracks[getRow('open_hat').index - 1]!;
    expect(closed.gain).toBeCloseTo(levelGain('closed_hat', 0.3), 10);
    expect(open.gain).toBeCloseTo(levelGain('open_hat', 0.3), 10);
    expect(closed.chokeGroup).toBe(open.chokeGroup);
    expect(setup.tracks.filter((track) => track.chokeGroup !== 0)).toHaveLength(2);
    expect(setup.tracks[0]!.gain).toBeCloseTo(levelGain('bass_drum', 0.75), 10);
  });

  it('holds the bank as A1, B1, A2, B2 and so on, each pattern with its own length and scale', () => {
    const fixture = loadFixture();
    const setup = engineSetup(fixture);
    expect(setup.patterns).toHaveLength(32);
    expect(setup.patterns.every((pattern) => pattern.rows.length === 12 && pattern.secondLength === 0)).toBe(true);
    expect(setup.patterns[patternIndex('a', 0)]).toMatchObject({ firstLength: 16, stepsPerBeat: 4 });
    expect(setup.patterns[patternIndex('b', 0)]).toMatchObject({ firstLength: 12, stepsPerBeat: 3 });
    expect(setup.patterns[patternIndex('a', 4)]).toMatchObject({ firstLength: 16, stepsPerBeat: 8 });
    expect(setup.patterns[patternIndex('a', 6)]).toMatchObject({ firstLength: 12, stepsPerBeat: 6 });
    expect(setup.patterns[patternIndex('b', 1)]).toMatchObject({ firstLength: 7, stepsPerBeat: 4 });
    // Row 0 is the accent, row 1 the bass drum.
    expect(setup.patterns[patternIndex('a', 0)]!.rows[0]).toBe(0b0001_0001_0001_0001);
    expect(setup.patterns[patternIndex('b', 1)]!.rows[1]).toBe(0b0100_1001);
    // The shuffle is the machine's, so every pattern takes the same.
    expect(new Set(setup.patterns.map((pattern) => pattern.swing))).toEqual(new Set([43]));
  });

  it('follows the tempo, the faders and the shuffle', () => {
    const project = newProject();
    const setup = engineSetup({ ...project, tempo: 97, shuffle: 4, mix: { ...project.mix, volume: 0.25, accent: 0 } });
    expect(setup.tempo).toBe(97);
    expect(setup.master).toBeCloseTo(0.125, 10);
    expect(setup.accent).toEqual({ plain: 0.6, accented: 0.6 });
    expect(setup.patterns[0]!.swing).toBe(85);
  });

  it('cues the pattern the panel is on, in its group, in every mode but track play', () => {
    const fixture = loadFixture();
    expect(engineSetup(withPanel(fixture, { mode: 'pattern_play', group: 'b', pattern: 9 })).follow).toEqual({ cue: 19 });
    expect(engineSetup(withPanel(fixture, { mode: 'pattern_step', group: 'a', pattern: 9 })).follow).toEqual({ cue: 18 });
    expect(engineSetup(withPanel(fixture, { mode: 'pattern_tap', group: 'a', pattern: 0 })).follow).toEqual({ cue: 0 });
    // Writing a track, the pattern is one of the track's own group.
    expect(engineSetup(withPanel(fixture, { mode: 'track_write', group: 'a', track: 1, pattern: 3 })).follow).toEqual({ cue: 7 });
    // The pattern cued does not move with the chain's ends, only with the pattern.
    expect(engineSetup({ ...fixture, panel: { ...fixture.panel, pattern: 2 } }).follow).toEqual({ cue: 4 });
  });

  it('gives the engine a track to play as a song of one group', () => {
    const fixture = loadFixture();
    const first = withPanel(fixture, { mode: 'track_play', track: 0, measure: 0 });
    expect(engineSetup(first).follow).toEqual({
      panel: { rhythm: 0, variation: 'a', fillRhythm: 0, fillVariation: 'a', autoFill: 0, firstBeatRule: false },
    });
    const second = withPanel(fixture, { mode: 'track_play', track: 1 });
    expect(engineSetup(second).follow).toMatchObject({ panel: { variation: 'b', fillVariation: 'b' } });
    // Where a stopped track stands changes the song, never the switches: moving them would take the song's place.
    expect(engineSetup(withPanel(first, { mode: 'track_play', track: 0, measure: 3 })).follow).toEqual(engineSetup(first).follow);
    expect(trackSong(first)).toEqual([0, 1, 0, 2, 3]);
    expect(trackSong(withPanel(first, { mode: 'track_play', track: 0, measure: 3 }))).toEqual([2, 3]);
    expect(trackSong(withPanel(first, { mode: 'track_play', track: 0, measure: 5 }))).toEqual([0, 1, 0, 2, 3]);
    expect(trackSong(withPanel(first, { mode: 'track_play', track: 2 }))).toEqual([]);
  });

  it('is the same setup for the same project', () => {
    expect(engineSetup(loadFixture())).toEqual(engineSetup(loadFixture()));
  });
});

describe('what an export holds', () => {
  const fixture = loadFixture();

  it('is the pattern the panel is on, as a loop', () => {
    const made = plan(withPanel(fixture, { mode: 'pattern_step', group: 'b', pattern: 1 }));
    expect(made).toMatchObject({ pattern: 3, loop: true });
    expect(planPatterns(wasm, made)).toEqual([3]);
  });

  it('is a chain as a loop of its patterns, in either group', () => {
    const made = plan({ ...fixture, panel: { ...fixture.panel, mode: 'pattern_play', group: 'a', pattern: 2, chain: { first: 0, last: 3 } } });
    expect(made).toMatchObject({ rhythms: [0, 1, 2, 3], loop: true });
    expect(planPatterns(wasm, made)).toEqual([0, 2, 4, 6]);
    // Patterns 13 to 16 are the engine's fill-ins: they keep to the group all the same.
    const late = plan({ ...fixture, panel: { ...fixture.panel, group: 'b', pattern: 11, chain: { first: 11, last: 14 } } });
    expect(planPatterns(wasm, late)).toEqual([23, 25, 27, 29]);
  });

  it('is the whole of the selected track, once through, in the track modes', () => {
    for (const mode of ['track_play', 'track_write'] as const) {
      const made = plan(withPanel(fixture, { mode, track: 0, measure: 3 }));
      expect(made).toMatchObject({ rhythms: [0, 1, 0, 2, 3], loop: false });
      expect(planPatterns(wasm, made)).toEqual([0, 2, 0, 4, 6]);
    }
    expect(planPatterns(wasm, plan(withPanel(fixture, { mode: 'track_play', track: 1 })))).toEqual([1, 3]);
    expect(exportPlan(withPanel(fixture, { mode: 'track_play', track: 2 }))).toEqual({ error: 'track III is empty.' });
  });

  it('names a MIDI note for each row, for the sounds the project chose', () => {
    const made = plan(newProject());
    expect(made.notes).toEqual([0, 36, 38, 41, 45, 48, 37, 39, 42, 46, 49, 51]);
    expect(plan(fixture).notes).toEqual([0, 35, 38, 41, 45, 48, 56, 54, 42, 46, 49, 51]);
    expect(made.notes.slice(1)).toEqual(INSTRUMENT_IDS.map((id) => getSound(getRow(id).sounds![0]!).gmNote));
    expect(made.velocities.accented).toBeGreaterThan(made.velocities.plain);
    expect(plan({ ...newProject(), mix: { ...newProject().mix, accent: 0 } }).velocities).toEqual({ plain: 76, accented: 76 });
  });
});

describe('the 707 through the engine', () => {
  it('plays every hit of the starter patterns once, each as a loop of one measure', () => {
    const project = newProject();
    for (const [group, pattern] of [['a', 0], ['a', 1], ['a', 2], ['a', 3], ['b', 0]] as const) {
      const at = withPanel(project, { group, pattern });
      const render = renderSong(wasm, engineSetup(at), plan(at), RATE);
      // Sixteen sixteenths and twelve triplet eighths are both four beats at 120.
      expect(render.left.length, `${group}${pattern}`).toBe(2 * RATE);
      expect(render.events, `${group}${pattern}`).toHaveLength(countHits(project.groups[group][pattern]!));
      expect(new Set(render.events.map((event) => event.pattern))).toEqual(new Set([patternIndex(group, pattern)]));
      expect(rms(render.left)).toBeGreaterThan(0.02);
      expect(render.left.every(Number.isFinite)).toBe(true);
      expect(Math.max(...render.left.map(Math.abs))).toBeLessThanOrEqual(1);
    }
  });

  it('plays as many steps as the last step says, at the pattern\'s scale', () => {
    const every = rows({ closed_hat: 'xxxxxxxxxxxxxxxx' });
    const lengths: Array<[Partial<Pattern>, number]> = [
      [{ lastStep: 16, scale: 4 }, 2],
      [{ lastStep: 12, scale: 4 }, 1.5],
      [{ lastStep: 2, scale: 4 }, 0.25],
      [{ lastStep: 16, scale: 8 }, 1],
      [{ lastStep: 12, scale: 3 }, 2],
      [{ lastStep: 12, scale: 6 }, 1],
    ];
    for (const [change, seconds] of lengths) {
      const project = onePattern({ ...every, ...change });
      const render = renderSong(wasm, engineSetup(project), plan(project), RATE);
      expect(render.left.length, JSON.stringify(change)).toBe(Math.round(seconds * RATE));
      expect(render.events, JSON.stringify(change)).toHaveLength(change.lastStep!);
    }
  });

  it('accents every instrument on the steps of the one accent row', () => {
    const project = onePattern(rows({ accent: 'x.......x.......', bass_drum: 'x...x...x...x...', ride: 'x.x.x.x.x.x.x.x.' }));
    const render = renderSong(wasm, engineSetup(project), plan(project), RATE);
    expect(render.events).toHaveLength(12);
    expect(render.events.filter((event) => event.accent).map((event) => [event.step, event.track])).toEqual([
      [0, 1],
      [0, 11],
      [8, 1],
      [8, 11],
    ]);
  });

  it('shuffles every second step late, and not at all in triplets', () => {
    const straight = onePattern(rows({ closed_hat: 'xxxxxxxxxxxxxxxx' }));
    const even = renderSong(wasm, engineSetup(straight), plan(straight), RATE);
    const shuffled = { ...straight, shuffle: 4 as const };
    const swung = renderSong(wasm, engineSetup(shuffled), plan(shuffled), RATE);
    const late = swung.events.filter((event, index) => event.frame > even.events[index]!.frame);
    expect(late.map((event) => event.step)).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
    // At its most a shuffled step falls two thirds of the way through its pair, as a triplet would.
    const step = RATE / 8;
    expect(swung.events[1]!.frame - even.events[1]!.frame).toBeCloseTo(step / 3, -2);

    const triplets = onePattern(rows({ closed_hat: 'xxxxxxxxxxxxxxxx' }, { scale: 3, lastStep: 12 }));
    const plain = renderSong(wasm, engineSetup(triplets), plan(triplets), RATE);
    const still = renderSong(wasm, engineSetup({ ...triplets, shuffle: 4 }), plan(triplets), RATE);
    expect(still.events.map((event) => event.frame)).toEqual(plain.events.map((event) => event.frame));
  });

  it('lets a closed hi-hat cut an open one off', () => {
    const ringing = onePattern(rows({ open_hat: 'x...............' }));
    const cut = onePattern(rows({ open_hat: 'x...............', closed_hat: '..x.............' }));
    const after = (project: Project): number => {
      const render = renderSong(wasm, engineSetup(project), { ...plan(project), loop: false }, RATE);
      // From the fifth step to the eighth: after the closed hat has died away.
      return rms(render.left.subarray(RATE / 2, (RATE * 7) / 8));
    };
    expect(after(ringing)).toBeGreaterThan(0.001);
    expect(after(cut)).toBeLessThan(after(ringing) / 4);
  });

  it('is silent with the volume down, or with a row\'s fader down', () => {
    const project = onePattern(rows({ bass_drum: 'x...x...x...x...' }));
    const quiet = (change: Partial<Project['mix']>) => {
      const changed = { ...project, mix: { ...project.mix, ...change } };
      return rms(renderSong(wasm, engineSetup(changed), plan(changed), RATE).left);
    };
    expect(quiet({})).toBeGreaterThan(0.05);
    expect(quiet({ volume: 0 })).toBe(0);
    expect(quiet({ levels: { ...project.mix.levels, bass_drum: 0 } })).toBe(0);
    expect(quiet({ levels: { ...project.mix.levels, snare_drum: 0 } })).toBe(quiet({}));
  });

  it('sounds different when a paired row is given its other sound', () => {
    const project = onePattern(
      rows({
        bass_drum: 'x...............',
        snare_drum: '....x...........',
        rim_cowbell: '..x.............',
        clap_tambourine: '......x.........',
      }),
    );
    const first = renderSong(wasm, engineSetup(project), plan(project), RATE);
    for (const [row, sound] of [
      ['bass_drum', 'bass_drum_2'],
      ['snare_drum', 'snare_drum_2'],
      ['rim_cowbell', 'cowbell'],
      ['clap_tambourine', 'tambourine'],
    ] as const) {
      const other = { ...project, sounds: { ...project.sounds, [row]: sound } };
      const render = renderSong(wasm, engineSetup(other), plan(other), RATE);
      expect(render.events, row).toEqual(first.events);
      expect(render.left, row).not.toEqual(first.left);
    }
  });

  it('plays a chain one pattern after the other, and a track measure by measure', () => {
    const fixture = loadFixture();
    const chain = { ...fixture, panel: { ...fixture.panel, mode: 'pattern_play' as const, pattern: 0, chain: { first: 0, last: 2 } } };
    const looped = renderSong(wasm, engineSetup(chain), plan(chain), RATE);
    const played = (events: typeof looped.events) => events.map((event) => event.pattern).filter((pattern, index, all) => pattern !== all[index - 1]);
    expect(played(looped.events)).toEqual([0, 2, 4]);
    expect(looped.events).toHaveLength(countHits(fixture.groups.a[0]!) + countHits(fixture.groups.a[1]!) + countHits(fixture.groups.a[2]!));

    const track = withPanel(fixture, { mode: 'track_play', track: 3 });
    const once = renderSong(wasm, engineSetup(track), plan(track), RATE);
    expect(played(once.events)).toEqual([patternIndex('a', 4), patternIndex('a', 6)]);
    // A4 is sixteen thirty-seconds and A6 twelve triplet sixteenths: two beats each, at 132, then the tail.
    expect(once.left.length).toBe(Math.round((4 * 60 * RATE) / 132) + 3 * RATE);

    const other = withPanel(fixture, { mode: 'track_play', track: 1 });
    expect(played(renderSong(wasm, engineSetup(other), plan(other), RATE).events)).toEqual([1, 3]);
  });

  it('exports a pattern as MIDI: a note for each hit, louder where accented, shuffled as it plays', () => {
    const project = newProject();
    const midi = parseMidi(exportSongMidi(wasm, engineSetup(project), plan(project)));
    const ons = midi.notes.filter((note) => note.on);
    expect(ons).toHaveLength(countHits(project.groups.a[0]!));
    expect(new Set(ons.map((note) => note.note))).toEqual(new Set([36, 38, 39, 42, 46]));
    expect(new Set(ons.map((note) => note.velocity))).toEqual(new Set([plan(project).velocities.plain, plan(project).velocities.accented]));
    expect(ons.every((note) => note.channel === 10)).toBe(true);
    expect(midi.tempoMicros).toBe(500_000);
    const shuffled = { ...project, shuffle: 4 as const };
    const late = parseMidi(exportSongMidi(wasm, engineSetup(shuffled), plan(shuffled))).notes.filter((note) => note.on);
    expect(late.some((note) => note.tick % 120 !== 0)).toBe(true);
    expect(ons.every((note) => note.tick % 120 === 0)).toBe(true);
  });

  it('exports a track as MIDI, every measure of it', () => {
    const fixture = withPanel(loadFixture(), { mode: 'track_play', track: 0 });
    const midi = parseMidi(exportSongMidi(wasm, engineSetup(fixture), plan(fixture)));
    const hits = [0, 1, 0, 2, 3].reduce((sum, pattern) => sum + countHits(fixture.groups.a[pattern]!), 0);
    expect(midi.notes.filter((note) => note.on)).toHaveLength(hits);
    // Bass Drum 2 and the cowbell, as the fixture has them chosen.
    expect(midi.notes.some((note) => note.note === 35)).toBe(true);
    expect(midi.notes.some((note) => note.note === 36)).toBe(false);
    expect(midi.notes.some((note) => note.note === 56)).toBe(true);
  });

  it('plays nothing where a pattern is empty', () => {
    const project = blankProject();
    expect(project.groups.a[0]!.steps.bass_drum).toBe(EMPTY_ROW);
    const render = renderSong(wasm, engineSetup(project), plan(project), RATE);
    expect(render.events).toEqual([]);
    expect(rms(render.left)).toBe(0);
  });
});
