import { z } from 'zod';
import { EMPTY_ROW, TRACK_IDS, withStep, type TrackId } from './machine';

/**
 * Version 1 of the project document: one 16-step beat on eight lanes, with a
 * velocity for every hit and a swing amount. It is read only to bring old
 * drafts and files into the current format.
 */
const V1_ROLES = ['kick', 'snare', 'closed_hat', 'open_hat', 'low_tom', 'high_tom', 'clap', 'cymbal'] as const;
const V1_STEPS = 16;
/** A v1 hit at or above this velocity was drawn and heard as an accent. */
const V1_ACCENT = 120;

const v1Schema = z.object({
  format: z.literal('boombapbot.project'),
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  bpm: z.number().min(40).max(240),
  swing: z.number().min(50).max(75),
  kit: z.object({ id: z.enum(['606', '707', '808', '909']), version: z.string().min(1).max(40) }),
  pattern: z.object({
    stepCount: z.literal(V1_STEPS),
    lanes: z
      .array(
        z.object({
          role: z.enum(V1_ROLES),
          steps: z.array(z.number().int().min(0).max(127)).length(V1_STEPS),
        }),
      )
      .length(V1_ROLES.length)
      .refine((lanes) => new Set(lanes.map((lane) => lane.role)).size === lanes.length, {
        message: 'each drum role must appear in exactly one lane',
      }),
  }),
});

/** A version 1 beat, reduced to what the current format can hold. */
export interface V1Beat {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  bpm: number;
  /** The beat as on/off rows, with an accent row made from its loudest hits. */
  variation: Record<TrackId, string>;
}

export type V1Result =
  | { ok: true; beat: V1Beat; /** What the beat lost on the way. */ changes: string[] }
  | { ok: false; errors: string[] };

/** Reads a version 1 project. Never throws. */
export function readV1(input: unknown): V1Result {
  const parsed = v1Schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 8).map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
        return `${path}${issue.message}`;
      }),
    };
  }
  const v1 = parsed.data;
  const variation = Object.fromEntries(TRACK_IDS.map((id) => [id, EMPTY_ROW])) as Record<TrackId, string>;
  const velocities = new Set<number>();
  for (const lane of v1.pattern.lanes) {
    lane.steps.forEach((velocity, step) => {
      if (velocity === 0) return;
      velocities.add(velocity);
      variation[lane.role] = withStep(variation[lane.role], step, true);
      if (velocity >= V1_ACCENT) variation.accent = withStep(variation.accent, step, true);
    });
  }

  const changes: string[] = [];
  if (velocities.size > 1) {
    changes.push('Each hit had its own velocity. Steps are now on or off, and the loudest ones are accented.');
  }
  if (v1.swing !== 50) changes.push(`Swing of ${v1.swing}% was dropped: the 808 has none.`);
  if (v1.kit.id !== '808') changes.push(`It was made on the ${v1.kit.id} kit and now plays on the 808.`);

  return {
    ok: true,
    beat: { id: v1.id, name: v1.name, createdAt: v1.createdAt, updatedAt: v1.updatedAt, bpm: v1.bpm, variation },
    changes,
  };
}
