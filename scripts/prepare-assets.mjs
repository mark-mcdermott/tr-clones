#!/usr/bin/env node
// Puts the engine, the worklet and the machine's panel image where the host
// page can serve them, and writes the manifest the editor reads to find them.
//
//   node scripts/prepare-assets.mjs          the 808
//   MACHINE=<id> node scripts/prepare-assets.mjs
//
// Each machine gets a folder of its own, apps/host/public/<id>, so the pages
// of several machines can be built and served side by side. The editor is the
// core's, so what is written there is exactly what the core's own script of
// the same name writes for its site.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chosenMachine, root } from './machines.mjs';

function fail(message) {
  console.error(`prepare-assets: ${message}`);
  process.exit(1);
}

let machine;
try {
  machine = chosenMachine();
} catch (error) {
  fail(error.message);
}
const publicDir = join(root, 'apps/host/public', machine);
const machineDir = join(root, 'machines', machine);

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 10);

// ---- Engine ----------------------------------------------------------------

const wasmSource = join(root, `build/wasm/boombapbot-engine-${machine}.wasm`);
if (!existsSync(wasmSource)) fail(`build/wasm/boombapbot-engine-${machine}.wasm is missing. Run pnpm build:wasm.`);

const engineDir = join(publicDir, 'engine');
rmSync(engineDir, { recursive: true, force: true });
mkdirSync(engineDir, { recursive: true });

const wasmBytes = readFileSync(wasmSource);
const wasmName = `boombapbot-engine-${machine}.${hash(wasmBytes)}.wasm`;
writeFileSync(join(engineDir, wasmName), wasmBytes);

// The worklet is bundled on its own: an AudioWorklet module cannot share the
// page's bundle, and it must not depend on the DOM or the network.
const worklet = await build({
  entryPoints: [join(root, 'core/packages/editor/src/engine/worklet/processor.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'none',
});
const workletBytes = worklet.outputFiles[0].contents;
const workletName = `boombapbot-worklet.${hash(workletBytes)}.js`;
writeFileSync(join(engineDir, workletName), workletBytes);

// ---- Faceplate ---------------------------------------------------------------
//
// Only the image committed in the machine's art folder is used.

const faceplateDir = join(publicDir, 'faceplates');
rmSync(faceplateDir, { recursive: true, force: true });
const panel = JSON.parse(readFileSync(join(machineDir, 'data', `${machine}.panel.json`), 'utf8'));
const source = join(machineDir, 'art', panel.faceplate.file);
let faceplate = null;
if (existsSync(source)) {
  mkdirSync(faceplateDir, { recursive: true });
  cpSync(source, join(faceplateDir, panel.faceplate.file));
  faceplate = `faceplates/${panel.faceplate.file}`;
}

// ---- Manifest --------------------------------------------------------------

const manifest = { machine, engine: { worklet: `engine/${workletName}`, wasm: `engine/${wasmName}` }, faceplate };
writeFileSync(join(publicDir, 'boombapbot-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `prepare-assets: machine ${machine}, engine ${wasmName} (${wasmBytes.length} bytes), worklet ${workletName} ` +
    `(${workletBytes.length} bytes), ${faceplate ? `faceplate ${panel.faceplate.file}` : 'no faceplate'}`,
);
