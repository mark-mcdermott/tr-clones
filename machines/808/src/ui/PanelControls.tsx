import type { KeyboardEvent, PointerEvent } from 'react';
import {
  DialHandle,
  Lamp,
  Lever,
  PassiveKnob,
  PositionSwitch,
  box,
  pressHandlers,
  nearestPosition,
  pointerAngle,
  slideLever,
} from '@tr-clones/panel';
import {
  AUTO_FILLS,
  BASIC_RHYTHMS,
  PRE_SCALES,
  isPerformMode,
  panelTarget,
  stepsPerBeat,
  writePart,
  type Mode,
  type PanelManifest,
  type PreScale,
} from '../document';
import { useEditorState, useRuntime } from './context';

interface ControlProps {
  panel: PanelManifest;
}

/** What a step button's rhythm is called: twelve Basic Rhythms, then four Intro/Fill-ins. */
export function rhythmName(button: number): string {
  return button < BASIC_RHYTHMS ? `Basic Rhythm ${button + 1}` : `Intro/Fill-in ${button + 1 - BASIC_RHYTHMS}`;
}

/** Modes in which CLEAR does something: it wipes a rhythm, sets up a part, or empties a rhythm track. */
export function clears(mode: Mode): boolean {
  return mode === 'pattern_clear' || mode === 'compose' || writePart(mode) !== null;
}

