import { useEffect, useRef } from 'react';
import {
  PANEL,
  STEPS,
  TRACK_NAMES,
  getPattern,
  isStepOn,
  isTrackMode,
  patternName,
  shownPattern,
  type Project,
} from '../document';
import type { State707 } from '../session';
import { useRuntime } from './context';
import { displayLines, heldPrompt, modeWords, readout, trackPosition, type Shown } from './show';

/** The display's own size, in faceplate pixels. Everything on it is placed in these. */
const [, , WIDTH, HEIGHT] = PANEL.display;
/** Canvas pixels to one of the display's. */
const DENSITY = 2;

const GLASS = '#b6bda9';
const INK = '#20271f';
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** How the display is set out: in full on the faceplate, or with fewer and larger letters on a phone. */
interface Layout {
  compact: boolean;
  /** Width of the column of row names. */
  names: number;
  nameSize: number;
  numberSize: number;
  captionSize: number;
  wordSize: number;
}

const FULL: Layout = { compact: false, names: 96, nameSize: 10.5, numberSize: 9.5, captionSize: 9.5, wordSize: 12.5 };
const COMPACT: Layout = { compact: true, names: 46, nameSize: 13.5, numberSize: 12, captionSize: 11.5, wordSize: 14 };

const EDGE = 9;
const GRID_TOP = 24;
const ROW_HEIGHT = 17;
const STATUS_TOP = GRID_TOP + 10 * ROW_HEIGHT + 8;

type Pen = CanvasRenderingContext2D;

function typeface(g: Pen, size: number, weight = 600): void {
  g.font = `${weight} ${size}px ${FONT}`;
}

function frame(g: Pen, x: number, y: number, width: number, height: number): void {
  g.globalAlpha = 0.55;
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  g.globalAlpha = 1;
}

/** A word of the display: dark when what it says is so, and barely there when it is not. */
function word(g: Pen, text: string, x: number, y: number, lit: boolean): void {
  g.globalAlpha = lit ? 1 : 0.13;
  g.fillText(text, x, y);
  g.globalAlpha = 1;
}

/** The grid: a line for each instrument group, a column for each step the pattern plays. */
function drawGrid(g: Pen, shown: Shown, step: number, layout: Layout): void {
  const { project, playing, currentPattern } = shown;
  const at = shownPattern(project, playing ? currentPattern : -1);
  const pattern = getPattern(project, at);
  const left = EDGE + layout.names;
  const cell = (WIDTH - EDGE - left) / STEPS;
  const lines = displayLines(project);
  const bottom = GRID_TOP + lines.length * ROW_HEIGHT;
  const running = playing && step >= 0 && step < pattern.lastStep;

  typeface(g, layout.numberSize);
  g.textAlign = 'left';
  if (!layout.compact) g.fillText('STEP', EDGE + 9, GRID_TOP - 7);
  g.textAlign = 'center';
  for (let column = 0; column < pattern.lastStep; column += 1) {
    const x = left + column * cell;
    const onBeat = column % pattern.scale === 0;
    if (running && column === step) {
      // The step now sounding: its number reversed out, and its column shaded.
      g.fillRect(x + 1, GRID_TOP - 17, cell - 2, 14);
      g.globalAlpha = 0.14;
      g.fillRect(x + 1, GRID_TOP, cell - 2, bottom - GRID_TOP);
      g.globalAlpha = 1;
      g.fillStyle = GLASS;
      g.fillText(String(column + 1), x + cell / 2, GRID_TOP - 6);
      g.fillStyle = INK;
    } else if (!layout.compact || onBeat) {
      g.globalAlpha = onBeat ? 1 : 0.6;
      g.fillText(String(column + 1), x + cell / 2, GRID_TOP - 6);
      g.globalAlpha = 1;
    }
  }

  lines.forEach((line, index) => {
    const y = GRID_TOP + index * ROW_HEIGHT;
    const written = project.panel.row === line.solid || project.panel.row === line.outline;
    typeface(g, layout.nameSize, written ? 700 : 600);
    g.textAlign = 'left';
    g.globalAlpha = written ? 1 : 0.78;
    g.fillText(layout.compact ? line.short : line.label, EDGE + 9, y + ROW_HEIGHT - 4.5);
    g.globalAlpha = 1;
    if (written) {
      // The row the step keys write.
      g.beginPath();
      g.moveTo(EDGE, y + 4);
      g.lineTo(EDGE + 6, y + ROW_HEIGHT / 2);
      g.lineTo(EDGE, y + ROW_HEIGHT - 4);
      g.fill();
    }
    for (let column = 0; column < pattern.lastStep; column += 1) {
      const x = left + column * cell;
      const solid = isStepOn(pattern.steps[line.solid], column);
      const outline = line.outline !== undefined && isStepOn(pattern.steps[line.outline], column);
      if (!solid && !outline) {
        g.globalAlpha = 0.1;
        g.fillRect(x + 2, y + 2, cell - 4, ROW_HEIGHT - 4);
        g.globalAlpha = 1;
        continue;
      }
      // The second sound of a line is a frame; the first is solid, inside the frame when both are on.
      const inset = outline ? 5 : 2;
      if (solid) g.fillRect(x + inset, y + inset, cell - inset * 2, ROW_HEIGHT - inset * 2);
      if (outline) {
        g.lineWidth = 1.8;
        g.strokeRect(x + 2.9, y + 2.9, cell - 5.8, ROW_HEIGHT - 5.8);
      }
    }
  });
}

