#!/usr/bin/env node
// Draws the 909's faceplate as SVG. The drawing is original: every shape is
// produced by this script and what it shares with the other machines'
// drawings (packages/panel/art/svg.mjs), and no photograph is traced or
// embedded. Every control the editor makes live (the knobs, the keys and
// their lamps, the display and the power switch) is placed from the 909's
// panel manifest, so the artwork and the hit areas cannot drift apart.
//
//   node machines/909/art/draw-faceplate.mjs           write 909.svg beside this file
//   node machines/909/art/draw-faceplate.mjs --check   fail if the committed file differs

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VERTICAL,
  circle,
  el,
  gradient,
  group,
  knobShadowGradient,
  lamp,
  line,
  liveDial,
  n,
  note,
  path,
  publishFaceplate,
  readPanel,
  rect,
  svgDocument,
  text,
  ticks,
} from '../../../packages/panel/art/svg.mjs';

const artDir = dirname(fileURLToPath(import.meta.url));

// ---- 909 -------------------------------------------------------------------

const C = {
  cheek: '#8d8b7b',
  cheekDark: '#6f6d5f',
  ink: '#3f4858',
  slate: '#4b566b',
  slateEdge: '#3c4557',
  orange: '#f08a24',
  orangeInk: '#2c2412',
  white: '#f6f4ec',
  tick: '#8a8d93',
  recess: '#2a2c31',
  keyBase: '#cfc8b1',
  keyShade: '#b5ae96',
  window: '#20264a',
  windowEdge: '#3a4170',
  lampOff: '#3a1512',
  smallFrame: '#74767d',
  smallBevel: '#9c9ea5',
  lens: '#d3bab0',
  lensLamp: '#b57a6f',
  bezel: '#1b1c20',
};

/** Every knob on the panel: dark blue-black, with an orange line. */
const KNOB = { skirt: '#141821', rib: '#252c3d', edge: '#3a435b', cap: '#1b2130', top: '#232b3d', pointer: '#f79b2f' };

/** The columns of the sound section, by the knob that is furthest left in each, with the name over them. */
const COLUMNS = [
  { title: 'TOTAL ACCENT', from: 150, to: 290 },
  { title: 'BASS DRUM', from: 290, to: 485 },
  { title: 'SNARE DRUM', from: 485, to: 680 },
  { title: 'LOW TOM', from: 680, to: 875 },
  { title: 'MID TOM', from: 875, to: 1070 },
  { title: 'HI TOM', from: 1070, to: 1265 },
  { title: 'RIM SHOT   HAND CLAP', from: 1265, to: 1460 },
  { title: 'HI-HAT', from: 1460, to: 1655 },
  { title: 'CYMBAL', from: 1655, to: 1850 },
];

/** What is lettered over each knob. The total accent and the volume are named by their own headings. */
const KNOB_LABELS = {
  bass_drum_tune: 'TUNE',
  bass_drum_level: 'LEVEL',
  bass_drum_attack: 'ATTACK',
  bass_drum_decay: 'DECAY',
  snare_drum_tune: 'TUNE',
  snare_drum_level: 'LEVEL',
  snare_drum_tone: 'TONE',
  snare_drum_snappy: 'SNAPPY',
  low_tom_tune: 'TUNE',
  low_tom_level: 'LEVEL',
  low_tom_decay: 'DECAY',
  mid_tom_tune: 'TUNE',
  mid_tom_level: 'LEVEL',
  mid_tom_decay: 'DECAY',
  hi_tom_tune: 'TUNE',
  hi_tom_level: 'LEVEL',
  hi_tom_decay: 'DECAY',
  rim_shot_level: 'LEVEL',
  hand_clap_level: 'LEVEL',
  hi_hat_level: 'LEVEL',
  closed_hat_decay: 'CH DECAY',
  open_hat_decay: 'OH DECAY',
  crash_level: 'LEVEL',
  ride_level: 'LEVEL',
  crash_tune: 'CRASH TUNE',
  ride_tune: 'RIDE TUNE',
};

