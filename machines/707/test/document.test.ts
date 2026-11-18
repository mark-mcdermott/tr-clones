import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEVEL,
  EMPTY_ROW,
  FADER_IDS,
  GROUPS,
  GROUP_PATTERNS,
  INSTRUMENT_IDS,
  KEY_SOUNDS,
  PAIRED_IDS,
  PANEL,
  PATTERN_COUNT,
  ROWS,
  ROW_IDS,
  SCALES,
  SHUFFLES,
  SOUNDS,
  SOUND_IDS,
  TRACK_MEASURES,
  accentGains,
  activeGroup,
  clampBpm,
  countHits,
  createEmptyPattern,
  createStarterGroups,
  createStarterTracks,
  document707,
  getRow,
  isEmptyPattern,
  levelGain,
  masterGain,
  panelPattern,
  parseProject,
  patternAt,
  patternIndex,
  patternName,
  rowFader,
  rowMask,
  rowSound,
  rowSounds,
  serializeProject,
  shownPattern,
  shuffleSwing,
  soundRow,
  trackCursor,
  withStep,
  type Project,
} from '../src/document';
import { codec, fixturePath, loadFixture, newProject } from './helpers';

describe('the 707 as sounds and rows', () => {
  it('has fifteen sounds, numbered in the order of the step keys that choose them', () => {
    expect(SOUNDS.map((sound) => sound.id)).toEqual([...SOUND_IDS]);
    expect(SOUNDS.map((sound) => sound.index)).toEqual(Array.from({ length: 15 }, (_, index) => index));
    expect(KEY_SOUNDS).toHaveLength(16);
    // Every sound has a key, in order, and the closed hi-hat has two.
    expect([...new Set(KEY_SOUNDS)]).toEqual([...SOUND_IDS]);
    expect(KEY_SOUNDS.filter((sound) => sound === 'closed_hat')).toHaveLength(2);
  });

  it('has the accent and eleven instruments, each an engine track', () => {
    expect(ROWS.map((row) => row.id)).toEqual([...ROW_IDS]);
    expect(ROWS.map((row) => row.index)).toEqual(Array.from({ length: 12 }, (_, index) => index));
    expect(getRow('accent').sounds).toBeUndefined();
    expect(INSTRUMENT_IDS).toHaveLength(11);
  });

  it('gives every sound to one row, two to each paired instrument', () => {
    expect(INSTRUMENT_IDS.flatMap((id) => rowSounds(id))).toEqual([...SOUND_IDS]);
    for (const id of INSTRUMENT_IDS) {
      expect(rowSounds(id), id).toHaveLength((PAIRED_IDS as readonly string[]).includes(id) ? 2 : 1);
      for (const sound of rowSounds(id)) expect(soundRow(sound)).toBe(id);
    }
    expect(rowSounds('rim_cowbell')).toEqual(['rim_shot', 'cowbell']);
    expect(rowSounds('clap_tambourine')).toEqual(['hand_clap', 'tambourine']);
  });

  it('has a fader for every instrument, one for both hi-hats, and they cut each other off', () => {
    expect([...new Set(INSTRUMENT_IDS.map(rowFader))]).toEqual([...FADER_IDS]);
    expect(rowFader('closed_hat')).toBe('hi_hat');
    expect(rowFader('open_hat')).toBe('hi_hat');
    expect(getRow('closed_hat').chokeGroup).toBeGreaterThan(0);
    expect(getRow('open_hat').chokeGroup).toBe(getRow('closed_hat').chokeGroup);
    expect(INSTRUMENT_IDS.filter((id) => getRow(id).chokeGroup !== 0)).toEqual(['closed_hat', 'open_hat']);
  });

  it('keeps pattern n of group A at 2n and of group B at 2n + 1', () => {
    expect(PATTERN_COUNT).toBe(32);
    expect(patternIndex('a', 0)).toBe(0);
    expect(patternIndex('b', 0)).toBe(1);
    expect(patternIndex('a', 15)).toBe(30);
    expect(patternIndex('b', 15)).toBe(31);
    for (let index = 0; index < PATTERN_COUNT; index += 1) {
      const at = patternAt(index);
      expect(patternIndex(at.group, at.pattern)).toBe(index);
    }
    expect(patternName('b', 4)).toBe('B5');
  });

  it('counts steps to the beat in the order of the scale chart', () => {
    expect(SCALES).toEqual([6, 3, 8, 4]);
  });

  it('shuffles from nothing to a triplet, never further than the engine swings', () => {
    expect(SHUFFLES.map(shuffleSwing)).toEqual([0, 21, 43, 64, 85]);
  });

  it('tapers its faders', () => {
    for (const id of INSTRUMENT_IDS) {
      expect(levelGain(id, DEFAULT_LEVEL)).toBeCloseTo(getRow(id).trim, 10);
      expect(levelGain(id, 0)).toBe(0);
      expect(levelGain(id, 1)).toBeGreaterThan(levelGain(id, DEFAULT_LEVEL));
    }
    expect(accentGains(0)).toEqual({ plain: 0.6, accented: 0.6 });
    expect(accentGains(1)).toEqual({ plain: 0.6, accented: 1 });
    expect(masterGain(0)).toBe(0);
    expect(masterGain(1)).toBe(1);
    expect(clampBpm(10)).toBe(40);
    expect(clampBpm(999)).toBe(240);
    expect(clampBpm(120.4)).toBe(120);
  });

  it('turns a row into the bits the engine takes', () => {
    expect(rowMask(EMPTY_ROW)).toBe(0);
    expect(rowMask(withStep(withStep(EMPTY_ROW, 0, true), 15, true))).toBe(0b1000_0000_0000_0001);
    expect(withStep(EMPTY_ROW, 16, true)).toBe(EMPTY_ROW);
  });
});

