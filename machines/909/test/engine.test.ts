import { describe, expect, it } from 'vitest';
import {
  applySetup,
  exportSongMidi,
  renderSong,
  type EngineMeasure,
  type EnginePanel,
  type WasmEngine,
} from '@boombapbot/editor/engine';
import {
  INSTRUMENTS,
  TRACKS,
  accentGains,
  countHits,
  isEmptyPattern,
  isStepOn,
  patternIndex,
  stepsPerBeat,
  type Group,
  type PanelState,
  type Pattern,
  type Project,
} from '../src/document';
import { machine909 } from '../src';
import { enginePanel, enginePatterns, engineSetup, engineTracks, exportPlan, midiVelocities, synthSound, trackNotes } from '../src/engine';
import { loadFixture, loadWasm, newProject, parseMidi, rms } from './helpers';

const wasm = loadWasm();
const fixture = loadFixture();
const RATE = 44100;

const withPanel = (change: Partial<PanelState>, project: Project = fixture): Project => ({
  ...project,
  panel: { ...project.panel, ...change },
});

/** Every pattern of the fixture with something in it: [group, number]. */
const WRITTEN: Array<[Group, number]> = fixture.patterns.flatMap((group, g) =>
  group.flatMap((pattern, number) => (isEmptyPattern(pattern) ? [] : [[g as Group, number] as [Group, number]])),
);

/** How long one measure of a pattern lasts, in frames. */
function measureFrames(pattern: Pattern, tempo: number): number {
  return ((pattern.lastStep / stepsPerBeat(pattern.scale)) * 60 * RATE) / tempo;
}

/** One pattern of a project as the loop an export of it holds. */
function renderPattern(project: Project, group: Group, pattern: number) {
  const on = withPanel({ mode: 'pattern_write', group, pattern, chain: pattern }, project);
  return renderSong(wasm, engineSetup(on), exportPlan(on), RATE);
}

/** Plays an engine until it stops or has begun `limit` measures, and returns the measures it began. */
function follow(engine: WasmEngine, limit: number, between?: (measures: EngineMeasure[]) => void): EngineMeasure[] {
  const left = new Float32Array(1024);
  const right = new Float32Array(1024);
  const measures: EngineMeasure[] = [];
  do {
    engine.render(left, right);
    const taken = engine.takeMeasures();
    if (taken) {
      measures.push(...taken);
      between?.(measures);
    }
  } while (engine.playing && measures.length < limit);
  return measures;
}

