// What a machine's art/draw-faceplate.mjs is written with: SVG elements,
// lettering that fits, the parts every drawn faceplate has, and the one way a
// drawing is written out or checked against the committed file.
//
// The drawings are original: every shape is produced by a script, and no
// photograph is traced or embedded. Controls the editor makes live are placed
// from the machine's panel manifest, so the artwork and the hit areas cannot
// drift apart.
//
// The editor turns a knob by rotating a round crop of the image, so every
// knob is shaded evenly here and the editor lays a fixed light over it. The
// editor also draws each switch's lever and lights the lamps, so only a
// switch's slot is drawn, and every lamp is drawn unlit.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// ---- SVG helpers -----------------------------------------------------------

export const n = (value) => String(Math.round(value * 100) / 100);
export const escapeText = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function el(tag, attrs = {}, children = '') {
  const pairs = Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ` ${key}="${typeof value === 'number' ? n(value) : value}"`)
    .join('');
  const body = Array.isArray(children) ? children.join('') : children;
  return body === '' ? `<${tag}${pairs}/>` : `<${tag}${pairs}>${body}</${tag}>`;
}

export const rect = (x, y, width, height, attrs = {}) => el('rect', { x, y, width, height, ...attrs });
export const circle = (cx, cy, r, attrs = {}) => el('circle', { cx, cy, r, ...attrs });
export const line = (x1, y1, x2, y2, attrs = {}) => el('line', { x1, y1, x2, y2, ...attrs });
export const path = (d, attrs = {}) => el('path', { d, ...attrs });
export const group = (attrs, children) => el('g', attrs, children);

/** A point at `radius` from a centre. 0 degrees is up; positive is clockwise. */
export function polar(cx, cy, radius, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + radius * Math.sin(rad), cy - radius * Math.cos(rad)];
}

/** A gradient for `defs`: radial when it is given a radius, linear otherwise. Stops are [offset, colour, opacity]. */
export function gradient(id, stops, attrs) {
  return el(
    attrs.r ? 'radialGradient' : 'linearGradient',
    { id, ...attrs },
    stops.map(([offset, colour, opacity]) => el('stop', { offset, 'stop-color': colour, 'stop-opacity': opacity })),
  );
}

/** Gradient attributes for one that runs from the top of a shape to its bottom. */
export const VERTICAL = { x1: 0, y1: 0, x2: 0, y2: 1 };

// ---- Lettering -------------------------------------------------------------

// Approximate advance widths of bold grotesque capitals, in ems. They are used
// only to cap how wide a label may get, so labels fit whatever font draws them.
const WIDE = { M: 0.83, W: 0.94, O: 0.78, G: 0.78, Q: 0.78 };
const NARROW = { I: 0.28, J: 0.56, L: 0.61, T: 0.61, F: 0.61, "'": 0.24, '-': 0.33, '/': 0.28, ' ': 0.28, 1: 0.56 };
const emWidth = (ch) => WIDE[ch] ?? NARROW[ch] ?? (/[0-9]/.test(ch) ? 0.56 : 0.7);
export const textWidth = (value, size) => [...String(value)].reduce((sum, ch) => sum + emWidth(ch) * size, 0);

export const FONT = "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', sans-serif";

export function text(x, y, value, { size = 14, fill, anchor = 'middle', weight = 700, spacing, maxWidth } = {}) {
  const estimate = textWidth(value, size) + (spacing ?? 0) * String(value).length;
  const squeeze = maxWidth && estimate > maxWidth;
  return el(
    'text',
    {
      x,
      y,
      fill,
      'font-size': size,
      'font-weight': weight,
      'text-anchor': anchor,
      'letter-spacing': spacing,
      textLength: squeeze ? maxWidth : undefined,
      lengthAdjust: squeeze ? 'spacingAndGlyphs' : undefined,
    },
    escapeText(value),
  );
}

