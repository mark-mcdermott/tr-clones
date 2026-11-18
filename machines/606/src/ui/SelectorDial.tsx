import { useRef, type KeyboardEvent } from 'react';
import { DialHandle, PassiveKnob, box, type KnobGeometry, type PanelFrame, type PanelRect } from '@tr-clones/panel';

export interface DialPosition {
  /** As it is lettered beside the dial, for the drawn panel. */
  label: string;
  /** What a screen reader calls it. */
  name: string;
  /** Pointer angle of the dial at this position. */
  deg: number;
  hit: PanelRect;
  testId: string;
}

/**
 * A rotary selector: a dial that points at one of a few lettered positions.
 * It is turned by pressing or dragging round the dial, by pressing a
 * position's lettering, or with the arrow keys once one of them has focus.
 * To a screen reader it is a group of radio buttons.
 */
export function SelectorDial(props: {
  panel: PanelFrame;
  photo: string | null;
  knob: KnobGeometry;
  label: string;
  positions: readonly DialPosition[];
  index: number;
  dialTestId: string;
  onChange(index: number): void;
}) {
  const { panel, photo, knob, positions, index, onChange } = props;
  const group = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = positions.length - 1;
    const target = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = Math.min(last, Math.max(0, target));
    onChange(next);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <>
      <PassiveKnob panel={panel} photo={photo} knob={knob} deg={positions[index]?.deg ?? 0} />
      <DialHandle
        panel={panel}
        knob={knob}
        degs={positions.map((position) => position.deg)}
        testId={props.dialTestId}
        onPick={(picked) => {
          if (picked !== index) onChange(picked);
        }}
      />
      <div ref={group} className="sb-panel-layer" role="radiogroup" aria-label={props.label} onKeyDown={onKeyDown}>
        {positions.map((position, at) => (
          <button
            key={position.testId}
            type="button"
            role="radio"
            className="sb-panel-voice"
            style={box(panel, position.hit)}
            aria-checked={at === index}
            aria-label={position.name}
            tabIndex={at === index ? 0 : -1}
            data-testid={position.testId}
            onClick={() => onChange(at)}
          >
            <span className="sb-panel-text">{position.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