/** The instruments lettered under the step keys: the keys each box spans, and what it says under each. */
const KEY_BOXES = [
  { keys: [0, 1], labels: ['BASS DRUM'] },
  { keys: [2, 3], labels: ['SNARE DRUM'] },
  { keys: [4, 5], labels: ['LOW TOM'] },
  { keys: [6, 7], labels: ['MID TOM'] },
  { keys: [8, 9], labels: ['HI TOM'] },
  { keys: [10, 11], labels: ['RIM SHOT', 'HAND CLAP'] },
  { keys: [12, 13], labels: ['CLOSED HAT', 'OPEN HAT'] },
  { keys: [14, 15], labels: ['CRASH', 'RIDE'] },
];

/** The scale chart, from the top: how many steps make a beat, which steps carry a note, and whether it is a triplet. */
const SCALE_ROWS = [
  { beat: 6, every: 2, triplet: true },
  { beat: 3, every: 1, triplet: true },
  { beat: 8, every: 8, triplet: false },
  { beat: 4, every: 4, triplet: false },
];

function defs() {
  return el('defs', {}, [
    gradient('panel', [[0, '#e6e4dc'], [1, '#d7d5cc']], VERTICAL),
    gradient('lip', [[0, '#c3c1b8'], [0.12, '#dedcd4'], [1, '#c9c7be']], VERTICAL),
    gradient('cheek', [[0, C.cheekDark], [0.5, C.cheek], [1, C.cheekDark]], { x1: 0, y1: 0, x2: 1, y2: 0 }),
    gradient('keyTop', [[0, '#f6f1e1'], [1, '#e7e0ca']], VERTICAL),
    gradient('keyFront', [[0, '#dcd5be'], [1, '#c4bda5']], VERTICAL),
    gradient('display', [[0, '#2c0605'], [1, '#470c09']], VERTICAL),
    knobShadowGradient(),
  ]);
}

const label = (x, y, value, options = {}) => text(x, y, value, { size: 13, fill: C.ink, spacing: 0.3, ...options });

/** The marks round a knob: one for each tenth of its travel. */
/** A cream key seen from above: its sloping front, its flat top, and the lamp window in a cap that has one. */
function keyCap([x, y, w, h], window) {
  const top = h - 30;
  return group({}, [
    rect(x - 3, y - 3, w + 6, h + 7, { rx: 4, fill: C.recess }),
    rect(x, y, w, h, { rx: 3, fill: C.keyBase }),
    rect(x + w - 7, y + 2, 7, h - 4, { rx: 2, fill: C.keyShade }),
    path(`M${n(x + 7)} ${n(y + top)} H${n(x + w - 7)} L${n(x + w - 1)} ${n(y + h - 1)} H${n(x + 1)} Z`, { fill: 'url(#keyFront)' }),
    rect(x + 7, y + 4, w - 14, top, { rx: 4, fill: 'url(#keyTop)' }),
    window
      ? group({}, [
          rect(window[0] - 1, window[1] - 1, window[2] + 2, window[3] + 2, { rx: 2, fill: C.windowEdge }),
          rect(window[0], window[1], window[2], window[3], { rx: 1.5, fill: C.window }),
        ])
      : '',
  ]);
}

/** A small square key: a grey frame round a lens. The editor lights the lamp behind the lens. */
function smallKey([cx, cy], size) {
  const half = size / 2;
  return group({}, [
    rect(cx - half + 1, cy - half + 2, size, size, { rx: 4, fill: '#000', opacity: 0.22 }),
    rect(cx - half, cy - half, size, size, { rx: 4, fill: C.smallFrame }),
    rect(cx - half + 2.5, cy - half + 2.5, size - 5, size - 5, { rx: 3, fill: C.smallBevel }),
    rect(cx - half + 7, cy - half + 7, size - 14, size - 14, { rx: 2.5, fill: C.lens }),
    circle(cx, cy, 7.5, { fill: C.lensLamp, opacity: 0.55 }),
  ]);
}

/** An orange block that names what the keys above it do with SHIFT. */
function shiftBlock(x, y, w, h, lines) {
  const size = lines.length > 1 ? 10 : 11.5;
  const first = y + h / 2 + size * 0.36 - (lines.length - 1) * size * 0.55;
  return group({}, [
    rect(x, y, w, h, { rx: 2, fill: C.orange }),
    ...lines.map((value, index) =>
      text(x + w / 2, first + index * size * 1.1, value, { size, fill: C.orangeInk, spacing: 0.4, maxWidth: w - 8 }),
    ),
  ]);
}

