#!/usr/bin/env node
// Draws faceplate artwork as SVG. The drawings are original: every shape is
// produced by this script, and no photograph is traced or embedded. Controls
// the editor makes live (steps, lamps, instrument selector, start/stop, the
// knobs and the voice switches) are placed from the machine's panel manifest,
// so the artwork and the hit areas cannot drift apart.
//
// The editor turns a knob by rotating a round crop of this image, so every
// knob is shaded evenly here and the editor lays a fixed light over it. The
// editor also draws each switch's lever and lights the lamps, so only a
// switch's slot is drawn here, and every lamp is drawn unlit.
//
//   node machines/808/art/draw-faceplate.mjs           write 808.svg beside this file
//   node machines/808/art/draw-faceplate.mjs --check   fail if the committed file differs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = dirname(fileURLToPath(import.meta.url));
const panelDir = join(outDir, '../data');

// ---- SVG helpers -----------------------------------------------------------

const n = (value) => String(Math.round(value * 100) / 100);
const escapeText = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function el(tag, attrs = {}, children = '') {
  const pairs = Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ` ${key}="${typeof value === 'number' ? n(value) : value}"`)
    .join('');
  const body = Array.isArray(children) ? children.join('') : children;
  return body === '' ? `<${tag}${pairs}/>` : `<${tag}${pairs}>${body}</${tag}>`;
}

const rect = (x, y, width, height, attrs = {}) => el('rect', { x, y, width, height, ...attrs });
const circle = (cx, cy, r, attrs = {}) => el('circle', { cx, cy, r, ...attrs });
const line = (x1, y1, x2, y2, attrs = {}) => el('line', { x1, y1, x2, y2, ...attrs });
const path = (d, attrs = {}) => el('path', { d, ...attrs });
const group = (attrs, children) => el('g', attrs, children);

/** A point at `radius` from a centre. 0 degrees is up; positive is clockwise. */
function polar(cx, cy, radius, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + radius * Math.sin(rad), cy - radius * Math.cos(rad)];
}

// Approximate advance widths of bold grotesque capitals, in ems. They are used
// only to cap how wide a label may get, so labels fit whatever font draws them.
const WIDE = { M: 0.83, W: 0.94, O: 0.78, G: 0.78, Q: 0.78 };
const NARROW = { I: 0.28, J: 0.56, L: 0.61, T: 0.61, F: 0.61, "'": 0.24, '-': 0.33, '/': 0.28, ' ': 0.28, 1: 0.56 };
const emWidth = (ch) => WIDE[ch] ?? NARROW[ch] ?? (/[0-9]/.test(ch) ? 0.56 : 0.7);
const textWidth = (value, size) => [...String(value)].reduce((sum, ch) => sum + emWidth(ch) * size, 0);

const FONT = "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', sans-serif";

