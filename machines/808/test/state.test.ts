import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  countHits,
  createEmptyRhythms,
  createEmptyTracks,
  createStarterRhythms,
  createStarterTracks,
  document808,
  isStepOn,
  patternIndex,
  serializeProject,
  tempoBpm,
} from '../src/document';
import {
  UNREADABLE_DRAFT_KEY,
  exportBaseName,
  loadDraft,
  projectFileName,
  readProjectFile,
  saveDraft,
  type KeyValueStorage,
} from '@boombapbot/editor';
import { exportPlan } from '../src/engine';
import { editTarget, remembersAnything, type Store808 } from '../src/session';
import { codec, fixturePath, legacyFixturePath, loadFixture, makeMachine } from './helpers';

const DRAFT_KEY = document808.draftKey;
const LEGACY_DRAFT_KEY = document808.earlierDraftKeys[0]!;

class MemoryStorage implements KeyValueStorage {
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

function hits(store: Store808, rhythm = 0): number {
  return countHits(store.getState().project.rhythms[rhythm]!, 'a');
}

describe('editor store', () => {
  it('toggles a step of the selected track with a step button', () => {
    const { store, session } = makeMachine();
    const row = () => store.getState().project.rhythms[0]!.a.kick;
    expect(editTarget(store.getState().project)).toEqual({ rhythm: 0, variation: 'a', track: 'kick', offset: 0 });
    expect(isStepOn(row(), 1)).toBe(false);
    expect(session.pressStep(1)).toEqual({ kind: 'step', on: true });
    expect(isStepOn(row(), 1)).toBe(true);
    expect(session.pressStep(1)).toEqual({ kind: 'step', on: false });
    expect(isStepOn(row(), 1)).toBe(false);
  });

  it('writes to the track the selector points at, the accent included', () => {
    const { store, session } = makeMachine();
    session.selectTrack('accent');
    session.pressStep(3);
    session.selectTrack('cowbell');
    session.pressStep(5);
    const { a } = store.getState().project.rhythms[0]!;
    expect(isStepOn(a.accent, 3)).toBe(true);
    expect(isStepOn(a.cowbell, 5)).toBe(true);
    // Selecting a track is not something to undo.
    store.undo();
    store.undo();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().project.panel.selector).toBe(8);
  });

  it('leaves every other rhythm alone', () => {
    const { store, session } = makeMachine();
    const before = store.getState().project.rhythms;
    session.pressStep(2);
    const after = store.getState().project.rhythms;
    expect(after[0]).not.toBe(before[0]);
    for (let index = 1; index < after.length; index += 1) expect(after[index]).toBe(before[index]);
    expect(store.getState().project.rhythms[0]!.b).toBe(before[0]!.b);
  });

  it('clears the selected rhythm and can undo it', () => {
    const { store, session } = makeMachine();
    const before = hits(store);
    expect(before).toBeGreaterThan(0);
    session.clearRhythm();
    expect(hits(store)).toBe(0);
    expect(hits(store, 1)).toBeGreaterThan(0);
    store.undo();
    expect(hits(store)).toBe(before);
    store.redo();
    expect(hits(store)).toBe(0);
    // Clearing an empty rhythm is not a step to undo.
    session.clearRhythm();
    store.undo();
    expect(hits(store)).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });

  it('puts the starter rhythms back, undoably', () => {
    const { store, session } = makeMachine();
    const before = store.getState().project.rhythms;
    session.loadStarterRhythms();
    expect(store.getState().project.rhythms).toEqual(createStarterRhythms());
    expect(store.getState().project.rhythmTracks).toEqual(createStarterTracks());
    // The fixture's fourth rhythm had a 2nd part of eight steps; the starter's does not.
    expect(store.getState().project.rhythms[3]!.secondLength).toBe(0);
    store.undo();
    expect(store.getState().project.rhythms).toEqual(before);
    expect(store.getState().project.rhythmTracks[0]).toHaveLength(7);
  });

  it('clears everything the machine remembers in one step that undo brings back', () => {
    const { store, session } = makeMachine();
    const before = store.getState().project;
    expect(remembersAnything(before)).toBe(true);

    session.clearEverything();
    const cleared = store.getState().project;
    expect(cleared.rhythms).toEqual(createEmptyRhythms());
    expect(cleared.rhythmTracks).toEqual(createEmptyTracks());
    expect(remembersAnything(cleared)).toBe(false);
    // The knobs, the tempo and the name are not memory, and stay.
    expect(cleared.sound).toEqual(before.sound);
    expect(cleared.tempo).toEqual(before.tempo);
    expect(cleared.name).toBe(before.name);

    store.undo();
    expect(store.getState().project.rhythms).toEqual(before.rhythms);
    expect(store.getState().project.rhythmTracks).toEqual(before.rhythmTracks);
    expect(store.getState().canUndo).toBe(false);
  });

  it('has nothing to clear, and so nothing to undo, when the machine is already blank', () => {
    const { store, session } = makeMachine();
    session.clearEverything();
    store.undo();
    store.redo();
    expect(store.getState().canUndo).toBe(true);
    session.clearEverything();
    store.undo();
    // That undo took back the one real clear, not a second empty one.
    expect(remembersAnything(store.getState().project)).toBe(true);
    expect(store.getState().canUndo).toBe(false);
  });

  it('counts a part\'s length or a measure of a track as something remembered', () => {
    const { store, session } = makeMachine();
    session.clearEverything();
    const blank = store.getState().project;
    const longer = { ...blank, rhythms: blank.rhythms.map((r, i) => (i === 3 ? { ...r, secondLength: 4 } : r)) };
    const composed = { ...blank, rhythmTracks: blank.rhythmTracks.map((t, i) => (i === 0 ? [2] : t)) };
    expect(remembersAnything(longer)).toBe(true);
    expect(remembersAnything(composed)).toBe(true);
  });

  it('sets the tempo as a click stop and a fine adjustment, inside the machine\'s range', () => {
    const { store, session } = makeMachine();
    session.setTempo({ coarse: 20 });
    expect(store.getState().project.tempo).toEqual({ coarse: 20, fine: -0.4 });
    session.setTempo({ fine: 0.5 });
    expect(tempoBpm(store.getState().project.tempo)).toBeCloseTo(40 + (20.5 * 260) / 39, 6);
    // A drag reports fractions of a stop; the knob clicks to the nearest one.
    session.setTempo({ coarse: 7.6 });
    expect(store.getState().project.tempo.coarse).toBe(8);
    session.setTempo({ coarse: -3, fine: -9 });
    expect(store.getState().project.tempo).toEqual({ coarse: 0, fine: -1 });
    expect(tempoBpm(store.getState().project.tempo)).toBe(40);
    session.setTempo({ coarse: 99, fine: 9 });
    expect(store.getState().project.tempo).toEqual({ coarse: 39, fine: 1 });
    expect(tempoBpm(store.getState().project.tempo)).toBe(300);
    expect(store.getState().canUndo).toBe(false);
  });

  it('turns the level, accent and master knobs and throws the voice switches', () => {
    const { store, session } = makeMachine();
    const before = store.getState().project;
    session.setKnob('cymbal', 'level', 0.3);
    session.setKnob('accent', 'level', 1);
    session.setMasterVolume(1.4);
    session.setAlternate('clap', true);
    const { sound } = store.getState().project;
    expect(sound.levels.cymbal).toBe(0.3);
    expect(sound.levels.kick).toBe(before.sound.levels.kick);
    expect(sound.accent).toBe(1);
    expect(sound.master).toBe(1);
    expect(sound.alternates).toEqual({ ...before.sound.alternates, clap: true });
    expect(store.getState().project.rhythms).toBe(before.rhythms);
    expect(store.getState().canUndo).toBe(false);

    // Setting a control to where it already is changes nothing at all.
    const settled = store.getState().project;
    session.setKnob('cymbal', 'level', 0.3);
    session.setMasterVolume(1);
    session.setAlternate('clap', true);
    session.setTempo({ coarse: settled.tempo.coarse });
    expect(store.getState().project).toBe(settled);
  });

  it('turns a sound knob without touching the rhythms or the undo history', () => {
    const { store, session } = makeMachine();
    const before = store.getState().project;
    session.setKnob('snare', 'snappy', 0.9);
    session.setKnob('snare', 'snappy', 4);
    const after = store.getState().project;
    expect(after.sound.knobs.snare.snappy).toBe(1);
    expect(after.sound.knobs.kick).toBe(before.sound.knobs.kick);
    expect(after.rhythms).toBe(before.rhythms);
    expect(store.getState().canUndo).toBe(false);
  });

  it('keeps knobs and the tempo where they are when a step is undone', () => {
    const { store, session } = makeMachine();
    session.pressStep(1);
    session.setKnob('kick', 'decay', 0.2);
    session.setTempo({ coarse: 3, fine: 0 });
    store.setName('Kept');
    store.undo();
    const { project } = store.getState();
    expect(isStepOn(project.rhythms[0]!.a.kick, 1)).toBe(false);
    expect(project.sound.knobs.kick.decay).toBe(0.2);
    expect(project.tempo).toEqual({ coarse: 3, fine: 0 });
    expect(project.name).toBe('Kept');
  });

  it('selects a rhythm with a step button outside the write modes', () => {
    const { store, session } = makeMachine();
    const before = store.getState().project.rhythms;
    session.setMode('pattern_clear');
    expect(session.pressStep(2)).toEqual({ kind: 'rhythm' });
    expect(store.getState().project.panel).toMatchObject({ basicRhythm: 2, writeTarget: 'basic' });
    expect(exportPlan(store.getState().project).rhythms).toEqual([2]);
    // Buttons 13 to 16 are the Intro/Fill-ins, with their own variation switch.
    session.pressStep(13);
    session.setFillVariation('b');
    expect(store.getState().project.panel).toMatchObject({ basicRhythm: 2, fillRhythm: 13, writeTarget: 'fill' });
    expect(editTarget(store.getState().project)).toMatchObject({ rhythm: 13, variation: 'b' });
    expect(exportPlan(store.getState().project)).toMatchObject({ rhythms: [13], panel: { fillVariation: 'b' } });
    // Choosing a rhythm writes nothing and is not an undo step.
    expect(store.getState().project.rhythms).toBe(before);
    expect(store.getState().canUndo).toBe(false);

    // The write modes then work on the rhythm chosen last.
    session.setMode('write_first');
    session.pressStep(0);
    expect(isStepOn(store.getState().project.rhythms[13]!.b.kick, 0)).toBe(true);
  });

  it('writes the B version, and the 2nd part from its own sixteen steps', () => {
    const { store, session } = makeMachine();
    const rows = () => store.getState().project.rhythms[0]!;
    const before = rows();
    session.setBasicVariation('b');
    session.pressStep(3);
    expect(isStepOn(rows().b.kick, 3)).toBe(!isStepOn(before.b.kick, 3));
    expect(rows().a).toBe(before.a);

    session.setMode('write_second');
    expect(editTarget(store.getState().project).offset).toBe(16);
    session.pressStep(3);
    expect(isStepOn(rows().b.kick, 19)).toBe(true);
    expect(isStepOn(rows().b.kick, 3)).toBe(!isStepOn(before.b.kick, 3));
    // With the switch on AB the A version is the one on the buttons.
    session.setBasicVariation('ab');
    expect(editTarget(store.getState().project).variation).toBe('a');
  });

  it('clears with CLEAR in pattern clear: one version, or both on AB, and resets the lengths', () => {
    const { store, session } = makeMachine();
    // Rhythm 4 of the fixture has sixteen and eight steps.
    session.setMode('pattern_clear');
    session.pressStep(3);
    expect(store.getState().project.rhythms[3]).toMatchObject({ firstLength: 16, secondLength: 8, preScale: 2 });
    session.pressClear();
    const cleared = store.getState().project.rhythms[3]!;
    expect(hits(store, 3)).toBe(0);
    expect(cleared).toMatchObject({ firstLength: 16, secondLength: 0, preScale: 2 });
    expect(store.getState().transient.clearArmed).toBe(false);
    store.undo();
    expect(store.getState().project.rhythms[3]).toMatchObject({ secondLength: 8 });

    // Rhythm 1 has both versions written.
    session.pressStep(0);
    session.pressClear();
    expect(countHits(store.getState().project.rhythms[0]!, 'a')).toBe(0);
    expect(countHits(store.getState().project.rhythms[0]!, 'b')).toBeGreaterThan(0);
    store.undo();
    session.setBasicVariation('ab');
    session.pressClear();
    expect(countHits(store.getState().project.rhythms[0]!, 'a')).toBe(0);
    expect(countHits(store.getState().project.rhythms[0]!, 'b')).toBe(0);
  });

  it('stores the pre-scale and sets the last step with CLEAR in a write mode', () => {
    const { store, session } = makeMachine();
    session.setPreScale(1);
    // Moving the switch alone changes no rhythm.
    expect(store.getState().project.rhythms[0]!.preScale).toBe(3);
    session.pressClear();
    expect(store.getState().project.rhythms[0]!.preScale).toBe(1);
    expect(store.getState().transient.clearArmed).toBe(true);
    // While CLEAR is down a step button sets the last step and writes nothing.
    const row = store.getState().project.rhythms[0]!.a.kick;
    expect(session.pressStep(11)).toEqual({ kind: 'length' });
    expect(store.getState().project.rhythms[0]).toMatchObject({ preScale: 1, firstLength: 12, secondLength: 0 });
    expect(store.getState().project.rhythms[0]!.a.kick).toBe(row);
    expect(store.getState().transient.clearArmed).toBe(false);
    // The next press is an ordinary step again.
    expect(session.pressStep(11).kind).toBe('step');

    // In the 2nd part the same gesture gives the rhythm a 2nd part.
    session.setMode('write_second');
    session.pressClear();
    session.pressStep(3);
    expect(store.getState().project.rhythms[0]).toMatchObject({ firstLength: 12, secondLength: 4 });
    // The lengths belong to both versions, and each change can be undone.
    store.undo();
    expect(store.getState().project.rhythms[0]!.secondLength).toBe(0);
    store.undo();
    store.undo();
    expect(store.getState().project.rhythms[0]!.firstLength).toBe(16);
  });

  it('lets CLEAR come back up without setting anything', () => {
    const { store, session } = makeMachine();
    session.pressClear();
    session.pressClear();
    expect(store.getState().transient.clearArmed).toBe(false);
    session.pressClear();
    session.releaseClear();
    expect(store.getState().transient.clearArmed).toBe(false);
    session.pressClear();
    session.setMode('manual_play');
    expect(store.getState().transient.clearArmed).toBe(false);
    // Outside pattern clear and the write modes CLEAR does nothing.
    const before = store.getState().project;
    session.pressClear();
    expect(store.getState().project).toBe(before);
    expect(store.getState().transient.clearArmed).toBe(false);
  });

  it('writes a tapped step on the selected track', () => {
    const { store, session } = makeMachine();
    session.selectTrack('cowbell');
    session.tapStep(9);
    session.tapStep(9);
    expect(isStepOn(store.getState().project.rhythms[0]!.a.cowbell, 9)).toBe(true);
    store.undo();
    expect(isStepOn(store.getState().project.rhythms[0]!.a.cowbell, 9)).toBe(false);
    // A second tap on a step that is already on is not a change.
    expect(store.getState().canUndo).toBe(false);
  });

  it('writes whichever version is playing while the switch is on AB', () => {
    const { store, session } = makeMachine();
    session.setBasicVariation('ab');
    // Stopped, or before the engine has said what is playing, that is A.
    expect(editTarget(store.getState().project, store.getState().currentPattern).variation).toBe('a');
    store.setPlaying(true);
    store.setPosition(0, patternIndex(0, 'b'));
    const before = store.getState().project.rhythms[0]!;
    session.selectTrack('cowbell');
    session.pressStep(6);
    expect(isStepOn(store.getState().project.rhythms[0]!.b.cowbell, 6)).toBe(true);
    expect(store.getState().project.rhythms[0]!.a).toBe(before.a);
    store.setPosition(0, patternIndex(0, 'a'));
    session.pressStep(6);
    expect(isStepOn(store.getState().project.rhythms[0]!.a.cowbell, 6)).toBe(true);
    // Another rhythm's pattern playing says nothing about this one.
    store.setPosition(0, patternIndex(5, 'b'));
    expect(editTarget(store.getState().project, store.getState().currentPattern).variation).toBe('a');
  });

  it('arms the intro or fill-in only in the modes played by hand', () => {
    const { store, session } = makeMachine();
    session.setMode('manual_play');
    session.setFillArmed(true);
    expect(store.getState().transient.fillArmed).toBe(true);
    session.setAutoFill(8);
    expect(store.getState().project.panel.autoFill).toBe(8);
    expect(store.getState().transient.fillArmed).toBe(true);
    // Composing is played by hand too.
    session.setMode('compose');
    expect(store.getState().transient.fillArmed).toBe(true);
    // A rhythm track played back has no fill-ins to bring in, and nor do the write modes.
    session.setMode('play');
    expect(store.getState().transient.fillArmed).toBe(false);
    session.setMode('manual_play');
    session.setFillArmed(true);
    session.setMode('write_first');
    expect(store.getState().transient.fillArmed).toBe(false);
    expect(store.getState().canUndo).toBe(false);
  });

  it('empties a rhythm track with CLEAR in compose, and stores a composition as one change', () => {
    const { store, session } = makeMachine();
    // The fixture has seven measures in track 1.
    expect(store.getState().project.rhythmTracks[0]).toHaveLength(7);
    session.setMode('compose');
    session.selectTrack('accent');
    session.pressClear();
    expect(store.getState().project.rhythmTracks[0]).toEqual([]);
    store.undo();
    expect(store.getState().project.rhythmTracks[0]).toHaveLength(7);

    // Seventy measures from track 3 fill it and go on into track 4.
    const long = Array.from({ length: 70 }, (_, index) => index % 12);
    session.commitComposition(2, long);
    const { rhythmTracks } = store.getState().project;
    expect(rhythmTracks[2]).toHaveLength(64);
    expect(rhythmTracks[3]).toEqual(long.slice(64));
    expect(rhythmTracks[0]).toHaveLength(7);
    session.commitComposition(2, long);
    store.undo();
    expect(store.getState().project.rhythmTracks[2]).toEqual([]);
    expect(store.getState().project.rhythmTracks[3]).toEqual([]);
    // Emptying an empty track is not a change.
    session.selectTrack('snare');
    session.pressClear();
    expect(store.getState().canUndo).toBe(false);
  });

  it('leaves the step buttons alone while a rhythm track plays', () => {
    const { store, session } = makeMachine();
    session.setMode('play');
    const before = store.getState().project;
    expect(session.pressStep(5)).toEqual({ kind: 'none' });
    expect(store.getState().project).toBe(before);
    session.setMode('compose');
    expect(session.pressStep(5)).toEqual({ kind: 'rhythm' });
    expect(store.getState().project.panel.basicRhythm).toBe(5);
  });

  it('switches off without losing anything it remembers', () => {
    const { store, session } = makeMachine();
    session.pressClear();
    session.setMode('manual_play');
    session.setFillArmed(true);
    const before = store.getState().project;
    store.setPower(false);
    expect(store.getState()).toMatchObject({ power: false, transient: { clearArmed: false, fillArmed: false } });
    expect(store.getState().project).toBe(before);
    store.setPower(true);
    expect(store.getState().power).toBe(true);
    expect(store.getState().project).toBe(before);
  });

  it('tracks where playback is', () => {
    const { store, session } = makeMachine();
    store.setPlaying(true);
    store.setPosition(17, 4);
    expect(store.getState()).toMatchObject({ playing: true, currentStep: 17, currentPattern: 4 });
    store.setPlaying(false);
    expect(store.getState()).toMatchObject({ playing: false, currentStep: -1, currentPattern: -1 });
  });
});