/** The number: the tempo, or the measure. */
function drawReadout(g: Pen, shown: Shown, x: number, width: number, layout: Layout): void {
  const { caption, value } = readout(shown);
  const height = HEIGHT - STATUS_TOP - EDGE;
  frame(g, x, STATUS_TOP, width, height);
  typeface(g, layout.captionSize);
  g.textAlign = 'left';
  word(g, 'TEMPO', x + 7, STATUS_TOP + 14, caption === 'TEMPO');
  word(g, 'MEASURE', x + 7, STATUS_TOP + 14 + layout.captionSize + 3, caption === 'MEASURE');
  typeface(g, 38, 700);
  g.textAlign = 'right';
  g.fillText(value, x + width - 8, STATUS_TOP + height - 10);
  const { project } = shown;
  if (caption === 'MEASURE' && isTrackMode(project.panel.mode)) {
    typeface(g, layout.captionSize);
    g.textAlign = 'left';
    g.fillText(`OF ${trackPosition(shown).of}`, x + 7, STATUS_TOP + height - 10);
  }
}

/** The mode, as words that are each there or not. */
function drawMode(g: Pen, project: Project, x: number, width: number, layout: Layout): void {
  const height = HEIGHT - STATUS_TOP - EDGE;
  const { what, does, by } = modeWords(project.panel.mode);
  frame(g, x, STATUS_TOP, width, height);
  typeface(g, layout.wordSize, 700);
  g.textAlign = 'left';
  const half = x + width / 2 + 2;
  const line = (height - 12) / 3;
  const base = (row: number) => STATUS_TOP + 6 + line * row + line * 0.72;
  word(g, 'TRACK', x + 8, base(0), what === 'TRACK');
  word(g, 'PATTERN', half, base(0), what === 'PATTERN');
  word(g, 'PLAY', x + 8, base(1), does === 'PLAY');
  word(g, 'WRITE', half, base(1), does === 'WRITE');
  word(g, 'STEP', x + 8, base(2), by === 'STEP');
  word(g, 'TAP', half, base(2), by === 'TAP');
}

