import { useRef, type PointerEvent } from 'react';
import { BarLamp, Knob, box, pressHandlers, slideLever, type PanelRect } from '@tr-clones/panel';
import {
  BPM_MAX,
  BPM_MIN,
  FADER_NAMES,
  GROUPS,
  SCALE_NAMES,
  STEPS,
  TRACK_NAMES,
  activeGroup,
  getPattern,
  isPatternWrite,
  isTrackMode,
  patternName,
  selectedTrack,
  trackCursor,
  type FunctionKey,
  type PanelFader,
  type PanelManifest,
} from '../document';
import { editTarget } from '../session';
import { useEditorState, useRuntime, type Runtime707 } from './context';
import { Fader } from './Fader';
import { keysArePatterns, rowName, stepKeyName, stepLamp, type Shown } from './show';

interface ControlProps {
  panel: PanelManifest;
}

/** Whether the build shipped the drawn faceplate. Without it the panel draws its own keys and unlit lamps. */
interface FaceplateProps extends ControlProps {
  photo: string | null;
}

function sameShown(a: Shown, b: Shown): boolean {
  return a.project === b.project && a.transient === b.transient && a.playing === b.playing && a.currentPattern === b.currentPattern;
}

/** Everything the panel shows itself by, but the running step. */
export function useShown(): Shown {
  return useEditorState(
    (state) => ({
      project: state.project,
      transient: state.transient,
      playing: state.playing,
      currentPattern: state.currentPattern,
    }),
    sameShown,
  );
}

/** The power switch. Off, the machine is dark and silent and nothing else on it answers. */
export function PowerSwitch({ panel }: ControlProps) {
  const runtime = useRuntime();
  const on = useEditorState((state) => state.power);
  return (
    <>
      <button
        type="button"
        role="switch"
        className="sb-panel-switch"
        style={box(panel, panel.power.hit)}
        data-testid="panel-power"
        aria-checked={on}
        aria-label="Power"
        onClick={() => runtime.setPower(!on)}
      >
        <span className="sb-panel-text">Power</span>
      </button>
      <span className="sb-panel-lever" aria-hidden="true" style={box(panel, slideLever(panel.power.slot, on ? 0 : 1, 2))} />
    </>
  );
}

export function TempoKnob({ panel, photo }: FaceplateProps) {
  const { session } = useRuntime();
  const tempo = useEditorState((state) => state.project.tempo);
  return (
    <Knob
      panel={panel}
      photo={photo}
      geometry={panel.tempo}
      label="Tempo"
      testId="panel-tempo"
      value={tempo}
      min={BPM_MIN}
      max={BPM_MAX}
      step={1}
      perPixel={1}
      valueText={`${tempo} beats per minute`}
      onChange={(value) => session.setTempo(value)}
    />
  );
}

const PERCENT = { min: 0, max: 100, step: 2 } as const;

function faderName(id: PanelFader['id']): string {
  if (id === 'accent') return 'Accent';
  return id === 'volume' ? 'Volume' : `${FADER_NAMES[id]} level`;
}

function BankFader({ panel, fader }: ControlProps & { fader: PanelFader }) {
  const { session } = useRuntime();
  const { id } = fader;
  const percent = useEditorState((state) => {
    const { mix } = state.project;
    return Math.round((id === 'accent' ? mix.accent : id === 'volume' ? mix.volume : mix.levels[id]) * 100);
  });
  return (
    <Fader
      panel={panel}
      geometry={fader}
      cap={panel.faderCap}
      label={faderName(id)}
      testId={`panel-fader-${id}`}
      marked={id === 'volume'}
      value={percent}
      {...PERCENT}
      valueText={`${percent}%`}
      onChange={(value) => {
        if (id === 'accent') session.setAccent(value / 100);
        else if (id === 'volume') session.setVolume(value / 100);
        else session.setLevel(id, value / 100);
      }}
    />
  );
}

/** The bank of faders: the accent, a level for each instrument group, and the volume. */
export function FaderBank({ panel }: ControlProps) {
  return (
    <div className="sb-panel-layer" role="group" aria-label="Levels">
      {panel.faders.map((fader) => (
        <BankFader key={fader.id} panel={panel} fader={fader} />
      ))}
    </div>
  );
}