describe('local draft', () => {
  it('saves and restores the active draft', () => {
    const storage = new MemoryStorage();
    expect(loadDraft(storage, document808, codec)).toEqual({ status: 'empty' });
    const { store, session } = makeMachine();
    session.selectTrack('clap');
    session.pressStep(3);
    session.setTempo({ coarse: 30, fine: 0.25 });
    session.setAlternate('rim_shot', false);
    session.setKnob('accent', 'level', 0.4);
    session.setKnob('cymbal', 'tone', 0.25);
    expect(saveDraft(storage, document808, store.getState().project)).toEqual({ ok: true });

    const loaded = loadDraft(storage, document808, codec);
    expect(loaded.status).toBe('restored');
    if (loaded.status !== 'restored') return;
    expect(loaded.project).toEqual(store.getState().project);
    expect(loaded.changes).toEqual([]);
  });

  it('sets an unreadable draft aside instead of deleting it', () => {
    const storage = new MemoryStorage();
    const broken = serializeProject(loadFixture()).replace('"coarse": 13', '"coarse": "fast"');
    expect(broken).toContain('"fast"');
    storage.items.set(DRAFT_KEY, broken);
    const loaded = loadDraft(storage, document808, codec);
    expect(loaded.status).toBe('unreadable');
    expect(storage.getItem(DRAFT_KEY)).toBeNull();
    expect(storage.getItem(UNREADABLE_DRAFT_KEY)).toBe(broken);
    // The next load starts clean.
    expect(loadDraft(storage, document808, codec)).toEqual({ status: 'empty' });
  });

  it('recovers from truncated JSON', () => {
    const storage = new MemoryStorage();
    storage.items.set(DRAFT_KEY, serializeProject(loadFixture()).slice(0, 200));
    expect(loadDraft(storage, document808, codec).status).toBe('unreadable');
  });

  it('reads a draft left by an earlier version once, and says what changed', () => {
    const storage = new MemoryStorage();
    storage.items.set(LEGACY_DRAFT_KEY, readFileSync(legacyFixturePath, 'utf8'));
    const loaded = loadDraft(storage, document808, codec);
    expect(loaded.status).toBe('restored');
    if (loaded.status !== 'restored') return;
    expect(loaded.changes.length).toBeGreaterThan(0);
    expect(countHits(loaded.project.rhythms[0]!, 'a')).toBe(22);
    // Once saved in the current format, the old draft is not read again.
    saveDraft(storage, document808, { ...loaded.project, name: 'Moved on' });
    const again = loadDraft(storage, document808, codec);
    expect(again.status === 'restored' && again.project.name).toBe('Moved on');
    expect(again.status === 'restored' && again.changes).toEqual([]);
    expect(storage.getItem(LEGACY_DRAFT_KEY)).not.toBeNull();
  });

  it('reports a failed save without throwing', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    const result = saveDraft(storage, document808, loadFixture());
    expect(result.ok).toBe(false);
  });
});

