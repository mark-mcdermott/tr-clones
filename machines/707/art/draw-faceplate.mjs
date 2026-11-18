#!/usr/bin/env node
// Draws the 707's faceplate as SVG. The drawing is original: every shape is
// produced by this script and what it shares with the other machines'
// drawings (packages/panel/art/svg.mjs), and no photograph is traced or
// embedded. Controls the editor makes live (the power switch, the display,
// the faders, the tempo knob, every key and every lamp) are placed from the
// 707's panel manifest, so the artwork and the hit areas cannot drift apart.
//
//   node machines/707/art/draw-faceplate.mjs           write 707.svg beside this file
//   node machines/707/art/draw-faceplate.mjs --check   fail if the committed file differs

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VERTICAL,
  el,
  gradient,
  group,
  knobShadowGradient,
  line,
  liveDial,
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
} from '../../../packages/panel/art/svg.mjs';

const artDir = dirname(fileURLToPath(import.meta.url));

const C = {
  page: '#151517',
  edge: '#a5a298',
  groove: '#aeaba1',
  lip: '#eeebe3',
  bayEdge: '#b9b6ac',
  ink: '#3c3c41',
  keyEdge: '#2c2c30',
  keyFace: '#515156',
  orange: '#e9722a',
  orangeInk: '#52230a',
  slot: '#26262a',
  chart: '#38383d',
  chartLine: '#5d5d63',
  chartInk: '#dedbd1',
  glassEdge: '#7f8676',
  lampOff: '#5a1911',
  lampRim: '#8b877c',
  knobSkirt: '#323236',
  knobRib: '#4a4a4f',
  knobEdge: '#5f5f65',
  knobCap: '#3b3b40',
  knobTop: '#44444a',
};

/** The tempo knob: charcoal, with an orange pointer. */
const KNOB = { skirt: C.knobSkirt, rib: C.knobRib, edge: C.knobEdge, cap: C.knobCap, top: C.knobTop, pointer: C.orange };

/**
 * What is lettered under the step keys: the instruments they choose, each in
 * a box that spans its keys. A box with a name for every key letters each
 * under its own; `above` is what stands over the box, key by key.
 */
const LEGEND = [
  { from: 0, to: 1, names: ['BASS DRUM'], above: ['1', '2'] },
  { from: 2, to: 3, names: ['SNARE DRUM'], above: ['1', '2'] },
  { from: 4, to: 4, names: ['LOW TOM'] },
  { from: 5, to: 5, names: ['MID TOM'] },
  { from: 6, to: 6, names: ['HI TOM'] },
  { from: 7, to: 8, names: ['RIMSHOT', 'COWBELL'] },
  { from: 9, to: 10, names: ['HANDCLAP', 'TAMBOURINE'] },
  { from: 11, to: 13, names: ['HI HAT'], above: ['CLOSED', 'CLOSED', 'OPEN'] },
  { from: 14, to: 15, names: ['CYMBAL'], above: ['CRASH', 'RIDE'] },
];

/** What SHIFT makes of the step keys, as the orange strip under them says. */
const SHIFTED = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'COPY', 'INS', 'DEL'];

function defs() {
  return el('defs', {}, [
    gradient('case', [[0, '#dfdcd2'], [1, '#d0cdc3']], VERTICAL),
    gradient('band', [[0, '#e3e0d7'], [1, '#d9d6cc']], VERTICAL),
    gradient('bay', [[0, '#d1cec4'], [0.08, '#dbd8ce'], [1, '#dedbd2']], VERTICAL),
    gradient('plate', [[0, '#e9e6de'], [1, '#e1ded5']], VERTICAL),
    gradient('key', [[0, '#5b5b60'], [1, '#434347']], VERTICAL),
    gradient('glass', [[0, '#bcc3af'], [1, '#aeb6a2']], VERTICAL),
    gradient('lid', [[0, '#d2cfc5'], [1, '#c6c3b9']], VERTICAL),
    knobShadowGradient(),
  ]);
}

/** A recessed area of the case: darker along its top edge, lighter along its bottom. */
function bay([x, y, w, h], radius = 10) {
  return group({}, [
    rect(x, y + 1.5, w, h, { rx: radius, fill: C.lip }),
    rect(x, y - 1, w, h, { rx: radius, fill: C.bayEdge }),
    rect(x, y, w, h, { rx: radius, fill: 'url(#bay)' }),
  ]);
}

