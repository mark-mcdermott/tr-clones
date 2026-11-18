#!/usr/bin/env node
// Worst-case load on the WebAssembly engine: every track hits on every step of
// a 32-step measure of thirty-second notes at the fastest tempo, with every
// decay knob fully right, rendered in 128-frame blocks as an AudioWorklet
// would. Reports how much faster than real time it runs.
//
//   node scripts/bench-engine.mjs [seconds] [sampleRate]
//
// The result depends on the machine; it is a sanity check, not a guarantee
// for phones. Device baselines still have to be measured on devices.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seconds = Number(process.argv[2] ?? 60);
const sampleRate = Number(process.argv[3] ?? 48000);
const block = 128;

const module = new WebAssembly.Module(readFileSync(join(root, 'build/wasm/boombapbot-engine-808.wasm')));
const imports = {};
for (const entry of WebAssembly.Module.imports(module)) {
  (imports[entry.module] ??= {})[entry.name] = () => 0;
}
const x = new WebAssembly.Instance(module, imports).exports;
x._initialize?.();

const TRACKS = 12;
const SOUNDS = 16;
const engine = x.snare_engine_create(sampleRate);

// Every sound at its longest. A sound's number is also its slot.
const params = x.malloc(24);
for (let sound = 0; sound < SOUNDS; sound += 1) {
  const view = new DataView(x.memory.buffer);
  view.setInt32(params, sound, true);
  for (const offset of [4, 8, 16]) view.setFloat32(params + offset, 0.5, true);
  view.setFloat32(params + 12, 1, true);
  view.setUint32(params + 20, 0, true);
  if (x.snare_engine_synth_sound(engine, params) !== 0) throw new Error(`sound ${sound} was rejected`);
}

// No choke groups here: chokes free voices, and this run wants the pool busy.
for (let track = 1; track < TRACKS; track += 1) x.snare_engine_set_track(engine, track, track - 1, 0, 0);

const pattern = x.malloc(52);
const view = new DataView(x.memory.buffer);
for (let track = 0; track < TRACKS; track += 1) view.setUint32(pattern + track * 4, 0xffffffff, true);
view.setUint8(pattern + 48, 16);
view.setUint8(pattern + 49, 16);
view.setUint8(pattern + 50, 8);
view.setUint8(pattern + 51, 0);
if (x.snare_engine_set_pattern(engine, 0, pattern) !== 0) throw new Error('the pattern was rejected');
x.snare_engine_set_tempo(engine, 300);
x.snare_engine_play(engine);

const left = x.malloc(block * 4);
const right = x.malloc(block * 4);
const blocks = Math.ceil((seconds * sampleRate) / block);
let peakVoices = 0;
let worstBlockMs = 0;
const started = performance.now();
for (let i = 0; i < blocks; i += 1) {
  const before = performance.now();
  x.snare_engine_render(engine, left, right, block);
  worstBlockMs = Math.max(worstBlockMs, performance.now() - before);
  peakVoices = Math.max(peakVoices, x.snare_engine_active_voices(engine));
}
const elapsed = (performance.now() - started) / 1000;
const out = new Float32Array(x.memory.buffer, left, block);
const finite = out.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1);

const blockMs = (block / sampleRate) * 1000;
console.log(`rendered ${seconds}s at ${sampleRate} Hz in ${elapsed.toFixed(2)}s`);
console.log(`  ${(seconds / elapsed).toFixed(0)}x real time, ${((elapsed / seconds) * 100).toFixed(2)}% of one core`);
console.log(`  slowest ${block}-frame block ${worstBlockMs.toFixed(3)} ms of a ${blockMs.toFixed(2)} ms budget`);
console.log(`  peak voices ${peakVoices} of 64, stolen ${x.snare_engine_stolen_voices(engine)}`);
console.log(`  output finite and within [-1, 1]: ${finite}`);
if (!finite) process.exit(1);