/** Where the machine is: its track and pattern, or what a key that is down waits for. */
function drawPlace(g: Pen, shown: Shown, x: number, width: number, layout: Layout): void {
  const { project, transient, playing, currentPattern } = shown;
  const height = HEIGHT - STATUS_TOP - EDGE;
  const { held } = transient;
  g.textAlign = 'left';
  if (held) {
    const prompt = heldPrompt(held, project.panel.mode);
    g.fillRect(x, STATUS_TOP, width, height);
    g.fillStyle = GLASS;
    typeface(g, layout.wordSize + 3, 700);
    g.fillText(prompt.key, x + 8, STATUS_TOP + 26);
    typeface(g, layout.captionSize);
    g.fillText(prompt.then, x + 8, STATUS_TOP + height - 12);
    g.fillStyle = INK;
    return;
  }
  frame(g, x, STATUS_TOP, width, height);
  const at = shownPattern(project, playing ? currentPattern : -1);
  const pattern = getPattern(project, at);
  typeface(g, layout.captionSize);
  const track = isTrackMode(project.panel.mode);
  word(g, track ? `TRACK ${TRACK_NAMES[project.panel.track]}` : 'TRACK', x + 8, STATUS_TOP + 14, track);
  const { chain } = project.panel;
  if (chain) g.fillText(`CHAIN ${chain.first + 1}-${chain.last + 1}`, x + width / 2 - 4, STATUS_TOP + 14);
  typeface(g, 27, 700);
  g.fillText(patternName(at.group, at.pattern), x + 8, STATUS_TOP + 43);
  typeface(g, layout.captionSize);
  g.textAlign = 'right';
  g.fillText(`${pattern.scale}/BEAT`, x + width - 8, STATUS_TOP + 32);
  g.fillText(`LAST ${pattern.lastStep}`, x + width - 8, STATUS_TOP + 32 + layout.captionSize + 3);
  g.textAlign = 'left';
  word(g, `SHUFFLE ${project.shuffle}`, x + 8, STATUS_TOP + height - 8, project.shuffle > 0);
}

/** One picture of the display. With the power off the glass is blank. */
function drawDisplay(g: Pen, state: State707, layout: Layout): void {
  g.setTransform(DENSITY, 0, 0, DENSITY, 0, 0);
  g.clearRect(0, 0, WIDTH, HEIGHT);
  if (!state.power) return;
  g.globalAlpha = 1;
  g.fillStyle = GLASS;
  g.fillRect(0, 0, WIDTH, HEIGHT);
  g.fillStyle = INK;
  g.strokeStyle = INK;
  g.textBaseline = 'alphabetic';
  drawGrid(g, state, state.currentStep, layout);
  const inner = WIDTH - EDGE * 2;
  const gap = 8;
  const number = layout.compact ? 138 : 132;
  const mode = layout.compact ? 162 : 154;
  drawReadout(g, state, EDGE, number, layout);
  drawMode(g, state.project, EDGE + number + gap, mode, layout);
  drawPlace(g, state, EDGE + number + mode + gap * 2, inner - number - mode - gap * 2, layout);
}

/**
 * The display, drawn from the store whenever it changes and never by React:
 * the running step moves across it without the panel rendering again. What
 * it shows is said in words by whatever holds it.
 */
export function DisplayCanvas({ compact = false, testId }: { compact?: boolean; testId: string }) {
  const runtime = useRuntime();
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return undefined;
    const layout = compact ? COMPACT : FULL;
    let waiting = 0;
    const draw = () => {
      waiting = 0;
      const state = runtime.store.getState();
      drawDisplay(context, state, layout);
      // For the tests, which cannot read a canvas: the step it has drawn.
      element.dataset.step = String(state.power ? state.currentStep : -1);
    };
    const schedule = () => {
      if (waiting === 0) waiting = requestAnimationFrame(draw);
    };
    draw();
    const unsubscribe = runtime.store.subscribe(schedule);
    return () => {
      unsubscribe();
      cancelAnimationFrame(waiting);
    };
  }, [runtime, compact]);

  return <canvas ref={canvas} width={WIDTH * DENSITY} height={HEIGHT * DENSITY} data-testid={testId} aria-hidden="true" />;
}