/** A key seen from above: its shadow, its body and the flat it is pressed on. */
function key([x, y, w, h]) {
  const inset = Math.min(6, w * 0.1);
  return group({}, [
    rect(x + 1.5, y + 4, w, h, { rx: 5, fill: '#000', opacity: 0.28 }),
    rect(x, y, w, h, { rx: 5, fill: C.keyEdge }),
    rect(x, y, w, h - 3, { rx: 5, fill: 'url(#key)' }),
    rect(x + inset, y + inset, w - inset * 2, h - 3 - inset * 2, { rx: 3, fill: C.keyFace, opacity: 0.55 }),
  ]);
}

/** A bar lamp, unlit. The editor lights it. */
function barLamp([x, y, w, h], rim = C.lampRim) {
  return group({}, [
    rect(x - 2, y - 2, w + 4, h + 4, { rx: 2, fill: rim }),
    rect(x, y, w, h, { rx: 1, fill: C.lampOff }),
  ]);
}

/** A heading with a rule running out to each side of it. */
function heading(x1, x2, y, label, size = 13.5) {
  const cx = (x1 + x2) / 2;
  const half = (label.length * size * 0.66) / 2 + 8;
  const rule = { stroke: C.ink, 'stroke-width': 1.4 };
  return group({}, [
    line(x1, y - size * 0.36, cx - half, y - size * 0.36, rule),
    line(cx + half, y - size * 0.36, x2, y - size * 0.36, rule),
    text(cx, y, label, { size, fill: C.ink, spacing: 0.6 }),
  ]);
}

/** Lettering in the case's ink, one line or two. */
function label(cx, y, lines, size = 12.5, maxWidth = undefined) {
  return group(
    {},
    [lines].flat().map((value, index) => text(cx, y + index * (size + 1.5), value, { size, fill: C.ink, spacing: 0.3, maxWidth })),
  );
}

/** An orange tag: what a key does with SHIFT. */
function tag([x, y, w, h], entries) {
  return group({}, [
    rect(x, y, w, h, { rx: 2, fill: C.orange }),
    ...entries.map(([cx, value, maxWidth]) => text(cx, y + h - 6.5, value, { size: 13, fill: C.orangeInk, maxWidth })),
  ]);
}

const rectCentre = ([x, y, w, h]) => [x + w / 2, y + h / 2];

/** Lettering that is two words, or one with a stroke in it, takes two lines. */
function twoLines(value) {
  if (value.includes(' ')) return value.split(' ');
  const stroke = value.indexOf('/');
  return stroke < 0 ? [value] : [value.slice(0, stroke), value.slice(stroke)];
}