/** START plays from the top. STOP/CONT stops, and carries a stopped track on from where it was. */
export function Transport({ panel }: ControlProps) {
  const runtime = useRuntime();
  const playing = useEditorState((state) => state.playing);
  return (
    <>
      <button
        type="button"
        className="sb-panel-transport"
        style={box(panel, panel.start.hit)}
        data-testid="panel-start"
        aria-label="Start"
        aria-pressed={playing}
        onClick={() => {
          if (playing) return;
          runtime.session.rewind();
          void runtime.play();
        }}
      >
        <span className="sb-panel-text">{panel.start.label}</span>
      </button>
      <button
        type="button"
        className="sb-panel-transport"
        style={box(panel, panel.stop.hit)}
        data-testid="panel-stop"
        aria-label={playing ? 'Stop' : 'Continue'}
        onClick={() => void runtime.togglePlay()}
      >
        <span className="sb-panel-text">{panel.stop.label}</span>
      </button>
    </>
  );
}

/** What a key of the machine is now: its name for what it will do, and whether it will do anything. */
export interface KeyState {
  /** A few letters, for the phone's buttons. */
  short: string;
  name: string;
  disabled: boolean;
  /** Down, waiting for the key that completes it. Undefined for a key that cannot stay down. */
  pressed?: boolean;
  press(): void;
}

export type MachineKey = FunctionKey | 'shift' | 'enter';

/** Every key beside the step keys, as it stands for one state of the machine. */
export function keyStates(shown: Shown, runtime: Runtime707): Record<MachineKey, KeyState> {
  const { session } = runtime;
  const { project, transient } = shown;
  const { panel } = project;
  const { mode } = panel;
  const { held } = transient;
  const tracks = isTrackMode(mode);
  const writing = isPatternWrite(mode);
  const shifted = held === 'shift';
  const track = TRACK_NAMES[panel.track];
  const pattern = getPattern(project, editTarget(shown));
  const chosen = patternName(activeGroup(project), panel.pattern);
  const measure = trackCursor(project) + 1;
  const length = selectedTrack(project).measures.length;

  const enterName = (): string => {
    if (held === 'instrument') return 'Accent: give the step keys the accent row';
    if (held === 'clear' && mode === 'track_write') return `Enter: empty track ${track}`;
    if (mode === 'track_write') return `Enter: store pattern ${chosen} in measure ${measure}`;
    return mode === 'pattern_tap' ? 'Accent: tap to accent this step' : 'Enter';
  };

  return {
    shift: {
      short: 'Shift',
      name: 'Shift',
      disabled: false,
      pressed: shifted,
      press: () => session.pressShift(),
    },
    clear: {
      short: 'Clear',
      name:
        mode === 'track_write'
          ? `Clear: then Enter empties track ${track}`
          : writing
            ? 'Clear: then a step key clears its pattern'
            : 'Clear',
      disabled: !writing && mode !== 'track_write',
      pressed: held === 'clear',
      press: () => session.pressClear(),
    },
    scale: {
      short: tracks ? 'Back' : 'Scale',
      name: tracks ? 'Back: the measure before' : `Scale: ${SCALE_NAMES[pattern.scale]}. Press for the next`,
      disabled: mode === 'pattern_play' || (tracks && length === 0),
      press: () => session.pressScale(),
    },
    last_step: {
      short: tracks ? 'Fwd' : 'Last step',
      name: tracks ? 'Forward: the next measure' : `Last step: ${pattern.lastStep}. Then a step key sets it`,
      disabled: mode === 'pattern_play' || (tracks && length === 0),
      pressed: tracks ? undefined : held === 'last_step',
      press: () => session.pressLastStep(),
    },
    instrument: {
      short: mode === 'track_write' ? 'Last meas' : 'Instrument',
      name:
        mode === 'track_write'
          ? `Last measure: end track ${track} at measure ${Math.min(measure, length)}`
          : `Instrument: ${rowName(panel.row, project)}. Then a step key chooses another`,
      disabled: !writing && (mode !== 'track_write' || length === 0),
      pressed: mode === 'track_write' ? undefined : held === 'instrument',
      press: () => session.pressInstrument(),
    },
    shuffle: {
      short: 'Shuffle',
      name: `Shuffle: ${project.shuffle === 0 ? 'off' : project.shuffle}. Then step key 1 to 5 sets it`,
      disabled: false,
      pressed: held === 'shuffle',
      press: () => session.pressShuffle(),
    },
    tempo_measure: {
      short: panel.readout === 'tempo' ? 'Meas' : 'Tempo',
      name: `Tempo or measure: the display shows the ${panel.readout}. Press for the other`,
      disabled: false,
      press: () => session.pressTempoMeasure(),
    },
    track: {
      short: shifted ? 'Track write' : 'Track',
      name: shifted ? 'Track write' : `Track play${mode === 'track_play' ? ', selected' : ''}`,
      disabled: false,
      press: () => session.pressModeKey('track'),
    },
    pattern: {
      short: shifted ? 'Pattern write' : 'Pattern',
      name: shifted
        ? `Pattern write, by ${mode === 'pattern_step' ? 'tapping' : 'step'}`
        : `Pattern play${mode === 'pattern_play' ? ', selected' : ''}`,
      disabled: false,
      press: () => session.pressModeKey('pattern'),
    },
    enter: {
      short: mode === 'pattern_tap' || held === 'instrument' ? 'Accent' : 'Enter',
      name: enterName(),
      disabled: !(held === 'instrument' || mode === 'track_write' || mode === 'pattern_tap'),
      press: () => session.pressEnter(),
    },
  };
}

