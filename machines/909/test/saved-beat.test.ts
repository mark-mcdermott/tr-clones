import { describe, expect, it } from 'vitest';
import { EditorRuntime } from '@boombapbot/editor';
import { machine909 } from '../src';
import { loadFixture } from './helpers';

describe('loading a saved beat onto the machine', () => {
  const saved = () => ({ ...loadFixture(), id: 'from-the-account', name: 'From the account' });

  it('replaces the beat as one undo step, as an import does', () => {
    const machine = new EditorRuntime({ baseUrl: '/', storage: null, machine: machine909 });
    const before = machine.store.getState().project;

    const loaded = machine.loadSavedBeat(JSON.parse(JSON.stringify(saved())));
    expect(loaded).toMatchObject({ adopted: false, project: { id: 'from-the-account' } });
    expect(machine.store.getState().project.name).toBe('From the account');
    expect(machine.store.getState().notice).toMatchObject({
      kind: 'info',
      message: 'Loaded “From the account” from your account. Undo brings back the previous beat.',
    });

    machine.store.undo();
    expect(machine.store.getState().project).toEqual(before);
    expect(machine.store.getState().canUndo).toBe(false);
  });

  it('leaves the beat alone when what came back is not a 909 project', () => {
    const machine = new EditorRuntime({ baseUrl: '/', storage: null, machine: machine909 });
    const before = machine.store.getState().project;
    const broken = [null, 'a beat', {}, { ...saved(), patterns: [] }, { ...saved(), schemaVersion: 99 }, { ...saved(), machine: '808' }];
    for (const input of broken) {
      expect(machine.loadSavedBeat(input)).toBeNull();
      expect(machine.store.getState().project).toBe(before);
      expect(machine.store.getState().canUndo).toBe(false);
      expect(machine.store.getState().notice).toMatchObject({
        kind: 'error',
        message: 'That saved beat could not be read. Your current beat is unchanged.',
      });
    }
  });

  it('starts a new machine on the starter beat, in pattern play', () => {
    const machine = new EditorRuntime({ baseUrl: '/', storage: null, machine: machine909 });
    const { project, transient, power } = machine.store.getState();
    expect(project).toMatchObject({ machine: '909', name: 'Starter beat', tempo: 125, panel: { mode: 'pattern_play', pattern: 0 } });
    expect(transient).toEqual({ shift: false, held: null, measure: 0, display: 'measure' });
    expect(power).toBe(true);
    expect(machine909.memory(project)).toEqual({ patterns: project.patterns, patternTracks: project.patternTracks });
  });
});
