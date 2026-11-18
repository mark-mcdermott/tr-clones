import type { CSSProperties, PointerEvent } from 'react';
import type { PanelManifest, PanelRect } from '../document';

/** Positions a faceplate rectangle as percentages, so it scales with the image. */
export function box(panel: PanelManifest, [x, y, w, h]: PanelRect): CSSProperties {
  const { width, height } = panel.faceplate;
  return {
    left: `${(x / width) * 100}%`,
    top: `${(y / height) * 100}%`,
    width: `${(w / width) * 100}%`,
    height: `${(h / height) * 100}%`,
  };
}

export function circle(panel: PanelManifest, cx: number, cy: number, r: number): CSSProperties {
  return box(panel, [cx - r, cy - r, r * 2, r * 2]);
}

/**
 * A knob cut from the faceplate photo: a round window onto the photo that
 * turns about the knob's centre. Without a photo it is drawn instead.
 */
export function KnobFace(props: {
  panel: PanelManifest;
  photo: string | null;
  cx: number;
  cy: number;
  r: number;
  photoDeg: number;
  deg: number;
}) {
  const { panel, photo, cx, cy, r } = props;
  const { width, height } = panel.faceplate;
  if (!photo) {
    return (
      <span className="sb-knob-drawn" style={{ transform: `rotate(${props.deg}deg)` }}>
        <span className="sb-knob-pointer" />
      </span>
    );
  }
  return (
    <span
      className="sb-knob-photo"
      style={{
        backgroundImage: `url("${photo}")`,
        backgroundSize: `${(width / (2 * r)) * 100}% auto`,
        backgroundPosition: `${((cx - r) / (width - 2 * r)) * 100}% ${((cy - r) / (height - 2 * r)) * 100}%`,
        transform: `rotate(${props.deg - props.photoDeg}deg)`,
      }}
    />
  );
}

/**
 * Artwork drawn for boombapbot shades its knobs evenly, so the light on them
 * can stay put while they turn. A photograph carries its own light.
 */
export function knobLighting(panel: PanelManifest, photo: string | null): 'fixed' | undefined {
  return photo && panel.faceplate.original ? 'fixed' : undefined;
}

/** A knob the pointer cannot turn: it shows where a selector stands. */
export function PassiveKnob(props: {
  panel: PanelManifest;
  photo: string | null;
  knob: { cx: number; cy: number; r: number; photoDeg: number };
  deg: number;
}) {
  const { panel, photo, knob } = props;
  return (
    <span
      className="sb-panel-knob sb-panel-knob-passive"
      data-lighting={knobLighting(panel, photo)}
      style={circle(panel, knob.cx, knob.cy, knob.r)}
      aria-hidden="true"
    >
      <KnobFace panel={panel} photo={photo} cx={knob.cx} cy={knob.cy} r={knob.r} photoDeg={knob.photoDeg} deg={props.deg} />
    </span>
  );
}

/** How far apart two pointer angles are, in degrees. */
function angleBetween(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** The position of a selector whose pointer angle is nearest to `deg`. */
export function nearestPosition(degs: readonly number[], deg: number): number {
  return degs.reduce((best, candidate, index) => (angleBetween(candidate, deg) < angleBetween(degs[best]!, deg) ? index : best), 0);
}

/**
 * The angle of a pointer about a point of an element, in degrees clockwise
 * from straight up, as the faceplate measures them. `at` is the point as
 * fractions of the element's width and height. Null too near the point to say.
 */
export function pointerAngle(event: PointerEvent<HTMLElement>, at: [number, number] = [0.5, 0.5]): number | null {
  const rect = event.currentTarget.getBoundingClientRect();
  const dx = event.clientX - (rect.left + at[0] * rect.width);
  const dy = event.clientY - (rect.top + at[1] * rect.height);
  if (Math.hypot(dx, dy) < Math.min(rect.width, rect.height) * 0.08) return null;
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/**
 * Lets a selector dial be turned by hand: press or drag around it and it goes
 * to the nearest position. The labels beside the dial and the keyboard are
 * the accessible way to the same choice, so this is hidden from them.
 */
export function DialHandle(props: {
  panel: PanelManifest;
  knob: { cx: number; cy: number; r: number };
  /** Pointer angle of each position, in order. */
  degs: readonly number[];
  testId: string;
  onPick(index: number): void;
}) {
  const { panel, knob, degs, onPick } = props;
  const pick = (event: PointerEvent<HTMLSpanElement>) => {
    const deg = pointerAngle(event);
    if (deg !== null) onPick(nearestPosition(degs, deg));
  };
  return (
    <span
      className="sb-panel-dial"
      aria-hidden="true"
      data-testid={props.testId}
      style={circle(panel, knob.cx, knob.cy, knob.r)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        pick(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 0) pick(event);
      }}
    />
  );
}