function PanelKey({ panel, hit, state, testId, inTime = false }: ControlProps & { hit: PanelRect; state: KeyState; testId: string; inTime?: boolean }) {
  return (
    <button
      type="button"
      className="sb-panel-transport sb-707-key"
      style={box(panel, hit)}
      data-testid={testId}
      aria-label={state.name}
      aria-pressed={state.pressed}
      disabled={state.disabled}
      {...pressHandlers(state.press, inTime)}
    >
      <span className="sb-panel-text">{state.short}</span>
    </button>
  );
}

/** SHIFT, ENTER and the small keys above the scale chart. */
export function FunctionKeys({ panel, shown }: ControlProps & { shown: Shown }) {
  const runtime = useRuntime();
  const states = keyStates(shown, runtime);
  return (
    <>
      <PanelKey panel={panel} hit={panel.shift.hit} state={states.shift} testId="panel-shift" />
      {panel.keys.map((entry) => (
        <PanelKey key={entry.key} panel={panel} hit={entry.hit} state={states[entry.key]} testId={`panel-key-${entry.key}`} />
      ))}
      <PanelKey
        panel={panel}
        hit={panel.enter.hit}
        state={states.enter}
        testId="panel-enter"
        inTime={shown.project.panel.mode === 'pattern_tap' && shown.transient.held === null}
      />
    </>
  );
}

/** The four keys A to D with their lamps: pattern groups, or with SHIFT the four tracks. */
export function GroupKeys({ panel, shown, dim }: ControlProps & { shown: Shown; dim: boolean }) {
  const { session } = useRuntime();
  const { project, transient } = shown;
  const shifted = transient.held === 'shift';
  const group = activeGroup(project);
  const { mode, track } = project.panel;
  return (
    <>
      <div className="sb-panel-layer" role="group" aria-label={shifted ? 'Track' : 'Pattern group'}>
        {panel.groups.map((entry, key) => {
          const letter = GROUPS[key];
          const selected = shifted ? key === track : letter === group;
          const name = shifted
            ? `Track ${entry.track}`
            : letter
              ? `Pattern group ${entry.label}`
              : `Pattern group ${entry.label} is not in this machine. With Shift, track ${entry.track}`;
          return (
            <button
              key={entry.label}
              type="button"
              className="sb-panel-transport sb-707-key"
              style={box(panel, entry.hit)}
              data-testid={`panel-group-${key}`}
              aria-label={`${name}${selected ? ', selected' : ''}`}
              disabled={!shifted && (!letter || mode === 'track_play')}
              onClick={() => session.pressGroup(key)}
            >
              <span className="sb-panel-text">{shifted ? entry.track : entry.label}</span>
            </button>
          );
        })}
      </div>
      {panel.groups.map((entry, key) => (
        <BarLamp className="sb-707-lamp"
          key={entry.label}
          panel={panel}
          rect={entry.lamp}
          on={shifted ? key === track : GROUPS[key] === group}
          dim={dim}
          testId={`lamp-group-${key}`}
        />
      ))}
    </>
  );
}

