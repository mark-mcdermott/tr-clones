import { z } from 'zod';
import {
  faceplateSchema,
  knobSchema,
  pointSchema,
  rectSchema,
  sweepKnobSchema,
  themeSchema,
} from '@tr-clones/panel/schema';
import panel606 from '../../data/606.panel.json';
import { LEVEL_IDS, STEPS, TRACK_IDS } from './machine';
import { MODES } from './project';

/**
 * The 606's panel manifest: where every live control is on the faceplate,
 * and what the panel leaves out. All coordinates are pixels of the faceplate
 * drawing, which art/draw-faceplate.mjs makes from this same file.
 */
export const panelManifestSchema = z.object({
  format: z.literal('boombapbot.panel'),
  schemaVersion: z.literal(1),
  id: z.literal('606'),
  name: z.string().min(1).max(40),
  faceplate: faceplateSchema,
  /** Colours for the drawn panel used when no faceplate image is available. */
  theme: themeSchema,
  /** Recessed areas of the drawn panel. */
  wells: z.array(rectSchema),
  steps: z.array(z.object({ hit: rectSchema, button: rectSchema, led: pointSchema })).length(STEPS),
  ledRadius: z.number().positive(),
  /** True when the image shows the step lamps lit, so unlit ones need dimming. */
  ledsLitInPhoto: z.boolean(),
  /** RUN/STOP, and the lamp above it that is lit while the machine runs. */
  run: z.object({ label: z.string().min(1).max(16), hit: rectSchema, lamp: pointSchema }),
  tempo: sweepKnobSchema,
  /** The volume knob. Fully left it clicks the power off. */
  volume: sweepKnobSchema,
  /** The level knobs, left to right. */
  levels: z.array(sweepKnobSchema.omit({ label: true }).extend({ level: z.enum(LEVEL_IDS) })).length(LEVEL_IDS.length),
  /** The instrument and track selector: a dial with a label for each of its eight positions. */
  voiceSelect: z.object({
    label: z.string().min(1).max(20),
    knob: knobSchema,
    positions: z
      .array(z.object({ label: z.string().min(1).max(4), track: z.enum(TRACK_IDS), deg: z.number(), hit: rectSchema }))
      .length(TRACK_IDS.length),
  }),
  /** The mode selector: a dial with a label for each of its four positions. */
  modeSelect: z.object({
    knob: knobSchema,
    positions: z
      .array(z.object({ mode: z.enum(MODES), label: z.string().min(1).max(20), deg: z.number(), hit: rectSchema }))
      .length(MODES.length),
  }),
  /** The lettering at the volume knob's off position, which works the power switch too. */
  power: z.object({ hit: rectSchema }),
  clear: z.object({ hit: rectSchema }),
  function: z.object({ hit: rectSchema }),
  tap: z.object({ hit: rectSchema }),
  /** The pattern group button and its two lamps, I then II. */
  group: z.object({ hit: rectSchema, lamps: z.tuple([pointSchema, pointSchema]) }),
  /** The scale switch: four positions, 4 at the top. */
  scale: z.object({ hit: rectSchema, slot: rectSchema }),
  /** Radius of the run and pattern group lamps. */
  lampRadius: z.number().positive(),
  /** Where the machine departs from the hardware, and what is unverified. */
  pending: z.array(z.string()),
});

export type PanelManifest = z.infer<typeof panelManifestSchema>;
export type PanelLevel = PanelManifest['levels'][number];

function loadPanel(): PanelManifest {
  const panel = panelManifestSchema.parse(panel606);
  if (LEVEL_IDS.some((id, index) => panel.levels[index]!.level !== id)) {
    throw new Error('606.panel.json must list the level knobs in panel order');
  }
  if (TRACK_IDS.some((id, index) => panel.voiceSelect.positions[index]!.track !== id)) {
    throw new Error('606.panel.json must list the selector positions in order');
  }
  if (MODES.some((mode, index) => panel.modeSelect.positions[index]!.mode !== mode)) {
    throw new Error('606.panel.json must list the mode selector positions in order');
  }
  return panel;
}

/** The 606's panel. */
export const PANEL: PanelManifest = loadPanel();