function draw707(panel) {
  const { width, height } = panel.faceplate;
  const out = [];
  const stepCentre = (index) => rectCentre(panel.steps[index].button)[0];
  const stepLeft = (index) => panel.steps[index].button[0];
  const stepRight = (index) => panel.steps[index].button[0] + panel.steps[index].button[2];

  // The case: one moulding, a raised band along the back, and a groove across it under the upper deck.
  out.push(rect(0, 0, width, height, { fill: C.page }));
  out.push(rect(22, 36, width - 44, height - 62, { rx: 28, fill: C.edge }));
  out.push(rect(24, 36, width - 48, height - 68, { rx: 26, fill: 'url(#case)' }));
  out.push(path(`M24 192 V62 a26 26 0 0 1 26 -26 H${width - 50} a26 26 0 0 1 26 26 V192 Z`, { fill: 'url(#band)' }));
  for (const y of [192, 548]) {
    out.push(rect(24, y, width - 48, 3, { fill: C.groove }));
    out.push(rect(24, y + 3, width - 48, 2, { fill: C.lip }));
  }

  // The model number, leaning as if it were moving.
  out.push(
    group({ transform: 'skewX(-12)' }, [
      text(1808 + 0.2126 * 166, 166, panel.id, { size: 104, fill: '#48484d', weight: 800, spacing: -2 }),
    ]),
  );

  // Power. The editor draws the lever in the slot: up is on.
  const [slotX, slotY, slotW, slotH] = panel.power.slot;
  out.push(rect(slotX - 10, slotY - 8, slotW + 20, slotH + 16, { rx: 6, fill: C.bayEdge }));
  out.push(rect(slotX - 9, slotY - 7, slotW + 18, slotH + 14, { rx: 5, fill: 'url(#plate)' }));
  out.push(switchSlot(panel.power.slot, C.slot));
  out.push(text(slotX + slotW + 22, slotY + 16, 'ON', { size: 13, fill: C.ink, anchor: 'start' }));
  out.push(text(slotX + slotW + 22, slotY + slotH - 4, 'OFF', { size: 13, fill: C.ink, anchor: 'start' }));
  out.push(text(slotX + slotW + 22, slotY + slotH / 2 + 5, 'POWER', { size: 14.5, fill: C.ink, anchor: 'start', spacing: 0.6 }));

  // Upper deck: an empty bay with its lid down, the display, and the fader bank.
  out.push(bay([150, 208, 244, 322]));
  out.push(rect(212, 236, 120, 266, { rx: 8, fill: C.groove }));
  out.push(rect(214, 239, 116, 261, { rx: 6, fill: 'url(#lid)' }));
  for (let y = 420; y <= 476; y += 14) out.push(line(236, y, 308, y, { stroke: C.groove, 'stroke-width': 2, 'stroke-linecap': 'round' }));
  out.push(rect(246, 252, 52, 8, { rx: 4, fill: C.groove }));

  out.push(bay([404, 208, 584, 322]));
  const [glassX, glassY, glassW, glassH] = panel.display;
  out.push(rect(glassX - 20, glassY - 16, glassW + 40, glassH + 32, { rx: 8, fill: C.bayEdge }));
  out.push(rect(glassX - 19, glassY - 14, glassW + 38, glassH + 30, { rx: 7, fill: '#c9c6bc' }));
  out.push(rect(glassX - 5, glassY - 5, glassW + 10, glassH + 10, { rx: 4, fill: C.glassEdge }));
  // The glass itself. The editor draws what the display shows over it.
  out.push(rect(glassX, glassY, glassW, glassH, { rx: 2, fill: 'url(#glass)' }));

  const [bankX, bankY, bankW, bankH] = panel.wells[0];
  out.push(bay([bankX, bankY, bankW, bankH]));
  const cap = panel.faderCap;
  panel.faders.forEach((fader, index) => {
    const volume = fader.id === 'volume';
    const top = fader.top - cap.height / 2 - 20;
    const bottom = fader.bottom + cap.height / 2 + 20;
    out.push(rect(fader.x - 23, top - 1, 46, bottom - top, { rx: 4, fill: C.bayEdge }));
    out.push(rect(fader.x - 23, top, 46, bottom - top, { rx: 4, fill: 'url(#plate)' }));
    out.push(rect(fader.x - 4, fader.top - cap.height / 2 - 4, 8, fader.bottom - fader.top + cap.height + 8, { rx: 4, fill: C.slot }));
    // Eleven marks beside the slot, the ends and the middle longer.
    for (let mark = 0; mark <= 10; mark += 1) {
      const y = fader.top + ((fader.bottom - fader.top) * mark) / 10;
      const long = mark % 5 === 0;
      const side = volume ? [fader.x + 30, fader.x + (long ? 50 : 42)] : [fader.x - (long ? 21 : 17), fader.x - 9];
      out.push(line(side[0], y, side[1], y, { stroke: C.ink, 'stroke-width': long ? 1.8 : 1.1, opacity: long ? 1 : 0.7 }));
    }
    if (index === 0 || volume) {
      const x = volume ? fader.x + 56 : fader.x - 30;
      const anchor = volume ? 'start' : 'end';
      out.push(text(x, fader.top + 5, 'MAX', { size: 13, fill: C.ink, anchor }));
      out.push(text(x, fader.bottom + 5, 'MIN', { size: 13, fill: C.ink, anchor }));
    }
    out.push(text(fader.x, bankY + bankH - 14, fader.label, { size: volume ? 15 : 12.5, fill: C.ink, maxWidth: volume ? 90 : 52 }));
  });

  // Lower deck. Start and stop, at the left.
  const [stopCx] = rectCentre(panel.stop.hit);
  const [startCx] = rectCentre(panel.start.hit);
  out.push(key(panel.stop.hit));
  out.push(label(stopCx, panel.stop.hit[1] - 12, panel.stop.label, 14));
  out.push(key(panel.start.hit));
  out.push(label(startCx, panel.start.hit[1] + panel.start.hit[3] + 22, panel.start.label, 14));

  // The small keys, with what each does lettered above it and, in the track modes, below.
  const keyOf = (name) => panel.keys.find((entry) => entry.key === name);
  const modeKeys = ['track', 'pattern'];
  for (const entry of panel.keys) {
    const [cx] = rectCentre(entry.button);
    const [, y, , h] = entry.button;
    out.push(key(entry.button));
    const lettered = twoLines(entry.label);
    out.push(label(cx, y - 12 - (lettered.length - 1) * 14, lettered, 12.5, 72));
    // What a mode key does with SHIFT is on the orange tag under the pair of them.
    if (entry.second && !modeKeys.includes(entry.key)) out.push(label(cx, y + h + 20, twoLines(entry.second)));
  }
  const patternLeft = keyOf('clear').button[0] - 10;
  const patternRight = keyOf('instrument').button[0] + keyOf('instrument').button[2] + 14;
  out.push(heading(patternLeft, patternRight, 622, 'PATTERN'));
  out.push(heading(patternLeft, patternRight, 786, 'TRACK'));
  const [trackCx] = rectCentre(keyOf('track').button);
  const [patternCx] = rectCentre(keyOf('pattern').button);
  out.push(heading(trackCx - 40, patternCx + 40, 622, 'PLAY'));
  out.push(
    tag(
      [trackCx - 46, 734, patternCx - trackCx + 92, 24],
      modeKeys.map((name) => [rectCentre(keyOf(name).button)[0], keyOf(name).second, name === 'track' ? 54 : 62]),
    ),
  );
  out.push(heading(trackCx - 40, patternCx + 40, 786, 'WRITE'));

  // The four group keys, each with its lamp and letter, and the track it chooses with SHIFT.
  const groupLeft = panel.groups[0].button[0] - 8;
  const groupRight = panel.groups[3].button[0] + panel.groups[3].button[2] + 8;
  out.push(heading(groupLeft, groupRight, 622, 'PATTERN GROUP'));
  for (const entry of panel.groups) {
    const [lampX, lampY, lampW] = entry.lamp;
    out.push(barLamp(entry.lamp));
    out.push(text(lampX + lampW + 14, lampY + 12, entry.label, { size: 15, fill: C.ink }));
    out.push(key(entry.button));
  }
  out.push(
    tag(
      [groupLeft, 734, groupRight - groupLeft, 24],
      panel.groups.map((entry) => [rectCentre(entry.button)[0], entry.track, 40]),
    ),
  );
  out.push(heading(groupLeft, groupRight, 786, 'TRACK NUMBER'));

  // Enter, which is also the accent.
  const [enterCx] = rectCentre(panel.enter.hit);
  out.push(key(panel.enter.hit));
  out.push(label(enterCx, panel.enter.hit[1] - 14, panel.enter.label, 15));
  out.push(label(enterCx, panel.enter.hit[1] + panel.enter.hit[3] + 22, 'ACCENT', 13.5));

  // Tempo: marks all the way round its travel, and the knob the editor turns.
  const tempo = panel.tempo;
  out.push(text(tempo.cx, tempo.cy - 108, tempo.label, { size: 15, fill: C.ink, spacing: 0.8 }));
  for (let mark = 0; mark <= 28; mark += 1) {
    const deg = tempo.minDeg + ((tempo.maxDeg - tempo.minDeg) * mark) / 28;
    const long = mark % 7 === 0;
    const [x1, y1] = polar(tempo.cx, tempo.cy, tempo.r + 12, deg);
    const [x2, y2] = polar(tempo.cx, tempo.cy, tempo.r + (long ? 30 : 23), deg);
    out.push(line(x1, y1, x2, y2, { stroke: C.ink, 'stroke-width': long ? 2 : 1.2, 'stroke-linecap': 'round' }));
  }
  out.push(text(tempo.cx - tempo.r - 30, tempo.cy + tempo.r + 26, 'SLOW', { size: 12.5, fill: C.ink }));
  out.push(text(tempo.cx + tempo.r + 30, tempo.cy + tempo.r + 26, 'FAST', { size: 12.5, fill: C.ink }));
  out.push(liveDial(tempo, 44, KNOB));

  // The scale chart: a row for each scale, its notes standing over the step keys they fall on.
  const [chartX, chartY, chartW, chartH] = panel.wells[1];
  out.push(rect(chartX, chartY - 1, chartW, chartH, { rx: 5, fill: '#2a2a2e' }));
  out.push(rect(chartX, chartY, chartW, chartH, { rx: 5, fill: C.chart }));
  const chartLeft = stepLeft(0) - 8;
  const chartRight = chartX + chartW - 8;
  const pitch = stepCentre(1) - stepCentre(0);
  panel.scales.forEach((entry, row) => {
    const top = chartY + 6 + row * 30;
    const middle = top + 13;
    out.push(barLamp(entry.lamp, C.chartLine));
    if (row > 0) out.push(line(chartX + 6, top - 2, chartRight, top - 2, { stroke: '#2a2a2e', 'stroke-width': 2 }));
    out.push(line(chartLeft, top + 24, chartRight, top + 24, { stroke: C.chartLine, 'stroke-width': 1 }));
    // A triplet scale shows its eighths under a bracket; a duple one, the quarter note each beat starts on.
    const triplet = entry.scale % 3 === 0;
    const every = triplet ? entry.scale / 3 : entry.scale;
    const noteX = (step) => stepLeft(step) + 22;
    for (let step = 0; step < panel.steps.length; step += every) out.push(note(noteX(step), middle - 1, { flag: triplet, fill: C.chartInk, head: 4.6, rise: 9 }));
    for (let step = 0; step < panel.steps.length; step += entry.scale) {
      const beat = stepLeft(step) - (pitch - (stepRight(0) - stepLeft(0))) / 2;
      if (step > 0) out.push(line(beat, top, beat, top + 24, { stroke: C.chartLine, 'stroke-width': 1.4 }));
      const last = step + entry.scale - every;
      // The bracket of a triplet, where all three of its notes have a key to stand over.
      if (triplet && last < panel.steps.length) {
        const bracket = `M${n(noteX(step) - 8)} ${n(top + 7)} V${n(top + 2.5)} H${n(noteX(last) + 16)} V${n(top + 7)}`;
        out.push(path(bracket, { fill: 'none', stroke: C.chartInk, 'stroke-width': 1, opacity: 0.7 }));
      }
    }
  });

  // The frame lines that run down each side of the step keys.
  for (const x of [196, 1836]) out.push(line(x, chartY, x, 1170, { stroke: C.ink, 'stroke-width': 1.2, opacity: 0.55 }));

  // SHIFT, and the sixteen step keys with their lamps and numbers.
  out.push(key(panel.shift.hit));
  const [shiftCx] = rectCentre(panel.shift.hit);
  out.push(tag([shiftCx - 54, 1096, 108, 24], [[shiftCx, panel.shift.label, 80]]));
  panel.steps.forEach((step, index) => {
    const [lampX, lampY, lampW] = step.lamp;
    out.push(barLamp(step.lamp));
    out.push(text(lampX + lampW + 16, lampY + 11, index + 1, { size: 14.5, fill: C.ink }));
    out.push(key(step.button));
  });
  out.push(
    tag(
      [stepLeft(0) - 36, 1096, stepRight(15) - stepLeft(0) + 48, 24],
      SHIFTED.map((value, index) => [stepCentre(index), value, 60]),
    ),
  );

  // The instruments the step keys choose and play.
  const boxTop = 1142;
  for (const entry of LEGEND) {
    const left = stepLeft(entry.from) + 2;
    const right = stepRight(entry.to) - 2;
    out.push(rect(left, boxTop, right - left, 24, { fill: 'none', stroke: C.ink, 'stroke-width': 1.2 }));
    const each = entry.names.length > 1;
    entry.names.forEach((name, offset) => {
      const cx = each ? stepCentre(entry.from + offset) : (left + right) / 2;
      out.push(text(cx, boxTop + 17, name, { size: 13, fill: C.ink, maxWidth: (each ? stepRight(0) - stepLeft(0) : right - left) - 10 }));
    });
    (entry.above ?? []).forEach((value, offset) => {
      // CLOSED is lettered once, over the two keys that play it.
      if (entry.above[offset - 1] === value) return;
      const twice = entry.above[offset + 1] === value;
      const at = entry.from + offset;
      out.push(text(twice ? (stepCentre(at) + stepCentre(at + 1)) / 2 : stepCentre(at), boxTop - 7, value, { size: 12, fill: C.ink }));
    });
  }

  return svgDocument(panel, { defs: defs(), body: out.join('') });
}

publishFaceplate(artDir, draw707(readPanel(artDir)));
