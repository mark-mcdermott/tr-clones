import { describe, expect, it } from 'vitest';
import { EditorRuntime } from '@boombapbot/editor';
import { machine808 } from '../src';
import { loadFixture } from './helpers';

describe('loading a saved beat onto the machine', () => {
  const saved = () => ({ ...loadFixture(), id: 'from-the-account', name: 'From the account' });

  it('replaces the beat as one undo step, as an import does', () => {
    const machine = new EditorRuntime({ baseUrl: '/', storage: null, machine: machine808 });
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

  it('leaves the beat alone when what came back is not a project', () => {
    const machine = new EditorRuntime({ baseUrl: '/', storage: null, machine: machine808 });
    const before = machine.store.getState().project;
    for (const broken of [null, 'a beat', {}, { ...saved(), rhythms: [] }, { ...saved(), schemaVersion: 99 }]) {
      expect(machine.loadSavedBeat(broken)).toBeNull();
      expect(machine.store.getState().project).toBe(before);
      expect(machine.store.getState().canUndo).toBe(false);
      expect(machine.store.getState().notice).toMatchObject({
        kind: 'error',
        message: 'That saved beat could not be read. Your current beat is unchanged.',
      });
    }
  });
});
