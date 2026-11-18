import { z } from 'zod';
import { faceplateSchema, rectSchema, sweepKnobSchema, themeSchema } from '@tr-clones/panel/schema';
import panel707 from '../../data/707.panel.json';
import { FADER_IDS, SCALES, STEPS } from './machine';

/**
 * The 707's panel manifest: where every live control is on the drawn
 * faceplate, and what the panel does not do as the machine does. All
 * coordinates are pixels of the faceplate, so they scale with it. The drawing
 * is made from the same file, so the two cannot drift apart.
 */

/** The faders of the bank, left to right: the accent, a level for each instrument group, and the volume. */
export const PANEL_FADER_IDS = ['accent', ...FADER_IDS, 'volume'] as const;
export type PanelFaderId = (typeof PANEL_FADER_IDS)[number];

/** The small keys above the scale chart, left to right. */
export const FUNCTION_KEYS = [
  'clear',
  'scale',
  'last_step',
  'instrument',
  'shuffle',
  'tempo_measure',
  'track',
  'pattern',
] as const;
export type FunctionKey = (typeof FUNCTION_KEYS)[number];

/** The four keys lettered A to D, and I to IV with SHIFT. */
export const GROUP_KEYS = 4;

const pressedSchema = z.object({ label: z.string().min(1).max(16), hit: rectSchema });
const scaleSchema = z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8)]);

export const panelManifestSchema = z.object({
  format: z.literal('boombapbot.panel'),
  schemaVersion: z.literal(1),
  id: z.literal('707'),
  name: z.string().min(1).max(40),
  faceplate: faceplateSchema,
  /** Colours for the drawn panel used when no faceplate image is available. */
  theme: themeSchema,
  /** Recessed areas of the drawn panel. */
  wells: z.array(rectSchema),
  /** The power switch: a slide switch, on at the top. */
  power: z.object({ hit: rectSchema, slot: rectSchema }),
  /** The glass of the display. */
  display: rectSchema,
  /** The size of a fader's cap. The editor draws it; the drawing has the slot. */
  faderCap: z.object({ width: z.number().positive(), height: z.number().positive() }),
  faders: z
    .array(
      z.object({
        id: z.enum(PANEL_FADER_IDS),
        label: z.string().min(1).max(10),
        /** Centre of the slot. */
        x: z.number(),
        /** Where the middle of the cap is with the fader at its most and at its least. */
        top: z.number(),
        bottom: z.number(),
        hit: rectSchema,
      }),
    )
    .length(PANEL_FADER_IDS.length),
  tempo: sweepKnobSchema,
  start: pressedSchema,
  stop: pressedSchema,
  shift: pressedSchema,
  enter: pressedSchema,
  keys: z
    .array(
      z.object({
        key: z.enum(FUNCTION_KEYS),
        label: z.string().min(1).max(16),
        /** What the key is lettered underneath: its work in the track modes, or with SHIFT. */
        second: z.string().min(1).max(16).optional(),
        hit: rectSchema,
        button: rectSchema,
      }),
    )
    .length(FUNCTION_KEYS.length),
  groups: z
    .array(
      z.object({
        /** The pattern group's letter, and the track's numeral. */
        label: z.string().length(1),
        track: z.string().min(1).max(3),
        hit: rectSchema,
        button: rectSchema,
        lamp: rectSchema,
      }),
    )
    .length(GROUP_KEYS),
  /** The lamps of the scale chart, top to bottom. */
  scales: z.array(z.object({ scale: scaleSchema, lamp: rectSchema })).length(SCALES.length),
  steps: z.array(z.object({ hit: rectSchema, button: rectSchema, lamp: rectSchema })).length(STEPS),
  /** Where the panel departs from the machine, and what is unverified. Settings shows it. */
  pending: z.array(z.string()),
});

export type PanelManifest = z.infer<typeof panelManifestSchema>;
export type PanelFader = PanelManifest['faders'][number];

function loadPanel(): PanelManifest {
  const panel = panelManifestSchema.parse(panel707);
  if (PANEL_FADER_IDS.some((id, index) => panel.faders[index]!.id !== id)) {
    throw new Error('707.panel.json must list the faders in the order of the bank');
  }
  if (FUNCTION_KEYS.some((key, index) => panel.keys[index]!.key !== key)) {
    throw new Error('707.panel.json must list the function keys in order');
  }
  if (SCALES.some((scale, index) => panel.scales[index]!.scale !== scale)) {
    throw new Error('707.panel.json must list the scales in the order of the chart');
  }
  return panel;
}

/** The 707's panel. */
export const PANEL: PanelManifest = loadPanel();