describe('a 707 project', () => {
  it('starts with the starter beat, every fader at rest and the panel on pattern A1', () => {
    const project = newProject();
    expect(parseProject(project)).toEqual({ ok: true, project, changes: [] });
    expect(project).toMatchObject({ machine: '707', schemaVersion: 1, tempo: 120, shuffle: 0 });
    expect(project.groups).toEqual(createStarterGroups());
    expect(project.tracks).toEqual(createStarterTracks());
    expect(Object.values(project.mix.levels).every((level) => level === DEFAULT_LEVEL)).toBe(true);
    expect(project.sounds).toEqual({
      bass_drum: 'bass_drum_1',
      snare_drum: 'snare_drum_1',
      rim_cowbell: 'rim_shot',
      clap_tambourine: 'hand_clap',
    });
    expect(project.panel).toEqual({
      mode: 'pattern_play',
      group: 'a',
      pattern: 0,
      chain: null,
      row: 'bass_drum',
      track: 0,
      measure: 0,
      readout: 'tempo',
    });
  });

  it('has a starter beat that shows the machine off and leaves room to write', () => {
    const { a, b } = createStarterGroups();
    expect(a).toHaveLength(GROUP_PATTERNS);
    expect(b).toHaveLength(GROUP_PATTERNS);
    for (const written of [a[0]!, a[1]!, a[2]!, a[3]!, b[0]!]) expect(countHits(written)).toBeGreaterThan(8);
    expect(b[0]).toMatchObject({ scale: 3, lastStep: 12 });
    for (const pattern of [...a.slice(4), ...b.slice(1)]) expect(isEmptyPattern(pattern)).toBe(true);
    // Across the patterns every instrument is heard but none of the second sounds, which the panel chooses.
    const used = INSTRUMENT_IDS.filter((id) => [...a, ...b].some((pattern) => pattern.steps[id] !== EMPTY_ROW));
    expect(used).toEqual([...INSTRUMENT_IDS]);
    const [first, ...rest] = createStarterTracks();
    expect(first).toEqual({ group: 'a', measures: [0, 0, 0, 1, 0, 0, 0, 2] });
    expect(rest.every((track) => track.measures.length === 0)).toBe(true);
  });

  it('reads the committed fixture and writes it back unchanged', () => {
    const text = readFileSync(fixturePath, 'utf8');
    const result = codec.parseText(text);
    expect(result).toMatchObject({ ok: true, changes: [] });
    if (!result.ok) return;
    expect(result.adopted).toBeUndefined();
    expect(codec.serialize(result.project)).toBe(text);
    expect(serializeProject(result.project)).toBe(text);
  });

  it('has a fixture with every setting away from where a new project has it', () => {
    const fixture = loadFixture();
    const fresh = newProject();
    expect(fixture.tempo).not.toBe(fresh.tempo);
    expect(fixture.shuffle).not.toBe(fresh.shuffle);
    expect(fixture.mix.volume).not.toBe(fresh.mix.volume);
    expect(fixture.mix.accent).not.toBe(fresh.mix.accent);
    for (const id of FADER_IDS) expect(fixture.mix.levels[id], id).not.toBe(fresh.mix.levels[id]);
    expect(fixture.sounds).not.toEqual(fresh.sounds);
    expect(fixture.panel.chain).toEqual({ first: 0, last: 3 });
    expect(fixture.tracks.filter((track) => track.measures.length > 0)).toHaveLength(3);
    expect(new Set(GROUPS.flatMap((group) => fixture.groups[group].map((pattern) => pattern.scale)))).toEqual(new Set(SCALES));
  });

  it('refuses what is not a 707 project, and says why', () => {
    const good = loadFixture();
    const pattern = good.groups.a[0]!;
    const withPattern = (change: object): unknown => ({
      ...good,
      groups: { ...good.groups, a: [{ ...pattern, ...change }, ...good.groups.a.slice(1)] },
    });
    const withPanel = (change: object): unknown => ({ ...good, panel: { ...good.panel, ...change } });
    const broken: Array<[string, unknown]> = [
      ['another machine', { ...good, machine: '808' }],
      ['a later version', { ...good, schemaVersion: 2 }],
      ['no name', { ...good, name: '' }],
      ['a tempo too slow', { ...good, tempo: 39 }],
      ['a tempo too fast', { ...good, tempo: 241 }],
      ['a tempo between beats', { ...good, tempo: 120.5 }],
      ['a shuffle past the last', { ...good, shuffle: 5 }],
      ['a fader past its end', { ...good, mix: { ...good.mix, volume: 1.1 } }],
      ['a fader missing', { ...good, mix: { ...good.mix, levels: { ...good.mix.levels, hi_hat: undefined } } }],
      ['a sound from another row', { ...good, sounds: { ...good.sounds, bass_drum: 'cowbell' } }],
      ['a sound that does not exist', { ...good, sounds: { ...good.sounds, snare_drum: 'snare_drum_3' } }],
      ['a short row', withPattern({ steps: { ...pattern.steps, bass_drum: 'x...' } })],
      ['a row of other marks', withPattern({ steps: { ...pattern.steps, bass_drum: 'X...............' } })],
      ['a row missing', withPattern({ steps: { ...pattern.steps, ride: undefined } })],
      ['no last step', withPattern({ lastStep: 0 })],
      ['a last step past the keys', withPattern({ lastStep: 17 })],
      ['a scale the engine has not', withPattern({ scale: 5 })],
      ['a group of fifteen', { ...good, groups: { ...good.groups, b: good.groups.b.slice(1) } }],
      ['a third group', { ...good, groups: { ...good.groups, c: good.groups.a } }],
      ['three tracks', { ...good, tracks: good.tracks.slice(1) }],
      ['a measure of pattern 17', { ...good, tracks: [{ group: 'a', measures: [16] }, ...good.tracks.slice(1)] }],
      [
        'a track too long',
        { ...good, tracks: [{ group: 'a', measures: Array.from({ length: TRACK_MEASURES + 1 }, () => 0) }, ...good.tracks.slice(1)] },
      ],
      ['a track of group C', { ...good, tracks: [{ group: 'c', measures: [] }, ...good.tracks.slice(1)] }],
      ['a mode it has not', withPanel({ mode: 'manual_play' })],
      ['a row it has not', withPanel({ row: 'cymbal' })],
      ['a fifth track', withPanel({ track: 4 })],
      ['a chain that runs backwards', withPanel({ chain: { first: 3, last: 0 } })],
      ['a chain of one', withPanel({ chain: { first: 1, last: 1 } })],
      ['a pattern outside its chain', withPanel({ pattern: 9 })],
      ['nothing at all', null],
      ['a word', 'a beat'],
    ];
    for (const [what, value] of broken) {
      const result = parseProject(value);
      expect(result.ok, what).toBe(false);
      if (!result.ok) expect(result.errors.length, what).toBeGreaterThan(0);
    }
    expect(() => serializeProject({ ...good, tempo: 39 })).toThrow();
  });

  it('is told from another machine by the name it carries', () => {
    expect(document707).toMatchObject({ machine: '707', draftKey: 'tr-clones.707.draft.v1', earlierDraftKeys: [] });
    expect(document707.owns({ machine: '707', schemaVersion: 1 })).toBe(true);
    expect(document707.owns({ schemaVersion: 2 })).toBe(false);
    expect(document707.owns({ machine: '808' })).toBe(false);
    const unnamed: Partial<Project> = { ...newProject() };
    delete unnamed.machine;
    expect(codec.parse(unnamed)).toEqual({ ok: false, errors: ['This project was made on a machine this build does not have.'] });
    expect(codec.parseText('{')).toEqual({ ok: false, errors: ['The file is not valid JSON.'] });
    expect(codec.parse({ format: 'something.else' })).toEqual({ ok: false, errors: ['This is not a boombapbot project file.'] });
    const made = document707.create({ id: 'made', now: new Date('2026-11-17T12:00:00.000Z') });
    expect(made).toMatchObject({ id: 'made', name: 'Starter beat', machine: '707' });
  });
});

