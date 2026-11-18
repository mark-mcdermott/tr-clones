import { describe, expect, it } from 'vitest';
import { EditorRuntime, type KeyValueStorage } from '@boombapbot/editor';
import { machine606 } from '../src';
import { MemoryStorage, loadFixture, newProject } from './helpers';

const runtime = (storage: KeyValueStorage | null = null) => new EditorRuntime({ baseUrl: '/', storage, machine: machine606 });

describe('the 606 as the editor mounts it', () => {
  it('opens on the starter beat, stopped in pattern write, with nothing held', () => {
    const machine = runtime();
    const { project, transient, power, playing } = machine.store.getState();
    expect(machine606.id).toBe('606');
    expect(project).toMatchObject({ machine: '606', name: 'Starter beat', tempo: 126 });
    expect(machine606.bpm(project)).toBe(126);
    expect(transient).toEqual({ functionHeld: false, clearArmed: false, bar: 0 });
    expect([power, playing]).toEqual([true, false]);
    expect(machine606.memory(project)).toEqual({ patterns: project.patterns, tracks: project.tracks });
  });

  it('restores its draft from its own key, and ignores what another machine left', () => {
    const storage = new MemoryStorage();
    storage.setItem('boombapbot.draft.v2', JSON.stringify({ format: 'boombapbot.project', schemaVersion: 2, name: 'Another machine' }));
    expect(runtime(storage).store.getState().project.name).toBe('Starter beat');
    storage.setItem('tr-clones.606.draft.v1', JSON.stringify({ ...newProject(), name: 'Mine' }));
    expect(runtime(storage).store.getState()).toMatchObject({ draftOrigin: 'restored', project: { name: 'Mine' } });
    expect(storage.getItem('boombapbot.draft.v2')).toContain('Another machine');
  });
});

describe('loading a saved beat onto the machine', () => {
  const saved = () => ({ ...loadFixture(), id: 'from-the-account', name: 'From the account' });

  it('replaces the beat as one undo step, as an import does', () => {
    const machine = runtime();
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

  it('leaves the beat alone when what came back is not a 606 project', () => {
    const machine = runtime();
    const before = machine.store.getState().project;
    const broken = [null, 'a beat', {}, { ...saved(), patterns: [] }, { ...saved(), schemaVersion: 99 }, { ...saved(), machine: '808' }];
    for (const value of broken) {
      expect(machine.loadSavedBeat(value)).toBeNull();
      expect(machine.store.getState().project).toBe(before);
      expect(machine.store.getState().canUndo).toBe(false);
      expect(machine.store.getState().notice).toMatchObject({
        kind: 'error',
        message: 'That saved beat could not be read. Your current beat is unchanged.',
      });
    }
  });
});
