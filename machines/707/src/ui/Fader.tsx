import { useState, type CSSProperties, type PointerEvent } from 'react';
import { useKnob, type KnobOptions } from '@boombapbot/editor';
import { box, type PanelFrame, type PanelRect } from '@tr-clones/panel';

/** Where a fader is on the faceplate, in its pixels. */
export interface FaderGeometry {
  /** Centre of the slot. */
  x: number;
  /** Where the middle of the cap is with the fader at its most and at its least. */
  top: number;
  bottom: number;
  hit: PanelRect;
}

export interface FaderProps extends Omit<KnobOptions, 'perPixel'> {
  panel: PanelFrame;
  geometry: FaderGeometry;
  cap: { width: number; height: number };
  testId: string;
  /** A fader whose cap is marked apart from the rest. */
  marked?: boolean;
}

/**
 * A slide fader on the faceplate: a vertical slider to a screen reader, its
 * cap dragged up and down or moved with the arrow keys. The faceplate has
 * the slot; this draws the cap, which keeps under the pointer as it is
 * dragged however large the panel is shown.
 */
export function Fader(props: FaderProps) {
  const { panel, geometry, cap, value, min, max } = props;
  const [, hitY, hitWidth, hitHeight] = geometry.hit;
  const travel = geometry.bottom - geometry.top;
  // Faceplate pixels to a pixel of the screen, measured when a drag begins.
  const [scale, setScale] = useState(1);
  const knob = useKnob({ ...props, perPixel: (max - min) / (travel * scale) });
  const turn = (value - min) / (max - min);
  const middle = geometry.bottom - turn * travel;
  const capStyle: CSSProperties = {
    left: `${((hitWidth - cap.width) / 2 / hitWidth) * 100}%`,
    width: `${(cap.width / hitWidth) * 100}%`,
    top: `${((middle - cap.height / 2 - hitY) / hitHeight) * 100}%`,
    height: `${(cap.height / hitHeight) * 100}%`,
  };

  return (
    <div
      className="sb-707-fader"
      style={box(panel, geometry.hit)}
      data-testid={props.testId}
      data-marked={props.marked}
      aria-orientation="vertical"
      {...knob}
      onPointerDown={(event: PointerEvent<HTMLElement>) => {
        setScale(event.currentTarget.getBoundingClientRect().height / hitHeight);
        knob.onPointerDown(event);
      }}
    >
      <span className="sb-707-fader-cap" style={capStyle} />
    </div>
  );
}
