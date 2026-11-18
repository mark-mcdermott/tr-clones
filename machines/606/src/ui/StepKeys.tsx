import { useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { Lamp, box } from '@tr-clones/panel';
import { STEPS, getTrack, type PanelManifest } from '../document';
import { stepLamps, stepNames } from '../lamps';
import { keysAreSteps, selectedTrack } from '../session';
import { sameJson, useEditorState, useRuntime } from './context';

/** The step key under a point of the page, or null. */
function keyAt(x: number, y: number): number | null {
  const key = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-panel-step]');
  return key ? Number(key.dataset.panelStep) : null;
}

/**
 * The sixteen step keys and the lamp over each.
 *
 * Two keys pressed together chain patterns, and a mouse has one pointer, so
 * there are three ways to do it: hold one key and touch another, press one
 * and let go over another, or hold Shift while pressing the second.
 */
export function StepKeys({ panel, photo }: { panel: PanelManifest; photo: string | null }) {
  const { session, store } = useRuntime();
  const lamps = useEditorState(stepLamps, sameJson);
  const names = useEditorState(stepNames, sameJson);
  const steps = useEditorState(keysAreSteps);
  const track = useEditorState((state) => getTrack(selectedTrack(state.project)).label);
  const layer = useRef<HTMLDivElement>(null);
  /** The key a pointer is down on. */
  const held = useRef<number | null>(null);
  /** Keys whose click has already been answered as half of a pair. */
  const answered = useRef(new Set<number>());

  const focusKey = (key: number) => layer.current?.querySelector<HTMLButtonElement>(`[data-panel-step="${key}"]`)?.focus();

  const onPointerDown = (key: number) => {
    const first = held.current;
    if (first !== null && first !== key) {
      session.pressSteps(first, key);
      answered.current = new Set([first, key]);
      return;
    }
    held.current = key;
    answered.current.clear();
    const lift = (event: PointerEvent) => {
      window.removeEventListener('pointerup', lift);
      window.removeEventListener('pointercancel', lift);
      if (held.current !== key) return;
      held.current = null;
      const over = event.type === 'pointerup' ? keyAt(event.clientX, event.clientY) : null;
      if (over !== null && over !== key && !answered.current.has(key)) session.pressSteps(key, over);
    };
    window.addEventListener('pointerup', lift);
    window.addEventListener('pointercancel', lift);
  };

  const onClick = (key: number, event: MouseEvent) => {
    if (answered.current.delete(key)) return;
    if (event.shiftKey) session.pressSteps(store.getState().project.panel.pattern, key);
    else session.pressStep(key);
  };

  const onKeyDown = (key: number, event: KeyboardEvent) => {
    const move = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (move === undefined) return;
    event.preventDefault();
    focusKey((key + move + STEPS) % STEPS);
  };

  return (
    <>
      {!photo
        ? panel.steps.map((step, key) => <span key={key} className="sb-panel-key" aria-hidden="true" style={box(panel, step.button)} />)
        : null}
      <div ref={layer} className="sb-panel-layer" role="group" aria-label={steps ? `${track} steps` : 'Patterns'}>
        {panel.steps.map((step, key) => (
          <button
            key={key}
            type="button"
            className="sb-panel-step"
            style={box(panel, step.hit)}
            data-panel-step={key}
            data-on={lamps[key]!.on}
            aria-pressed={lamps[key]!.on}
            aria-label={names[key]}
            onPointerDown={() => onPointerDown(key)}
            onClick={(event) => onClick(key, event)}
            onKeyDown={(event) => onKeyDown(key, event)}
          >
            <span className="sb-panel-text">{key + 1}</span>
          </button>
        ))}
      </div>
      {panel.steps.map((step, key) => (
        <Lamp
          key={key}
          panel={panel}
          at={step.led}
          radius={panel.ledRadius}
          step={key}
          on={lamps[key]!.on}
          now={lamps[key]!.now}
          flash={lamps[key]!.flash}
          dim={!photo || panel.ledsLitInPhoto}
        />
      ))}
    </>
  );
}
