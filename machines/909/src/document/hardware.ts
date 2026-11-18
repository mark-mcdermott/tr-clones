import { z } from 'zod';
import { faceplateSchema, pointSchema, rectSchema, sweepKnobSchema, themeSchema } from '@tr-clones/panel/schema';
import panel909 from '../../data/909.panel.json';
import { GROUPS, KNOB_IDS, PATTERN_TRACKS, SCALES, STEPS } from './machine';

/**
 * The 909's panel manifest: where every live control is on the drawn
 * faceplate, in the drawing's own pixels, and what the panel leaves out. The
 * drawing is made from this file, so the art and the hit areas cannot drift.
 */

/** A small square key with a lamp in it, by its centre. */
const keySchema = z.object({ at: pointSchema });

export const panelManifestSchema = z.object({
  format: z.literal('boombapbot.panel'),
  schemaVersion: z.literal(1),
  id: z.literal('909'),
  name: z.string().min(1).max(40),
  faceplate: faceplateSchema,
  /** Colours for the drawn panel used when the faceplate image is missing. */
  theme: themeSchema,
  /** Recessed areas of that stand-in. */
  wells: z.array(rectSchema),
  /** The power switch: a rocker whose raised half shows whether the machine is on. */
  power: z.object({ hit: rectSchema, rocker: rectSchema }),
  /** START and STOP. */
  transport: z
    .array(z.object({ action: z.enum(['start', 'stop']), label: z.string().min(1).max(16), hit: rectSchema }))
    .length(2),
  /** The display: its window, and the three digits in it. */
  display: z.object({ window: rectSchema, digits: rectSchema }),
  tempo: sweepKnobSchema,
  /** Every other knob: total accent, the levels and sound knobs of the columns, and the volume. */
  knobs: z.array(sweepKnobSchema.omit({ label: true }).extend({ knob: z.enum(KNOB_IDS) })).length(KNOB_IDS.length),
  /** The small keys: how large one is drawn, how large its hit area is, and where each is. */
  keys: z.object({
    size: z.number().positive(),
    hit: z.number().positive(),
    lampRadius: z.number().positive(),
    tracks: z.array(keySchema).length(PATTERN_TRACKS),
    groups: z.array(keySchema).length(GROUPS),
    tempo: keySchema,
    back: keySchema,
    forward: keySchema,
    available: keySchema,
    cycle: keySchema,
    lastStep: keySchema,
    scale: keySchema,
    shuffle: keySchema,
    clear: keySchema,
    instrument: keySchema,
    shift: keySchema,
  }),
  /** The ENTER key, which is also TOTAL ACCENT, and the lamp window in it. */
  enter: z.object({ hit: rectSchema, lamp: rectSchema }),
  /** The lamps of the scale chart, from the top. */
  scales: z.object({ lamps: z.array(pointSchema).length(SCALES.length), radius: z.number().positive() }),
  /** The step keys, each with the lamp window in its cap. */
  steps: z.array(z.object({ hit: rectSchema, button: rectSchema, lamp: rectSchema })).length(STEPS),
  /** Where the panel departs from the machine. Shown in settings. */
  pending: z.array(z.string()),
});

export type PanelManifest = z.infer<typeof panelManifestSchema>;
export type PanelKnob = PanelManifest['knobs'][number];
export type PanelKey = z.infer<typeof keySchema>;

function loadPanel(): PanelManifest {
  const panel = panelManifestSchema.parse(panel909);
  const listed = new Set(panel.knobs.map((knob) => knob.knob));
  if (KNOB_IDS.some((id) => !listed.has(id))) throw new Error('909.panel.json must place every knob the machine has, once');
  return panel;
}

/** The 909's panel. */
export const PANEL: PanelManifest = loadPanel();