/** The mode selector: a label to press for each position, and the dial that follows. */
export function ModeSelector({ panel, photo }: ControlProps & { photo: string | null }) {
  const { session } = useRuntime();
  const mode = useEditorState((state) => state.project.panel.mode);
  const { knob, positions } = panel.modeSelect;
  const active = positions.find((position) => position.mode === mode);
  return (
    <>
      <PassiveKnob panel={panel} photo={photo} knob={knob} deg={active?.deg ?? 0} />
      <DialHandle
        panel={panel}
        knob={knob}
        degs={positions.map((position) => position.deg)}
        testId="panel-dial-mode"
        onPick={(index) => session.setMode(positions[index]!.mode)}
      />
      <div className="sb-panel-layer" role="radiogroup" aria-label="Mode">
        {positions.map((position) => (
          <button
            key={position.mode}
            type="button"
            role="radio"
            className="sb-panel-voice"
            style={box(panel, position.hit)}
            aria-checked={position.mode === mode}
            aria-label={position.label}
            data-testid={`panel-mode-${position.mode}`}
            onClick={() => session.setMode(position.mode)}
          >
            <span className="sb-panel-text">{position.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * CLEAR. In pattern clear it wipes the selected rhythm. In a write mode it
 * stores the pre-scale and stays down until a step button sets the last step.
 */
export function ClearButton({ panel }: ControlProps) {
  const { session } = useRuntime();
  const mode = useEditorState((state) => state.project.panel.mode);
  const armed = useEditorState((state) => state.transient.clearArmed);
  const track = useEditorState((state) => state.project.panel.selector + 1);
  const writing = writePart(mode) !== null;
  const label = writing
    ? 'Clear: store the pre-scale, then press a step button to make it the last step'
    : mode === 'pattern_clear'
      ? 'Clear the selected rhythm'
      : mode === 'compose'
        ? `Clear rhythm track ${track}`
        : 'Clear';
  return (
    <button
      type="button"
      className="sb-panel-clear"
      style={box(panel, panel.clear.hit)}
      data-testid="panel-clear"
      aria-label={label}
      aria-pressed={writing ? armed : undefined}
      disabled={!clears(mode)}
      onClick={() => session.pressClear()}
    >
      <span className="sb-panel-text">Clear</span>
    </button>
  );
}

/** Modes in which TAP does something: it writes a step, or brings in the intro or a fill-in. */
export function taps(mode: Mode): boolean {
  return isPerformMode(mode) || writePart(mode) !== null;
}

/**
 * TAP. In a write mode it writes the selected instrument where the rhythm is
 * now; in a play mode it sets the intro or triggers the fill-in. It acts on
 * the press, not the release.
 */
export function TapButton({ panel }: ControlProps) {
  const runtime = useRuntime();
  const playMode = useEditorState((state) => isPerformMode(state.project.panel.mode));
  const armed = useEditorState((state) => state.transient.fillArmed);
  // TAP has no part in clearing a rhythm or in playing a rhythm track back.
  const idle = useEditorState((state) => !taps(state.project.panel.mode));
  return (
    <button
      type="button"
      className="sb-panel-transport"
      style={box(panel, panel.tap.hit)}
      data-testid="panel-tap"
      aria-label={playMode ? 'Tap: play the intro or fill-in next' : 'Tap: write the selected instrument now'}
      aria-pressed={playMode ? armed : undefined}
      disabled={idle}
      {...pressHandlers(() => runtime.session.tap())}
    >
      <span className="sb-panel-text">Tap</span>
    </button>
  );
}

const AUTO_FILL_TEXT = AUTO_FILLS.map((every) => (every === 0 ? 'Manual' : `Every ${every} measures`));

/**
 * The auto fill-in selector. Press or drag around the dial and it turns to
 * the nearest position; the arrow keys step through them.
 */
export function AutoFillSelector({ panel, photo }: ControlProps & { photo: string | null }) {
  const { session } = useRuntime();
  const index = useEditorState((state) => AUTO_FILLS.indexOf(state.project.panel.autoFill));
  const { knob, hit, degs } = panel.autoFill;
  const last = AUTO_FILLS.length - 1;
  const move = (next: number) => session.setAutoFill(AUTO_FILLS[Math.min(last, Math.max(0, next))]!);

  const turnTo = (event: PointerEvent<HTMLDivElement>) => {
    const [x, y, width, height] = hit;
    const deg = pointerAngle(event, [(knob.cx - x) / width, (knob.cy - y) / height]);
    if (deg !== null) move(nearestPosition(degs, deg));
  };

  return (
    <>
      <PassiveKnob panel={panel} photo={photo} knob={knob} deg={degs[index] ?? 0} />
      <div
        className="sb-panel-switch"
        style={box(panel, hit)}
        role="slider"
        tabIndex={0}
        data-testid="panel-auto-fill"
        aria-label="Auto fill-in"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={index}
        aria-valuetext={AUTO_FILL_TEXT[index]}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          const target = { ArrowRight: index + 1, ArrowUp: index + 1, ArrowLeft: index - 1, ArrowDown: index - 1, Home: 0, End: last }[
            event.key
          ];
          if (target === undefined) return;
          event.preventDefault();
          move(target);
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          turnTo(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons !== 0) turnTo(event);
        }}
      />
    </>
  );
}

const PRE_SCALE_TEXT = PRE_SCALES.map((preScale) => `${preScale}: ${stepsPerBeat(preScale)} steps to the beat`);

export function PreScaleSwitch({ panel }: ControlProps) {
  const { session } = useRuntime();
  const preScale = useEditorState((state) => state.project.panel.preScale);
  const index = PRE_SCALES.indexOf(preScale);
  return (
    <>
      <PositionSwitch
        panel={panel}
        hit={panel.preScale.hit}
        label="Pre-scale"
        testId="panel-pre-scale"
        positions={PRE_SCALE_TEXT}
        index={index}
        axis="y"
        onChange={(next) => session.setPreScale(PRE_SCALES[next] as PreScale)}
      />
      <span
        className="sb-panel-lever"
        aria-hidden="true"
        style={box(panel, slideLever(panel.preScale.slot, index, PRE_SCALES.length))}
      />
    </>
  );
}

const BASIC_VARIATIONS = ['a', 'ab', 'b'] as const;
const FILL_VARIATIONS = ['a', 'b'] as const;

/** The two variation levers: A, AB and B for Basic Rhythms, A and B for Intro/Fill-ins. */
export function VariationSwitches({ panel }: ControlProps) {
  const { session } = useRuntime();
  const basic = useEditorState((state) => BASIC_VARIATIONS.indexOf(state.project.panel.basicVariation));
  const fill = useEditorState((state) => FILL_VARIATIONS.indexOf(state.project.panel.fillVariation));
  return (
    <>
      <PositionSwitch
        panel={panel}
        hit={panel.basicVariation.hit}
        label="Basic variation"
        testId="panel-basic-variation"
        positions={['A', 'A then B', 'B']}
        index={basic}
        axis="x"
        onChange={(next) => session.setBasicVariation(BASIC_VARIATIONS[next]!)}
      />
      <Lever panel={panel} slot={panel.basicVariation.slot} index={basic} count={BASIC_VARIATIONS.length} />
      <PositionSwitch
        panel={panel}
        hit={panel.fillVariation.hit}
        label="Intro and fill-in variation"
        testId="panel-fill-variation"
        positions={['A', 'B']}
        index={fill}
        axis="x"
        onChange={(next) => session.setFillVariation(FILL_VARIATIONS[next]!)}
      />
      <Lever panel={panel} slot={panel.fillVariation.slot} index={fill} count={FILL_VARIATIONS.length} />
    </>
  );
}

/**
 * The lamps beside the step buttons and under the variation lever: which part
 * is playing or being written, and which version.
 */
export function StatusLamps({ panel, dim }: ControlProps & { dim: boolean }) {
  const playing = useEditorState((state) => state.playing && state.currentStep >= 0);
  const secondPlaying = useEditorState((state) => state.currentStep >= 16);
  const patternB = useEditorState((state) => state.currentPattern % 2 === 1);
  const part = useEditorState((state) => writePart(state.project.panel.mode));
  const variation = useEditorState((state) => panelTarget(state.project.panel, state.currentPattern).variation);
  const second = playing ? secondPlaying : part === 1;
  const first = playing ? !secondPlaying : part === 0;
  const b = playing ? patternB : variation === 'b';
  const { lamps } = panel;
  const lamp = (testId: string, at: [number, number], on: boolean, radius = lamps.radius) => (
    <Lamp panel={panel} at={at} radius={radius} on={on} dim={dim} testId={testId} />
  );
  return (
    <>
      {lamp('lamp-first-part', lamps.firstPart, first, lamps.radius - 1)}
      {lamp('lamp-second-part', lamps.secondPart, second, lamps.radius - 1)}
      {lamp('lamp-variation-a', lamps.variationA, !b)}
      {lamp('lamp-variation-b', lamps.variationB, b)}
    </>
  );
}
