import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT } from '@boombapbot/contracts';
import { UNREADABLE_DRAFT_KEY, loadDraft, saveDraft } from '@boombapbot/editor';
import {
  BPM_MAX,
  BPM_MIN,
  GROUP_PATTERNS,
  INSTRUMENTS,
  INSTRUMENT_IDS,
  LEVEL_IDS,
  PANEL,
  SCALES,
  SONG_TRACKS,
  STEPS,
  TRACKS,
  TRACK_IDS,
  TRACK_MEASURES,
  accentGains,
  bankIndex,
  chainOf,
  clampBpm,
  clearedPattern,
  countHits,
  createEmptyPattern,
  createEmptyPatterns,
  createEmptyTracks,
  createProject,
  createStarterPatterns,
  createStarterTracks,
  document606,
  editedPattern,
  endingAt,
  isCleared,
  lastBar,
  levelGain,
  masterGain,
  nextStep,
  parseProject,
  rowMask,
  selectionOf,
  serializeProject,
  stepsPerBeat,
  tappedStep,
  withInsertedMeasure,
  withLastStep,
  withMeasure,
  withStep,
  withoutMeasure,
} from '../src/document';
import { MemoryStorage, codec, fixturePath, loadFixture, newProject } from './helpers';

describe('the 606 as a set of tracks', () => {
  it('has an accent and seven instruments, in selector order, and a sound for each instrument', () => {
    expect(TRACK_IDS).toEqual(['accent', 'kick', 'snare', 'low_tom', 'high_tom', 'cymbal', 'open_hat', 'closed_hat']);
    expect(TRACKS.map((track) => track.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(TRACKS.map((track) => track.short)).toEqual(['AC', 'BD', 'SD', 'LT', 'HT', 'CY', 'OH', 'CH']);
    expect(INSTRUMENTS.map((instrument) => instrument.id)).toEqual([...INSTRUMENT_IDS]);
    expect(TRACKS[0]!.level).toBeUndefined();
  });

  it('puts the toms on one level knob and the hi-hats on another, and lets the closed hat cut the open one', () => {
    const knobOf = (id: string) => INSTRUMENTS.find((instrument) => instrument.id === id)!.level;
    expect(knobOf('low_tom')).toBe('toms');
    expect(knobOf('high_tom')).toBe('toms');
    expect(knobOf('open_hat')).toBe('hi_hat');
    expect(knobOf('closed_hat')).toBe('hi_hat');
    expect(new Set(INSTRUMENTS.map((instrument) => instrument.level))).toEqual(new Set(LEVEL_IDS.filter((id) => id !== 'accent')));
    const choked = INSTRUMENTS.filter((instrument) => instrument.chokeGroup !== 0).map((instrument) => instrument.id);
    expect(choked).toEqual(['open_hat', 'closed_hat']);
  });

  it('counts three, four, six or eight steps to the beat, and keeps a pattern at n * 2 + group in the bank', () => {
    expect(SCALES.map(stepsPerBeat)).toEqual([4, 8, 3, 6]);
    expect(bankIndex(0, 0)).toBe(0);
    expect(bankIndex(0, 1)).toBe(1);
    expect(bankIndex(15, 1)).toBe(31);
    const all = new Set(Array.from({ length: GROUP_PATTERNS }, (_, n) => [bankIndex(n, 0), bankIndex(n, 1)]).flat());
    expect(all.size).toBe(32);
  });

  it('turns rows into the bits the engine takes, and its knobs into gains', () => {
    expect(rowMask('x...x...........')).toBe(0b10001);
    expect(rowMask(withStep('................', 15, true))).toBe(1 << 15);
    expect(withStep('x...............', 16, true)).toBe('x...............');
    expect(levelGain('kick', 0)).toBe(0);
    expect(levelGain('kick', 0.75)).toBeCloseTo(0.8, 10);
    expect(levelGain('kick', 1)).toBeGreaterThan(levelGain('kick', 0.75));
    expect(accentGains(0).accented).toBe(accentGains(0).plain);
    expect(accentGains(1)).toEqual({ plain: 0.6, accented: 1 });
    expect(masterGain(0)).toBe(0);
    expect(masterGain(1)).toBe(1);
    expect([clampBpm(10), clampBpm(126.4), clampBpm(900), clampBpm(Number.NaN)]).toEqual([BPM_MIN, 126, BPM_MAX, 120]);
  });
});

describe('the 606 project document', () => {
  it('names its machine, and a new one opens on the starter beat', () => {
    const project = newProject();
    expect(project).toMatchObject({ format: PROJECT_FORMAT, schemaVersion: 1, machine: '606', tempo: 126 });
    expect(project.patterns.map((group) => group.length)).toEqual([GROUP_PATTERNS, GROUP_PATTERNS]);
    expect(project.tracks).toHaveLength(SONG_TRACKS);
    expect(project.panel).toEqual({ mode: 'pattern_write', selector: 1, group: 0, pattern: 0, chainEnd: 0, scale: 1 });
    expect(project.patterns).toEqual(createStarterPatterns());
    expect(project.tracks).toEqual(createStarterTracks());
    for (const pattern of project.patterns.flat()) {
      for (const id of TRACK_IDS) expect(pattern.steps[id]).toMatch(/^[.x]{16}$/);
    }
  });

  it('starts with a four-bar phrase, patterns at three of the four scales, and room to write', () => {
    const [one, two] = createStarterPatterns();
    if (!one || !two) throw new Error('the starter has two groups');
    for (const number of [0, 1, 2, 3, 4, 5]) expect(countHits(one[number]!)).toBeGreaterThan(12);
    expect(one[8]).toMatchObject({ scale: 3, lastStep: 12 });
    expect(one[9]).toMatchObject({ scale: 2, lastStep: 16 });
    expect(one[12]).toMatchObject({ scale: 1, lastStep: 12 });
    // Nothing is written past a pattern's last step.
    for (const pattern of one) {
      for (const id of TRACK_IDS) expect(pattern.steps[id].slice(pattern.lastStep)).not.toContain('x');
    }
    // Pattern 16 of group I and all of group II are left empty: the browser tests write there.
    expect(isCleared(one[15]!)).toBe(true);
    expect(two.every(isCleared)).toBe(true);
    const tracks = createStarterTracks();
    expect(tracks[0]).toEqual([0, 1, 0, 3, 0, 1, 2, 3]);
    expect(tracks.slice(2).every((track) => track.length === 0)).toBe(true);
    // A starter track plays only patterns that hold something.
    for (const measure of tracks.flat()) expect(countHits(one[measure]!)).toBeGreaterThan(0);
  });

  it('with patterns of its own it gets no starter tracks', () => {
    const project = createProject({ id: 'own', now: new Date('2026-11-17T12:00:00.000Z'), patterns: createEmptyPatterns() });
    expect(project.tracks).toEqual(createEmptyTracks());
    expect(project.name).toBe('Untitled beat');
    expect(project.tempo).toBe(120);
    expect(parseProject(project).ok).toBe(true);
  });

  it('goes to text and back unchanged', () => {
    const project = newProject();
    expect(codec.parseText(serializeProject(project))).toEqual({ ok: true, project, changes: [] });
    expect(codec.serialize(project)).toBe(serializeProject(project));
  });

  it('reads the committed fixture and writes it back byte for byte', () => {
    const text = readFileSync(fixturePath, 'utf8');
    const fixture = loadFixture();
    expect(serializeProject(fixture)).toBe(text);
    expect(fixture.panel).toEqual({ mode: 'pattern_play', selector: 2, group: 0, pattern: 0, chainEnd: 3, scale: 3 });
    expect(fixture.patterns[1]![0]).toMatchObject({ scale: 4, lastStep: 14 });
    expect(new Set(fixture.patterns.flat().map((pattern) => pattern.scale))).toEqual(new Set(SCALES));
  });

  it('refuses what is not one, and says why', () => {
    const project = newProject();
    const pattern = project.patterns[0]![0]!;
    const withPattern = (change: object) => ({
      ...project,
      patterns: [[{ ...pattern, ...change }, ...project.patterns[0]!.slice(1)], project.patterns[1]],
    });
    const broken: Array<[string, unknown]> = [
      ['a tempo past the knob', { ...project, tempo: BPM_MAX + 1 }],
      ['a tempo that is not whole', { ...project, tempo: 120.5 }],
      ['one group', { ...project, patterns: [project.patterns[0]] }],
      ['a group of fifteen', { ...project, patterns: [project.patterns[0]!.slice(1), project.patterns[1]] }],
      ['a fifth scale', withPattern({ scale: 5 })],
      ['a last step of none', withPattern({ lastStep: 0 })],
      ['a last step past the keys', withPattern({ lastStep: STEPS + 1 })],
      ['a row of the wrong length', withPattern({ steps: { ...pattern.steps, kick: 'x' } })],
      ['a row with a velocity in it', withPattern({ steps: { ...pattern.steps, kick: 'X...............' } })],
      ['a track missing from a pattern', withPattern({ steps: { ...pattern.steps, cymbal: undefined } })],
      ['seven tracks', { ...project, tracks: project.tracks.slice(1) }],
      ['a track of sixty-five bars', { ...project, tracks: project.tracks.map(() => Array.from({ length: TRACK_MEASURES + 1 }, () => 0)) }],
      ['a bar of pattern seventeen', { ...project, tracks: project.tracks.map(() => [16]) }],
      ['a level knob missing', { ...project, mix: { ...project.mix, levels: { ...project.mix.levels, toms: undefined } } }],
      ['a knob past its end', { ...project, mix: { ...project.mix, volume: 1.2 } }],
      ['a fifth mode', { ...project, panel: { ...project.panel, mode: 'song' } }],
      ['a ninth selector position', { ...project, panel: { ...project.panel, selector: 8 } }],
      ['a third group', { ...project, panel: { ...project.panel, group: 2 } }],
      ['a chain that runs backwards', { ...project, panel: { ...project.panel, pattern: 2, chainEnd: 1 } }],
      ['a chain across two blocks', { ...project, panel: { ...project.panel, pattern: 2, chainEnd: 5 } }],
      ['no name', { ...project, name: '' }],
      ['another machine', { ...project, machine: '808' }],
    ];
    for (const [what, value] of broken) {
      const result = parseProject(value);
      expect(result.ok, what).toBe(false);
      if (!result.ok) expect(result.errors.length, what).toBeGreaterThan(0);
    }
    expect(parseProject({ ...project, schemaVersion: 2 })).toEqual({
      ok: false,
      errors: ['This project uses schema version 2. This build reads version 1.'],
    });
    for (const nothing of [null, undefined, 'a beat', 42, []]) expect(parseProject(nothing).ok).toBe(false);
  });

  it('is owned by the 606 alone', () => {
    expect(document606.owns({ machine: '606' })).toBe(true);
    expect(document606.owns({ machine: '808' })).toBe(false);
    expect(document606.owns({})).toBe(false);
    expect(codec.parse({ ...newProject(), machine: undefined })).toEqual({
      ok: false,
      errors: ['This project was made on a machine this build does not have.'],
    });
    expect(codec.parse({ format: 'something.else' })).toEqual({ ok: false, errors: ['This is not a boombapbot project file.'] });
    expect(codec.parseText('{"format":')).toEqual({ ok: false, errors: ['The file is not valid JSON.'] });
  });
});

describe('patterns, chains and tracks', () => {
  it('clears a pattern to sixteen empty steps and keeps its scale', () => {
    const fixture = loadFixture();
    const triplets = fixture.patterns[0]![8]!;
    expect(isCleared(triplets)).toBe(false);
    expect(clearedPattern(triplets)).toEqual({ ...createEmptyPattern(), scale: 3 });
    expect(isCleared(clearedPattern(triplets))).toBe(true);
    // A pattern with nothing on it but a shorter length still has something to clear.
    expect(isCleared(withLastStep(createEmptyPattern(), 12))).toBe(false);
  });

  it('sets a last step within the sixteen, and counts and steps only up to it', () => {
    const pattern = withLastStep(loadFixture().patterns[0]![0]!, 8);
    expect(pattern.lastStep).toBe(8);
    expect(withLastStep(pattern, 0).lastStep).toBe(1);
    expect(withLastStep(pattern, 40).lastStep).toBe(STEPS);
    expect(countHits(pattern)).toBeLessThan(countHits(withLastStep(pattern, 16)));
    expect(nextStep(pattern, 6)).toBe(7);
    expect(nextStep(pattern, 7)).toBe(0);
    expect(tappedStep(pattern, 7, 0.4)).toBe(7);
    expect(tappedStep(pattern, 7, 0.6)).toBe(0);
  });

  it('chains neighbouring patterns within a block of four, whichever key is pressed first', () => {
    expect(selectionOf(5)).toEqual({ pattern: 5, chainEnd: 5 });
    expect(selectionOf(1, 3)).toEqual({ pattern: 1, chainEnd: 3 });
    expect(selectionOf(3, 1)).toEqual({ pattern: 1, chainEnd: 3 });
    expect(selectionOf(12, 15)).toEqual({ pattern: 12, chainEnd: 15 });
    // Across two blocks there is no chain: the second key is the pattern.
    expect(selectionOf(3, 4)).toEqual({ pattern: 4, chainEnd: 4 });
    expect(chainOf({ pattern: 1, chainEnd: 3 })).toEqual([1, 2, 3]);
    expect(chainOf({ pattern: 9, chainEnd: 9 })).toEqual([9]);
  });

  it('writes the pattern of the chain that is playing, and otherwise its first', () => {
    const panel = { ...newProject().panel, ...selectionOf(4, 7) };
    expect(editedPattern(panel)).toBe(4);
    expect(editedPattern(panel, bankIndex(6, 0))).toBe(6);
    // A pattern outside the chain, or one of the other group, is not what is selected.
    expect(editedPattern(panel, bankIndex(2, 0))).toBe(4);
    expect(editedPattern(panel, bankIndex(6, 1))).toBe(4);
    expect(editedPattern({ ...panel, group: 1 }, bankIndex(6, 1))).toBe(6);
  });

  it('writes, ends, shortens and lengthens a track a bar at a time', () => {
    expect(withMeasure([], 0, 5)).toEqual([5]);
    expect(withMeasure([5], 1, 6)).toEqual([5, 6]);
    expect(withMeasure([5, 6], 0, 9)).toEqual([9, 6]);
    // There is no bar past the one after the last.
    expect(withMeasure([5, 6], 3, 9)).toEqual([5, 6]);
    expect(endingAt([1, 2, 3, 4], 1, 9)).toEqual([1, 9]);
    expect(endingAt([1, 2], 2, 9)).toEqual([1, 2, 9]);
    expect(withoutMeasure([1, 2, 3], 1)).toEqual([1, 3]);
    expect(withoutMeasure([1, 2, 3], 3)).toEqual([1, 2, 3]);
    expect(withInsertedMeasure([1, 2, 3], 1, 9)).toEqual([1, 9, 2, 3]);
    expect(withInsertedMeasure([1, 2, 3], 3, 9)).toEqual([1, 2, 3, 9]);

    const full = Array.from({ length: TRACK_MEASURES }, () => 7);
    expect(lastBar([])).toBe(0);
    expect(lastBar([1, 2])).toBe(2);
    expect(lastBar(full)).toBe(TRACK_MEASURES - 1);
    expect(withInsertedMeasure(full, 0, 9)).toEqual(full);
    expect(withMeasure(full, TRACK_MEASURES - 1, 9)).toHaveLength(TRACK_MEASURES);
    expect(withMeasure(full, TRACK_MEASURES, 9)).toEqual(full);
  });
});

describe('the panel manifest', () => {
  it('places every control the machine has, in the order the document names them', () => {
    expect(PANEL.id).toBe('606');
    expect(PANEL.faceplate).toMatchObject({ file: '606.svg', width: 2000, original: true });
    expect(PANEL.faceplate.credit).toBeUndefined();
    expect(PANEL.steps).toHaveLength(STEPS);
    expect(PANEL.levels.map((knob) => knob.level)).toEqual([...LEVEL_IDS]);
    expect(PANEL.voiceSelect.positions.map((position) => position.track)).toEqual([...TRACK_IDS]);
    expect(PANEL.voiceSelect.positions.map((position) => position.label)).toEqual(TRACKS.map((track) => track.short));
    expect(PANEL.modeSelect.positions.map((position) => position.mode)).toEqual(['track_write', 'track_play', 'pattern_play', 'pattern_write']);
  });

  it('keeps every hit area on the faceplate, and each step key inside its own cell', () => {
    const { width, height } = PANEL.faceplate;
    const rects = [
      ...PANEL.steps.flatMap((step) => [step.hit, step.button]),
      ...PANEL.voiceSelect.positions.map((position) => position.hit),
      ...PANEL.modeSelect.positions.map((position) => position.hit),
      PANEL.run.hit,
      PANEL.clear.hit,
      PANEL.function.hit,
      PANEL.tap.hit,
      PANEL.group.hit,
      PANEL.scale.hit,
      PANEL.scale.slot,
      PANEL.power.hit,
    ];
    for (const [x, y, w, h] of rects) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(width);
      expect(y + h).toBeLessThanOrEqual(height);
    }
    PANEL.steps.forEach((step, index) => {
      const [x, , w] = step.hit;
      expect(step.button[0]).toBeGreaterThan(x);
      expect(step.button[0] + step.button[2]).toBeLessThan(x + w);
      expect(step.led[0]).toBeCloseTo(x + w / 2, 0);
      const next = PANEL.steps[index + 1];
      if (next) expect(next.hit[0]).toBeGreaterThanOrEqual(x + w - 0.2);
    });
  });

  it('says where the machine departs from the hardware, and is called by its number alone', () => {
    expect(PANEL.pending.length).toBeGreaterThan(5);
    expect(PANEL.pending.every((note) => note.endsWith('.'))).toBe(true);
    expect(PANEL.name).toBe('606 panel');
  });
});

describe('the 606 draft', () => {
  it('is kept under a key of its own, with no earlier ones to read', () => {
    expect(document606.draftKey).toBe('tr-clones.606.draft.v1');
    expect(document606.earlierDraftKeys).toEqual([]);
    const storage = new MemoryStorage();
    expect(loadDraft(storage, document606, codec)).toEqual({ status: 'empty' });
    const project = loadFixture();
    expect(saveDraft(storage, document606, project).ok).toBe(true);
    expect([...storage.items.keys()]).toEqual(['tr-clones.606.draft.v1']);
    expect(loadDraft(storage, document606, codec)).toEqual({ status: 'restored', project, changes: [], adopted: false });
  });

  it('sets an unreadable draft aside, never deletes it, and says when storage is full', () => {
    const storage = new MemoryStorage();
    const broken = JSON.stringify({ ...newProject(), tempo: 'fast' });
    storage.setItem(document606.draftKey, broken);
    expect(loadDraft(storage, document606, codec).status).toBe('unreadable');
    expect(storage.getItem(UNREADABLE_DRAFT_KEY)).toBe(broken);
    expect(storage.getItem(document606.draftKey)).toBeNull();
    storage.failWrites = true;
    expect(saveDraft(storage, document606, newProject()).ok).toBe(false);
  });
});
