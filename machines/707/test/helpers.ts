import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProjectCodec } from '@boombapbot/contracts';
import { EditorStore, type EngineMeasure, type MachineHost } from '@boombapbot/editor';
import { SnareWasm } from '@boombapbot/editor/engine';
import {
  createEmptyGroups,
  createEmptyTracks,
  createProject,
  document707,
  type Group,
  type Project,
  type RowId,
} from '../src/document';
import { RESTING, Session707, memoryOf, type Store707, type Transient707 } from '../src/session';

export { parseMidi, rms, type ParsedMidi } from '../../../core/packages/editor/test/helpers';

/** The 707's package. */
export const machinePath = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(machinePath, '../..');
const wasmPath = resolve(repoRoot, 'build/wasm/boombapbot-engine-707.wasm');
export const nativeRenderPath = resolve(repoRoot, 'build/native/boombapbot-render-707');

export function loadWasm(): SnareWasm {
  if (!existsSync(wasmPath)) throw new Error(`${wasmPath} is missing. Build the 707's WebAssembly engine first.`);
  return SnareWasm.fromBytes(readFileSync(wasmPath));
}

export const codec = createProjectCodec([document707]);

export const fixturePath = resolve(machinePath, 'fixtures/every-control.project.json');

/** The committed beat with something in both groups and every setting away from where a new project has it. */
export function loadFixture(): Project {
  const result = codec.parseText(readFileSync(fixturePath, 'utf8'));
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.project;
}

const NOW = new Date('2026-11-17T12:00:00.000Z');

/** A new project, with the starter beat. */
export function newProject(): Project {
  return createProject({ id: 'test-beat', now: NOW, name: 'Test beat' });
}

/** A project that remembers nothing. */
export function blankProject(): Project {
  return createProject({ id: 'test-beat', now: NOW, name: 'Test beat', groups: createEmptyGroups(), tracks: createEmptyTracks() });
}

/** A host that notes every hit it is asked to play and every time it is told to stop. */
export interface TestHost extends MachineHost<Project, Transient707> {
  triggered: number[];
  stops: number;
  /** Whether audio is running. */
  running: boolean;
  /** When the step now sounding began, on the clock a tap is placed by. */
  stepStarted: number;
}

export function testHost(store: Store707): TestHost {
  const host: TestHost = {
    store,
    triggered: [],
    stops: 0,
    running: true,
    stepStarted: 0,
    ensureAudio: async () => host.running,
    audioRunning: () => host.running,
    trigger: (track) => {
      host.triggered.push(track);
    },
    armFill: () => undefined,
    stop: () => {
      host.stops += 1;
      store.setPlaying(false);
    },
    stepStartedAt: () => host.stepStarted,
  };
  return host;
}

/** A 707 with a clock that ticks a second at every reading, watching its own store as the editor has it do. */
export function makeMachine(project: Project = newProject()) {
  let tick = 0;
  const store: Store707 = new EditorStore({
    project,
    memory: memoryOf,
    transient: RESTING,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, (tick += 1))),
  });
  const host = testHost(store);
  const session = new Session707(host);
  let previous = store.getState();
  store.subscribe(() => {
    const before = previous;
    previous = store.getState();
    session.changed(before, previous);
  });
  return { store, host, session };
}

export type Machine707 = ReturnType<typeof makeMachine>;

/** Starts the machine as the editor does, without audio. False when the machine would not start. */
export function play({ store, session }: Machine707): boolean {
  const plan = session.start();
  if (!plan) return false;
  store.setPlaying(true);
  session.started();
  return true;
}

export function stop({ store, session }: Machine707): void {
  store.setPlaying(false);
  session.stopped();
}

/** A measure as the engine reports one it began. */
export function measure(pattern: number, position = -1, ordinal = 1): EngineMeasure {
  return { frame: 0, ordinal, pattern, kind: 'basic', position };
}

export const rowOf = (store: Store707, row: RowId, pattern: number, group: Group = 'a'): string =>
  store.getState().project.groups[group][pattern]!.steps[row];

export const panelOf = (store: Store707) => store.getState().project.panel;