/** The ring of marks round a knob: wider round the large ones. */
const tickRing = (knob, big) => ({ inner: knob.r + (big ? 7 : 5), outer: knob.r + (big ? 15 : 11), stroke: C.tick, width: 1.6 });

function draw909(panel) {
  const { width, height } = panel.faceplate;
  const { steps, keys } = panel;
  const stepCentre = (index) => steps[index].button[0] + steps[index].button[2] / 2;
  const pitch = stepCentre(1) - stepCentre(0);
  const cellLeft = (index) => stepCentre(index) - pitch / 2;
  const cellRight = (index) => stepCentre(index) + pitch / 2;
  const keysLeft = steps[0].button[0];
  const keysRight = steps[15].button[0] + steps[15].button[2];
  const chartLeft = keysLeft + 15;
  const chartRight = keysRight + 14;
  const out = [];

  // The case: a cheek at each side, the panel between them, and the lip at the front.
  out.push(rect(0, 0, width, height, { fill: 'url(#panel)' }));
  out.push(rect(0, 0, 36, height, { fill: 'url(#cheek)' }));
  out.push(rect(width - 36, 0, 36, height, { fill: 'url(#cheek)' }));
  out.push(rect(36, 872, width - 72, height - 872, { fill: 'url(#lip)' }));
  out.push(line(36, 872.5, width - 36, 872.5, { stroke: '#a9a79e', 'stroke-width': 1 }));
  out.push(line(36.5, 0, 36.5, height, { stroke: '#f1efe8', 'stroke-width': 1 }));
  out.push(line(width - 36.5, 0, width - 36.5, height, { stroke: '#b9b7ae', 'stroke-width': 1 }));

  // The model number, and the power switch. The editor draws which half of the rocker is up.
  out.push(text(296, 110, panel.id, { size: 96, fill: C.slate, anchor: 'start', spacing: 2 }));
  out.push(line(296, 122, 560, 122, { stroke: C.orange, 'stroke-width': 4 }));
  const [rockerX, rockerY, rockerW, rockerH] = panel.power.rocker;
  out.push(label(rockerX - 16, rockerY + rockerH / 2 + 4.5, 'POWER', { anchor: 'end' }));
  out.push(rect(rockerX - 5, rockerY - 5, rockerW + 10, rockerH + 10, { rx: 4, fill: C.bezel }));
  out.push(rect(rockerX, rockerY, rockerW, rockerH, { rx: 3, fill: '#101114' }));
  out.push(label(rockerX + rockerW + 12, rockerY + 15, 'ON', { anchor: 'start', size: 11 }));
  out.push(label(rockerX + rockerW + 12, rockerY + rockerH - 5, 'OFF', { anchor: 'start', size: 11 }));

  // The sound section: a named bar over each column, a rule between columns.
  for (const column of COLUMNS) {
    out.push(rect(column.from + 3, 140, column.to - column.from - 6, 25, { rx: 1.5, fill: C.slate }));
    out.push(text((column.from + column.to) / 2, 158, column.title, { size: 14.5, fill: C.orange, spacing: 0.6, maxWidth: column.to - column.from - 22 }));
  }
  for (const x of [COLUMNS[0].from, ...COLUMNS.map((column) => column.to)]) {
    out.push(line(x, 140, x, 360, { stroke: C.ink, 'stroke-width': 1.3 }));
  }

  // Every knob of the section is one the editor turns, so each is drawn where the manifest has it.
  for (const knob of panel.knobs) {
    const big = knob.knob === 'volume';
    out.push(ticks(knob, big ? 30 : 10, tickRing(knob, big)));
    out.push(liveDial(knob, big ? 44 : 30, KNOB));
    const name = KNOB_LABELS[knob.knob];
    if (name) out.push(label(knob.cx, knob.cy - knob.r - 19, name, { maxWidth: 86 }));
  }
  const volume = panel.knobs.find((knob) => knob.knob === 'volume');
  out.push(label(volume.cx, volume.cy - volume.r - 26, 'VOLUME', { size: 13.5 }));
  out.push(label(volume.cx - 58, volume.cy + 62, 'MIN', { size: 10.5 }));
  out.push(label(volume.cx + 58, volume.cy + 62, 'MAX', { size: 10.5 }));

  // START and STOP.
  for (const control of panel.transport) {
    const [x, y, w] = control.hit;
    out.push(label(x + w / 2, y - 13, control.label, { size: 13.5 }));
    out.push(keyCap(control.hit));
  }

  // The display. The editor draws its digits.
  const [windowX, windowY, windowW, windowH] = panel.display.window;
  out.push(label(windowX + windowW / 2, windowY - 13, 'MEAS / TEMPO', { size: 13.5 }));
  out.push(rect(windowX - 5, windowY - 5, windowW + 10, windowH + 10, { rx: 4, fill: C.bezel }));
  out.push(rect(windowX, windowY, windowW, windowH, { rx: 2, fill: 'url(#display)' }));
  out.push(rect(windowX, windowY, windowW, windowH * 0.3, { rx: 2, fill: '#fff', opacity: 0.05 }));

  // Tempo.
  const { tempo } = panel;
  out.push(ticks(tempo, 30, tickRing(tempo, true)));
  out.push(liveDial(tempo, 44, KNOB));
  out.push(label(tempo.cx, tempo.cy - tempo.r - 26, tempo.label, { size: 13.5 }));
  out.push(label(tempo.cx - 58, tempo.cy + 62, 'SLOW', { size: 10.5 }));
  out.push(label(tempo.cx + 58, tempo.cy + 62, 'FAST', { size: 10.5 }));

  // The mode keys: what each does is lettered over it, and what it does with SHIFT in orange under it.
  const keyY = keys.tempo.at[1];
  const over = keyY - keys.size / 2 - 12;
  const under = keyY + keys.size / 2 + 16;
  const blockY = under + 9;
  const centre = (places) => (places[0].at[0] + places[places.length - 1].at[0]) / 2;
  const span = (places) => [places[0].at[0] - 24, places[places.length - 1].at[0] - places[0].at[0] + 48];
  out.push(label(centre(keys.tracks), over, 'TRACK PLAY'));
  out.push(label(centre(keys.groups), over, 'PATTERN PLAY'));
  [...keys.tracks, ...keys.groups].forEach((place) => out.push(smallKey(place.at, keys.size)));
  keys.tracks.forEach((place, index) => out.push(label(place.at[0], under, index + 1)));
  keys.groups.forEach((place, index) => out.push(label(place.at[0], under, index + 1)));
  out.push(shiftBlock(span(keys.tracks)[0], blockY, span(keys.tracks)[1], 22, ['TRACK WRITE']));
  out.push(shiftBlock(span(keys.groups)[0], blockY, span(keys.groups)[1], 22, ['PATTERN WRITE']));
  const lettered = [
    [keys.tempo, ['TEMPO'], 'STEP'],
    [keys.back, ['BACK'], 'TAP'],
    [keys.forward, ['FWD'], ''],
    [keys.available, ['AVAILABLE', 'MEAS'], ''],
    [keys.cycle, ['CYCLE'], ''],
  ];
  for (const [place, above, below] of lettered) {
    out.push(smallKey(place.at, keys.size));
    above.forEach((value, index) => out.push(label(place.at[0], over - (above.length - 1 - index) * 12, value, { size: 11.5 })));
    if (below) out.push(label(place.at[0], under, below, { size: 11.5 }));
  }
  const writeModes = span([keys.tempo, keys.back]);
  out.push(shiftBlock(writeModes[0], blockY, writeModes[1], 22, ['WRITE MODE']));
  out.push(shiftBlock(keys.cycle.at[0] - 28, blockY, 56, 22, ['LAST', 'MEAS']));

  // ENTER, which is the total accent key in pattern write.
  const [enterX, enterY, enterW, enterH] = panel.enter.hit;
  out.push(label(enterX + enterW / 2, enterY - 13, 'ENTER', { size: 13.5 }));
  out.push(keyCap(panel.enter.hit, panel.enter.lamp));
  out.push(label(enterX + enterW / 2, enterY + enterH + 21, 'TOTAL ACCENT', { size: 11.5 }));

  // The function keys, in their frame at the left.
  const frameTop = 540;
  const frameBottom = 842;
  out.push(rect(146, frameTop, 136, frameBottom - frameTop, { fill: 'none', stroke: C.ink, 'stroke-width': 1.3 }));
  const functions = [
    [keys.lastStep, ['LAST STEP']],
    [keys.scale, ['SCALE']],
    [keys.shuffle, ['SHUFFLE']],
    [keys.clear, ['CLEAR']],
    [keys.instrument, ['INSTRUMENT', 'SELECT']],
  ];
  for (const [place, lines] of functions) {
    out.push(smallKey(place.at, keys.size));
    lines.forEach((value, index) =>
      out.push(label(place.at[0], place.at[1] + keys.size / 2 + 16 + index * 12, value, { size: 11, maxWidth: 60 })),
    );
  }
  out.push(smallKey(keys.shift.at, keys.size));
  out.push(shiftBlock(keys.shift.at[0] - 24, keys.shift.at[1] + keys.size / 2 + 5, 48, 18, ['SHIFT']));

  // The scale chart: a row for each scale, a bar for each beat, and the notes that fill it.
  SCALE_ROWS.forEach((row, rowIndex) => {
    const [lampX, lampY] = panel.scales.lamps[rowIndex];
    const y = lampY - 12;
    out.push(circle(lampX, lampY, panel.scales.radius + 1.5, { fill: C.slateEdge }));
    out.push(lamp([lampX, lampY], panel.scales.radius, C.lampOff));
    for (let first = 0; first < steps.length; first += row.beat) {
      const last = Math.min(first + row.beat, steps.length) - 1;
      const left = Math.max(chartLeft, cellLeft(first) + 3);
      const right = Math.min(chartRight, cellRight(last) - 3);
      out.push(rect(left, y, right - left, 24, { rx: 2, fill: C.slate }));
      const notes = [];
      for (let step = first; step <= last; step += row.every) notes.push(stepCentre(step) - 2);
      // A bracket over the notes of a beat marks them as a triplet, where the whole beat is on the keys.
      if (row.triplet && notes.length === 3) {
        const from = notes[0] - 7;
        const to = notes[2] + 14;
        out.push(path(`M${n(from)} ${n(y + 6)} L${n(from + 6)} ${n(y + 2.5)} H${n(to - 6)} L${n(to)} ${n(y + 6)}`, { fill: 'none', stroke: C.white, 'stroke-width': 1, opacity: 0.85 }));
      }
      notes.forEach((x) => out.push(note(x, y + 12, { flag: row.triplet, fill: C.white, head: 4.3, rise: 6 })));
    }
  });

  // The step keys, numbered above, in pairs.
  out.push(line(chartLeft, 662.5, chartRight, 662.5, { stroke: C.ink, 'stroke-width': 1 }));
  steps.forEach((step, index) => {
    out.push(text(stepCentre(index), 680, index + 1, { size: 15, fill: C.ink, weight: 400 }));
    out.push(keyCap(step.button, step.lamp));
    if (index % 2 === 1 && index < steps.length - 1) {
      out.push(line(cellRight(index), 668, cellRight(index), 778, { stroke: C.ink, 'stroke-width': 1 }));
    }
  });

  // The bar under the keys: the shuffle each of the first seven sets.
  out.push(rect(keysLeft, 786, keysRight - keysLeft, 22, { rx: 1.5, fill: C.slate }));
  for (let index = 0; index < 7; index += 1) {
    out.push(text(stepCentre(index), 802.5, index + 1, { size: 15, fill: C.white }));
  }
  const arrow = cellLeft(7) + 6;
  out.push(path(`M${n(arrow)} 797 l9 -5 v10 Z`, { fill: C.white }));
  out.push(text(arrow + 16, 801.5, 'SHUFFLE', { size: 11.5, fill: C.white, anchor: 'start', spacing: 1.2 }));

  // The instrument each key selects and taps.
  for (const box of KEY_BOXES) {
    const [first, last] = box.keys;
    const left = steps[first].button[0];
    const right = steps[last].button[0] + steps[last].button[2];
    out.push(rect(left, 816, right - left, 26, { rx: 6, fill: 'none', stroke: C.ink, 'stroke-width': 1.3 }));
    if (box.labels.length === 1) {
      out.push(label((left + right) / 2, 834, box.labels[0], { size: 13.5 }));
    } else {
      out.push(label(stepCentre(first), 833.5, box.labels[0], { size: 11, maxWidth: 78 }));
      out.push(label(stepCentre(last), 833.5, box.labels[1], { size: 11, maxWidth: 78 }));
    }
  }

  return svgDocument(panel, { defs: defs(), body: out.join('') });
}

publishFaceplate(artDir, draw909(readPanel(artDir)));