describe('where the panel stands', () => {
  const project = loadFixture();
  const at = (panel: Partial<Project['panel']>): Project => ({ ...project, panel: { ...project.panel, chain: null, ...panel } });

  it('takes its patterns from the panel\'s group, or in the track modes from the track\'s own', () => {
    expect(activeGroup(at({ mode: 'pattern_step', group: 'a', track: 1 }))).toBe('a');
    expect(activeGroup(at({ mode: 'track_write', group: 'a', track: 1 }))).toBe('b');
    expect(activeGroup(at({ mode: 'track_play', group: 'b', track: 0 }))).toBe('a');
  });

  it('never stands past the measure after a track\'s last', () => {
    expect(trackCursor(at({ track: 0, measure: 3 }))).toBe(3);
    expect(trackCursor(at({ track: 0, measure: 99 }))).toBe(5);
    expect(trackCursor(at({ track: 2, measure: 4 }))).toBe(0);
  });

  it('is on the pattern its keys chose, or playing a track, on the one of its measure', () => {
    expect(panelPattern(at({ mode: 'pattern_play', group: 'b', pattern: 7 }))).toEqual({ group: 'b', pattern: 7 });
    expect(panelPattern(at({ mode: 'track_write', track: 1, pattern: 7 }))).toEqual({ group: 'b', pattern: 7 });
    expect(panelPattern(at({ mode: 'track_play', track: 0, measure: 3, pattern: 7 }))).toEqual({ group: 'a', pattern: 2 });
    // Past its end, a track shows its last measure; an empty one, the pattern the keys chose.
    expect(panelPattern(at({ mode: 'track_play', track: 0, measure: 99, pattern: 7 }))).toEqual({ group: 'a', pattern: 3 });
    expect(panelPattern(at({ mode: 'track_play', track: 2, pattern: 7 }))).toEqual({ group: 'a', pattern: 7 });
  });

  it('shows the pattern that is sounding while the machine plays', () => {
    const stopped = at({ mode: 'pattern_play', group: 'a', pattern: 2 });
    expect(shownPattern(stopped)).toEqual({ group: 'a', pattern: 2 });
    expect(shownPattern(stopped, patternIndex('b', 5))).toEqual({ group: 'b', pattern: 5 });
  });

  it('counts the hits a pattern plays, and knows a cleared one', () => {
    const pattern = project.groups.b[1]!;
    expect(pattern.lastStep).toBe(7);
    // Three bass drums, two low toms, two mid toms, a hi tom and an open hat fall inside seven steps.
    expect(countHits(pattern)).toBe(9);
    expect(countHits({ ...pattern, lastStep: 3 })).toBe(4);
    expect(isEmptyPattern(createEmptyPattern())).toBe(true);
    expect(isEmptyPattern({ ...createEmptyPattern(), lastStep: 12 })).toBe(false);
    expect(isEmptyPattern({ ...createEmptyPattern(), scale: 3 })).toBe(false);
    expect(isEmptyPattern(pattern)).toBe(false);
  });

  it('plays the sound the project chose on a paired row, and its only sound on any other', () => {
    expect(rowSound('bass_drum', project.sounds)).toBe('bass_drum_2');
    expect(rowSound('rim_cowbell', project.sounds)).toBe('cowbell');
    expect(rowSound('ride', project.sounds)).toBe('ride');
  });
});

