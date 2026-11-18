#!/usr/bin/env node
// Draws the 606's faceplate as SVG. The drawing is original: every shape is
// produced by this script and what it shares with the other machines'
// drawings (packages/panel/art/svg.mjs), and no photograph is traced or
// embedded. Every control the editor makes live (the knobs, the two selector
// dials, the step keys and their lamps, the scale switch and the six keys
// around them) is placed from the 606's panel manifest, so the artwork and
// the hit areas cannot drift apart.
//
//   node machines/606/art/draw-faceplate.mjs           write 606.svg beside this file
//   node machines/606/art/draw-faceplate.mjs --check   fail if the committed file differs

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VERTICAL,
  castShadow,
  circle,
  el,
  gradient,
  group,
  knobBody,
  knobShadowGradient,
  lamp,
  line,
  mixedCaps,
  n,
  note,
  path,
  polar,
  publishFaceplate,
  readPanel,
  rect,
  svgDocument,
  switchSlot,
  text,
  ticks,
} from '../../../packages/panel/art/svg.mjs';

const artDir = dirname(fileURLToPath(import.meta.url));

// ---- 606 -------------------------------------------------------------------

const C = {
  bodyTop: '#c9c7bd',
  body: '#bdbbb0',
  bodyLow: '#b1afa4',
  lip: '#98968c',
  groove: '#7d7b72',
  shine: '#dddbd2',
  ink: '#262624',
  black: '#161615',
  frame: '#0a0a0a',
  line: '#e9e7df',
  red: '#e8492f',
  cell: '#b6b4a9',
  cellEdge: '#8f8d83',
  key: '#8b8579',
  keyTop: '#a8a295',
  keyLow: '#6a655b',
  knobSkirt: '#2a2a28',
  knobRib: '#5a5954',
  knobEdge: '#8d8b83',
  knobCap: '#bfbdb3',
  knobTop: '#d3d1c8',
  dial: '#b4b2a8',
  bar: '#d6d4cb',
  barEdge: '#8d8b83',
  ledOff: '#5a100b',
  ledRim: '#2b0706',
};

/** Every knob that turns freely: a dark knurled skirt under a silver cap. */
const KNOB = { skirt: C.knobSkirt, rib: C.knobRib, edge: C.knobEdge, cap: C.knobCap, top: C.knobTop };

/** The lettering over each level knob, in two sizes of capitals. */
const LEVEL_PLATES = {
  accent: [['AC', 1], ['CENT', 0]],
  bass_drum: [['B', 1], ['ASS', 0], ['D', 1], ['RUM', 0]],
  snare_drum: [['S', 1], ['NARE', 0], ['D', 1], ['RUM', 0]],
  toms: [['L.H.T', 1], ['OM', 0]],
  cymbal: [['CY', 1], ['MBAL', 0]],
  hi_hat: [['O.C.H', 1], ['IHAT', 0]],
};

/** Steps to the beat at each scale, and which steps of a beat carry a note in its row of the chart. */
const SCALE_ROWS = [
  { scale: 4, beat: 6, every: 2, flag: true, top: 520, bottom: 562 },
  { scale: 3, beat: 3, every: 1, flag: true, top: 563, bottom: 606 },
  { scale: 2, beat: 8, every: 8, flag: false, top: 607, bottom: 640 },
  { scale: 1, beat: 4, every: 4, flag: false, top: 641, bottom: 673 },
];

/** What the BAR row letters under each step key: the digits a bar number is read against, then DEL and INS. */
const BAR_PLATES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '', '', '', '', 'DEL', 'INS'];

function defs() {
  return el('defs', {}, [
    gradient('body', [[0, C.bodyTop], [0.5, C.body], [1, C.bodyLow]], VERTICAL),
    gradient('lip', [[0, C.bodyLow], [0.25, C.lip], [1, '#807e75']], VERTICAL),
    gradient('key', [[0, C.keyTop], [0.5, C.key], [1, C.keyLow]], VERTICAL),
    gradient('cell', [[0, '#bcbaaf'], [1, '#aeaca1']], VERTICAL),
    knobShadowGradient(),
  ]);
}

