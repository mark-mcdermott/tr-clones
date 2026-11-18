import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applySetup, decodeWav, encodeWav, exportSongMidi, type EngineSetup } from '@boombapbot/editor/engine';
import { bankIndex, selectionOf, type Group } from '../src/document';
import { engineSetup, exportPlan } from '../src/engine';
import { loadFixture, loadWasm, nativeRenderPath } from './helpers';

// The 606 through the engine built natively and the one built to
// WebAssembly. Both are given the same setup and asked for the same
// measures; what comes out must agree.

const wasm = loadWasm();
const built = existsSync(nativeRenderPath);
if (!built) console.warn(`skipped: ${nativeRenderPath} is missing. Build the native engine for the 606 first.`);

const RATE = 44100;
const BLOCK = 1024;
const MEASURES = 2;
/** The most the two builds may differ by, in steps of 24-bit audio. */
const STEPS_24_BIT = 2;

const fixture = loadFixture();
const setup = engineSetup(fixture);

/** Patterns of the fixture at each of the four scales, and its shortest: [number, group]. */
const PATTERNS: Array<[number, Group]> = [
  [0, 0],
  [1, 0],
  [8, 0],
  [0, 1],
  [6, 1],
  [15, 1],
];

interface Played {
  left: Float32Array;
  right: Float32Array;
  events: Array<{ frame: number; step: number; track: number; accent: boolean; pattern: number }>;
}

/** Measures of a pattern, from silence, through the WebAssembly engine. */
function throughWasm(from: EngineSetup, pattern: number): Played {
  const engine = wasm.createEngine(RATE, BLOCK);
  try {
    engine.enableEventLog(8192);
    applySetup(engine, from);
    const frames = wasm.tickFrame(MEASURES * wasm.patternTicks(from.patterns[pattern]!), from.tempo, RATE);
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
function throughNative(from: EngineSetup, pattern: number, midi?: { notes: number[]; plain: number; accented: number }) {
  const dir = mkdtempSync(join(tmpdir(), 'tr-clones-606-'));
  const run = join(dir, 'run.json');
  const wav = join(dir, 'measures.wav');
  const events = join(dir, 'events.json');
  const midiFile = join(dir, 'beat.mid');
  writeFileSync(run, JSON.stringify({ rate: RATE, setup: from, pattern, measures: midi ? 1 : MEASURES, midi }));
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

describe.skipIf(!built)('the 606, native against WebAssembly', () => {
  it('plays patterns of both groups and all four scales on the same frames and to the same samples', () => {
    for (const [number, group] of PATTERNS) {
      const pattern = bankIndex(number, group);
      const what = `pattern ${number + 1} of group ${group + 1}`;
      const played = throughWasm(setup, pattern);
      const native = throughNative(setup, pattern);
      expect(played.events.length, what).toBeGreaterThan(0);
      expect(native.events, what).toEqual(played.events);
      expect(worstSteps(native.audio.pcm, played), what).toBeLessThanOrEqual(STEPS_24_BIT);
    }
  });

  it('agrees with every level and the volume turned up, and with the accent turned off', () => {
    const loud = { ...fixture.mix.levels, bass_drum: 1, snare_drum: 1, toms: 1, cymbal: 1, hi_hat: 1 };
    for (const mix of [{ volume: 1, levels: loud }, { volume: 0.3, levels: { ...fixture.mix.levels, accent: 0 } }]) {
      const turned = engineSetup({ ...fixture, mix });
      const played = throughWasm(turned, 2);
      const native = throughNative(turned, 2);
      const what = JSON.stringify(mix);
      expect(native.events, what).toEqual(played.events);
      expect(worstSteps(native.audio.pcm, played), what).toBeLessThanOrEqual(STEPS_24_BIT);
    }
  });

  it('writes the same MIDI file, byte for byte', () => {
    for (const [number, group] of PATTERNS) {
      const project = { ...fixture, panel: { ...fixture.panel, group, ...selectionOf(number) } };
      const plan = exportPlan(project);
      if ('error' in plan) throw new Error(plan.error);
      const native = throughNative(engineSetup(project), bankIndex(number, group), { notes: plan.notes, ...plan.velocities });
      const exported = exportSongMidi(wasm, engineSetup(project), plan);
      expect(Buffer.from(exported).equals(native.midi!), `pattern ${number + 1} of group ${group + 1}`).toBe(true);
    }
  });
});
