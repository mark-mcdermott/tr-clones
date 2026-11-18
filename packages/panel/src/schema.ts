import { z } from 'zod';

/**
 * What every hardware panel manifest is made of. All coordinates are pixels
 * in the reference faceplate image, so they scale with it. A machine's own
 * manifest schema puts these together with what only it has.
 */

/** [x, y, width, height] in faceplate pixels. */
export const rectSchema = z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]);
export const pointSchema = z.tuple([z.number(), z.number()]);
export const colourSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

export const knobSchema = z.object({
  cx: z.number(),
  cy: z.number(),
  /** Radius of the part that turns. */
  r: z.number().positive(),
  /** Pointer angle in the photo, in degrees clockwise from straight up. */
  photoDeg: z.number(),
});

/** A knob with a pointer that sweeps between two angles. */
export const sweepKnobSchema = knobSchema.extend({
  label: z.string(),
  /** Pointer angles with the knob fully left and fully right. */
  minDeg: z.number(),
  maxDeg: z.number(),
});

export const faceplateSchema = z.object({
  /** File name in the machine's art folder, or in misc/assets during development. */
  file: z.string().regex(/^[a-z0-9_-]+\.(jpg|png|webp|svg)$/),
  /**
   * Size of the coordinate space every rectangle of the manifest is measured
   * in. A photo of the same framing at another resolution works unchanged.
   */
  width: z.number().positive(),
  height: z.number().positive(),
  /**
   * True for artwork drawn for boombapbot by the machine's
   * art/draw-faceplate.mjs. It needs no credit; any other image needs one
   * before it may ship.
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
});

/** Colours for the drawn panel used when no photo is available. */
export const themeSchema = z.object({
  panel: colourSchema,
  ink: colourSchema,
  accent: colourSchema,
  button: colourSchema,
  well: colourSchema,
  led: colourSchema,
});

export type PanelRect = z.infer<typeof rectSchema>;
export type PanelPoint = z.infer<typeof pointSchema>;
export type KnobGeometry = z.infer<typeof knobSchema>;
export type SweepKnobGeometry = z.infer<typeof sweepKnobSchema>;
export type Faceplate = z.infer<typeof faceplateSchema>;
export type FaceplateCredit = NonNullable<Faceplate['credit']>;
export type PanelTheme = z.infer<typeof themeSchema>;

/** The least a manifest must say for a control to be placed on its faceplate. */
export interface PanelFrame {
  faceplate: Pick<Faceplate, 'width' | 'height' | 'original'>;
}
