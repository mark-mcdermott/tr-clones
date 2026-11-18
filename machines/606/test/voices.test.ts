import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SynthSound } from '@boombapbot/editor/engine';
import { INSTRUMENTS } from '../src/document';
import { loadWasm, nativeRenderPath, rms } from './helpers';

const wasm = loadWasm();
const VOICES = INSTRUMENTS.length;
/** One step of 24-bit audio: the most a sound may differ between builds. */
const STEP_24_BIT = 1 / 8388608;

/** A voice with the engine's four knobs all at one position. */
function settings(sound: number, knob = 0.5): SynthSound {
  return { sound, tune: knob, tone: knob, decay: knob, snappy: knob };
}

describe('the voices of the 606', () => {
  it('has one for each instrument, each audible, bounded and ending in silence', () => {
    expect(VOICES).toBe(7);
    for (let sound = 0; sound < VOICES; sound += 1) {
      const pcm = wasm.synthesise(settings(sound), 48000);
      expect(pcm.every(Number.isFinite)).toBe(true);
      const peak = pcm.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
      expect(peak).toBeGreaterThan(0.2);
      expect(peak).toBeLessThanOrEqual(1);
      expect(rms(pcm)).toBeGreaterThan(0);
      expect(Math.abs(pcm[pcm.length - 1]!)).toBe(0);
    }
    expect(() => wasm.synthesise(settings(VOICES), 48000)).toThrow(/could not be synthesised/);
  });

  it('is deterministic, and no knob changes a sound, because the machine has none that could', () => {
    for (let sound = 0; sound < VOICES; sound += 1) {
      const first = wasm.synthesise(settings(sound), 44100);
      expect(wasm.synthesise(settings(sound), 44100)).toEqual(first);
      expect(wasm.synthesise(settings(sound, 0), 44100)).toEqual(first);
      expect(wasm.synthesise(settings(sound, 1), 44100)).toEqual(first);
    }
  });

  it('keeps the closed hat far shorter than the open one, and both shorter than the cymbal', () => {
    const seconds = INSTRUMENTS.map((_, sound) => wasm.synthesise(settings(sound), 48000).length / 48000);
    const of = (id: string) => seconds[INSTRUMENTS.findIndex((instrument) => instrument.id === id)]!;
    expect(of('closed_hat') * 4).toBeLessThan(of('open_hat'));
    expect(of('open_hat') * 2).toBeLessThan(of('cymbal'));
    expect(Math.max(...seconds)).toBeLessThan(2.5);
  });

  it('matches the native build, voice by voice', () => {
    if (!existsSync(nativeRenderPath)) {
      console.warn(`skipped: ${nativeRenderPath} is missing. Build the native engine for the 606 first.`);
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'tr-clones-606-'));
    for (const rate of [44100, 48000]) {
      for (let sound = 0; sound < VOICES; sound += 1) {
        const file = join(dir, `${sound}-${rate}.f32`);
        execFileSync(nativeRenderPath, ['--synth', String(sound), '--raw', file, '--rate', String(rate)]);
        const bytes = readFileSync(file);
        const native = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        const fromWasm = wasm.synthesise(settings(sound), rate);
        expect(fromWasm.length, `voice ${sound} length`).toBe(native.length);
        let worst = 0;
        for (let i = 0; i < native.length; i += 1) worst = Math.max(worst, Math.abs(native[i]! - fromWasm[i]!));
        expect(worst, `voice ${sound} at ${rate} Hz`).toBeLessThanOrEqual(STEP_24_BIT);
      }
    }
  });
});
