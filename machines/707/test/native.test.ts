import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applySetup, decodeWav, encodeWav, exportSongMidi, type EngineSetup } from '@boombapbot/editor/engine';
import { patternIndex, type Project } from '../src/document';
import { engineSetup, exportPlan } from '../src/engine';
import { loadFixture, loadWasm, nativeRenderPath } from './helpers';

// The 707 through the engine built natively and the one built to
// WebAssembly. Both are given the same setup and asked for the same
// measures; what comes out must agree.

const wasm = loadWasm();
const built = existsSync(nativeRenderPath);
if (!built) console.warn(`skipped: ${nativeRenderPath} is missing. Build the 707's native engine first.`);

const RATE = 44100;
const BLOCK = 1024;
const MEASURES = 2;
/** The most the two builds may differ by, in steps of 24-bit audio. */
const STEPS_APART = 2;

const fixture = loadFixture();
/** Every pattern of the fixture that holds anything, by its place in the bank. */
const WRITTEN = [
  patternIndex('a', 0),
  patternIndex('a', 1),
  patternIndex('a', 2),
  patternIndex('a', 3),
  patternIndex('a', 4),
  patternIndex('a', 6),
  patternIndex('b', 0),
  patternIndex('b', 1),
];

interface Played {
  left: Float32Array;
  right: Float32Array;
  events: Array<{ frame: number; step: number; track: number; accent: boolean; pattern: number }>;
}

/** Measures of a pattern, from silence, through the WebAssembly engine. */
function throughWasm(setup: EngineSetup, pattern: number): Played {
  const engine = wasm.createEngine(RATE, BLOCK);
  try {
    engine.enableEventLog(8192);
    applySetup(engine, setup);
    const frames = wasm.tickFrame(MEASURES * wasm.patternTicks(setup.patterns[pattern]!), setup.tempo, RATE);
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    engine.cuePattern(pattern);
    engine.playMeasures(MEASURES);
    for (let done = 0; done < frames; done += BLOCK) {
      const count = Math.min(BLOCK, frames - done);
      engine.render(left.subarray(done, done + count), right.subarray(done, done + count), count);
    }
    return { left, right, events: engine.readEvents() };
  } finally {
    engine.destroy();
  }
}

/** The same measures through the native engine, by its render tool. */
function throughNative(setup: EngineSetup, pattern: number, midi?: { notes: number[]; plain: number; accented: number }) {
  const dir = mkdtempSync(join(tmpdir(), 'tr-clones-707-'));
  const run = join(dir, 'run.json');
  const wav = join(dir, 'measures.wav');
  const events = join(dir, 'events.json');
  const midiFile = join(dir, 'beat.mid');
  writeFileSync(run, JSON.stringify({ rate: RATE, setup, pattern, measures: midi ? 1 : MEASURES, midi }));
  execFileSync(nativeRenderPath, ['--setup', run, '--out', wav, '--events', events, ...(midi ? ['--midi', midiFile] : [])]);
  return {
    audio: decodeWav(new Uint8Array(readFileSync(wav)).buffer as ArrayBuffer),
    events: (JSON.parse(readFileSync(events, 'utf8')) as Array<Omit<Played['events'][number], 'accent'> & { accent: number }>).map(
      (event) => ({ ...event, accent: event.accent !== 0 }),
    ),
    midi: midi ? readFileSync(midiFile) : null,
  };
}

/** The most two renders differ by, in steps of 24-bit audio. */
function worstSteps(native: Float32Array, played: Played): number {
  const encoded = decodeWav(encodeWav(played.left, played.right, RATE, 24).buffer as ArrayBuffer);
  expect(native.length).toBe(encoded.pcm.length);
  let worst = 0;
  for (let i = 0; i < native.length; i += 1) worst = Math.max(worst, Math.abs(native[i]! - encoded.pcm[i]!));
  return worst * 8388608;
}

describe.skipIf(!built)('the 707, native against WebAssembly', () => {
  it('plays every written pattern of the fixture on the same frames and to the same samples', () => {
    const setup = engineSetup(fixture);
    for (const pattern of WRITTEN) {
      const played = throughWasm(setup, pattern);
      const native = throughNative(setup, pattern);
      expect(played.events.length, `pattern ${pattern}`).toBeGreaterThan(0);
      expect(native.events, `pattern ${pattern}`).toEqual(played.events);
      expect(worstSteps(native.audio.pcm, played), `pattern ${pattern}`).toBeLessThanOrEqual(STEPS_APART);
    }
  });

  it('agrees straight and shuffled as far as it goes', () => {
    const straight = throughWasm(engineSetup({ ...fixture, shuffle: 0 }), 0);
    for (const shuffle of [0, 1, 4] as const) {
      const setup = engineSetup({ ...fixture, shuffle });
      const played = throughWasm(setup, 0);
      const native = throughNative(setup, 0);
      expect(native.events, `shuffle ${shuffle}`).toEqual(played.events);
      expect(worstSteps(native.audio.pcm, played), `shuffle ${shuffle}`).toBeLessThanOrEqual(STEPS_APART);
      const sameFrames = played.events.every((event, index) => event.frame === straight.events[index]!.frame);
      expect(sameFrames, `shuffle ${shuffle}`).toBe(shuffle === 0);
    }
  });

  it('agrees with the other sound of every pair chosen, and with the faders moved', () => {
    const other: Project = {
      ...fixture,
      sounds: { bass_drum: 'bass_drum_1', snare_drum: 'snare_drum_2', rim_cowbell: 'rim_shot', clap_tambourine: 'hand_clap' },
      mix: { ...fixture.mix, volume: 0.6, accent: 1, levels: { ...fixture.mix.levels, hi_hat: 1, bass_drum: 0.4 } },
    };
    const setup = engineSetup(other);
    for (const pattern of [patternIndex('a', 1), patternIndex('a', 2)]) {
      const played = throughWasm(setup, pattern);
      const native = throughNative(setup, pattern);
      expect(native.events, `pattern ${pattern}`).toEqual(played.events);
      expect(worstSteps(native.audio.pcm, played), `pattern ${pattern}`).toBeLessThanOrEqual(STEPS_APART);
      expect(played.left, `pattern ${pattern}`).not.toEqual(throughWasm(engineSetup(fixture), pattern).left);
    }
  });

  it('writes the same MIDI file, byte for byte', () => {
    for (const [group, pattern] of [['a', 0], ['a', 6], ['b', 1]] as const) {
      const project: Project = { ...fixture, panel: { ...fixture.panel, mode: 'pattern_step', group, pattern, chain: null } };
      const plan = exportPlan(project);
      if ('error' in plan) throw new Error(plan.error);
      const index = patternIndex(group, pattern);
      const native = throughNative(engineSetup(project), index, { notes: plan.notes, ...plan.velocities });
      const exported = exportSongMidi(wasm, engineSetup(project), plan);
      expect(Buffer.from(exported).equals(native.midi!), `pattern ${group}${pattern}`).toBe(true);
    }
  });
});