/** The line on a silver cap that shows where the knob points. */
function capLine(cx, cy, r, deg) {
  const [x1, y1] = polar(cx, cy, r * 0.2, deg);
  const [x2, y2] = polar(cx, cy, r * 0.7, deg);
  const [x3, y3] = polar(cx, cy, r * 0.84, deg);
  const [x4, y4] = polar(cx, cy, r * 0.99, deg);
  return group({ 'stroke-linecap': 'round' }, [
    line(x1, y1, x2, y2, { stroke: C.ink, 'stroke-width': Math.max(3, r * 0.09) }),
    line(x3, y3, x4, y4, { stroke: C.line, 'stroke-width': Math.max(2.4, r * 0.07) }),
  ]);
}

/** A knob the editor turns, from its manifest entry, shown at the angle the manifest says. */
function knob(entry, ribs) {
  return group({}, [
    castShadow(entry.cx, entry.cy, entry.r),
    knobBody(entry.cx, entry.cy, entry.r - 1, ribs, KNOB),
    capLine(entry.cx, entry.cy, entry.r - 1, entry.photoDeg),
  ]);
}

/**
 * A selector dial the editor turns: a dark collar that stays put, and inside
 * the manifest's radius a disc with a bar across it that points at the
 * position the manifest says the image shows.
 */
function selectorDial(entry) {
  const { cx, cy, r, photoDeg } = entry;
  const half = r * 0.34;
  return group({}, [
    castShadow(cx, cy, r + 8),
    circle(cx, cy, r + 9, { fill: C.knobSkirt, stroke: C.knobEdge, 'stroke-width': 2 }),
    circle(cx, cy, r - 1, { fill: C.dial, stroke: '#6f6d65', 'stroke-width': 1.5 }),
    group({ transform: `rotate(${n(photoDeg)} ${n(cx)} ${n(cy)})` }, [
      rect(cx - half - 2, cy - r + 5, half * 2 + 4, r * 2 - 10, { rx: 12, fill: '#7f7d75' }),
      rect(cx - half, cy - r + 4, half * 2, r * 2 - 10, { rx: 11, fill: C.bar, stroke: C.barEdge, 'stroke-width': 1.5 }),
      line(cx, cy - r + 12, cx, cy - r * 0.42, { stroke: C.ink, 'stroke-width': 5, 'stroke-linecap': 'round' }),
    ]),
  ]);
}

/** A lettered plate: dark with light lettering on the silver, or the other way about. */
function plate([x, y, w, h], label, { fill, ink, size = 15, italic = false }) {
  const lettering = text(x + w / 2, y + h / 2 + size * 0.36, label, { size, fill: ink, maxWidth: w - 8 });
  return group({}, [rect(x, y, w, h, { rx: 3, fill }), italic ? group({ 'font-style': 'italic' }, lettering) : lettering]);
}

/** Lettering in a thin outline, as the second meanings of the keys are marked. */
function outlined([x, y, w, h], label, { colour = C.line, size = 15, italic = false } = {}) {
  const lettering = text(x + w / 2, y + h / 2 + size * 0.36, label, { size, fill: colour, maxWidth: w - 10 });
  return group({}, [
    rect(x, y, w, h, { fill: 'none', stroke: colour, 'stroke-width': 1.6 }),
    italic ? group({ 'font-style': 'italic' }, lettering) : lettering,
  ]);
}

/** A key of the black section: a metal cap standing in a dark surround. */
function key([x, y, w, h]) {
  return group({}, [
    rect(x - 3, y - 3, w + 6, h + 8, { rx: 3, fill: C.frame }),
    rect(x, y, w, h, { rx: 2, fill: 'url(#key)' }),
    rect(x + 3, y + 3, w - 6, h - 9, { rx: 1.5, fill: 'none', stroke: '#fff', 'stroke-opacity': 0.22, 'stroke-width': 1.5 }),
    rect(x, y + h - 6, w, 6, { rx: 2, fill: '#000', opacity: 0.22 }),
  ]);
}