function text(x, y, value, { size = 14, fill, anchor = 'middle', weight = 700, spacing, maxWidth } = {}) {
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
function mixedCaps(x, y, parts, { big, small, fill, maxWidth }) {
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

// ---- 808 -------------------------------------------------------------------

const C = {
  caseDark: '#0e0f12',
  caseEdge: '#23252b',
  panelTop: '#313237',
  panelBottom: '#27282c',
  recess: '#17181b',
  rule: '#8f8d88',
  label: '#cbc8c0',
  cream: '#f1ebd9',
  plate: '#f1ebbf',
  plateInk: '#24231f',
  orange: '#ff5a2a',
  capOrange: '#f7a53a',
  capWhite: '#f3f0e8',
  well: '#8d8a84',
  wellInk: '#26262a',
  knobSkirt: '#0e0f11',
  knobRib: '#2a2b30',
  knobEdge: '#3b3c42',
  knobCap: '#1a1b1f',
  knobTop: '#202125',
  ledOff: '#5a100b',
  red: '#e7422d',
  amber: '#f28b3a',
  yellow: '#f1d646',
  white: '#f2efe7',
};

const STEP_COLOURS = [C.red, C.amber, C.yellow, C.white];

/** Instrument columns, left to right, with the knobs and plates each carries. */
const COLUMNS = [
  { plate: [['AC', 1], ['CENT', 0]] },
  { plate: [['B', 1], ['ASS', 0], ['D', 1], ['RUM', 0]], mid: 'TONE', low: 'DECAY' },
  { plate: [['S', 1], ['NARE', 0], ['D', 1], ['RUM', 0]], mid: 'TONE', low: 'SNAPPY' },
  { plate: [['L', 1], ['OW', 0], ['T', 1], ['OM', 0]], mid: 'TUNING', alt: [['L', 1], ['OW', 0], ['C', 1], ['ONGA', 0]] },
  { plate: [['M', 1], ['ID', 0], ['T', 1], ['OM', 0]], mid: 'TUNING', alt: [['M', 1], ['ID', 0], ['C', 1], ['ONGA', 0]] },
  { plate: [['H', 1], ['I', 0], ['T', 1], ['OM', 0]], mid: 'TUNING', alt: [['H', 1], ['I', 0], ['C', 1], ['ONGA', 0]] },
  { plate: [['R', 1], ['IM', 0], ['S', 1], ['HOT', 0]], alt: [['CL', 1], ['AVES', 0]] },
  { plate: [['HAND', 0], ['C', 1], ['LA', 0], ['P', 1]], alt: [['MA', 1], ['RACAS', 0]] },
  { plate: [['C', 1], ['OW', 0], ['B', 1], ['ELL', 0]] },
  { plate: [['CY', 1], ['MBAL', 0]], mid: 'TONE', low: 'DECAY' },
  { plate: [['O', 1], ['PEN', 0], ['H', 1], ['IHAT', 0]], low: 'DECAY' },
  { plate: [['C', 1], ["LS'D", 0], ['H', 1], ['IHAT', 0]] },
];

const COLUMN_LEFT = 500;
const COLUMN_RIGHT = 1838;
const COLUMN_WIDTH = (COLUMN_RIGHT - COLUMN_LEFT) / COLUMNS.length;
const columnCentre = (index) => COLUMN_LEFT + COLUMN_WIDTH * (index + 0.5);

function defs() {
  const gradient = (id, stops, attrs) =>
    el(
      attrs.r ? 'radialGradient' : 'linearGradient',
      { id, ...attrs },
      stops.map(([offset, colour, opacity]) => el('stop', { offset, 'stop-color': colour, 'stop-opacity': opacity })),
    );
  const vertical = { x1: 0, y1: 0, x2: 0, y2: 1 };
  return el('defs', {}, [
    gradient('panel', [[0, C.panelTop], [1, C.panelBottom]], vertical),
    gradient('cheekLeft', [[0, '#24262c'], [0.5, '#15161a'], [1, '#0b0c0e']], { x1: 0, y1: 0, x2: 1, y2: 0 }),
    gradient('cheekRight', [[0, '#0b0c0e'], [0.5, '#15161a'], [1, '#24262c']], { x1: 0, y1: 0, x2: 1, y2: 0 }),
    gradient('knobShadow', [[0, '#000', 0.6], [0.72, '#000', 0.5], [1, '#000', 0]], { cx: 0.5, cy: 0.5, r: 0.5 }),
    gradient('cream', [[0, '#fbf6dc'], [1, '#e2d9ad']], vertical),
    gradient('well', [[0, '#96938d'], [1, '#85827c']], vertical),
  ]);
}

/** The shadow a knob casts on the panel, down and to the right of it. */
const castShadow = (cx, cy, r) => circle(cx + r * 0.06, cy + r * 0.14, r * 1.2, { fill: 'url(#knobShadow)' });

/**
 * A black knob seen from above: a ribbed skirt, a chamfered edge and a flat
 * matte top. It has no light of its own, so it looks the same at any angle.
 */
function knobBody(cx, cy, r, ribs) {
  // The ribs are one dashed ring: its stroke is as wide as a rib is long.
  const middle = r * 0.9175;
  const pitch = (2 * Math.PI * middle) / ribs;
  return group({}, [
    circle(cx, cy, r, { fill: C.knobSkirt }),
    circle(cx, cy, middle, {
      fill: 'none',
      stroke: C.knobRib,
      'stroke-width': r * 0.135,
      'stroke-dasharray': `${n(pitch * 0.46)} ${n(pitch * 0.54)}`,
    }),
    circle(cx, cy, r * 0.84, { fill: C.knobCap, stroke: C.knobEdge, 'stroke-width': Math.max(1, r * 0.022) }),
    circle(cx, cy, r * 0.75, { fill: C.knobTop }),
  ]);
}

function pointer(cx, cy, r, deg) {
  const [x1, y1] = polar(cx, cy, r * 0.42, deg);
  const [x2, y2] = polar(cx, cy, r * 0.9, deg);
  return line(x1, y1, x2, y2, { stroke: C.orange, 'stroke-width': Math.max(3, r * 0.075), 'stroke-linecap': 'round' });
}

/** A small knob with a coloured cap inside a tick ring. The editor lights it. */
function smallKnob(cx, cy, { cap, deg, marker = false }) {
  const ticks = [];
  for (let i = 0; i <= 10; i += 1) {
    const angle = -150 + i * 30;
    const [x1, y1] = polar(cx, cy, 27, angle);
    const [x2, y2] = polar(cx, cy, 34, angle);
    ticks.push(line(x1, y1, x2, y2, { stroke: C.label, 'stroke-width': 2, 'stroke-linecap': 'round' }));
  }
  const [mx, my] = polar(cx, cy, 33, 68);
  const [px, py] = polar(cx, cy, 11, deg);
  const [qx, qy] = polar(cx, cy, 3, deg);
  return group({}, [
    ...ticks,
    marker ? circle(mx, my, 3, { fill: C.orange }) : '',
    castShadow(cx, cy, 22),
    knobBody(cx, cy, 22, 26),
    circle(cx, cy, 13, { fill: cap, stroke: '#000', 'stroke-opacity': 0.35, 'stroke-width': 1 }),
    line(qx, qy, px, py, { stroke: C.plateInk, 'stroke-width': 3.2, 'stroke-linecap': 'round' }),
  ]);
}

function screw(cx, cy) {
  return group({}, [
    circle(cx, cy, 7.5, { fill: '#1b1c20', stroke: '#3d3e44', 'stroke-width': 1 }),
    line(cx - 3.5, cy - 3.5, cx + 3.5, cy + 3.5, { stroke: '#08090a', 'stroke-width': 1.8 }),
    line(cx - 3.5, cy + 3.5, cx + 3.5, cy - 3.5, { stroke: '#08090a', 'stroke-width': 1.8 }),
  ]);
}

function plate(cx, y, parts) {
  return group({}, [
    rect(cx - 50, y + 1.5, 100, 34, { rx: 4, fill: '#000', opacity: 0.35 }),
    rect(cx - 50, y, 100, 34, { rx: 4, fill: 'url(#cream)' }),
    mixedCaps(cx, y + 26, parts, { big: 24, small: 12.5, fill: C.plateInk, maxWidth: 88 }),
  ]);
}

/** A knob the editor turns: its body and pointer, with no light of its own. */
function liveDial(knob, ribs) {
  return group({}, [
    castShadow(knob.cx, knob.cy, knob.r),
    knobBody(knob.cx, knob.cy, knob.r - 1, ribs),
    pointer(knob.cx, knob.cy, knob.r - 1, knob.photoDeg),
  ]);
}

/** The slot of a slide switch. The editor draws the lever in it. */
const switchSlot = ([x, y, w, h]) => rect(x, y, w, h, { rx: 3, fill: '#0b0c0e' });

/** The rounded slot of a lever switch. The editor draws the lever in it. */
const leverSlot = ([x, y, w, h]) => rect(x, y, w, h, { rx: h / 2, fill: '#0b0c0e' });

const lamp = ([x, y], r) => circle(x, y, r, { fill: C.ledOff });

function note(x, y, { flag }) {
  return group({ fill: C.wellInk, stroke: C.wellInk }, [
    el('ellipse', { cx: x, cy: y + 6, rx: 5, ry: 3.8, transform: `rotate(-20 ${n(x)} ${n(y + 6)})`, stroke: 'none' }),
    line(x + 4.4, y + 5, x + 4.4, y - 11, { 'stroke-width': 1.8 }),
    flag ? path(`M${n(x + 4.4)} ${n(y - 11)} q7 3 6 11`, { fill: 'none', 'stroke-width': 1.8 }) : '',
  ]);
}

function draw808(panel) {
  const { width, height } = panel.faceplate;
  const steps = panel.steps;
  const stepCentre = (index) => steps[index].button[0] + steps[index].button[2] / 2;
  const stepLeft = (index) => steps[index].button[0];
  const stepRight = (index) => steps[index].button[0] + steps[index].button[2];
  const [well] = panel.wells;
  const wellRight = well[0] + well[2];
  const wellBottom = well[1] + well[3];
  const out = [];

  // Case: rails front and back, a cheek at each side, and the panel between.
  out.push(rect(0, 0, width, height, { fill: C.caseDark }));
  out.push(rect(0, 0, 92, height, { fill: 'url(#cheekLeft)' }));
  out.push(rect(width - 92, 0, 92, height, { fill: 'url(#cheekRight)' }));
  out.push(rect(92, 56, width - 184, 1078, { fill: 'url(#panel)' }));
  out.push(line(92, 56.5, width - 92, 56.5, { stroke: '#4b4c52', 'stroke-width': 1 }));
  out.push(line(92, 1133.5, width - 92, 1133.5, { stroke: '#08090a', 'stroke-width': 3 }));
  for (const [x, y] of [[120, 96], [395, 100], [1000, 100], [1692, 100], [1876, 96], [120, 410], [1876, 410], [300, 1105], [1000, 1105], [1695, 1105]]) {
    out.push(screw(x, y));
  }

  // Power switch.
  out.push(text(221, 86, 'POWER', { size: 14, fill: C.label, spacing: 0.6 }));
  // The editor draws which half of the rocker is pressed.
  const [rockerX, rockerY, rockerW, rockerH] = panel.power.rocker;
  out.push(rect(rockerX - 5, rockerY - 5, rockerW + 10, rockerH + 10, { rx: 4, fill: '#08090a' }));
  out.push(rect(rockerX, rockerY, rockerW, rockerH, { rx: 3, fill: '#1b1c20' }));
  out.push(rect(266, 127, 9, 5, { fill: C.label }));
  out.push(text(280, 135, 'ON', { size: 12, fill: C.label, anchor: 'start' }));
  out.push(rect(266, 160, 9, 5, { fill: 'none', stroke: C.label, 'stroke-width': 1.2 }));
  out.push(text(280, 168, 'OFF', { size: 12, fill: C.label, anchor: 'start' }));

  // The rule under the top band, and the lines between instrument columns.
  out.push(rect(150, 203, COLUMN_RIGHT - 150, 4, { fill: C.rule }));
  for (let i = 0; i <= COLUMNS.length; i += 1) {
    const x = COLUMN_LEFT + COLUMN_WIDTH * i;
    const edge = i === 0 || i === COLUMNS.length;
    out.push(line(x, 214, x, edge ? 752 : 572, { stroke: C.rule, 'stroke-width': 1.6 }));
  }

  // Pattern section, top left.
  const thin = { fill: 'none', stroke: C.cream, 'stroke-width': 1.6 };
  const hot = { fill: 'none', stroke: C.orange, 'stroke-width': 1.6 };
  out.push(path('M178 221 H152 V428 H212', thin));
  out.push(path('M282 221 H347', thin));
  out.push(path('M184 322 H165 V387 H190', thin));
  out.push(path('M152 475 H312 V402 H498', { ...thin, stroke: C.rule, 'stroke-width': 3 }));
  out.push(rect(178, 211, 104, 20, { ...thin }));
  out.push(text(230, 226, 'PATTERN WRITE', { size: 11.5, fill: C.cream, maxWidth: 96 }));
  out.push(text(410, 226, 'INSTRUMENT-SELECT', { size: 11.5, fill: C.cream, maxWidth: 122 }));
  out.push(rect(349, 232, 124, 18, hot));
  out.push(text(411, 245.5, 'RHYTHM TRACK', { size: 11.5, fill: C.orange, maxWidth: 112 }));
  out.push(path('M349 241 H326 V279 H308', hot));
  out.push(path('M326 279 V303 H318', hot));
  out.push(text(171, 262, '1st', { size: 11, fill: C.cream }));
  out.push(text(171, 274, 'PART', { size: 11, fill: C.cream }));
  out.push(text(216, 246, '2nd', { size: 11, fill: C.cream }));
  out.push(text(216, 258, 'PART', { size: 11, fill: C.cream }));
  out.push(rect(259, 240, 56, 26, { fill: 'none', stroke: C.rule, 'stroke-width': 1.4 }));
  out.push(text(287, 251, 'MANUAL', { size: 9.5, fill: C.rule }));
  out.push(text(287, 262, 'PLAY', { size: 9.5, fill: C.rule }));
  out.push(text(304, 283, 'PLAY', { size: 11, fill: C.orange, anchor: 'end' }));
  out.push(text(316, 301, 'COM-', { size: 10, fill: C.orange, anchor: 'end' }));
  out.push(text(316, 312, 'POSE', { size: 10, fill: C.orange, anchor: 'end' }));
  const mode = panel.modeSelect;
  for (const position of mode.positions) {
    const [x, y] = polar(mode.knob.cx, mode.knob.cy, 47, position.deg);
    out.push(circle(x, y, 2, { fill: C.label }));
  }
  out.push(liveDial(mode.knob, 35));
  out.push(rect(190, 377, 108, 20, thin));
  out.push(text(244, 392, 'PATTERN CLEAR', { size: 11.5, fill: C.cream, maxWidth: 100 }));
  out.push(text(196, 414, 'STEP', { size: 10.5, fill: C.cream }));
  out.push(text(196, 426, 'NUMBER', { size: 10.5, fill: C.cream }));
  out.push(text(196, 440, 'PRE-', { size: 10.5, fill: C.cream }));
  out.push(text(196, 452, 'SCALE', { size: 10.5, fill: C.cream }));
  out.push(text(274, 414, 'TRACK', { size: 10.5, fill: C.orange }));
  out.push(text(274, 426, 'CLEAR', { size: 10.5, fill: C.orange }));
  const [clearX, clearY, clearSize] = panel.clear.hit;
  const clear = [clearX + clearSize / 2, clearY + clearSize / 2];
  out.push(circle(clear[0], clear[1] + 2, 14, { fill: '#000', opacity: 0.4 }));
  out.push(circle(clear[0], clear[1], 13, { fill: '#d5362b' }));
  out.push(circle(clear[0] - 3, clear[1] - 4, 5, { fill: '#ef6a5f', opacity: 0.7 }));

  // Instrument selector. The editor turns the knob and lights the label.
  const select = panel.voiceSelect;
  const knob = select.knob;
  select.positions.forEach((position, index) => {
    const [x, y, w, h] = position.hit;
    const [nx, ny] = polar(knob.cx, knob.cy, knob.r + 9, position.deg);
    out.push(rect(x + 1, y + 1, w - 2, h - 2, { rx: 3, fill: 'url(#cream)' }));
    out.push(text(x + w / 2, y + h - 4.2, position.label, { size: 13, fill: C.plateInk }));
    out.push(text(nx, ny + 3, index + 1, { size: 8, fill: C.orange, weight: 400 }));
  });
  out.push(liveDial(knob, 30));

  // Auto fill-in.
  const fill = panel.autoFill;
  ['MANUAL', '16', '12', '8', '4', '2'].forEach((label, index) => {
    const deg = fill.degs[index];
    const [dx, dy] = polar(fill.knob.cx, fill.knob.cy, 47, deg);
    const [lx, ly] = polar(fill.knob.cx, fill.knob.cy, 62, deg);
    out.push(circle(dx, dy, 2, { fill: C.label }));
    out.push(
      text(label === 'MANUAL' ? lx + 4 : lx, ly + 4, label, {
        size: 10.5,
        fill: C.label,
        anchor: label === 'MANUAL' ? 'end' : 'middle',
      }),
    );
  });
  out.push(liveDial(fill.knob, 34));
  out.push(text(fill.knob.cx, fill.knob.cy + 66, 'MEASURES', { size: 9, fill: C.label, weight: 400 }));
  out.push(text(fill.knob.cx, fill.knob.cy + 80, 'AUTO FILL IN', { size: 12, fill: C.label }));
  out.push(screw(430, 586));

  // Tempo. Only the part inside the manifest's radius turns with the knob.
  const tempo = panel.tempo;
  out.push(text(tempo.cx, tempo.cy - 120, tempo.label, { size: 14, fill: C.label, spacing: 0.6 }));
  out.push(circle(tempo.cx, tempo.cy, 113, { fill: 'url(#well)' }));
  out.push(circle(tempo.cx, tempo.cy, tempo.r + 3, { fill: C.recess }));
  for (let i = 0; i <= 10; i += 1) {
    const [x, y] = polar(tempo.cx, tempo.cy, 99, tempo.minDeg + (i * (tempo.maxDeg - tempo.minDeg)) / 10);
    out.push(text(x, y + 6, i, { size: 17, fill: C.wellInk }));
  }
  out.push(knobBody(tempo.cx, tempo.cy, tempo.r - 1, 72));
  out.push(pointer(tempo.cx, tempo.cy, tempo.r - 1, tempo.photoDeg));

  // Fine tempo.
  const fine = panel.fine;
  out.push(text(fine.cx, fine.cy - 52, fine.label, { size: 13, fill: C.label, spacing: 0.5 }));
  for (let i = 0; i <= 6; i += 1) {
    const [x, y] = polar(fine.cx, fine.cy, 36, fine.minDeg + (i * (fine.maxDeg - fine.minDeg)) / 6);
    out.push(circle(x, y, 2, { fill: C.label }));
  }
  out.push(liveDial(fine, 24));
  out.push(text(fine.cx - 36, fine.cy + 40, 'SLOW', { size: 9.5, fill: C.label }));
  out.push(text(fine.cx + 40, fine.cy + 40, 'FAST', { size: 9.5, fill: C.label }));

  // Instrument columns. Every knob and switch here is one the editor works,
  // so each is drawn where the manifest says it is.
  const unplaced = new Set([...panel.knobs, ...panel.switches]);
  const placed = (found, what) => {
    if (!found) throw new Error(`the manifest has no ${what} where the drawing has one`);
    unplaced.delete(found);
    return found;
  };
  const columnKnob = (cx, cy, look) => {
    const knob = placed(
      panel.knobs.find((entry) => Math.abs(entry.cx - cx) < 0.5 && Math.abs(entry.cy - cy) < 0.5),
      `knob at ${n(cx)}, ${cy}`,
    );
    if (knob.r !== 22) throw new Error(`the ${knob.track} ${knob.param} knob must have radius 22`);
    return smallKnob(cx, cy, { ...look, deg: knob.photoDeg });
  };
  COLUMNS.forEach((column, index) => {
    const cx = columnCentre(index);
    out.push(text(cx, 229, 'LEVEL', { size: 13, fill: C.label, spacing: 0.5 }));
    out.push(columnKnob(cx, 268, { cap: C.capOrange, marker: true }));
    if (column.mid) {
      out.push(text(cx, 350, column.mid, { size: 13, fill: C.label, spacing: 0.5 }));
      out.push(columnKnob(cx, 389, { cap: C.capWhite }));
    }
    if (column.low) {
      out.push(text(cx, 470, column.low, { size: 13, fill: C.label, spacing: 0.5 }));
      out.push(columnKnob(cx, 509, { cap: C.capWhite }));
    }
    if (column.alt) {
      out.push(plate(cx, 482, column.alt));
      const entry = placed(
        panel.switches.find((candidate) => Math.abs(candidate.slot[0] + candidate.slot[2] / 2 - cx) < 0.5),
        `switch in column ${index + 1}`,
      );
      out.push(switchSlot(entry.slot));
    }
    out.push(plate(cx, 578, column.plate));
  });
  if (unplaced.size > 0) {
    const [stray] = unplaced;
    throw new Error(`the ${stray.track} ${stray.param ?? 'switch'} is not where the drawing has one`);
  }

  // Model name on its rule, and master volume.
  out.push(line(545, 704, 1688, 704, { stroke: C.orange, 'stroke-width': 2.5 }));
  out.push(text(1584, 696, panel.id, { size: 50, fill: C.orange, weight: 400, spacing: 1 }));
  const master = panel.master;
  for (let i = 0; i <= 10; i += 1) {
    const [dx, dy] = polar(master.cx, master.cy, 50, master.minDeg + (i * (master.maxDeg - master.minDeg)) / 10);
    out.push(circle(dx, dy, 2, { fill: C.label }));
  }
  out.push(liveDial(master, 36));
  out.push(text(master.cx - 44, master.cy + 54, 'MIN', { size: 9.5, fill: C.label }));
  out.push(text(master.cx + 44, master.cy + 54, 'MAX', { size: 9.5, fill: C.label }));
  out.push(text(master.cx, master.cy + 70, master.label, { size: 12, fill: C.label, maxWidth: 118 }));

  // The rule above the step section.
  out.push(rect(well[0], 760, wellRight - well[0] - 4, 7, { fill: C.rule }));

  // Step section: a grey well with a dark recess for the keys and note bars.
  const recessLeft = 385;
  const recessRight = stepRight(15) + 18;
  out.push(rect(well[0], well[1], well[2], well[3], { rx: 8, fill: 'url(#well)' }));
  out.push(rect(recessLeft, well[1] - 8, recessRight - recessLeft, 1040 - well[1] + 8, { fill: C.recess }));
  out.push(rect(stepRight(11) + 5, 1040, stepLeft(12) - stepRight(11) - 10, wellBottom - 1040, { fill: C.recess }));

  // Basic variation and start/stop.
  out.push(text(273, 803, 'BASIC-VARIATION', { size: 11.5, fill: C.wellInk, maxWidth: 124 }));
  out.push(leverSlot(panel.basicVariation.slot));
  [['A', 245], ['AB', 274], ['B', 303]].forEach(([label, x]) => out.push(text(x, 866, label, { size: 11.5, fill: C.wellInk })));
  out.push(rect(233, 876, 82, 22, { rx: 3, fill: C.recess }));
  out.push(lamp(panel.lamps.variationA, panel.lamps.radius));
  out.push(lamp(panel.lamps.variationB, panel.lamps.radius));
  out.push(line(168, 913, 377, 913, { stroke: C.wellInk, 'stroke-width': 1.5 }));
  for (const control of panel.transport) {
    const [x, y, w, h] = control.hit;
    const [upper, lower] = control.label.split('/');
    out.push(rect(x - 3, y - 3, w + 6, h + 8, { rx: 5, fill: C.recess }));
    out.push(rect(x, y, w, h, { rx: 5, fill: 'url(#cream)' }));
    out.push(rect(x + 7, y + 7, w - 14, h - 14, { rx: 3, fill: 'none', stroke: '#c9bd86', 'stroke-width': 1.5 }));
    out.push(text(x + w / 2, y + h / 2 - 4, upper, { size: 15, fill: '#6b5a24', spacing: 0.5 }));
    out.push(line(x + w * 0.28, y + h / 2 + 1, x + w * 0.72, y + h / 2 + 1, { stroke: '#6b5a24', 'stroke-width': 1.2 }));
    out.push(text(x + w / 2, y + h / 2 + 17, lower ?? '', { size: 15, fill: '#6b5a24', spacing: 0.5 }));
  }

  // Pre-scale selector and its four rows of note values.
  out.push(text(436, 801, 'PRE-SCALE', { size: 11.5, fill: C.label, maxWidth: 80 }));
  out.push(switchSlot(panel.preScale.slot));
  const rows = [
    { y: 783, group: 3, every: 1, flag: true },
    { y: 815, group: 6, every: 2, flag: true },
    { y: 847, group: 4, every: 4, flag: false },
    { y: 880, group: 8, every: 8, flag: false },
  ];
  rows.forEach((row, rowIndex) => {
    out.push(text(455, 823 + rowIndex * 19.5, rowIndex + 1, { size: 10.5, fill: C.label }));
    out.push(
      path(`M462 ${n(819 + rowIndex * 19.5)} H472 L490 ${n(row.y + 14)} H${n(stepLeft(0) - 2)}`, {
        fill: 'none',
        stroke: C.label,
        'stroke-width': 1.2,
      }),
    );
    for (let first = 0; first < steps.length; first += row.group) {
      const last = Math.min(first + row.group, steps.length) - 1;
      const left = stepLeft(first);
      const notes = [];
      for (let step = first; step <= last; step += row.every) notes.push(stepCentre(step));
      out.push(rect(left, row.y, stepRight(last) - left, 27, { rx: 5, fill: C.well }));
      if (notes.length > 1) {
        const from = notes[0] + 8;
        const to = notes[notes.length - 1] + 2;
        out.push(
          path(`M${n(from)} ${n(row.y + 4)} Q${n((from + to) / 2)} ${n(row.y - 1)} ${n(to)} ${n(row.y + 5)}`, {
            fill: 'none',
            stroke: C.wellInk,
            'stroke-width': 1.2,
          }),
        );
      }
      notes.forEach((x) => out.push(note(x - 2, row.y + 15, { flag: row.flag })));
    }
  });

  // Step keys. Lamps are drawn unlit; the editor lights them.
  out.push(path(`M392 908 H483 V903 L497 919 L483 935 V930 H392 Z`, { fill: C.well }));
  out.push(text(437, 925, 'STEP NO', { size: 13, fill: C.wellInk, maxWidth: 80 }));
  out.push(lamp(panel.lamps.firstPart, panel.lamps.radius - 1));
  out.push(text(436, 975, '1st PART', { size: 11.5, fill: C.label }));
  out.push(lamp(panel.lamps.secondPart, panel.lamps.radius - 1));
  out.push(text(436, 1030, '2nd PART', { size: 11.5, fill: C.label }));
  steps.forEach((step, index) => {
    const [x, y, w, h] = step.button;
    const colour = STEP_COLOURS[Math.floor(index / 4)];
    const [ledX, ledY] = step.led;
    out.push(text(x + w / 2, y - 6, index + 1, { size: 15, fill: C.cream }));
    out.push(rect(x - 2, y - 1, w + 4, h + 5, { rx: 4, fill: '#050506' }));
    out.push(rect(x, y, w, h, { rx: 4, fill: colour }));
    out.push(rect(x, y, w, h * 0.34, { rx: 4, fill: '#fff', opacity: 0.16 }));
    out.push(rect(x, y + h - 9, w, 9, { rx: 4, fill: '#000', opacity: 0.14 }));
    out.push(circle(ledX, ledY, panel.ledRadius - 1, { fill: '#2b0706' }));
    out.push(circle(ledX, ledY, panel.ledRadius - 3, { fill: C.ledOff }));
    out.push(circle(ledX - 1.5, ledY - 1.5, 1.6, { fill: '#b5483f' }));
    const number = index < 12 ? index + 1 : index - 11;
    out.push(text(x + w / 2, 1074, number, { size: 34, fill: C.wellInk, weight: 700 }));
  });
  out.push(path('M278 1050 H438 V1045 L454 1061 L438 1077 V1072 H278 Z', { fill: C.wellInk }));
  out.push(text(358, 1066, 'BASIC RHYTHM', { size: 14, fill: C.well, maxWidth: 140 }));

  // Intro and fill-in, right.
  out.push(text(1763, 803, 'I/F-VARIATION', { size: 11.5, fill: C.wellInk, maxWidth: 112 }));
  out.push(leverSlot(panel.fillVariation.slot));
  out.push(text(1748, 862, 'A', { size: 11.5, fill: C.wellInk }));
  out.push(text(1778, 862, 'B', { size: 11.5, fill: C.wellInk }));
  out.push(line(1697, 878, 1830, 878, { stroke: C.wellInk, 'stroke-width': 1.5 }));
  out.push(text(1763, 909, 'INTRO SET', { size: 11.5, fill: C.wellInk }));
  out.push(line(1712, 915, 1814, 915, { stroke: C.wellInk, 'stroke-width': 1 }));
  out.push(text(1763, 931, 'FILL IN TRIGGER', { size: 11.5, fill: C.wellInk, maxWidth: 118 }));
  const [tapX, tapY, tapW, tapH] = panel.tap.hit;
  out.push(rect(tapX - 3, tapY - 2, tapW + 6, tapH + 8, { rx: 5, fill: C.recess }));
  out.push(rect(tapX, tapY, tapW, tapH, { rx: 5, fill: 'url(#cream)' }));
  out.push(rect(tapX + 7, tapY + 7, tapW - 14, tapH - 14, { rx: 3, fill: 'none', stroke: '#c9bd86', 'stroke-width': 1.5 }));
  out.push(text(tapX + tapW / 2, tapY + tapH / 2 + 6, 'TAP', { size: 15, fill: '#6b5a24', spacing: 0.5 }));
  out.push(path('M1827 1050 H1699 V1045 L1683 1061 L1699 1077 V1072 H1827 Z', { fill: C.wellInk }));
  out.push(text(1763, 1066, 'INTRO/FILL IN', { size: 14, fill: C.well, maxWidth: 118 }));

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ` +
    `font-family="${FONT}">` +
    el('title', {}, `${panel.id} panel`) +
    defs() +
    out.join('') +
    '</svg>\n'
  );
}

// ---- Main ------------------------------------------------------------------

const DRAWINGS = { 808: draw808 };
// The owner does not want manufacturer or product names in the artwork.
const BRANDING = /roland|rhythm composer|tr-?\d{3}|computer controlled/i;

const check = process.argv.includes('--check');
let stale = 0;
for (const [id, draw] of Object.entries(DRAWINGS)) {
  const panel = JSON.parse(readFileSync(join(panelDir, `${id}.panel.json`), 'utf8'));
  const svg = draw(panel);
  if (BRANDING.test(svg)) {
    console.error(`draw-faceplate: the ${id} drawing contains a brand or product name.`);
    process.exit(1);
  }
  const target = join(outDir, `${id}.svg`);
  if (check) {
    const ok = existsSync(target) && readFileSync(target, 'utf8') === svg;
    console.log(`${ok ? 'ok      ' : 'differs '} machines/808/art/${id}.svg`);
    if (!ok) stale += 1;
  } else {
    writeFileSync(target, svg);
    console.log(`wrote    machines/808/art/${id}.svg (${svg.length} bytes)`);
  }
}
if (stale > 0) {
  console.error('draw-faceplate: run pnpm faceplates:draw and commit the result.');
  process.exit(1);
}