/** A label set in two sizes of capitals: [['B', big], ['ASS', small], ...]. */
export function mixedCaps(x, y, parts, { big, small, fill, maxWidth }) {
  const estimate = parts.reduce((sum, [value, isBig]) => sum + textWidth(value, isBig ? big : small), 0);
  const squeeze = estimate > maxWidth;
  return el(
    'text',
    {
      x,
      y,
      fill,
      'font-weight': 700,
      'text-anchor': 'middle',
      textLength: squeeze ? maxWidth : undefined,
      lengthAdjust: squeeze ? 'spacingAndGlyphs' : undefined,
    },
    parts.map(([value, isBig]) => el('tspan', { 'font-size': isBig ? big : small }, escapeText(value))),
  );
}

// ---- Parts -----------------------------------------------------------------

/** The gradient `castShadow` fills with. Put it in the drawing's `defs`. */
export const knobShadowGradient = () =>
  gradient('knobShadow', [[0, '#000', 0.6], [0.72, '#000', 0.5], [1, '#000', 0]], { cx: 0.5, cy: 0.5, r: 0.5 });

/** The shadow a knob casts on the panel, down and to the right of it. */
export const castShadow = (cx, cy, r) => circle(cx + r * 0.06, cy + r * 0.14, r * 1.2, { fill: 'url(#knobShadow)' });

/**
 * A knob seen from above: a ribbed skirt, a chamfered edge and a flat matte
 * top, in the colours of `look` ({ skirt, rib, edge, cap, top }). It has no
 * light of its own, so it looks the same at any angle.
 */
export function knobBody(cx, cy, r, ribs, look) {
  // The ribs are one dashed ring: its stroke is as wide as a rib is long.
  const middle = r * 0.9175;
  const pitch = (2 * Math.PI * middle) / ribs;
  return group({}, [
    circle(cx, cy, r, { fill: look.skirt }),
    circle(cx, cy, middle, {
      fill: 'none',
      stroke: look.rib,
      'stroke-width': r * 0.135,
      'stroke-dasharray': `${n(pitch * 0.46)} ${n(pitch * 0.54)}`,
    }),
    circle(cx, cy, r * 0.84, { fill: look.cap, stroke: look.edge, 'stroke-width': Math.max(1, r * 0.022) }),
    circle(cx, cy, r * 0.75, { fill: look.top }),
  ]);
}

/** The line on a knob that shows where it points. */
export function pointer(cx, cy, r, deg, colour) {
  const [x1, y1] = polar(cx, cy, r * 0.42, deg);
  const [x2, y2] = polar(cx, cy, r * 0.9, deg);
  return line(x1, y1, x2, y2, { stroke: colour, 'stroke-width': Math.max(3, r * 0.075), 'stroke-linecap': 'round' });
}

/**
 * A knob the editor turns, from its manifest entry: its shadow, its body and
 * its pointer at the angle the manifest says the image shows. `look` is
 * `knobBody`'s, with the colour of the `pointer`.
 */
export function liveDial(knob, ribs, look) {
  return group({}, [
    castShadow(knob.cx, knob.cy, knob.r),
    knobBody(knob.cx, knob.cy, knob.r - 1, ribs, look),
    pointer(knob.cx, knob.cy, knob.r - 1, knob.photoDeg, look.pointer),
  ]);
}

/** A cross-head screw in a dark panel. */
export function screw(cx, cy) {
  return group({}, [
    circle(cx, cy, 7.5, { fill: '#1b1c20', stroke: '#3d3e44', 'stroke-width': 1 }),
    line(cx - 3.5, cy - 3.5, cx + 3.5, cy + 3.5, { stroke: '#08090a', 'stroke-width': 1.8 }),
    line(cx - 3.5, cy + 3.5, cx + 3.5, cy - 3.5, { stroke: '#08090a', 'stroke-width': 1.8 }),
  ]);
}

const SLOT = '#0b0c0e';

/** The slot of a slide switch. The editor draws the lever in it. */
export const switchSlot = ([x, y, w, h], fill = SLOT) => rect(x, y, w, h, { rx: 3, fill });

