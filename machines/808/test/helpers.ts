import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProjectCodec } from '@boombapbot/contracts';
import { EditorStore, type MachineHost } from '@boombapbot/editor';
import { SnareWasm } from '@boombapbot/editor/engine';
import { document808, parseProject, type Project } from '../src/document';
import { RESTING, Session808, memoryOf, type Store808, type Transient808 } from '../src/session';

export { parseMidi, rms, type ParsedMidi } from '../../../core/packages/editor/test/helpers';

/** The 808's package: its data files and fixtures are what the native tool reads too. */
export const machinePath = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(machinePath, '../..');
const wasmPath = resolve(repoRoot, 'build/wasm/boombapbot-engine-808.wasm');
export const nativeRenderPath = resolve(repoRoot, 'build/native/boombapbot-render-808');

export function loadWasm(): SnareWasm {
  if (!existsSync(wasmPath)) throw new Error(`${wasmPath} is missing. Run "pnpm build:wasm" first.`);
  return SnareWasm.fromBytes(readFileSync(wasmPath));
}

export const fixturePath = resolve(machinePath, 'fixtures/mixed-rhythms.project.json');
export const legacyFixturePath = resolve(machinePath, 'fixtures/v1-kick-snare-hat.project.json');

export function loadFixture(): Project {
  const result = parseProject(JSON.parse(readFileSync(fixturePath, 'utf8')));
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.project;
}

export const codec = createProjectCodec([document808]);

/** A host with no audio, for driving the machine in tests. */
export function silentHost(store: Store808): MachineHost<Project, Transient808> {
  return {
    store,
    ensureAudio: async () => false,
    audioRunning: () => false,
    trigger: () => undefined,
    armFill: () => undefined,
    stop: () => undefined,
    stepStartedAt: () => 0,
  };
}

/** The fixture on an 808 with a clock that ticks a second at every reading. */
export function makeMachine(project: Project = loadFixture()): { store: Store808; session: Session808 } {
  let tick = 0;
  const store: Store808 = new EditorStore({
    project,
    memory: memoryOf,
    transient: RESTING,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, (tick += 1))),
  });
  return { store, session: new Session808(silentHost(store)) };
}
