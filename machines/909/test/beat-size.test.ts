import { describe, expect, it } from 'vitest';
import { beatBytes, beatTooLarge } from '@boombapbot/contracts';
import { KNOB_IDS, TRACK_IDS, TRACK_MEASURES, createProject, parseProject, type Project } from '../src/document';

/** A project with everything the schema allows turned up as far as it goes. */
function fullestProject(): Project {
  const project = createProject({ id: 'x'.repeat(64), now: new Date('2026-11-17T12:00:00.000Z') });
  const awkward = 0.12345678901234568;
  const everyStep = Object.fromEntries(TRACK_IDS.map((id) => [id, 'x'.repeat(16)])) as Project['patterns'][number][number]['steps'];
  return {
    ...project,
    name: '🥁'.repeat(40),
    tempo: 290,
    knobs: Object.fromEntries(KNOB_IDS.map((id) => [id, awkward])) as Project['knobs'],
    patterns: project.patterns.map((group) => group.map(() => ({ scale: 4 as const, lastStep: 16, shuffle: 6, steps: everyStep }))),
    patternTracks: project.patternTracks.map(() => ({ group: 1 as const, measures: Array.from({ length: TRACK_MEASURES }, () => 15) })),
    panel: { ...project.panel, mode: 'pattern_write', pattern: 10, chain: 15, instrument: 'closed_hat' },
  };
}

describe('the size of a saved 909 beat', () => {
  it('the fullest project the machine can hold still fits', () => {
    const project = fullestProject();
    expect(parseProject(project).ok).toBe(true);
    expect(beatTooLarge(beatBytes(project))).toBe(false);
  });
});
