import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { useEditorState, useKnob, useRuntime, type KnobOptions } from '@boombapbot/editor';
import { KnobFace, box, circle, knobLighting } from './geometry';
import type { PanelFrame, PanelPoint, PanelRect, SweepKnobGeometry } from './schema';

export interface KnobProps extends KnobOptions {
  panel: PanelFrame;
  photo: string | null;
  geometry: Omit<SweepKnobGeometry, 'label'>;
  testId: string;
}

/** A knob on the faceplate: drag up and down, or use the arrow keys. */
export function Knob(props: KnobProps) {
  const { panel, photo, geometry, value, min, max } = props;
  const knob = useKnob(props);
  const turn = (value - min) / (max - min);
  const deg = geometry.minDeg + turn * (geometry.maxDeg - geometry.minDeg);

  return (
    <div
      className="sb-panel-knob"
      style={circle(panel, geometry.cx, geometry.cy, geometry.r)}
      data-testid={props.testId}
      data-lighting={knobLighting(panel, photo)}
      {...knob}
    >
      <KnobFace
        panel={panel}
        photo={photo}
        cx={geometry.cx}
        cy={geometry.cy}
        r={geometry.r}
        photoDeg={geometry.photoDeg}
        deg={deg}
      />
    </div>
  );
}

export interface PositionSwitchProps {
  panel: PanelFrame;
  hit: PanelRect;
  label: string;
  testId: string;
  /** What each position is called, in order along the switch. */
  positions: readonly string[];
  index: number;
  axis: 'x' | 'y';
  onChange(index: number): void;
}

/** A switch with a few fixed positions: press where it should go, or use the arrow keys. */
export function PositionSwitch(props: PositionSwitchProps) {
  const { positions, index, axis, onChange } = props;
  const last = positions.length - 1;
  const move = (next: number) => onChange(Math.min(last, Math.max(0, next)));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const target = { [forward]: index + 1, [back]: index - 1, Home: 0, End: last }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    move(target);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const along = axis === 'x' ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height;
    move(Math.floor(along * positions.length));
  };

  return (
    <div
      className="sb-panel-switch"
      style={box(props.panel, props.hit)}
      role="slider"
      tabIndex={0}
      data-testid={props.testId}
      aria-label={props.label}
      aria-orientation={axis === 'x' ? 'horizontal' : 'vertical'}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={index}
      aria-valuetext={positions[index]}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    />
  );
}

/** Where the lever of a slide switch sits in its slot, for one of `count` positions. */
export function slideLever([x, y, width, height]: PanelRect, index: number, count: number): PanelRect {
  const inset = 3;
  const lever = 24;
  const travel = height - inset * 2 - lever;
  return [x + inset, y + inset + (travel * index) / (count - 1), width - inset * 2, lever];
}

const BALL = 9;

/** A lever thrown along a rounded slot: a stem from the middle and a ball at its end. */
export function Lever({ panel, slot, index, count }: { panel: PanelFrame; slot: PanelRect; index: number; count: number }) {
  const [x, y, width, height] = slot;
  const middle = x + width / 2;
  const reach = width / 2 - 15;
  const tip = middle + (count === 1 ? 0 : (index / (count - 1)) * 2 - 1) * reach;
  const centre = y + height / 2 + 1;
  return (
    <>
      <span
        className="sb-panel-stem"
        aria-hidden="true"
        style={box(panel, [Math.min(middle, tip), centre - 3, Math.abs(tip - middle), 6])}
      />
      <span className="sb-panel-ball" aria-hidden="true" style={circle(panel, tip, centre, BALL)} />
    </>
  );
}

export interface LampProps {
  panel: PanelFrame;
  at: PanelPoint;
  radius: number;
  on: boolean;
  /** True where an unlit lamp has to be painted: on the drawn panel, or over a photo that shows it lit. */
  dim: boolean;
  /** The step now sounding. */
  now?: boolean;
  /** Flashing while it waits. */
  flash?: boolean;
  testId?: string;
  /** Which step button the lamp belongs to. */
  step?: number;
}

/** A lamp on the faceplate. Nothing about it can be pressed. */
export function Lamp({ panel, at: [x, y], radius, on, dim, now, flash, testId, step }: LampProps) {
  return (
    <span
      className="sb-panel-led"
      aria-hidden="true"
      data-testid={testId}
      data-panel-lamp={step}
      data-on={on}
      data-now={now}
      data-flash={flash}
      data-dim={dim}
      style={circle(panel, x, y, radius)}
    />
  );
}

/** A lamp behind a bar or a window: a rectangle, where the panel's other lamps are round. */
export function BarLamp(props: Omit<LampProps, 'at' | 'radius'> & { rect: PanelRect; className?: string }) {
  return (
    <span
      className={props.className ? `sb-panel-led ${props.className}` : 'sb-panel-led'}
      aria-hidden="true"
      data-testid={props.testId}
      data-panel-lamp={props.step}
      data-on={props.on}
      data-now={props.now}
      data-flash={props.flash}
      data-dim={props.dim}
      style={box(props.panel, props.rect)}
    />
  );
}

/**
 * A key that has to be in time acts as the pointer goes down, and only the
 * keyboard arrives as a click. Any other key waits for the click, so a finger
 * that drags the faceplate sideways presses nothing.
 */
export function pressHandlers(press: () => void, inTime = true) {
  return {
    onPointerDown: inTime ? press : undefined,
    onClick: (event: MouseEvent) => {
      if (!inTime || event.detail === 0) press();
    },
  };
}

/**
 * A rocker for the power. Off, the machine is dark and silent and nothing
 * else on it answers. The faceplate has the rocker's well; this draws the
 * half that stands proud, the top when it is on.
 */
export function PowerRocker({ panel, hit, rocker }: { panel: PanelFrame; hit: PanelRect; rocker: PanelRect }) {
  const runtime = useRuntime();
  const on = useEditorState((state) => state.power);
  const [x, y, width, height] = rocker;
  return (
    <>
      <button
        type="button"
        role="switch"
        className="sb-panel-switch sb-panel-power"
        style={box(panel, hit)}
        data-testid="panel-power"
        aria-checked={on}
        aria-label="Power"
        onClick={() => runtime.setPower(!on)}
      >
        <span className="sb-panel-text">Power</span>
      </button>
      <span className="sb-panel-rocker" aria-hidden="true" style={box(panel, [x, on ? y : y + height / 2, width, height / 2])} />
    </>
  );
}
