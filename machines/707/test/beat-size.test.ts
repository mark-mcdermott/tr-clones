import { describe, expect, it } from 'vitest';
import { beatBytes, beatTooLarge } from '@boombapbot/contracts';
import { ROW_IDS, TRACK_MEASURES, createProject, parseProject, type Project } from '../src/document';

function mapValues<Key extends string, From, To>(record: Record<Key, From>, change: (value: From) => To): Record<Key, To> {
  return Object.fromEntries(Object.entries<From>(record).map(([key, value]) => [key, change(value)])) as Record<Key, To>;
}

/** A project with everything the schema allows turned up as far as it goes. */
function fullestProject(): Project {
  const project = createProject({ id: 'x'.repeat(64), now: new Date('2026-11-17T12:00:00.000Z') });
  const awkward = 0.12345678901234568;
  const allOn = Object.fromEntries(ROW_IDS.map((id) => [id, 'x'.repeat(16)])) as Project['groups']['a'][number]['steps'];
  return {
    ...project,
    name: '🥁'.repeat(40),
    tempo: 240,
    shuffle: 4,
    mix: { volume: awkward, accent: awkward, levels: mapValues(project.mix.levels, () => awkward) },
    groups: mapValues(project.groups, (patterns) => patterns.map(() => ({ scale: 8 as const, lastStep: 16, steps: allOn }))),
    tracks: project.tracks.map(() => ({ group: 'b' as const, measures: Array.from({ length: TRACK_MEASURES }, () => 15) })),
    panel: { ...project.panel, mode: 'pattern_play', pattern: 15, chain: { first: 14, last: 15 }, measure: TRACK_MEASURES },
  };
}

describe('the size of a saved 707 beat', () => {
  it('the fullest project the machine can hold still fits', () => {
    const project = fullestProject();
    expect(parseProject(project).ok).toBe(true);
    expect(beatTooLarge(beatBytes(project))).toBe(false);
    // With room to spare: a later field or two will not push it over.
    expect(beatBytes(project)).toBeLessThan(32 * 1024);
  });
});
