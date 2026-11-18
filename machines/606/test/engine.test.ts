import { describe, expect, it } from 'vitest';
import { exportSongMidi, renderSong, type ExportPlan, type SongPlan } from '@boombapbot/editor/engine';
import { INSTRUMENTS, bankIndex, countHits, levelGain, selectionOf, type Mode, type Project } from '../src/document';
import { engineSetup, enginePattern, exportPlan } from '../src/engine';
import { loadFixture, loadWasm, newProject, parseMidi, rms } from './helpers';

const wasm = loadWasm();
const RATE = 44100;

function at(project: Project, panel: Partial<Project['panel']>): Project {
  return { ...project, panel: { ...project.panel, ...panel } };
}

function planOf(project: Project): ExportPlan<SongPlan> {
  const plan = exportPlan(project);
  if ('error' in plan) throw new Error(plan.error);
  return plan;
}

/** Frames in a number of beats at a tempo. */
const beats = (count: number, bpm: number) => (count * 60 * RATE) / bpm;

/** A render is as long as it should be, to the frame the engine rounds to. */
function expectFrames(actual: number, wanted: number, what?: string): void {
  expect(Math.abs(actual - wanted), what).toBeLessThanOrEqual(1);
}

describe('what the 606 asks of the engine', () => {
  it('gives each instrument its own track, slot and sound, with the accent on track 0 and nothing panned', () => {
    const setup = engineSetup(newProject());
    expect(setup.tempo).toBe(126);
    expect(setup.tracks.map((track) => [track.track, track.slot])).toEqual([[1, 0], [2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 6]]);
    expect(setup.tracks.every((track) => track.pan === 0)).toBe(true);
    expect(setup.tracks.map((track) => track.chokeGroup)).toEqual([0, 0, 0, 0, 0, 1, 1]);
    expect(setup.tracks[0]!.gain).toBeCloseTo(levelGain('kick', 0.75), 10);
    // The machine has no sound knobs, so every sound is asked for the same way.
    expect(setup.sounds).toEqual(INSTRUMENTS.map((_, sound) => ({ sound, tune: 0.5, tone: 0.5, decay: 0.5, snappy: 0.5 })));
    expect(setup.effect).toBeUndefined();
    expect(setup.accent.plain).toBe(0.6);
    expect(setup.accent.accented).toBeCloseTo(0.9, 10);
  });

  it('fills the bank with both groups in turn, each pattern at its own length and scale, and never swings', () => {
    const fixture = loadFixture();
    const { patterns } = engineSetup(fixture);
    expect(patterns).toHaveLength(32);
    expect(patterns.every((pattern) => pattern.rows.length === 12 && pattern.swing === 0 && pattern.secondLength === 0)).toBe(true);
    expect(patterns[bankIndex(0, 0)]).toEqual(enginePattern(fixture.patterns[0]![0]!));
    expect(patterns[bankIndex(0, 1)]).toMatchObject({ firstLength: 14, stepsPerBeat: 6 });
    expect(patterns[bankIndex(8, 0)]).toMatchObject({ firstLength: 12, stepsPerBeat: 3 });
    expect(patterns[bankIndex(6, 1)]).toMatchObject({ firstLength: 7, stepsPerBeat: 8 });
    expect(patterns[bankIndex(15, 1)]).toMatchObject({ firstLength: 1, stepsPerBeat: 4 });
    // The accent row first, then the instruments in selector order: the bass drum on steps 1, 7, 9 and 15.
    expect(patterns[0]!.rows[0]).toBe(0b0000_0001_0000_0001);
    expect(patterns[0]!.rows[1]).toBe(0b0100_0001_0100_0001);
    expect(patterns[0]!.rows.slice(8)).toEqual([0, 0, 0, 0]);
  });

  it('follows the selected pattern in the group the button stands on', () => {
    const project = newProject();
    expect(engineSetup(project).follow).toEqual({
      panel: { rhythm: 0, variation: 'a', fillRhythm: 0, fillVariation: 'a', autoFill: 0, firstBeatRule: false },
    });
    expect(engineSetup(at(project, { group: 1, ...selectionOf(13, 15) })).follow).toEqual({
      panel: { rhythm: 13, variation: 'b', fillRhythm: 13, fillVariation: 'b', autoFill: 0, firstBeatRule: false },
    });
  });

  it('follows the knobs: two instruments on one level knob move together, and the accent knob sets how much louder', () => {
    const project = newProject();
    const turned = engineSetup({
      ...project,
      tempo: 174,
      mix: { volume: 1, levels: { ...project.mix.levels, toms: 0, hi_hat: 1, accent: 0 } },
    });
    expect(turned.tempo).toBe(174);
    expect(turned.master).toBe(1);
    expect([turned.tracks[2]!.gain, turned.tracks[3]!.gain]).toEqual([0, 0]);
    expect(turned.tracks[5]!.gain).toBeCloseTo(levelGain('open_hat', 1), 10);
    expect(turned.tracks[6]!.gain).toBe(turned.tracks[5]!.gain);
    expect(turned.tracks[0]!.gain).toBe(engineSetup(project).tracks[0]!.gain);
    expect(turned.accent).toEqual({ plain: 0.6, accented: 0.6 });
  });
});

