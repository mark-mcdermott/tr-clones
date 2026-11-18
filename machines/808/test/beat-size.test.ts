import { describe, expect, it } from 'vitest';
import { beatBytes, beatTooLarge } from '@boombapbot/contracts';
import { RHYTHM_TRACK_MEASURES, TRACK_IDS, createProject, parseProject, type Project } from '../src/document';

/** A project with everything the schema allows turned up as far as it goes. */
function fullestProject(): Project {
  const project = createProject({ id: 'x'.repeat(64), now: new Date('2026-11-16T12:00:00.000Z') });
  const awkward = 0.12345678901234568;
  const everyStep = 'x'.repeat(32);
  const allOn = Object.fromEntries(TRACK_IDS.map((id) => [id, everyStep])) as Project['rhythms'][number]['a'];
  return {
    ...project,
    name: '🥁'.repeat(40),
    tempo: { coarse: 39, fine: -awkward },
    sound: {
      master: awkward,
      accent: awkward,
      levels: mapValues(project.sound.levels, () => awkward),
      knobs: mapValues(project.sound.knobs, (knobs) => mapValues(knobs, () => awkward)),
      alternates: mapValues(project.sound.alternates, () => false),
    },
    rhythms: project.rhythms.map((rhythm) => ({ ...rhythm, firstLength: 16, secondLength: 16, a: allOn, b: allOn })),
    rhythmTracks: project.rhythmTracks.map(() => Array.from({ length: RHYTHM_TRACK_MEASURES }, () => 15)),
  };
}

function mapValues<Key extends string, From, To>(record: Record<Key, From>, change: (value: From) => To): Record<Key, To> {
  return Object.fromEntries(Object.entries<From>(record).map(([key, value]) => [key, change(value)])) as Record<Key, To>;
}

describe('the size of a saved 808 beat', () => {
  it('the fullest project the machine can hold still fits', () => {
    const project = fullestProject();
    expect(parseProject(project).ok).toBe(true);
    expect(beatTooLarge(beatBytes(project))).toBe(false);
  });
});
