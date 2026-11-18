import { describe, expect, it } from 'vitest';
import { EditorRuntime, type KeyValueStorage } from '@boombapbot/editor';
import { machine707 } from '../src';
import { loadFixture } from './helpers';

/** Storage that lives for one test. */
class MemoryStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const runtime = (storage: KeyValueStorage | null = null) => new EditorRuntime({ baseUrl: '/', storage, machine: machine707 });

describe('loading a saved beat onto the machine', () => {
  const saved = () => ({ ...loadFixture(), id: 'from-the-account', name: 'From the account' });

  it('replaces the beat as one undo step, as an import does', () => {
    const machine = runtime();
    const before = machine.store.getState().project;

    const loaded = machine.loadSavedBeat(JSON.parse(JSON.stringify(saved())));
    expect(loaded).toMatchObject({ adopted: false, project: { id: 'from-the-account', machine: '707' } });
    expect(machine.store.getState().project.name).toBe('From the account');
    expect(machine.store.getState().notice).toMatchObject({
      kind: 'info',
      message: 'Loaded “From the account” from your account. Undo brings back the previous beat.',
    });

    machine.store.undo();
    expect(machine.store.getState().project).toEqual(before);
    expect(machine.store.getState().canUndo).toBe(false);
  });

  it('leaves the beat alone when what came back is not a 707 project', () => {
    const machine = runtime();
    const before = machine.store.getState().project;
    const another = { ...saved(), machine: '808' };
    for (const broken of [null, 'a beat', {}, another, { ...saved(), tracks: [] }, { ...saved(), schemaVersion: 99 }]) {
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

describe('the draft the machine keeps', () => {
  it('starts with the starter beat, and keeps its draft under a key of its own', () => {
    const storage = new MemoryStorage();
    const machine = runtime(storage);
    machine.attach();
    expect(machine.store.getState().project).toMatchObject({ machine: '707', name: 'Starter beat' });
    expect([...storage.items.keys()]).toEqual(['tr-clones.707.draft.v1']);
    machine.session.setTempo(99);
    expect(JSON.parse(storage.items.get('tr-clones.707.draft.v1')!)).toMatchObject({ tempo: 99 });
    machine.detach();
  });

  it('comes back as it was left', () => {
    const storage = new MemoryStorage();
    const first = runtime(storage);
    first.attach();
    first.session.setMode('pattern_step');
    first.session.pressStep(3);
    first.session.setLevel('ride', 0.2);
    const left = first.store.getState().project;
    first.detach();
    const second = runtime(storage);
    expect(second.store.getState().project).toEqual(left);
    expect(second.store.getState().draftOrigin).toBe('restored');
  });

  it('sets an unreadable draft aside and starts again, and never reads another machine\'s', () => {
    const storage = new MemoryStorage();
    storage.setItem('tr-clones.707.draft.v1', '{"format":"boombapbot.project","machine":"707","schemaVersion":1}');
    storage.setItem('boombapbot.draft.v2', JSON.stringify({ format: 'boombapbot.project', schemaVersion: 2, name: 'An 808 beat' }));
    const machine = runtime(storage);
    expect(machine.store.getState().project.name).toBe('Starter beat');
    expect(machine.store.getState().notice).toMatchObject({ kind: 'error' });
    expect(storage.items.has('boombapbot.draft.unreadable')).toBe(true);
    expect(storage.items.get('boombapbot.draft.v2')).toContain('An 808 beat');
  });
});
