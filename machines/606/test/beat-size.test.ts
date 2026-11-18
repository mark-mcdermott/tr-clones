import { describe, expect, it } from 'vitest';
import { beatBytes, beatTooLarge } from '@boombapbot/contracts';
import { TRACK_IDS, TRACK_MEASURES, createProject, parseProject, type Project } from '../src/document';

/** A project with everything the schema allows turned up as far as it goes. */
function fullestProject(): Project {
  const project = createProject({ id: 'x'.repeat(64), now: new Date('2026-11-17T12:00:00.000Z') });
  const awkward = 0.12345678901234568;
  const everyStep = 'x'.repeat(16);
  const allOn = Object.fromEntries(TRACK_IDS.map((id) => [id, everyStep])) as Project['patterns'][number][number]['steps'];
  return {
    ...project,
    name: '🥁'.repeat(40),
    tempo: 300,
    mix: {
      volume: awkward,
      levels: Object.fromEntries(Object.keys(project.mix.levels).map((id) => [id, awkward])) as Project['mix']['levels'],
    },
    patterns: project.patterns.map((group) => group.map(() => ({ scale: 4 as const, lastStep: 16, steps: allOn }))),
    tracks: project.tracks.map(() => Array.from({ length: TRACK_MEASURES }, () => 15)),
    panel: { ...project.panel, mode: 'pattern_write', selector: 7, group: 1, pattern: 12, chainEnd: 15, scale: 4 },
  };
}

describe('the size of a saved 606 beat', () => {
  it('the fullest project the machine can hold still fits', () => {
    const project = fullestProject();
    expect(parseProject(project).ok).toBe(true);
    expect(beatTooLarge(beatBytes(project))).toBe(false);
  });
});