describe('project to engine', () => {
  it('gives every instrument its own track and sound, and the hats one choke group', () => {
    const tracks = engineTracks(fixture.knobs);
    expect(tracks.map((track) => track.track)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(tracks.map((track) => track.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(tracks[7]!.chokeGroup).toBe(tracks[8]!.chokeGroup);
    expect(tracks.filter((track) => track.chokeGroup !== 0)).toHaveLength(2);
  });

  it('turns the levels, the accent and the volume into gains', () => {
    const rest = newProject();
    const tracks = engineTracks(rest.knobs);
    // At rest a level knob gives the instrument's own trim.
    expect(tracks.map((track) => track.gain)).toEqual(INSTRUMENTS.map((instrument) => instrument.trim));
    const silent = engineTracks({ ...rest.knobs, bass_drum_level: 0 });
    expect(silent[0]!.gain).toBe(0);
    expect(silent.slice(1)).toEqual(tracks.slice(1));
    // The one hi-hat level is both hats'.
    const hats = engineTracks({ ...rest.knobs, hi_hat_level: 1 });
    expect(hats[7]!.gain).toBeGreaterThan(tracks[7]!.gain);
    expect(hats[8]!.gain).toBe(hats[7]!.gain);
    expect(hats.filter((track, index) => track.gain !== tracks[index]!.gain)).toHaveLength(2);

    expect(engineSetup(rest).accent).toEqual(accentGains(0.75));
    expect(engineSetup({ ...rest, knobs: { ...rest.knobs, accent: 0 } }).accent).toEqual({ plain: 0.6, accented: 0.6 });
    expect(engineSetup({ ...rest, knobs: { ...rest.knobs, accent: 1 } }).accent.accented).toBe(1);
    expect(engineSetup({ ...rest, knobs: { ...rest.knobs, volume: 0 } }).master).toBe(0);
    expect(engineSetup({ ...rest, knobs: { ...rest.knobs, volume: 1 } }).master).toBe(1);
    expect(engineSetup(fixture).tempo).toBe(132);
  });

  it('gives a sound the knobs of its panel column, and leaves the rest at rest', () => {
    const { knobs } = fixture;
    const sounds = engineSetup(fixture).sounds;
    expect(sounds.map((sound) => sound.sound)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // ATTACK is the engine's tone knob.
    expect(sounds[0]).toEqual({ sound: 0, tune: knobs.bass_drum_tune, tone: knobs.bass_drum_attack, decay: knobs.bass_drum_decay, snappy: 0.5 });
    expect(sounds[1]).toEqual({ sound: 1, tune: knobs.snare_drum_tune, tone: knobs.snare_drum_tone, decay: 0.5, snappy: knobs.snare_drum_snappy });
    expect(sounds[3]).toEqual({ sound: 3, tune: knobs.mid_tom_tune, tone: 0.5, decay: knobs.mid_tom_decay, snappy: 0.5 });
    expect(sounds[5]).toEqual({ sound: 5, tune: 0.5, tone: 0.5, decay: 0.5, snappy: 0.5 });
    expect(sounds[7]).toEqual({ sound: 7, tune: 0.5, tone: 0.5, decay: knobs.closed_hat_decay, snappy: 0.5 });
    expect(sounds[8]!.decay).toBe(knobs.open_hat_decay);
    expect(sounds[10]).toEqual({ sound: 10, tune: knobs.ride_tune, tone: 0.5, decay: 0.5, snappy: 0.5 });
    expect(synthSound(INSTRUMENTS[9]!, knobs).tune).toBe(knobs.crash_tune);
  });

  it('lays out the bank with the groups interleaved, and each pattern in its own shape', () => {
    const bank = enginePatterns(fixture.patterns);
    expect(bank).toHaveLength(32);
    for (const [group, number] of WRITTEN) {
      const pattern = fixture.patterns[group]![number]!;
      const engine = bank[patternIndex(group, number)]!;
      expect(engine).toMatchObject({ firstLength: pattern.lastStep, secondLength: 0, stepsPerBeat: stepsPerBeat(pattern.scale) });
      expect(engine.rows).toHaveLength(12);
      TRACKS.forEach((track) => {
        for (let step = 0; step < 16; step += 1) {
          expect(((engine.rows[track.index]! >> step) & 1) === 1).toBe(isStepOn(pattern.steps[track.id], step));
        }
      });
    }
    expect(bank[patternIndex(0, 1)]!.swing).toBe(64);
    expect(bank[patternIndex(0, 4)]!.swing).toBe(128);
    expect(bank[patternIndex(1, 1)]!.swing).toBe(21);
    expect(bank[patternIndex(0, 0)]!.swing).toBe(0);
  });

  it('asks for no effect and follows the panel', () => {
    const setup = engineSetup(fixture);
    expect(setup.effect).toBeUndefined();
    expect(setup.follow).toEqual({ panel: enginePanel(fixture) });
    expect(engineSetup(fixture)).toEqual(setup);
  });
});

describe('what the panel asks the engine to play', () => {
  const asked = (rhythm: number, variation: 'a' | 'b'): EnginePanel => ({
    rhythm,
    variation,
    fillRhythm: rhythm,
    fillVariation: variation,
    autoFill: 0,
    firstBeatRule: false,
  });

  it('is the selected pattern in the group of the PATTERN key', () => {
    expect(enginePanel(withPanel({ mode: 'pattern_play', group: 0, pattern: 5, chain: 5 }))).toEqual(asked(5, 'a'));
    expect(enginePanel(withPanel({ mode: 'pattern_write', group: 1, pattern: 15, chain: 15 }))).toEqual(asked(15, 'b'));
  });

  it('is in the group of the track in the track modes', () => {
    expect(enginePanel(withPanel({ mode: 'track_play', track: 1, group: 0, pattern: 2, chain: 2 }))).toEqual(asked(2, 'b'));
    expect(enginePanel(withPanel({ mode: 'track_write', track: 0, group: 1, pattern: 2, chain: 2 }))).toEqual(asked(2, 'a'));
  });

  it('plays the selected pattern round and round, and a newly selected one from the bar line', () => {
    const engine = wasm.createEngine(RATE, 1024);
    try {
      applySetup(engine, engineSetup(fixture));
      engine.setPanel(asked(0, 'a'));
      engine.setSong([], false);
      engine.play();
      const measures = follow(engine, 5, (so) => {
        if (so.length === 2) engine.setPanel(asked(1, 'a'));
        if (so.length === 3) engine.setPanel(asked(1, 'b'));
      });
      expect(measures.map((measure) => measure.pattern)).toEqual([0, 0, 2, 3, 3]);
      expect(measures.every((measure) => measure.position === -1)).toBe(true);
    } finally {
      engine.destroy();
    }
  });

  it('plays a chain as a song that goes round, which a newly selected pattern takes the place of', () => {
    const engine = wasm.createEngine(RATE, 1024);
    try {
      applySetup(engine, engineSetup(fixture));
      engine.setPanel(asked(0, 'a'));
      engine.setSong([0, 1, 2], true);
      engine.play();
      const measures = follow(engine, 9, (so) => {
        // The other group, while the chain plays: the chain goes on in it.
        if (so.length === 4) engine.setPanel(asked(0, 'b'));
        // Then a single pattern: it plays from the next bar line, and the chain is over.
        if (so.length === 6) engine.setPanel(asked(15, 'b'));
      });
      expect(measures.map((measure) => measure.pattern)).toEqual([0, 2, 4, 0, 3, 5, 31, 31, 31]);
    } finally {
      engine.destroy();
    }
  });

  it('plays a track from its group, counts its measures, and stops at its end unless it cycles', () => {
    const project = withPanel({ mode: 'track_play', track: 1 });
    const track = project.patternTracks[1]!.measures;
    const engine = wasm.createEngine(RATE, 1024);
    try {
      applySetup(engine, engineSetup(project));
      engine.setPanel(enginePanel(project));
      engine.setSong(track, false);
      engine.play();
      const once = follow(engine, 99);
      // Pattern 16 too, though the engine's songs treat rhythms 13 to 16 as fill-ins.
      expect(once.map((measure) => measure.pattern)).toEqual([1, 3, 31]);
      expect(once.map((measure) => measure.position)).toEqual([0, 1, 2]);
      expect(engine.playing).toBe(false);

      engine.setSong(track, true);
      engine.play();
      const cycled = follow(engine, 7);
      expect(cycled.map((measure) => measure.position)).toEqual([0, 1, 2, 0, 1, 2, 0]);
      expect(engine.playing).toBe(true);
    } finally {
      engine.destroy();
    }
  });
});

describe('what an export holds', () => {
  it('is the selected pattern as a loop', () => {
    const plan = exportPlan(withPanel({ mode: 'pattern_write', group: 1, pattern: 1, chain: 1 }));
    expect(plan).toMatchObject({ rhythms: [1], loop: true, panel: { rhythm: 1, variation: 'b' } });
    expect(wasm.songPatterns(plan.panel, plan.rhythms)).toEqual([3]);
  });

  it('is the chain, in pattern play', () => {
    const plan = exportPlan(withPanel({ mode: 'pattern_play', group: 0, pattern: 1, chain: 3 }));
    expect(plan).toMatchObject({ rhythms: [1, 2, 3], loop: true });
    expect(wasm.songPatterns(plan.panel, plan.rhythms)).toEqual([2, 4, 6]);
  });

  it('is the selected track once through, in the track modes', () => {
    for (const mode of ['track_play', 'track_write'] as const) {
      const plan = exportPlan(withPanel({ mode, track: 1 }));
      expect(plan).toMatchObject({ rhythms: [0, 1, 15], loop: false });
      expect(wasm.songPatterns(plan.panel, plan.rhythms)).toEqual([1, 3, 31]);
    }
    const first = exportPlan(withPanel({ mode: 'track_play', track: 0 }));
    expect(wasm.songPatterns(first.panel, first.rhythms)).toEqual([0, 2, 0, 6]);
  });

  it('names a General MIDI note for every instrument, and velocities for the accent', () => {
    expect(trackNotes()).toEqual([0, 36, 38, 41, 45, 48, 37, 39, 42, 46, 49, 51]);
    expect(exportPlan(fixture).notes).toEqual(trackNotes());
    expect(midiVelocities({ ...fixture.knobs, accent: 1 })).toEqual({ plain: 76, accented: 127 });
    expect(midiVelocities({ ...fixture.knobs, accent: 0 })).toEqual({ plain: 76, accented: 76 });
  });

  it('says why there is nothing to export for an empty track', () => {
    expect(machine909.exportPlan(withPanel({ mode: 'track_play', track: 3 }))).toEqual({ error: 'track 4 is empty.' });
    expect(machine909.exportPlan(withPanel({ mode: 'track_play', track: 0 }))).toMatchObject({ loop: false });
    expect(machine909.bpm(fixture)).toBe(132);
  });
});

describe('through the WebAssembly engine', () => {
  it('plays every written pattern for exactly one measure, hit for hit', () => {
    for (const [group, number] of WRITTEN) {
      const pattern = fixture.patterns[group]![number]!;
      const render = renderPattern(fixture, group, number);
      const what = `group ${group + 1}, pattern ${number + 1}`;
      expect(Math.abs(render.left.length - measureFrames(pattern, fixture.tempo)), what).toBeLessThanOrEqual(1);
      expect(render.events, what).toHaveLength(countHits(pattern));
      expect(render.events.every((event) => event.pattern === patternIndex(group, number)), what).toBe(true);
      for (const event of render.events) {
        const track = TRACKS[event.track]!;
        expect(isStepOn(pattern.steps[track.id], event.step), `${what}, ${track.id} step ${event.step}`).toBe(true);
        expect(event.accent, `${what}, accent on step ${event.step}`).toBe(isStepOn(pattern.steps.accent, event.step));
        expect(event.step).toBeLessThan(pattern.lastStep);
      }
      expect(rms(render.left), what).toBeGreaterThan(0.005);
      expect(render.left.every(Number.isFinite), what).toBe(true);
    }
  });

  it('gives each scale its own step length', () => {
    // Twelve steps of six to the beat are two beats; of three, four beats; sixteen of eight, two.
    const beats = (group: Group, number: number) =>
      (renderPattern(fixture, group, number).left.length * fixture.tempo) / (60 * RATE);
    expect(beats(0, 0)).toBeCloseTo(4, 3);
    expect(beats(0, 2)).toBeCloseTo(4, 3);
    expect(beats(0, 3)).toBeCloseTo(2, 3);
    expect(beats(0, 4)).toBeCloseTo(2, 3);
    expect(beats(0, 5)).toBeCloseTo(1.75, 3);
  });

  it('plays every second step late when a pattern is shuffled, and the others on time', () => {
    const straight = { ...fixture.patterns[0]![1]!, shuffle: 0 };
    const patterns = fixture.patterns.map((group) => [...group]);
    patterns[0]![9] = straight;
    const project = { ...fixture, patterns };
    const frames = (number: number) => new Map(renderPattern(project, 0, number).events.map((event) => [`${event.track}:${event.step}`, event.frame]));
    const shuffled = frames(1);
    const plain = frames(9);
    const step = measureFrames(straight, fixture.tempo) / 16;
    expect(shuffled.size).toBe(plain.size);
    for (const [key, frame] of plain) {
      const odd = Number(key.split(':')[1]) % 2 === 1;
      const late = shuffled.get(key)! - frame;
      // Shuffle 3 of 6 is a quarter of a step.
      if (odd) expect(Math.abs(late - step / 4), key).toBeLessThanOrEqual(1);
      else expect(late, key).toBe(0);
    }
    expect([...plain.keys()].some((key) => Number(key.split(':')[1]) % 2 === 1)).toBe(true);
  });

  it('renders a chain as one loop of its patterns in order', () => {
    const project = withPanel({ mode: 'pattern_play', group: 0, pattern: 0, chain: 2 });
    const render = renderSong(wasm, engineSetup(project), exportPlan(project), RATE);
    const single = [0, 1, 2].map((number) => renderPattern(fixture, 0, number));
    const length = single.reduce((sum, one) => sum + one.left.length, 0);
    // Each length is rounded to a frame on its own.
    expect(Math.abs(render.left.length - length)).toBeLessThanOrEqual(2);
    expect(render.events.map((event) => event.pattern)).toEqual([
      ...single[0]!.events.map(() => 0),
      ...single[1]!.events.map(() => 2),
      ...single[2]!.events.map(() => 4),
    ]);
  });

  it('renders a track once through and lets it ring', () => {
    const project = withPanel({ mode: 'track_play', track: 1 });
    const plan = exportPlan(project);
    const render = renderSong(wasm, engineSetup(project), plan, RATE);
    const bank = enginePatterns(project.patterns);
    const ticks = wasm.songPatterns(plan.panel, plan.rhythms).reduce((sum, pattern) => sum + wasm.patternTicks(bank[pattern]!), 0);
    const length = wasm.tickFrame(ticks, project.tempo, RATE);
    expect(render.left.length).toBe(length + 3 * RATE);
    expect([...new Set(render.events.map((event) => event.pattern))]).toEqual([1, 3, 31]);
    expect(Math.max(...render.events.map((event) => event.frame))).toBeLessThan(length);
    expect(rms(render.left.subarray(render.left.length - 4410))).toBeLessThan(1e-4);
  });

  it('is deterministic', () => {
    expect(renderPattern(fixture, 0, 0).left).toEqual(renderPattern(fixture, 0, 0).left);
  });

  it('follows the mix: a level knob, the accent and the volume', () => {
    const loud = { ...fixture, knobs: { ...fixture.knobs, volume: 0.8, accent: 0.5 } };
    const plain = renderPattern(loud, 0, 0);
    const quiet = renderPattern({ ...loud, knobs: { ...loud.knobs, volume: 0.4 } }, 0, 0);
    expect(rms(quiet.left)).toBeLessThan(rms(plain.left) * 0.5);
    const accented = renderPattern({ ...loud, knobs: { ...loud.knobs, accent: 1 } }, 0, 0);
    expect(rms(accented.left)).toBeGreaterThan(rms(plain.left));
    const noKick = renderPattern({ ...loud, knobs: { ...loud.knobs, bass_drum_level: 0 } }, 0, 0);
    expect(rms(noKick.left)).toBeLessThan(rms(plain.left));
    expect(noKick.events).toEqual(plain.events);
    expect(renderPattern({ ...loud, knobs: { ...loud.knobs, volume: 0 } }, 0, 0).left.every((sample) => sample === 0)).toBe(true);
  });

  it('pans the instruments: the low tom to the left, the hi tom to the right', () => {
    const only = (id: 'low_tom' | 'hi_tom') => {
      const patterns = fixture.patterns.map((group) => [...group]);
      const empty = patterns[0]![9]!;
      patterns[0]![9] = { ...empty, steps: { ...empty.steps, [id]: 'x...............' } };
      const render = renderPattern({ ...fixture, patterns, knobs: { ...fixture.knobs, volume: 0.8, [`${id}_level`]: 0.75 } }, 0, 9);
      return rms(render.left) / rms(render.right);
    };
    expect(only('low_tom')).toBeGreaterThan(1.1);
    expect(only('hi_tom')).toBeLessThan(0.9);
  });
});

describe('MIDI export', () => {
  it('writes the selected pattern as one measure of drum notes on channel 10', () => {
    const project = withPanel({ mode: 'pattern_write', group: 0, pattern: 0, chain: 0 });
    const pattern = project.patterns[0]![0]!;
    const midi = parseMidi(exportSongMidi(wasm, engineSetup(project), exportPlan(project)));
    expect(midi.format).toBe(1);
    expect(midi.ppq).toBe(480);
    expect(midi.tempoMicros).toBe(Math.round(60_000_000 / 132));
    expect(midi.trackEnds).toEqual([1920, 1920]);
    const noteOns = midi.notes.filter((note) => note.on);
    expect(noteOns).toHaveLength(countHits(pattern));
    expect(midi.notes.every((note) => note.channel === 10)).toBe(true);
    const kicks = noteOns.filter((note) => note.note === 36);
    expect(kicks.map((note) => note.tick)).toEqual([0, 480, 960, 1440]);
    const { plain, accented } = midiVelocities(project.knobs);
    expect(kicks.map((note) => note.velocity)).toEqual([accented, plain, accented, plain]);
  });

  it('writes patterns of different lengths and scales one after another', () => {
    const project = withPanel({ mode: 'track_play', track: 2 });
    const plan = exportPlan(project);
    const midi = parseMidi(exportSongMidi(wasm, engineSetup(project), plan));
    // Twenty measures: five rounds of four beats, four beats, four beats and seven sixteenths.
    const round = 1920 + 1920 + 1920 + 840;
    expect(midi.trackEnds).toEqual([5 * round, 5 * round]);
    const hits = plan.rhythms.reduce((sum, number) => sum + countHits(project.patterns[0]![number]!), 0);
    expect(midi.notes.filter((note) => note.on)).toHaveLength(hits);
  });

  it('swings the notes of a shuffled pattern as the audio is swung', () => {
    const project = withPanel({ mode: 'pattern_write', group: 0, pattern: 1, chain: 1 });
    const midi = parseMidi(exportSongMidi(wasm, engineSetup(project), exportPlan(project)));
    const rim = midi.notes.filter((note) => note.on && note.note === 37);
    // The rim shot is on step 8, an off step: a quarter of a sixteenth late.
    expect(rim.map((note) => note.tick)).toEqual([7 * 120 + 30]);
  });
});
