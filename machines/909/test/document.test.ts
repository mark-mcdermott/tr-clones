import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT } from '@boombapbot/contracts';
import {
  GROUPS,
  GROUP_PATTERNS,
  INSTRUMENTS,
  KEY_INSTRUMENTS,
  KNOBS,
  KNOB_IDS,
  PANEL,
  PATTERN_TRACKS,
  SCALES,
  STEPS,
  TRACKS,
  TRACK_IDS,
  TRACK_MEASURES,
  activeGroup,
  chainOf,
  countHits,
  createEmptyPattern,
  createEmptyPatterns,
  createProject,
  createStarterPatterns,
  createStarterTracks,
  document909,
  engineSwing,
  isEmptyPattern,
  nextScale,
  nextStep,
  parseProject,
  patternIndex,
  rowMask,
  selectedPattern,
  serializeProject,
  stepsPerBeat,
  withStep,
  type Project,
} from '../src/document';
import { codec, fixturePath, loadFixture, newProject } from './helpers';

describe('the machine table', () => {
  it('has the total accent and eleven instruments, each with its own sound, track and note', () => {
    expect(TRACKS.map((track) => track.id)).toEqual([...TRACK_IDS]);
    expect(TRACKS[0]).toMatchObject({ id: 'accent', index: 0 });
    expect(INSTRUMENTS).toHaveLength(11);
    expect(INSTRUMENTS.map((instrument) => instrument.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(new Set(INSTRUMENTS.map((instrument) => instrument.note)).size).toBe(11);
  });

  it('gives the two hi-hats one level knob and one choke group, and nothing else shares either', () => {
    const levels = INSTRUMENTS.map((instrument) => instrument.level);
    expect(levels.filter((level) => level === 'hi_hat_level')).toHaveLength(2);
    expect(new Set(levels).size).toBe(10);
    expect(INSTRUMENTS.filter((instrument) => instrument.chokeGroup !== 0).map((instrument) => instrument.id)).toEqual([
      'closed_hat',
      'open_hat',
    ]);
  });

  it('uses every knob exactly once: as a level, as a sound knob, or as the accent or the volume', () => {
    const used = [
      'accent',
      'volume',
      ...new Set(INSTRUMENTS.map((instrument) => instrument.level)),
      ...INSTRUMENTS.flatMap((instrument) => Object.values(instrument.sound)),
    ];
    expect([...used].sort()).toEqual([...KNOB_IDS].sort());
    expect(KNOBS.every((knob) => knob.label.length > 0)).toBe(true);
  });

  it('names the columns as the panel does: attack on the bass drum is the engine tone knob', () => {
    const sound = (id: string) => INSTRUMENTS.find((instrument) => instrument.id === id)!.sound;
    expect(sound('bass_drum')).toEqual({ tune: 'bass_drum_tune', tone: 'bass_drum_attack', decay: 'bass_drum_decay' });
    expect(sound('snare_drum')).toEqual({ tune: 'snare_drum_tune', tone: 'snare_drum_tone', snappy: 'snare_drum_snappy' });
    expect(sound('rim_shot')).toEqual({});
    expect(sound('hand_clap')).toEqual({});
  });

  it('puts an instrument on every step key, in the order of the engine tracks', () => {
    expect(KEY_INSTRUMENTS).toHaveLength(STEPS);
    expect([...new Set(KEY_INSTRUMENTS)]).toEqual(INSTRUMENTS.map((instrument) => instrument.id));
  });

  it('keeps the two groups in the engine as the two versions of sixteen rhythms', () => {
    expect(patternIndex(0, 0)).toBe(0);
    expect(patternIndex(1, 0)).toBe(1);
    expect(patternIndex(0, 15)).toBe(30);
    expect(patternIndex(1, 15)).toBe(31);
    expect(GROUPS * GROUP_PATTERNS).toBe(32);
    // The four tracks together are the longest song the engine takes.
    expect(PATTERN_TRACKS * TRACK_MEASURES).toBe(768);
  });

  it('has four scales and seven shuffle settings', () => {
    expect(SCALES.map(stepsPerBeat)).toEqual([6, 3, 8, 4]);
    expect([1, 2, 3, 4].map((scale) => nextScale(scale as 1))).toEqual([2, 3, 4, 1]);
    expect([0, 1, 2, 3, 4, 5, 6].map(engineSwing)).toEqual([0, 21, 43, 64, 85, 107, 128]);
    expect(engineSwing(99)).toBe(128);
  });

  it('turns a row of steps into the bits the engine takes', () => {
    expect(rowMask('x...............')).toBe(1);
    expect(rowMask('...............x')).toBe(1 << 15);
    expect(rowMask(withStep('................', 4, true))).toBe(16);
    expect(withStep('x...............', 0, false)).toBe('................');
    expect(withStep('................', 16, true)).toBe('................');
  });
});

describe('the panel manifest', () => {
  it('places every knob once, every key, and sixteen step keys from left to right', () => {
    expect(PANEL.knobs.map((knob) => knob.knob).sort()).toEqual([...KNOB_IDS].sort());
    expect(PANEL.steps).toHaveLength(16);
    PANEL.steps.forEach((step, index) => {
      if (index > 0) expect(step.button[0]).toBeGreaterThan(PANEL.steps[index - 1]!.button[0]);
      // The lamp window is in the key cap, and the key is inside its hit area.
      expect(step.lamp[0]).toBeGreaterThan(step.button[0]);
      expect(step.lamp[0] + step.lamp[2]).toBeLessThan(step.button[0] + step.button[2]);
      expect(step.hit[0]).toBeLessThanOrEqual(step.button[0]);
    });
    expect(PANEL.faceplate).toMatchObject({ file: '909.svg', width: 2000, original: true });
    expect(PANEL.faceplate.credit).toBeUndefined();
  });

  it('keeps every control inside the faceplate and no two knobs on top of each other', () => {
    const { width, height } = PANEL.faceplate;
    for (const knob of [PANEL.tempo, ...PANEL.knobs]) {
      expect(knob.cx - knob.r).toBeGreaterThan(0);
      expect(knob.cx + knob.r).toBeLessThan(width);
      expect(knob.cy + knob.r).toBeLessThan(height);
    }
    const knobs = [PANEL.tempo, ...PANEL.knobs];
    for (const a of knobs) {
      for (const b of knobs) {
        if (a !== b) expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThan(a.r + b.r);
      }
    }
  });

  it('says where it departs from the machine', () => {
    expect(PANEL.pending.length).toBeGreaterThan(8);
    expect(PANEL.pending.every((line) => line.endsWith('.'))).toBe(true);
    expect(PANEL.name).toBe('909 panel');
  });
});

describe('a new project', () => {
  it('is a 909 document with every knob at rest and the starter patterns', () => {
    const project = newProject();
    expect(project).toMatchObject({ format: PROJECT_FORMAT, schemaVersion: 1, machine: '909', tempo: 125 });
    expect(Object.keys(project.knobs)).toEqual([...KNOB_IDS]);
    expect(project.knobs.bass_drum_level).toBe(0.75);
    expect(project.knobs.bass_drum_attack).toBe(0.5);
    expect(project.patterns).toEqual(createStarterPatterns());
    expect(project.patternTracks).toEqual(createStarterTracks());
    expect(project.panel).toEqual({
      mode: 'pattern_play',
      track: 0,
      group: 0,
      pattern: 0,
      chain: 0,
      write: 'step',
      instrument: 'bass_drum',
      cycle: false,
    });
    expect(parseProject(project)).toEqual({ ok: true, project, changes: [] });
  });

  it('given patterns of its own, has no starter track', () => {
    const project = createProject({ id: 'own', now: new Date(0), patterns: createEmptyPatterns(), bpm: 90 });
    expect(project.tempo).toBe(90);
    expect(project.patternTracks.every((track) => track.measures.length === 0)).toBe(true);
    expect(project.patterns.flat().every(isEmptyPattern)).toBe(true);
  });

  it('opens on a beat that can be heard, and leaves patterns empty for writing', () => {
    const [first, second] = createStarterPatterns();
    expect(countHits(first![0]!)).toBeGreaterThan(20);
    for (const number of [0, 1, 2, 3, 4, 5, 6, 7, 15]) expect(isEmptyPattern(first![number]!), `pattern ${number + 1}`).toBe(false);
    for (const number of [8, 9, 10, 11, 12, 13, 14]) expect(isEmptyPattern(first![number]!), `pattern ${number + 1}`).toBe(true);
    expect(second!.slice(2).every(isEmptyPattern)).toBe(true);
    // The starter shows the machine off: triplets, thirty-seconds, a short bar and a shuffle.
    expect(first![5]).toMatchObject({ scale: 2, lastStep: 12 });
    expect(first![6]).toMatchObject({ scale: 3 });
    expect(first![7]).toMatchObject({ lastStep: 7 });
    expect(first![4]!.shuffle).toBeGreaterThan(0);
    // Every instrument is somewhere in it.
    for (const instrument of INSTRUMENTS) {
      expect(first!.some((pattern) => pattern.steps[instrument.id].includes('x')), instrument.id).toBe(true);
    }
  });

  it('has a starter track that plays written patterns of its own group', () => {
    const tracks = createStarterTracks();
    const patterns = createStarterPatterns();
    expect(tracks[0]!.measures.length).toBe(16);
    for (const measure of tracks[0]!.measures) expect(isEmptyPattern(patterns[tracks[0]!.group]![measure]!)).toBe(false);
    expect(tracks.slice(1).every((track) => track.measures.length === 0)).toBe(true);
  });
});

describe('where the panel stands', () => {
  it('takes the group from the PATTERN key in the pattern modes and from the track in the track modes', () => {
    const fixture = loadFixture();
    expect(activeGroup({ ...fixture, panel: { ...fixture.panel, mode: 'pattern_play', group: 1 } })).toBe(1);
    expect(activeGroup({ ...fixture, panel: { ...fixture.panel, mode: 'track_play', track: 0, group: 1 } })).toBe(0);
    expect(activeGroup({ ...fixture, panel: { ...fixture.panel, mode: 'track_write', track: 1, group: 0 } })).toBe(1);
    const inTrack: Project = { ...fixture, panel: { ...fixture.panel, mode: 'track_write', track: 1, pattern: 15, chain: 15 } };
    expect(selectedPattern(inTrack)).toBe(fixture.patterns[1]![15]);
  });

  it('lists a chain from its first pattern to its last', () => {
    expect(chainOf({ pattern: 3, chain: 3 })).toEqual([3]);
    expect(chainOf({ pattern: 2, chain: 5 })).toEqual([2, 3, 4, 5]);
  });

  it('wraps at the last step, and counts only the hits a pattern plays', () => {
    const short = { ...createEmptyPattern(), lastStep: 7 };
    expect(nextStep(short, 5)).toBe(6);
    expect(nextStep(short, 6)).toBe(0);
    const hits = { ...short, steps: { ...short.steps, bass_drum: 'x.....x.x.......', accent: 'x...............' } };
    expect(countHits(hits)).toBe(2);
    expect(isEmptyPattern(short)).toBe(false);
    expect(isEmptyPattern(createEmptyPattern())).toBe(true);
  });
});

describe('reading and writing a project', () => {
  it('reads the fixture and writes it back unchanged', () => {
    const text = readFileSync(fixturePath, 'utf8');
    const result = codec.parseText(text);
    expect(result).toMatchObject({ ok: true, changes: [] });
    if (!result.ok) return;
    expect(result.adopted).toBeUndefined();
    expect(serializeProject(result.project)).toBe(text);
    expect(codec.serialize(result.project)).toBe(text);
  });

  it('has a fixture with both groups, every scale, a shuffle, a short pattern and written tracks', () => {
    const fixture = loadFixture();
    const all = fixture.patterns.flat();
    expect(new Set(all.map((pattern) => pattern.scale))).toEqual(new Set([1, 2, 3, 4]));
    expect(all.some((pattern) => pattern.shuffle > 0)).toBe(true);
    expect(all.some((pattern) => pattern.lastStep < 16)).toBe(true);
    expect(fixture.patterns.every((group) => group.some((pattern) => !isEmptyPattern(pattern)))).toBe(true);
    expect(fixture.patternTracks.map((track) => track.measures.length)).toEqual([4, 3, 20, 0]);
    expect(fixture.patternTracks[1]!.group).toBe(1);
    // No knob is where a new machine has it.
    const rest = newProject().knobs;
    for (const id of KNOB_IDS) expect(fixture.knobs[id], id).not.toBe(rest[id]);
  });

  it('survives a round trip of the starter project', () => {
    const project = newProject();
    const result = codec.parseText(serializeProject(project));
    expect(result).toEqual({ ok: true, project, changes: [] });
  });

  it('owns only documents that name the 909', () => {
    expect(document909.owns({ machine: '909' })).toBe(true);
    expect(document909.owns({})).toBe(false);
    expect(document909.owns({ machine: '808' })).toBe(false);
    expect(document909.draftKey).toBe('tr-clones.909.draft.v1');
    expect(document909.earlierDraftKeys).toEqual([]);
    expect(codec.parse({ ...newProject(), machine: '707' })).toEqual({
      ok: false,
      errors: ['This project was made on a machine this build does not have.'],
    });
  });

  it('refuses what is not a current 909 project, and says why', () => {
    const good = loadFixture();
    const refused = (input: unknown) => {
      const result = codec.parse(input);
      expect(result.ok).toBe(false);
      return result.ok ? [] : result.errors;
    };
    expect(refused({ ...good, format: 'other' })).toEqual(['This is not a boombapbot project file.']);
    expect(refused({ ...good, schemaVersion: 2 })).toEqual([
      'This project uses schema version 2. This build reads version 1.',
    ]);
    expect(codec.parseText('{not json')).toEqual({ ok: false, errors: ['The file is not valid JSON.'] });
    expect(refused(null).length).toBeGreaterThan(0);
    expect(refused('a beat').length).toBeGreaterThan(0);

    const broken: Array<[string, unknown]> = [
      ['tempo', { ...good, tempo: 300 }],
      ['tempo', { ...good, tempo: 120.5 }],
      ['knobs', { ...good, knobs: { ...good.knobs, volume: 1.2 } }],
      ['knobs', { ...good, knobs: { ...good.knobs, ride_tune: undefined } }],
      ['patterns', { ...good, patterns: [good.patterns[0]] }],
      ['patterns', { ...good, patterns: [good.patterns[0], good.patterns[1]!.slice(1)] }],
      ['patterns.0.0.steps.bass_drum', withRow(good, 'x'.repeat(17))],
      ['patterns.0.0.steps.bass_drum', withRow(good, 'x.x.x.x.x.x.x.xo')],
      ['patterns.0.0.lastStep', withShape(good, { lastStep: 0 })],
      ['patterns.0.0.lastStep', withShape(good, { lastStep: 17 })],
      ['patterns.0.0.scale', withShape(good, { scale: 5 })],
      ['patterns.0.0.shuffle', withShape(good, { shuffle: 7 })],
      ['patternTracks', { ...good, patternTracks: good.patternTracks.slice(1) }],
      ['patternTracks.0.measures', withTrack(good, { group: 0, measures: [16] })],
      ['patternTracks.0.measures', withTrack(good, { group: 0, measures: Array.from({ length: TRACK_MEASURES + 1 }, () => 0) })],
      ['patternTracks.0.group', withTrack(good, { group: 2, measures: [] })],
      ['panel.mode', { ...good, panel: { ...good.panel, mode: 'compose' } }],
      ['panel.track', { ...good, panel: { ...good.panel, track: 4 } }],
      ['panel.instrument', { ...good, panel: { ...good.panel, instrument: 'cowbell' } }],
      ['panel.chain', { ...good, panel: { ...good.panel, pattern: 5, chain: 4 } }],
      ['name', { ...good, name: '' }],
    ];
    for (const [path, input] of broken) {
      const errors = refused(input);
      expect(errors.some((error) => error.startsWith(path)), `${path}: ${errors.join(' | ')}`).toBe(true);
    }
  });

  it('never throws on a file too large to be a project', () => {
    expect(codec.parseText(' '.repeat(1_000_001))).toEqual({
      ok: false,
      errors: ['The file is too large to be a boombapbot project.'],
    });
  });
});

function withShape(project: Project, shape: object): unknown {
  const patterns = project.patterns.map((group) => [...group]);
  patterns[0]![0] = { ...patterns[0]![0]!, ...shape };
  return { ...project, patterns };
}

function withRow(project: Project, row: string): unknown {
  return withShape(project, { steps: { ...project.patterns[0]![0]!.steps, bass_drum: row } });
}

function withTrack(project: Project, track: unknown): unknown {
  return { ...project, patternTracks: [track, ...project.patternTracks.slice(1)] };
}
