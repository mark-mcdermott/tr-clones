import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applySetup, decodeWav, encodeWav, exportSongMidi, type EngineSetup, type SynthSound } from '@boombapbot/editor/engine';
import { INSTRUMENTS, isEmptyPattern, patternIndex } from '../src/document';
import { engineSetup, midiVelocities, trackNotes } from '../src/engine';
import { loadFixture, loadWasm, nativeRenderPath } from './helpers';

// The 909 through the engine built natively and the one built to
// WebAssembly. Both are given the same setup and asked for the same
// measures; what comes out must agree.

const wasm = loadWasm();
const built = existsSync(nativeRenderPath);
if (!built) console.warn(`skipped: ${nativeRenderPath} is missing. Build the native engine first.`);

const RATE = 44100;
const BLOCK = 1024;
const MEASURES = 2;
/** The most the two builds may differ by, in steps of 24-bit audio. */
const STEPS_24_BIT = 2;
/** One step of 24-bit audio: the most a single sound may differ. */
const STEP_24_BIT = 1 / 8388608;

const fixture = loadFixture();
const setup = engineSetup(fixture);
/** Every pattern of the fixture with something in it, by its place in the engine's bank. */
const WRITTEN = fixture.patterns.flatMap((group, g) =>
  group.flatMap((pattern, number) => (isEmptyPattern(pattern) ? [] : [patternIndex(g, number)])),
);

interface Played {
  left: Float32Array;
  right: Float32Array;
  events: Array<{ frame: number; step: number; track: number; accent: boolean; pattern: number }>;
}

/** Measures of a pattern, from silence, through the WebAssembly engine. */
function throughWasm(pattern: number): Played {
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
function throughNative(pattern: number, midi?: { notes: number[]; plain: number; accented: number }) {
  const dir = mkdtempSync(join(tmpdir(), 'tr-clones-909-'));
  const run = join(dir, 'run.json');
  const wav = join(dir, 'measures.wav');
  const events = join(dir, 'events.json');
  const midiFile = join(dir, 'beat.mid');
  const asked: { rate: number; setup: EngineSetup; pattern: number; measures: number; midi?: typeof midi } = {
    rate: RATE,
    setup,
    pattern,
    measures: midi ? 1 : MEASURES,
    midi,
  };
  writeFileSync(run, JSON.stringify(asked));
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

describe.skipIf(!built)('the 909, native against WebAssembly', () => {
  it('plays every written pattern on the same frames and to the same samples', () => {
    expect(WRITTEN.length).toBeGreaterThan(6);
    for (const pattern of WRITTEN) {
      const played = throughWasm(pattern);
      const native = throughNative(pattern);
      expect(played.events.length, `pattern ${pattern}`).toBeGreaterThan(0);
      expect(native.events, `pattern ${pattern}`).toEqual(played.events);
      expect(worstSteps(native.audio.pcm, played), `pattern ${pattern}`).toBeLessThanOrEqual(STEPS_24_BIT);
    }
  });

  it('agrees on where a shuffle puts the steps', () => {
    // Pattern 2 of group 1 is shuffled a quarter of a step, and has a hit on step 8, an off step.
    const pattern = patternIndex(0, 1);
    const offStep = (events: Played['events']) => events.find((event) => event.step === 7)!.frame;
    const step = wasm.tickFrame(wasm.patternTicks(setup.patterns[pattern]!), setup.tempo, RATE) / 16;
    const native = offStep(throughNative(pattern).events);
    expect(native).toBe(offStep(throughWasm(pattern).events));
    expect(Math.abs(native - 7.25 * step)).toBeLessThanOrEqual(1);
  });

  it('writes the same MIDI file, byte for byte', () => {
    const notes = trackNotes();
    const velocities = midiVelocities(fixture.knobs);
    for (const pattern of WRITTEN) {
      const native = throughNative(pattern, { notes, ...velocities });
      const exported = exportSongMidi(wasm, setup, { pattern, loop: true, notes, velocities });
      expect(Buffer.from(exported).equals(native.midi!), `pattern ${pattern}`).toBe(true);
    }
  });

  it('synthesises every voice the same, to one step of 24-bit audio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tr-clones-909-voices-'));
    for (const rate of [44100, 48000]) {
      for (const instrument of INSTRUMENTS) {
        for (const knob of [0.2, 0.8]) {
          const sound: SynthSound = { sound: instrument.index - 1, tune: knob, tone: knob, decay: knob, snappy: knob };
          const file = join(dir, `${sound.sound}-${rate}-${knob}.f32`);
          execFileSync(nativeRenderPath, [
            '--synth', String(sound.sound), '--raw', file, '--rate', String(rate),
            '--tune', String(knob), '--tone', String(knob), '--decay', String(knob), '--snappy', String(knob),
          ]);
          const bytes = readFileSync(file);
          const native = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
          const web = wasm.synthesise(sound, rate);
          const what = `${instrument.id} at ${rate} Hz, knobs ${knob}`;
          expect(web.length, what).toBe(native.length);
          let worst = 0;
          for (let i = 0; i < native.length; i += 1) worst = Math.max(worst, Math.abs(native[i]! - web[i]!));
          expect(worst, what).toBeLessThanOrEqual(STEP_24_BIT);
        }
      }
    }
  });
});