describe('what an export holds', () => {
  it('is the selected pattern as a loop, or the chain from its first to its last', () => {
    const project = newProject();
    for (const mode of ['pattern_write', 'pattern_play'] as const) {
      expect(planOf(at(project, { mode }))).toMatchObject({ rhythms: [0], loop: true });
      expect(planOf(at(project, { mode, ...selectionOf(0, 3) }))).toMatchObject({ rhythms: [0, 1, 2, 3], loop: true });
    }
    expect(planOf(project).panel).toMatchObject({ variation: 'a', fillVariation: 'a' });
    expect(planOf(at(project, { group: 1 })).panel).toMatchObject({ variation: 'b', fillVariation: 'b' });
  });

  it('is the track the selector is on, once through, in the track modes, and says so when it is empty', () => {
    const project = newProject();
    for (const mode of ['track_play', 'track_write'] as const) {
      expect(planOf(at(project, { mode, selector: 0 }))).toMatchObject({ rhythms: [0, 1, 0, 3, 0, 1, 2, 3], loop: false });
      expect(exportPlan(at(project, { mode, selector: 5 }))).toEqual({ error: 'track 6 is empty.' });
    }
  });

  it('gives each instrument its General MIDI note, and an accented hit a higher velocity', () => {
    const plan = planOf(newProject());
    expect(plan.notes).toEqual([0, 36, 38, 45, 50, 49, 46, 42, 0, 0, 0, 0]);
    expect(plan.velocities).toEqual({ plain: 76, accented: 114 });
  });
});