describe('project import', () => {
  it('reads a valid file', async () => {
    const result = await readProjectFile(new Blob([readFileSync(fixturePath)]), codec);
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid file and leaves the draft untouched', async () => {
    const { store, session } = makeMachine();
    const before = store.getState().project;
    for (const contents of [
      '{ nope',
      '{"format":"boombapbot.project","schemaVersion":1}',
      '{"format":"boombapbot.project","schemaVersion":2}',
      '{"format":"boombapbot.project","schemaVersion":3}',
      'RIFF....WAVE',
    ]) {
      const result = await readProjectFile(new Blob([contents]), codec);
      expect(result.ok).toBe(false);
      if (result.ok) store.replaceProject(result.project);
    }
    expect(store.getState().project).toBe(before);
  });

  it('replaces the whole project on a valid import and can undo it', async () => {
    const { store, session } = makeMachine();
    session.setKnob('kick', 'decay', 0.1);
    store.setName('Mine');
    session.clearRhythm();
    const result = await readProjectFile(new Blob([readFileSync(legacyFixturePath)]), codec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.length).toBeGreaterThan(0);
    store.replaceProject(result.project);
    expect(hits(store)).toBe(22);
    expect(store.getState().project.sound.knobs.kick.decay).toBe(0.5);
    // Undo brings back the knobs and the name too, not only the rhythms.
    store.undo();
    expect(hits(store)).toBe(0);
    expect(store.getState().project.sound.knobs.kick.decay).toBe(0.1);
    expect(store.getState().project.name).toBe('Mine');
    store.redo();
    expect(hits(store)).toBe(22);
    expect(store.getState().project.name).toBe(result.project.name);
  });

  it('names export files safely', () => {
    const project = { ...loadFixture(), name: '  My  Beat / v2: "final"  ' };
    expect(exportBaseName(project)).toBe('my-beat-v2-final');
    expect(projectFileName(project)).toBe('my-beat-v2-final.boombapbot.json');
    expect(exportBaseName({ ...project, name: '///' })).toBe('boombapbot-beat');
  });
});
