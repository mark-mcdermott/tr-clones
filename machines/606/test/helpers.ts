import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProjectCodec } from '@boombapbot/contracts';
import { EditorStore, type KeyValueStorage, type MachineHost } from '@boombapbot/editor';
import { SnareWasm } from '@boombapbot/editor/engine';
import { TRACK_IDS, createProject, document606, type Group, type Project, type TrackId } from '../src/document';
import { RESTING, Session606, memoryOf, type Store606, type Transient606 } from '../src/session';

export { parseMidi, rms } from '../../../core/packages/editor/test/helpers';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const wasmPath = resolve(repoRoot, 'build/wasm/boombapbot-engine-606.wasm');
/** The core's render tool built with the 606's voices: what the WebAssembly build is compared with. */
export const nativeRenderPath = resolve(repoRoot, 'build/native/boombapbot-render-606');

export function loadWasm(): SnareWasm {
  if (!existsSync(wasmPath)) throw new Error(`${wasmPath} is missing. Build the WebAssembly engine for the 606 first.`);
  return SnareWasm.fromBytes(readFileSync(wasmPath));
}

export const codec = createProjectCodec([document606]);

export const fixturePath = fileURLToPath(new URL('../fixtures/two-groups.project.json', import.meta.url));

/** The committed beat: something in both groups, at every scale, with every setting away from its default. */
export function loadFixture(): Project {
  const result = codec.parseText(readFileSync(fixturePath, 'utf8'));
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.project;
}

/** A new project, as the page opens on one: the starter beat, stopped in pattern write. */
export function newProject(): Project {
  return createProject({ id: 'test-beat', now: new Date('2026-11-17T12:00:00.000Z'), name: 'Test beat', bpm: 126 });
}

/** Storage that lives for one test, and can be told to refuse writes. */
export class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota exceeded');
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** A host with no audio that notes every hit it is asked to play and every time it is told to stop. */
export interface TestHost extends MachineHost<Project, Transient606> {
  triggered: number[];
  stops: number;
  /** When the step now sounding began, on the clock a tap is placed by. */
  stepStarted: number;
}

export function testHost(store: Store606): TestHost {
  const host: TestHost = {
    store,
    triggered: [],
    stops: 0,
    stepStarted: 0,
    ensureAudio: async () => true,
    audioRunning: () => true,
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

/** A 606 with a clock that ticks a second at every reading. */
export function makeMachine(project: Project = newProject()) {
  let tick = 0;
  const store: Store606 = new EditorStore({
    project,
    memory: memoryOf,
    transient: RESTING,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, (tick += 1))),
  });
  const host = testHost(store);
  const session = new Session606(host);
  /** Presses RUN/STOP as the runtime does: the machine is asked what to play, and says when it stops. */
  const run = () => {
    const plan = session.start();
    if (plan) store.setPlaying(true);
    return plan;
  };
  const stop = () => {
    store.setPlaying(false);
    session.stopped();
  };
  /** The engine reports a step of a pattern of the bank. */
  const at = (step: number, pattern: number) => store.setPosition(step, pattern);
  return { store, host, session, run, stop, at };
}

/** A row of a pattern of the project a store holds. */
export function rowOf(store: Store606, track: TrackId, pattern: number, group: Group = store.getState().project.panel.group): string {
  return store.getState().project.patterns[group]![pattern]!.steps[track];
}

/** The steps that are on in a row. */
export function stepsOn(row: string): number[] {
  return [...row].flatMap((mark, index) => (mark === 'x' ? [index] : []));
}

export const selectorOf = (track: TrackId): number => TRACK_IDS.indexOf(track);
