import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProjectCodec } from '@boombapbot/contracts';
import { EditorStore, type MachineHost } from '@boombapbot/editor';
import { SnareWasm } from '@boombapbot/editor/engine';
import { createProject, document909, type Group, type Pattern, type Project, type TrackId } from '../src/document';
import { RESTING, Session909, memoryOf, type Store909, type Transient909 } from '../src/session';

export { parseMidi, rms, type ParsedMidi } from '../../../core/packages/editor/test/helpers';

/** The 909's package: its data files and fixtures. */
export const machinePath = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(machinePath, '../..');
const wasmPath = resolve(repoRoot, 'build/wasm/boombapbot-engine-909.wasm');
export const nativeRenderPath = resolve(repoRoot, 'build/native/boombapbot-render-909');
export const fixturePath = resolve(machinePath, 'fixtures/two-groups.project.json');

export const codec = createProjectCodec([document909]);

export function loadWasm(): SnareWasm {
  if (!existsSync(wasmPath)) throw new Error(`${wasmPath} is missing. Build the engine to WebAssembly first.`);
  return SnareWasm.fromBytes(readFileSync(wasmPath));
}

/** The committed beat with something in both groups and every setting away from its default. */
export function loadFixture(): Project {
  const result = codec.parseText(readFileSync(fixturePath, 'utf8'));
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.project;
}

/** A new machine with the starter patterns, as the page opens on. */
export function newProject(): Project {
  return createProject({ id: 'test-beat', now: new Date('2026-11-17T12:00:00.000Z'), name: 'Test beat' });
}

/** A host with no audio that notes every hit it is asked to play and every time it is told to stop. */
export interface TestHost extends MachineHost<Project, Transient909> {
  triggered: number[];
  stops: number;
  /** How far into the sounding step a tap falls, in seconds. */
  sinceStep: number;
}

/**
 * A 909 with a clock that ticks a second at every reading, wired as the
 * runtime wires one: the session hears of every change to the store, and a
 * stop it asks for stops the machine.
 */
export function makeMachine(project: Project = newProject()) {
  let tick = 0;
  const store: Store909 = new EditorStore({
    project,
    memory: memoryOf,
    transient: RESTING,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, (tick += 1))),
  });
  const host: TestHost = {
    store,
    triggered: [],
    stops: 0,
    sinceStep: 0,
    ensureAudio: async () => true,
    audioRunning: () => true,
    trigger: (track) => {
      host.triggered.push(track);
    },
    armFill: () => undefined,
    stop: () => {
      host.stops += 1;
      store.setPlaying(false);
      session.stopped();
    },
    stepStartedAt: () => performance.now() - host.sinceStep * 1000,
  };
  const session = new Session909(host);
  let previous = store.getState();
  store.subscribe(() => {
    const before = previous;
    previous = store.getState();
    session.changed(before, previous);
  });
  /** Starts the machine as the runtime does, without audio. False when the session refused. */
  const start = (): boolean => {
    if (!session.start()) return false;
    store.setPlaying(true);
    return true;
  };
  /** Reports the step and pattern the engine is on. */
  const at = (step: number, pattern = 0): void => store.setPosition(step, pattern);
  return { store, host, session, start, at };
}

export const panelOf = (store: Store909) => store.getState().project.panel;

/** A pattern of a group, as the store holds it now. */
export const patternOf = (store: Store909, number = panelOf(store).pattern, group: Group = panelOf(store).group): Pattern =>
  store.getState().project.patterns[group]![number]!;

/** The steps that are on in one row of a pattern. */
export const stepsOn = (pattern: Pattern, track: TrackId): number[] =>
  [...pattern.steps[track]].flatMap((mark, index) => (mark === 'x' ? [index] : []));
