#!/usr/bin/env node
// Runs one command for every machine, in turn, with MACHINE set to its id
// and {machine} in the command replaced by it. Stops at the first failure.
//
//   node scripts/each-machine.mjs pnpm build
//   node scripts/each-machine.mjs node machines/{machine}/art/draw-faceplate.mjs --check

import { spawnSync } from 'node:child_process';
import { MACHINES, root } from './machines.mjs';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('each-machine: give a command to run.');
  process.exit(1);
}

for (const machine of MACHINES) {
  console.log(`\n==> ${machine}`);
  const run = spawnSync(
    command,
    args.map((arg) => arg.replaceAll('{machine}', machine)),
    { cwd: root, stdio: 'inherit', env: { ...process.env, MACHINE: machine } },
  );
  if (run.error) throw run.error;
  if (run.status !== 0) process.exit(run.status ?? 1);
}