/** The lamps of the scale chart: the scale of the pattern shown. */
export function ScaleLamps({ panel, shown, dim }: ControlProps & { shown: Shown; dim: boolean }) {
  const { scale } = getPattern(shown.project, editTarget(shown));
  return (
    <>
      {panel.scales.map((entry) => (
        <BarLamp className="sb-707-lamp" key={entry.scale} panel={panel} rect={entry.lamp} on={entry.scale === scale} dim={dim} testId={`lamp-scale-${entry.scale}`} />
      ))}
    </>
  );
}

/** The lamps over the step keys. They alone follow the running step. */
function StepLamps({ panel, shown, dim }: ControlProps & { shown: Shown; dim: boolean }) {
  const step = useEditorState((state) => (state.playing ? state.currentStep : -1));
  return (
    <>
      {panel.steps.map((entry, key) => {
        const lamp = stepLamp(shown, key);
        return (
          <BarLamp className="sb-707-lamp"
            key={key}
            panel={panel}
            rect={entry.lamp}
            on={lamp.on}
            flash={lamp.flash}
            now={step === key}
            dim={dim}
            testId={`lamp-step-${key}`}
          />
        );
      })}
    </>
  );
}

/**
 * The sixteen step keys. They choose a pattern, write a step, are tapped for
 * their instrument, or complete the key that is down. Two pressed together
 * in pattern play chain the patterns between them.
 */
export function StepKeys({ panel, shown, dim }: ControlProps & { shown: Shown; dim: boolean }) {
  const { session } = useRuntime();
  const layer = useRef<HTMLDivElement>(null);
  /** The step key under each pointer that is down, and whether two of them made a chain. */
  const down = useRef(new Map<number, number>());
  const chained = useRef(false);
  const { project, transient } = shown;
  const { mode, row } = project.panel;
  const tapped = mode === 'pattern_tap' && transient.held === null;
  const chains = mode === 'pattern_play' && transient.held === null;

  const focusKey = (key: number) => layer.current?.querySelector<HTMLButtonElement>(`[data-panel-step="${key}"]`)?.focus();

  const onPointerDown = (key: number) => (event: PointerEvent<HTMLButtonElement>) => {
    if (down.current.size === 0) chained.current = false;
    const [other] = [...down.current.values()].filter((held) => held !== key);
    down.current.set(event.pointerId, key);
    if (tapped) session.pressStep(key);
    else if (chains && other !== undefined) {
      chained.current = true;
      session.chain(other, key);
    }
  };
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    down.current.delete(event.pointerId);
  };

  const label = keysArePatterns(shown) ? 'Patterns' : mode === 'pattern_tap' ? 'Instruments' : `${rowName(row, project)} steps`;
  return (
    <>
      <div ref={layer} className="sb-panel-layer" role="group" aria-label={transient.held ? 'Step keys' : label}>
        {panel.steps.map((entry, key) => {
          const lamp = stepLamp(shown, key);
          return (
            <button
              key={key}
              type="button"
              className="sb-panel-step"
              style={box(panel, entry.hit)}
              data-panel-step={key}
              data-on={lamp.on}
              aria-pressed={lamp.on}
              aria-label={stepKeyName(shown, key)}
              onPointerDown={onPointerDown(key)}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerUp}
              onClick={(event) => {
                // A key tapped in time, or one of two that made a chain, has already done its work.
                if (chained.current || (tapped && event.detail !== 0)) return;
                session.pressStep(key);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  focusKey((key + 1) % STEPS);
                } else if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  focusKey((key - 1 + STEPS) % STEPS);
                }
              }}
            >
              <span className="sb-panel-text">{key + 1}</span>
            </button>
          );
        })}
      </div>
      <StepLamps panel={panel} shown={shown} dim={dim} />
    </>
  );
}