/** A live key, drawn inside its hit area in the manifest, which is a little larger than the key. */
function keyIn([x, y, w, h], insetX, insetY = insetX) {
  return key([x + insetX, y + insetY, w - insetX * 2, h - insetY * 2]);
}

/** A small triangle pointing at the back of the machine, where a socket is. */
const socket = (x, y) => path(`M${n(x)} ${n(y - 7)} l7 13 h-14 Z`, { fill: C.ink });

/** The marks round the two large knobs: every other one longer and heavier. */
const bigDialTicks = (knob) => ({
  inner: knob.r + 14,
  outer: knob.r + 24,
  stroke: C.ink,
  major: 2,
  majorOuter: knob.r + 30,
  majorWidth: 2.6,
});

function draw606(panel) {
  const { width, height } = panel.faceplate;
  const steps = panel.steps;
  const cellLeft = (index) => steps[index].hit[0];
  const cellRight = (index) => steps[index].hit[0] + steps[index].hit[2];
  const cellCentre = (index) => steps[index].hit[0] + steps[index].hit[2] / 2;
  const [well] = panel.wells;
  const out = [];
  const label = (x, y, value, options = {}) => out.push(text(x, y, value, { fill: C.ink, ...options }));
  const white = (x, y, value, options = {}) => out.push(text(x, y, value, { fill: C.line, ...options }));

  // The case: one silver moulding, folded where the top band meets the
  // middle one, with a lip along the front.
  out.push(rect(0, 0, width, height, { fill: 'url(#body)' }));
  out.push(rect(0, 0, width, 3, { fill: C.shine }));
  out.push(rect(0, 194, width, 4, { fill: C.groove }));
  out.push(rect(0, 198, width, 2.5, { fill: C.shine }));
  out.push(rect(0, well[1] + well[3] + 14, width, height - well[1] - well[3] - 14, { fill: 'url(#lip)' }));
  out.push(rect(0, well[1] + well[3] + 14, width, 2, { fill: C.shine }));
  out.push(rect(0, 0, 4, height, { fill: '#fff', opacity: 0.18 }));
  out.push(rect(width - 4, 0, 4, height, { fill: '#000', opacity: 0.14 }));

  // Top band: what the sockets on the back are, either side of the level knobs.
  for (const [x, y, name, size] of [
    [118, 70, 'RUN/STOP', 17],
    [404, 70, 'SYNC', 17],
    [1508, 74, 'TRIGGER OUT', 17],
    [1652, 74, 'HEADPHONE', 17],
    [1774, 74, 'OUTPUT', 17],
    [1882, 74, 'DC 9V', 17],
  ]) {
    label(x, y, name, { size, weight: 400, spacing: 0.4 });
  }
  for (const [x, y] of [[118, 40], [404, 40], [1468, 40], [1548, 40], [1652, 40], [1774, 40], [1882, 40]]) out.push(socket(x, y));
  label(1492, 46, 'LT', { size: 13, weight: 400 });
  label(1572, 46, 'HT', { size: 13, weight: 400 });
  out.push(line(510, 30, 510, 180, { stroke: C.ink, 'stroke-width': 1.6 }));
  out.push(line(1432, 30, 1432, 180, { stroke: C.ink, 'stroke-width': 1.6 }));

  // Level knobs.
  for (const entry of panel.levels) {
    out.push(mixedCaps(entry.cx, 44, LEVEL_PLATES[entry.level], { big: 22, small: 15, fill: C.ink, maxWidth: 132 }));
    out.push(ticks(entry, 10, { inner: entry.r + 8, outer: entry.r + 16, stroke: C.ink }));
    out.push(rect(entry.cx - 4, entry.cy - entry.r - 22, 8, 10, { fill: C.ink }));
    out.push(knob(entry, 30));
  }
  panel.levels.slice(1).forEach((entry, index) => {
    const before = panel.levels[index];
    const gap = [before.cx + before.r + 26, entry.cx - entry.r - 26];
    out.push(line(gap[0], entry.cy, gap[1], entry.cy, { stroke: C.ink, 'stroke-width': 1.6, 'stroke-dasharray': '9 9' }));
  });

  // Tempo.
  const tempo = panel.tempo;
  label(tempo.cx, tempo.cy - 124, tempo.label, { size: 22, spacing: 0.5 });
  out.push(ticks(tempo, 20, bigDialTicks(tempo)));
  out.push(knob(tempo, 64));
  label(tempo.cx - 102, tempo.cy + 92, 'SLOW', { size: 15, weight: 400 });
  label(tempo.cx + 102, tempo.cy + 92, 'FAST', { size: 15, weight: 400 });

  // The instrument and track selector. The editor turns the dial and marks the label.
  const select = panel.voiceSelect;
  out.push(plate([484, 214, 78, 28], 'TRACK', { fill: C.ink, ink: C.body, size: 20 }));
  label(646, 236, select.label, { size: 22, spacing: 0.5, maxWidth: 150 });
  select.positions.forEach((position, index) => {
    const [x, y, w, h] = position.hit;
    const [dx, dy] = polar(select.knob.cx, select.knob.cy, select.knob.r + 19, position.deg);
    const left = position.deg < 0;
    out.push(circle(dx, dy, 3, { fill: C.ink }));
    out.push(text(left ? x + 17 : x + w - 17, y + h - 6, position.label, { size: 17, fill: C.ink, maxWidth: 30 }));
    out.push(plate([left ? x + w - 23 : x + 1, y + 2, 22, h - 4], index + 1, { fill: C.ink, ink: C.body, size: 17 }));
  });
  out.push(selectorDial(select.knob));

  // The mode selector: the two track modes on dark plates, the two pattern modes plain.
  const mode = panel.modeSelect;
  label(mode.knob.cx, 236, 'MODE', { size: 22, spacing: 0.5 });
  for (const position of mode.positions) {
    const [x, y, w, h] = position.hit;
    const [dx, dy] = polar(mode.knob.cx, mode.knob.cy, mode.knob.r + 19, position.deg);
    const word = position.mode.endsWith('write') ? 'WRITE' : 'PLAY';
    out.push(circle(dx, dy, 3, { fill: C.ink }));
    if (position.mode.startsWith('track')) out.push(plate([x + 4, y + 2, w - 8, h - 4], word, { fill: C.ink, ink: C.body, size: 17 }));
    else label(x + w / 2, y + h - 7, word, { size: 17, maxWidth: w - 8 });
  }
  const edge = (index) => mode.positions[index].hit[0] + mode.positions[index].hit[2];
  const middle = (index) => mode.positions[index].hit[1] + mode.positions[index].hit[3] / 2;
  const bracket = { fill: 'none', stroke: C.ink, 'stroke-width': 1.8 };
  out.push(path(`M${n(edge(0))} ${n(middle(0))} H1072 V${n(middle(1))} H${n(edge(1))} M1072 ${n((middle(0) + middle(1)) / 2)} H1088`, bracket));
  out.push(plate([1088, (middle(0) + middle(1)) / 2 - 13, 74, 26], 'TRACK', { fill: C.ink, ink: C.body, size: 17 }));
  out.push(path(`M${n(edge(2))} ${n(middle(2))} H1076 V${n(middle(3))} H${n(edge(3))} M1076 ${n((middle(2) + middle(3)) / 2)} H1090`, bracket));
  label(1096, (middle(2) + middle(3)) / 2 + 6, 'PATTERN', { size: 17, anchor: 'start' });
  out.push(selectorDial(mode.knob));

  // The model number, and the volume knob that is the power switch too.
  label(1543, 392, panel.id, { size: 88, weight: 700, spacing: -2 });
  const volume = panel.volume;
  label(volume.cx, volume.cy - 124, volume.label, { size: 22, spacing: 0.5 });
  out.push(ticks(volume, 20, bigDialTicks(volume)));
  out.push(knob(volume, 64));
  const [powerX, powerY, powerW, powerH] = panel.power.hit;
  label(powerX + powerW / 2, powerY + powerH - 8, 'POWER SW  OFF', { size: 15, weight: 400, maxWidth: powerW - 8 });
  label(volume.cx + 100, volume.cy + 92, 'MAX', { size: 15, weight: 400 });

  // The black section, and the thin lines that divide it.
  const [wellX, wellY, wellW, wellH] = well;
  const thin = { fill: 'none', stroke: C.line, 'stroke-width': 1.8 };
  out.push(rect(wellX - 3, wellY - 3, wellW + 6, wellH + 7, { rx: 5, fill: '#6b6961' }));
  out.push(rect(wellX, wellY, wellW, wellH, { rx: 3, fill: C.black }));
  const chartLeft = cellLeft(0);
  const chartRight = cellRight(15);
  const chartTop = SCALE_ROWS[0].top - 2;
  out.push(rect(52, chartTop, 186, 150, thin));
  out.push(rect(52, 676, 186, 232, thin));
  out.push(rect(245, chartTop, chartRight - 243, 908 - chartTop, thin));
  out.push(rect(1772, chartTop, 186, 150, thin));
  out.push(rect(1772, 676, 186, 232, thin));

  // CLEAR, and its two other names in track write.
  out.push(outlined([62, 536, 48, 28], 'D.C.', { italic: true, size: 16 }));
  out.push(outlined([116, 536, 114, 28], 'BAR RESET', { size: 15 }));
  white(145, 592, 'PATTERN CLEAR', { size: 15, maxWidth: 168 });
  out.push(keyIn(panel.clear.hit, 12));

  // RUN/STOP and the lamp that shows the machine running.
  white(108, panel.run.lamp[1] + 5, 'RUN', { size: 14 });
  out.push(lamp(panel.run.lamp, panel.lampRadius + 1, C.ledRim));
  out.push(lamp(panel.run.lamp, panel.lampRadius - 1.5, C.ledOff));
  out.push(keyIn(panel.run.hit, 8));
  white(145, 846, panel.run.label, { size: 17, maxWidth: 150 });

  // The scale switch, a line from each of its positions to its row of the
  // chart, and FUNCTION under it.
  const [slotX, slotY, slotW, slotH] = panel.scale.slot;
  out.push(switchSlot(panel.scale.slot, '#000'));
  out.push(rect(slotX, slotY, slotW, slotH, { rx: 3, fill: 'none', stroke: '#3a3a37', 'stroke-width': 1.2 }));
  SCALE_ROWS.forEach((row, index) => {
    // Where the editor rests the lever for this position.
    const leverY = slotY + 3 + 12 + ((slotH - 30) * index) / (SCALE_ROWS.length - 1);
    const rowY = (row.top + row.bottom) / 2;
    white(260, leverY + 6, row.scale, { size: 17 });
    out.push(circle(273, leverY, 2.2, { fill: C.line }));
    out.push(path(`M${n(slotX + slotW + 3)} ${n(leverY)} H${n(slotX + slotW + 12)} L${n(chartLeft - 8)} ${n(rowY)} H${n(chartLeft)}`, thin));
  });
  white(297, 692, 'SCALE', { size: 16 });
  white(297, 716, 'FUNCTION', { size: 15, maxWidth: 92 });
  out.push(keyIn(panel.function.hit, 24, 6));

  // The chart: for each scale, where the beats fall across the sixteen steps.
  for (const row of SCALE_ROWS) {
    out.push(line(chartLeft, row.top, chartRight, row.top, { stroke: C.line, 'stroke-width': 1.8 }));
    for (let first = 0; first < steps.length; first += row.beat) {
      const last = Math.min(first + row.beat, steps.length) - 1;
      if (first > 0) out.push(line(cellLeft(first), row.top, cellLeft(first), row.bottom + 1, { stroke: C.line, 'stroke-width': 1.8 }));
      const notes = [];
      for (let step = first; step <= last; step += row.every) notes.push(cellCentre(step) - 6);
      const y = (row.top + row.bottom) / 2 + 2;
      if (notes.length > 1) {
        const from = notes[0] + 12;
        const to = notes[notes.length - 1] + 2;
        out.push(path(`M${n(from)} ${n(y - 11)} Q${n((from + to) / 2)} ${n(y - 17)} ${n(to)} ${n(y - 12)}`, { fill: 'none', stroke: C.line, 'stroke-width': 1.6 }));
      }
      notes.forEach((x) => out.push(note(x, y, { flag: row.flag, fill: C.line })));
    }
  }
  out.push(line(chartLeft, SCALE_ROWS[0].top - 2, chartLeft, 823, { stroke: C.line, 'stroke-width': 1.8 }));

  // Step keys, each in a silver cell under its lamp. Lamps are drawn unlit; the editor lights them.
  steps.forEach((step, index) => {
    const [x, y, w, h] = step.hit;
    out.push(rect(x + 1, y, w - 2, h, { fill: 'url(#cell)' }));
    out.push(rect(x + 1, y, w - 2, 2, { fill: '#fff', opacity: 0.3 }));
    out.push(lamp(step.led, panel.ledRadius + 1.5, C.ledRim));
    out.push(lamp(step.led, panel.ledRadius - 1.5, C.ledOff));
    out.push(circle(step.led[0] - 2.5, step.led[1] - 2.5, 2, { fill: '#b5483f' }));
    out.push(key(step.button));
    out.push(text(cellCentre(index), 851, index + 1, { size: 17, fill: C.red, weight: 400 }));
  });

  // LAST STEP: what a step key means with FUNCTION down in pattern write.
  out.push(
    path(`M252 829 H338 V824 L356 842 L338 860 V855 H252 Z`, { fill: 'none', stroke: C.red, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }),
  );
  out.push(text(296, 847.5, 'LAST STEP', { size: 13.5, fill: C.red, maxWidth: 78 }));

  // BAR: the digits a bar number is read against, and the two keys that edit a track.
  out.push(rect(249, 864, chartRight - 250, 42, { fill: 'url(#cell)' }));
  out.push(path('M258 872 H326 V868 L343 885 L326 902 V898 H258 Z', { fill: C.black }));
  white(292, 890, 'BAR', { size: 14 });
  BAR_PLATES.forEach((value, index) => {
    if (value === '') return;
    const wide = value.length > 1;
    out.push(plate([cellCentre(index) - (wide ? 25 : 21), 872, wide ? 50 : 42, 26], value, { fill: C.black, ink: C.line, size: wide ? 15 : 17 }));
  });

  // The pattern group button and its two lamps.
  const [first, second] = panel.group.lamps;
  for (const point of [first, second]) {
    out.push(lamp(point, panel.lampRadius + 1, C.ledRim));
    out.push(lamp(point, panel.lampRadius - 1.5, C.ledOff));
  }
  const serif = { 'font-family': "Georgia, 'Times New Roman', 'Liberation Serif', serif" };
  out.push(group(serif, [text(first[0] - 24, first[1] + 7, 'I', { size: 20, fill: C.line }), text(second[0] + 26, second[1] + 7, 'II', { size: 20, fill: C.line })]));
  white(1865, 596, 'PATTERN GROUP', { size: 15, maxWidth: 168 });
  out.push(keyIn(panel.group.hit, 24, 8));

  // TAP, and its other name in track write.
  out.push(keyIn(panel.tap.hit, 8));
  out.push(outlined([1802, 824, 126, 28], 'WRITE/NEXT', { size: 15 }));
  white(1865, 882, 'TAP', { size: 17 });

  return svgDocument(panel, { defs: defs(), body: out.join('') });
}

publishFaceplate(artDir, draw606(readPanel(artDir)));
