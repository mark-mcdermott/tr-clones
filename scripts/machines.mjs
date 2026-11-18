// The machines in this repository: every folder of machines/ that is a
// package. A machine's folder name is its id.

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The machine a build, a page or a test run is for when MACHINE names none. */
export const DEFAULT_MACHINE = '808';

export const MACHINES = readdirSync(join(root, 'machines'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(root, 'machines', entry.name, 'package.json')))
  .map((entry) => entry.name)
  .sort();

/** The machine MACHINE names, or the default. Throws for one that is not here. */
export function chosenMachine(env = process.env) {
  const machine = env.MACHINE ?? DEFAULT_MACHINE;
  if (!MACHINES.includes(machine)) {
    throw new Error(`MACHINE=${machine} is not a machine here. There is ${MACHINES.join(', ')}.`);
  }
  return machine;
}
