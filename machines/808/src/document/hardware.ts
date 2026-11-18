import { z } from 'zod';
import panel808 from '../../data/808.panel.json';
import { KNOB_PARAMS, PART_STEPS, SWITCHED_IDS, TRACK_IDS, getTrack } from './machine';
import { AUTO_FILLS, MODES } from './project';

/**
 * Hardware panel manifests: control geometry and behaviour notes for the
 * photo-based editor. All coordinates are pixels in the reference faceplate
 * image, so they scale with it. The manifest carries no pixels itself; the
 * photo is supplied separately and the panel can be drawn without it.
 */

/** [x, y, width, height] in faceplate pixels. */
const rectSchema = z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]);
const pointSchema = z.tuple([z.number(), z.number()]);
const colourSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

const knobSchema = z.object({
  cx: z.number(),
  cy: z.number(),
  /** Radius of the part that turns. */
  r: z.number().positive(),
  /** Pointer angle in the photo, in degrees clockwise from straight up. */
  photoDeg: z.number(),
});

/** A knob with a pointer that sweeps between two angles. */
const sweepKnobSchema = knobSchema.extend({
  label: z.string(),
  /** Pointer angles with the knob fully left and fully right. */
  minDeg: z.number(),
  maxDeg: z.number(),
});

const voicePositionSchema = z.object({
  label: z.string().min(1).max(12),
  /** The track this position selects. */
  track: z.enum(TRACK_IDS),
  /** Pointer angle for rotary selectors. */
  deg: z.number().optional(),
  hit: rectSchema,
});