describe('the 606 through the engine', () => {
  it('plays the selected pattern, every hit once, as a loop of one measure', () => {
    const project = newProject();
    for (const number of [0, 1, 4]) {
      const selected = at(project, selectionOf(number));
      const render = renderSong(wasm, engineSetup(selected), planOf(selected), RATE);
      expectFrames(render.left.length, beats(4, 126), `pattern ${number + 1}`);
      expect(render.events).toHaveLength(countHits(project.patterns[0]![number]!));
      expect(new Set(render.events.map((event) => event.pattern))).toEqual(new Set([bankIndex(number, 0)]));
      expect(render.events.every((event) => event.track >= 1 && event.track <= 7)).toBe(true);
      expect(rms(render.left)).toBeGreaterThan(0.02);
      expect(render.left.every(Number.isFinite)).toBe(true);
    }
  });

  it('accents exactly the steps of the accent row', () => {
    const project = newProject();
    const render = renderSong(wasm, engineSetup(project), planOf(project), RATE);
    const accented = new Set(render.events.filter((event) => event.accent).map((event) => event.step));
    const hit = new Set(render.events.map((event) => event.step));
    expect(accented).toEqual(new Set([0, 4, 8, 12].filter((step) => hit.has(step))));
    expect(accented.size).toBeGreaterThan(0);
  });

  it('plays a measure as long as its last step and its scale make it', () => {
    const project = newProject();
    const lengthOf = (number: number) => {
      const selected = at(project, selectionOf(number));
      return renderSong(wasm, engineSetup(selected), planOf(selected), RATE).left.length;
    };
    // Pattern 9: twelve steps at three to the beat. Pattern 10: sixteen at eight. Pattern 13: twelve at four.
    expectFrames(lengthOf(8), beats(4, 126));
    expectFrames(lengthOf(9), beats(2, 126));
    expectFrames(lengthOf(12), beats(3, 126));
  });

  it('plays a chain through, pattern after pattern, and a pattern of the other group when the button says so', () => {
    const project = at(newProject(), selectionOf(0, 3));
    const chain = renderSong(wasm, engineSetup(project), planOf(project), RATE);
    expectFrames(chain.left.length, beats(16, 126));
    const order = chain.events.map((event) => event.pattern).filter((pattern, index, all) => pattern !== all[index - 1]);
    expect(order).toEqual([0, 2, 4, 6]);

    const fixture = at(loadFixture(), { group: 1, ...selectionOf(0) });
    const other = renderSong(wasm, engineSetup(fixture), planOf(fixture), RATE);
    expect(new Set(other.events.map((event) => event.pattern))).toEqual(new Set([bankIndex(0, 1)]));
    // Fourteen steps at six to the beat.
    expectFrames(other.left.length, beats(14 / 6, fixture.tempo));
  });

  it('plays a track once through, bar by bar, and lets its last hits ring', () => {
    const project = at(newProject(), { mode: 'track_play' as Mode, selector: 1 });
    const plan = planOf(project);
    const render = renderSong(wasm, engineSetup(project), plan, RATE);
    expect(render.left.length).toBeGreaterThan(beats(16, 126));
    const hits = [4, 4, 4, 5].reduce((sum, number) => sum + countHits(project.patterns[0]![number]!), 0);
    expect(render.events).toHaveLength(hits);
    expect(wasm.songPatterns(plan.panel, plan.rhythms)).toEqual([8, 8, 8, 10]);
    // The same track in group II plays the patterns of group II, which the starter leaves empty.
    const inTwo = at(project, { group: 1 });
    expect(wasm.songPatterns(planOf(inTwo).panel, planOf(inTwo).rhythms)).toEqual([9, 9, 9, 11]);
    expect(renderSong(wasm, engineSetup(inTwo), planOf(inTwo), RATE).events).toHaveLength(0);
  });

  it('is silent with every level down, and the last four patterns play in their own group too', () => {
    const project = newProject();
    const down = { ...project, mix: { ...project.mix, levels: { ...project.mix.levels, bass_drum: 0, snare_drum: 0, toms: 0, cymbal: 0, hi_hat: 0 } } };
    expect(rms(renderSong(wasm, engineSetup(down), planOf(down), RATE).left)).toBe(0);
    // The engine reads rhythms 13 to 16 by its second variation switch; both stand on the group.
    for (const group of [0, 1] as const) {
      const last = at(project, { group, ...selectionOf(12, 15) });
      expect(wasm.songPatterns(planOf(last).panel, planOf(last).rhythms)).toEqual([12, 13, 14, 15].map((n) => bankIndex(n, group)));
    }
  });

  it('exports MIDI: a note for each instrument at its step, louder where accented', () => {
    const project = newProject();
    const plan = planOf(project);
    const midi = parseMidi(exportSongMidi(wasm, engineSetup(project), plan));
    expect(midi.ppq).toBe(480);
    expect(midi.tempoMicros).toBe(Math.floor(60_000_000 / 126 + 0.5));
    expect(midi.trackEnds).toEqual([1920, 1920]);
    const ons = midi.notes.filter((note) => note.on);
    expect(ons).toHaveLength(countHits(project.patterns[0]![0]!));
    expect(midi.notes.every((note) => note.channel === 10)).toBe(true);
    const kicks = ons.filter((note) => note.note === 36);
    expect(kicks.map((note) => note.tick)).toEqual([0, 6, 8, 10].map((step) => step * 120));
    expect(kicks.map((note) => note.velocity)).toEqual([114, 76, 114, 76]);

    // Triplets: three steps to the beat are 160 ticks apart, and the measure is still four beats.
    const triplets = at(project, selectionOf(8));
    const shuffled = parseMidi(exportSongMidi(wasm, engineSetup(triplets), planOf(triplets)));
    expect(shuffled.trackEnds).toEqual([1920, 1920]);
    expect(shuffled.notes.filter((note) => note.on).every((note) => note.tick % 160 === 0)).toBe(true);

    // A track is its bars one after another.
    const track = at(project, { mode: 'track_play' as Mode, selector: 1 });
    expect(parseMidi(exportSongMidi(wasm, engineSetup(track), planOf(track))).trackEnds).toEqual([7680, 7680]);
  });
});
