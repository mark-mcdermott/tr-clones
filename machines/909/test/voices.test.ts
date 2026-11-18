import { describe, expect, it } from 'vitest';
import type { SynthSound } from '@boombapbot/editor/engine';
import { INSTRUMENTS, KNOB_IDS, createDefaultKnobs, type KnobId } from '../src/document';
import { synthSound } from '../src/engine';
import { loadWasm, rms } from './helpers';

const wasm = loadWasm();
const RATE = 48000;

function settings(sound: number, knob = 0.5): SynthSound {
  return { sound, tune: knob, tone: knob, decay: knob, snappy: knob };
}

describe('the voices, through the WebAssembly engine', () => {
  it('renders all eleven, audible, bounded and ending in silence, and no twelfth', () => {
    for (const instrument of INSTRUMENTS) {
      const pcm = wasm.synthesise(settings(instrument.index - 1), RATE);
      expect(pcm.length, instrument.id).toBeGreaterThan(RATE * 0.05);
      expect(pcm.every(Number.isFinite), instrument.id).toBe(true);
      const peak = pcm.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
      expect(peak, instrument.id).toBeGreaterThan(0.2);
      expect(peak, instrument.id).toBeLessThanOrEqual(1);
      expect(Math.abs(pcm[pcm.length - 1]!), instrument.id).toBe(0);
    }
    expect(() => wasm.synthesise(settings(INSTRUMENTS.length), RATE)).toThrow(/could not be synthesised/);
  });

  it('is deterministic', () => {
    expect(wasm.synthesise(settings(0), 44100)).toEqual(wasm.synthesise(settings(0), 44100));
  });

  it('shapes each sound with the knobs of its own column and with no other knob', () => {
    const rest = createDefaultKnobs();
    const plain = INSTRUMENTS.map((instrument) => wasm.synthesise(synthSound(instrument, rest), RATE));
    plain.forEach((pcm, index) => expect(rms(pcm), INSTRUMENTS[index]!.id).toBeGreaterThan(0.01));
    for (const id of KNOB_IDS) {
      const turned = { ...rest, [id]: 0.9 } as Record<KnobId, number>;
      INSTRUMENTS.forEach((instrument, index) => {
        const changed = wasm.synthesise(synthSound(instrument, turned), RATE);
        const own = Object.values(instrument.sound).includes(id);
        const same = changed.length === plain[index]!.length && changed.every((sample, i) => sample === plain[index]![i]);
        expect(same, `${id} on the ${instrument.label}`).toBe(!own);
      });
    }
  });

  it('makes the bass drum and the open hat longer with DECAY, and the snare with TONE', () => {
    const length = (id: KnobId, value: number, sound: number) =>
      wasm.synthesise(synthSound(INSTRUMENTS[sound]!, { ...createDefaultKnobs(), [id]: value }), RATE).length;
    expect(length('bass_drum_decay', 1, 0)).toBeGreaterThan(length('bass_drum_decay', 0, 0) * 2);
    expect(length('open_hat_decay', 1, 8)).toBeGreaterThan(length('open_hat_decay', 0, 8) * 2);
    expect(length('snare_drum_tone', 1, 1)).toBeGreaterThan(length('snare_drum_tone', 0, 1) * 2);
    // The closed hat is the short one of the two, wherever its own knob stands.
    expect(length('closed_hat_decay', 1, 7)).toBeLessThan(length('open_hat_decay', 0, 8));
  });
});