export const panelManifestSchema = z.object({
  format: z.literal('boombapbot.panel'),
  schemaVersion: z.literal(1),
  id: z.literal('808'),
  name: z.string().min(1).max(40),
  faceplate: z.object({
    /** File name in the machine's art folder, or in misc/assets during development. */
    file: z.string().regex(/^[a-z0-9_-]+\.(jpg|png|webp|svg)$/),
    /**
     * Size of the coordinate space every rectangle below is measured in. A
     * photo of the same framing at another resolution works unchanged.
     */
    width: z.number().positive(),
    height: z.number().positive(),
    /**
     * True for artwork drawn for boombapbot by art/draw-faceplate.mjs. It
     * needs no credit; any other image needs one before it may ship.
     */
    original: z.boolean().optional(),
    /**
     * Who made the photograph and under what licence. Required before a
     * photograph may ship: the licences need the credit shown with the image.
     */
    credit: z
      .object({
        /** Title of the original work, as its source names it. */
        title: z.string().min(1).max(120),
        author: z.string().min(1).max(120),
        source: z.url({ protocol: /^https$/ }),
        licence: z.string().min(1).max(40),
        licenceUrl: z.url({ protocol: /^https$/ }),
        /** What was changed from the original, when the image is an adaptation. */
        changes: z.string().min(1).max(200).optional(),
      })
      .optional(),
  }),
  /** Colours for the drawn panel used when no photo is available. */
  theme: z.object({
    panel: colourSchema,
    ink: colourSchema,
    accent: colourSchema,
    button: colourSchema,
    well: colourSchema,
    led: colourSchema,
  }),
  /** Recessed areas of the drawn panel. */
  wells: z.array(rectSchema),
  steps: z
    .array(z.object({ hit: rectSchema, button: rectSchema, led: pointSchema }))
    .length(PART_STEPS),
  ledRadius: z.number().positive(),
  /** True when the photo shows the step lamps lit, so unlit ones need dimming. */
  ledsLitInPhoto: z.boolean(),
  transport: z
    .array(
      z.object({
        action: z.enum(['toggle', 'start', 'stop']),
        label: z.string().min(1).max(16),
        hit: rectSchema,
      }),
    )
    .min(1),
  /** The tempo knob, which turns in click stops, and the fine knob beside it. */
  tempo: sweepKnobSchema,
  fine: sweepKnobSchema,
  master: sweepKnobSchema,
  /** The knobs of the instrument columns: a level each, and their sound knobs. */
  knobs: z.array(
    sweepKnobSchema.omit({ label: true }).extend({
      track: z.enum(TRACK_IDS),
      param: z.enum(KNOB_PARAMS),
    }),
  ),
  /** The switches that select a column's alternate sound. Up is the alternate. */
  switches: z
    .array(
      z.object({
        track: z.enum(SWITCHED_IDS),
        /** The area that throws the switch: its slot and the plate above it. */
        hit: rectSchema,
        /** The slot the lever travels in. */
        slot: rectSchema,
      }),
    )
    .length(SWITCHED_IDS.length),
  /** The mode selector: a dial with a label for each of its six positions. */
  modeSelect: z.object({
    knob: knobSchema,
    positions: z
      .array(z.object({ mode: z.enum(MODES), label: z.string().min(1).max(20), deg: z.number(), hit: rectSchema }))
      .length(MODES.length),
  }),
  /** The auto fill-in selector: a dial that is turned by pressing around it. */
  autoFill: z.object({
    knob: knobSchema,
    hit: rectSchema,
    /** Pointer angle for each position, in the order of AUTO_FILLS. */
    degs: z.array(z.number()).length(AUTO_FILLS.length),
  }),
  /** The power switch: a rocker whose pressed half shows whether the machine is on. */
  power: z.object({ hit: rectSchema, rocker: rectSchema }),
  /** The CLEAR button under the mode selector, and TAP beside the step buttons. */
  clear: z.object({ hit: rectSchema }),
  tap: z.object({ hit: rectSchema }),
  /** The pre-scale switch: four positions, 1 at the top. */
  preScale: z.object({ hit: rectSchema, slot: rectSchema }),
  /** The variation levers: A, AB and B for the basic rhythms, A and B for intros and fill-ins. */
  basicVariation: z.object({ hit: rectSchema, slot: rectSchema }),
  fillVariation: z.object({ hit: rectSchema, slot: rectSchema }),
  /** Lamps beside the step buttons and under the basic variation lever. */
  lamps: z.object({
    firstPart: pointSchema,
    secondPart: pointSchema,
    variationA: pointSchema,
    variationB: pointSchema,
    radius: z.number().positive(),
  }),
  voiceSelect: z.object({
    kind: z.enum(['rotary', 'keys']),
    label: z.string(),
    knob: knobSchema.optional(),
    positions: z.array(voicePositionSchema).length(TRACK_IDS.length),
  }),
  /** Behaviour that still needs checking against the machine's manual. */
  pending: z.array(z.string()),
});

export type PanelManifest = z.infer<typeof panelManifestSchema>;
export type PanelRect = z.infer<typeof rectSchema>;
export type FaceplateCredit = NonNullable<PanelManifest['faceplate']['credit']>;

export type PanelKnob = PanelManifest['knobs'][number];
export type PanelSwitch = PanelManifest['switches'][number];

function loadPanel(): PanelManifest {
  const panel = panelManifestSchema.parse(panel808);
  const wanted = TRACK_IDS.flatMap((id) =>
    id === 'accent' ? ['accent level'] : ['level', ...getTrack(id).knobs].map((param) => `${id} ${param}`),
  );
  const listed = panel.knobs.map((knob) => `${knob.track} ${knob.param}`);
  if (wanted.length !== listed.length || wanted.some((knob) => !listed.includes(knob))) {
    throw new Error('808.panel.json must list exactly the knobs the machine has');
  }
  if (SWITCHED_IDS.some((id) => !panel.switches.some((entry) => entry.track === id))) {
    throw new Error('808.panel.json must list a switch for every alternate sound');
  }
  if (MODES.some((mode, index) => panel.modeSelect.positions[index]!.mode !== mode)) {
    throw new Error('808.panel.json must list the mode selector positions in order');
  }
  return panel;
}

/** The 808's panel. */
export const PANEL: PanelManifest = loadPanel();