/** The rounded slot of a lever switch. The editor draws the lever in it. */
export const leverSlot = ([x, y, w, h], fill = SLOT) => rect(x, y, w, h, { rx: h / 2, fill });

/** A lamp, unlit. The editor lights it. */
export const lamp = ([x, y], r, fill) => circle(x, y, r, { fill });

// ---- A drawing, start to finish --------------------------------------------

/** The panel manifest of the machine whose art folder this is. */
export function readPanel(artDir) {
  const id = basename(dirname(artDir));
  return JSON.parse(readFileSync(join(artDir, '../data', `${id}.panel.json`), 'utf8'));
}

/** The whole file: `defs` and `body` are markup, in the manifest's coordinate space. */
export function svgDocument(panel, { defs, body }) {
  const { width, height } = panel.faceplate;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `font-family="${FONT}">` +
    el('title', {}, `${panel.id} panel`) +
    defs +
    body +
    '</svg>\n'
  );
}

/**
 * A note of a scale chart: a head, a stem, and a flag for one shorter than a
 * quarter. `head` is half the width of the head and `rise` is how far the
 * stem stands above the note's place; the rest follows from them.
 */
export function note(x, y, { flag, fill, head = 5, rise = 11 }) {
  const stem = x + head * 0.88;
  const weight = head * 0.36;
  const flagPath = `M${n(stem)} ${n(y - rise)} q${n(head * 1.4)} ${n(head * 0.6)} ${n(head * 1.2)} ${n((rise + 5) * 0.6875)}`;
  return group({ fill, stroke: fill }, [
    el('ellipse', { cx: x, cy: y + 6, rx: head, ry: head * 0.76, transform: `rotate(-20 ${n(x)} ${n(y + 6)})`, stroke: 'none' }),
    line(stem, y + 5, stem, y - rise, { 'stroke-width': weight }),
    flag ? path(flagPath, { fill: 'none', 'stroke-width': weight }) : '',
  ]);
}

/**
 * Marks round a knob's travel, from its lowest position to its highest, each
 * from `inner` to `outer` of its centre. Every `major`th is longer and heavier.
 */
export function ticks(knob, count, { inner, outer, stroke, width = 1.8, major = 0, majorOuter = outer, majorWidth = width }) {
  const marks = [];
  for (let i = 0; i <= count; i += 1) {
    const deg = knob.minDeg + (i * (knob.maxDeg - knob.minDeg)) / count;
    const long = major > 0 && i % major === 0;
    const [x1, y1] = polar(knob.cx, knob.cy, inner, deg);
    const [x2, y2] = polar(knob.cx, knob.cy, long ? majorOuter : outer, deg);
    marks.push(line(x1, y1, x2, y2, { stroke, 'stroke-width': long ? majorWidth : width, 'stroke-linecap': 'round' }));
  }
  return group({}, marks);
}

// The owner does not want manufacturer or product names in the artwork.
const BRANDING = /roland|rhythm composer|tr-?\d{3}|computer controlled/i;

/**
 * Writes a machine's drawing beside its script as <id>.svg. With --check on
 * the command line it writes nothing and fails if the committed file differs.
 */
export function publishFaceplate(artDir, svg) {
  const id = basename(dirname(artDir));
  if (BRANDING.test(svg)) {
    console.error(`draw-faceplate: the ${id} drawing contains a brand or product name.`);
    process.exit(1);
  }
  const target = join(artDir, `${id}.svg`);
  const name = `machines/${id}/art/${id}.svg`;
  if (!process.argv.includes('--check')) {
    writeFileSync(target, svg);
    console.log(`wrote    ${name} (${svg.length} bytes)`);
    return;
  }
  const ok = existsSync(target) && readFileSync(target, 'utf8') === svg;
  console.log(`${ok ? 'ok      ' : 'differs '} ${name}`);
  if (!ok) {
    console.error('draw-faceplate: run pnpm faceplates:draw and commit the result.');
    process.exit(1);
  }
}