describe('the panel manifest', () => {
  it('places every live control inside the faceplate', () => {
    const { width, height } = PANEL.faceplate;
    expect(width).toBe(2000);
    const rects = [
      PANEL.power.hit,
      PANEL.power.slot,
      PANEL.display,
      PANEL.start.hit,
      PANEL.stop.hit,
      PANEL.shift.hit,
      PANEL.enter.hit,
      ...PANEL.faders.map((fader) => fader.hit),
      ...PANEL.keys.flatMap((key) => [key.hit, key.button]),
      ...PANEL.groups.flatMap((group) => [group.hit, group.button, group.lamp]),
      ...PANEL.scales.map((scale) => scale.lamp),
      ...PANEL.steps.flatMap((step) => [step.hit, step.button, step.lamp]),
    ];
    for (const [x, y, w, h] of rects) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(width);
      expect(y + h).toBeLessThanOrEqual(height);
    }
  });

  it('has no two controls that can be pressed in the same place', () => {
    const pressed = [
      PANEL.power.hit,
      PANEL.start.hit,
      PANEL.stop.hit,
      PANEL.shift.hit,
      PANEL.enter.hit,
      [PANEL.tempo.cx - PANEL.tempo.r, PANEL.tempo.cy - PANEL.tempo.r, PANEL.tempo.r * 2, PANEL.tempo.r * 2],
      ...PANEL.faders.map((fader) => fader.hit),
      ...PANEL.keys.map((key) => key.hit),
      ...PANEL.groups.map((group) => group.hit),
      ...PANEL.steps.map((step) => step.hit),
    ] as Array<[number, number, number, number]>;
    for (let a = 0; a < pressed.length; a += 1) {
      for (let b = a + 1; b < pressed.length; b += 1) {
        const [ax, ay, aw, ah] = pressed[a]!;
        const [bx, by, bw, bh] = pressed[b]!;
        const apart = ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay;
        expect(apart, `controls ${a} and ${b}`).toBe(true);
      }
    }
  });

  it('is an original drawing, and says what it leaves out', () => {
    expect(PANEL.faceplate).toMatchObject({ file: '707.svg', original: true });
    expect(PANEL.faceplate.credit).toBeUndefined();
    expect(PANEL.pending.length).toBeGreaterThan(4);
    expect(PANEL.pending.join(' ')).toMatch(/flam/i);
  });
});
