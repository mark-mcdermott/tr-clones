import type { MouseEvent, ReactNode } from 'react';
import { Knob, Lamp, PositionSwitch, box, pressHandlers, slideLever, type PanelRect } from '@tr-clones/panel';
import {
  BPM_MAX,
  BPM_MIN,
  GROUP_NAMES,
  MODES,
  SCALES,
  TRACKS,
  isTrackMode,
  stepsPerBeat,
  type LevelId,
  type Mode,
  type PanelLevel,
  type PanelManifest,
  type Scale,
} from '../document';
import type { Session606 } from '../session';
import { SelectorDial } from './SelectorDial';
import { useEditorState, useRuntime } from './context';

interface ControlProps {
  panel: PanelManifest;
}

interface FaceplateProps extends ControlProps {
  photo: string | null;
}

const PERCENT = { min: 0, max: 100, step: 2, perPixel: 0.5 } as const;

// ---- Knobs --------------------------------------------------------------------

const LEVEL_NAMES: Record<LevelId, string> = {
  accent: 'Accent',
  bass_drum: 'Bass drum level',
  snare_drum: 'Snare drum level',
  toms: 'Low and hi tom level',
  cymbal: 'Cymbal level',
  hi_hat: 'Open and closed hi-hat level',
};

export function LevelKnob({ panel, photo, knob }: FaceplateProps & { knob: PanelLevel }) {
  const { session } = useRuntime();
  const percent = useEditorState((state) => Math.round(state.project.mix.levels[knob.level] * 100));
  return (
    <Knob
      panel={panel}
      photo={photo}
      geometry={knob}
      label={LEVEL_NAMES[knob.level]}
      testId={`panel-level-${knob.level}`}
      value={percent}
      {...PERCENT}
      valueText={`${percent}%`}
      onChange={(value) => session.setLevel(knob.level, value / 100)}
    />
  );
}

export function TempoKnob({ panel, photo }: FaceplateProps) {
  const { session } = useRuntime();
  const bpm = useEditorState((state) => state.project.tempo);
  return (
    <Knob
      panel={panel}
      photo={photo}
      geometry={panel.tempo}
      label="Tempo"
      testId="panel-tempo"
      value={bpm}
      min={BPM_MIN}
      max={BPM_MAX}
      step={1}
      // Its whole travel in 260 pixels.
      perPixel={1}
      valueText={`${bpm} beats per minute`}
      onChange={(value) => session.setTempo(value)}
    />
  );
}

/**
 * The volume knob, which is the power switch too: turned fully left it
 * clicks the machine off, and turned up again it switches it back on.
 */
export function VolumeKnob({ panel, photo }: FaceplateProps) {
  const runtime = useRuntime();
  const power = useEditorState((state) => state.power);
  // Just past the click the machine is on and nearly silent, never off.
  const percent = useEditorState((state) => Math.max(1, Math.round(state.project.mix.volume * 100)));
  return (
    <Knob
      panel={panel}
      photo={photo}
      geometry={panel.volume}
      label="Volume and power"
      testId="panel-volume"
      value={power ? percent : 0}
      {...PERCENT}
      valueText={power ? `${percent}%` : 'Power off'}
      onChange={(value) => {
        if (value === 0) {
          runtime.setPower(false);
          return;
        }
        runtime.session.setVolume(value / 100);
        if (!power) runtime.setPower(true);
      }}
    />
  );
}

/** The power switch by itself, on the lettering at the volume knob's off position. */
export function PowerSwitch({ panel }: ControlProps) {
  const runtime = useRuntime();
  const on = useEditorState((state) => state.power);
  return (
    <button
      type="button"
      role="switch"
      className="sb-panel-switch sb-panel-power"
      style={box(panel, panel.power.hit)}
      data-testid="panel-power"
      aria-checked={on}
      aria-label="Power"
      onClick={() => runtime.setPower(!on)}
    >
      <span className="sb-panel-text">Power</span>
    </button>
  );
}

// ---- The two selector dials -----------------------------------------------------

/** The instrument selector, which in the track modes chooses a track. Turning it to an instrument plays it. */
export function VoiceSelector({ panel, photo }: FaceplateProps) {
  const { session } = useRuntime();
  const selector = useEditorState((state) => state.project.panel.selector);
  const tracks = useEditorState((state) => isTrackMode(state.project.panel.mode));
  const select = panel.voiceSelect;
  return (
    <SelectorDial
      panel={panel}
      photo={photo}
      knob={select.knob}
      label={tracks ? 'Track' : 'Instrument'}
      index={selector}
      dialTestId="panel-dial-voice"
      positions={select.positions.map((position, index) => ({
        label: position.label,
        name: tracks ? `Track ${index + 1}` : `${position.label}, ${TRACKS[index]!.label}`,
        deg: position.deg,
        hit: position.hit,
        testId: `panel-voice-${position.track}`,
      }))}
      onChange={(index) => chooseVoice(session, index, tracks)}
    />
  );
}

/** Turns the selector, and plays the instrument it lands on. A track makes no sound. */
export function chooseVoice(session: Session606, index: number, tracks: boolean): void {
  session.turnSelector(index);
  const track = TRACKS[index];
  if (!tracks && track) void session.audition(track.id);
}

export function ModeSelector({ panel, photo }: FaceplateProps) {
  const { session } = useRuntime();
  const mode = useEditorState((state) => state.project.panel.mode);
  const { knob, positions } = panel.modeSelect;
  return (
    <SelectorDial
      panel={panel}
      photo={photo}
      knob={knob}
      label="Mode"
      index={MODES.indexOf(mode)}
      dialTestId="panel-dial-mode"
      positions={positions.map((position) => ({
        label: position.mode.endsWith('write') ? 'WRITE' : 'PLAY',
        name: position.label,
        deg: position.deg,
        hit: position.hit,
        testId: `panel-mode-${position.mode}`,
      }))}
      onChange={(index) => session.setMode(MODES[index]!)}
    />
  );
}

// ---- The scale switch -----------------------------------------------------------

/** The scale switch stands with 4 at the top. */
const SCALES_DOWN = [...SCALES].reverse();
const BEAT_WORDS: Record<number, string> = { 3: 'three', 4: 'four', 6: 'six', 8: 'eight' };

export function scaleName(scale: Scale): string {
  return `Scale ${scale}: ${BEAT_WORDS[stepsPerBeat(scale)]} steps to the beat`;
}

export function ScaleSwitch({ panel }: ControlProps) {
  const { session } = useRuntime();
  const scale = useEditorState((state) => state.project.panel.scale);
  const index = SCALES_DOWN.indexOf(scale);
  return (
    <>
      <PositionSwitch
        panel={panel}
        hit={panel.scale.hit}
        label="Scale"
        testId="panel-scale"
        positions={SCALES_DOWN.map(scaleName)}
        index={index}
        axis="y"
        onChange={(next) => session.setScale(SCALES_DOWN[next]!)}
      />
      <span
        className="sb-panel-lever sb-606-lever"
        aria-hidden="true"
        style={box(panel, slideLever(panel.scale.slot, index, SCALES_DOWN.length))}
      />
    </>
  );
}

// ---- The keys round the step keys -------------------------------------------------

/** What one of the machine's keys does just now. */
export interface KeyRole {
  /** What a screen reader calls it. */
  name: string;
  /** Its lettering in this mode, for the phone strip. */
  text: string;
  enabled: boolean;
  /** Whether it is down, for a key that stays down. */
  held?: boolean;
}

export interface KeyState {
  mode: Mode;
  playing: boolean;
  functionHeld: boolean;
  clearArmed: boolean;
}

export function functionRole({ mode, functionHeld }: KeyState): KeyRole {
  if (mode === 'pattern_write') {
    return {
      name: 'Function: store the scale, then press a step key to make it the last step',
      text: 'Function',
      enabled: true,
      held: functionHeld,
    };
  }
  if (mode === 'track_write') {
    return {
      name: 'Function: show the bar number, and turn CLEAR into D.C. and the last two step keys into DEL and INS',
      text: 'Function',
      enabled: true,
      held: functionHeld,
    };
  }
  return { name: 'Function', text: 'Function', enabled: false };
}

export function clearRole({ mode, playing, functionHeld, clearArmed }: KeyState): KeyRole {
  if (mode === 'pattern_write') {
    return {
      name: 'Pattern clear: then press the step key of the pattern to clear',
      text: 'Clear',
      enabled: !playing,
      held: clearArmed,
    };
  }
  if (mode === 'track_write') {
    return functionHeld
      ? { name: 'D.C.: write the chosen pattern here and make this bar the last', text: 'D.C.', enabled: true }
      : { name: 'Bar reset: back to the first bar', text: 'Bar reset', enabled: true };
  }
  return { name: 'Clear', text: 'Clear', enabled: false };
}

export function tapRole({ mode }: KeyState): KeyRole {
  if (mode === 'pattern_write') return { name: 'Tap: write the selected instrument now', text: 'Tap', enabled: true };
  if (mode === 'track_write') {
    return { name: 'Write/next: write the chosen pattern into this bar and move on a bar', text: 'Write/next', enabled: true };
  }
  return { name: 'Tap', text: 'Tap', enabled: false };
}

export function useKeyState(): KeyState {
  return {
    mode: useEditorState((state) => state.project.panel.mode),
    playing: useEditorState((state) => state.playing),
    functionHeld: useEditorState((state) => state.transient.functionHeld),
    clearArmed: useEditorState((state) => state.transient.clearArmed),
  };
}

function PanelKey(props: {
  panel: PanelManifest;
  hit: PanelRect;
  testId: string;
  role: KeyRole;
  handlers: { onClick(event: MouseEvent): void; onPointerDown?(): void };
  children: ReactNode;
}) {
  const { role } = props;
  return (
    <button
      type="button"
      className="sb-panel-transport sb-606-key sb-606-latch"
      style={box(props.panel, props.hit)}
      data-testid={props.testId}
      aria-label={role.name}
      aria-pressed={role.held}
      disabled={!role.enabled}
      {...props.handlers}
    >
      <span className="sb-panel-text">{props.children}</span>
    </button>
  );
}

/** FUNCTION, CLEAR, TAP and the pattern group button, each doing what the mode gives it to do. */
export function ModeKeys({ panel }: ControlProps) {
  const { session } = useRuntime();
  const keys = useKeyState();
  const group = useEditorState((state) => state.project.panel.group);
  return (
    <>
      <PanelKey panel={panel} hit={panel.clear.hit} testId="panel-clear" role={clearRole(keys)} handlers={{ onClick: () => session.pressClear() }}>
        Clear
      </PanelKey>
      <PanelKey
        panel={panel}
        hit={panel.function.hit}
        testId="panel-function"
        role={functionRole(keys)}
        handlers={{ onClick: () => session.pressFunction() }}
      >
        Function
      </PanelKey>
      <PanelKey panel={panel} hit={panel.tap.hit} testId="panel-tap" role={tapRole(keys)} handlers={pressHandlers(() => session.pressTap())}>
        Tap
      </PanelKey>
      <PanelKey
        panel={panel}
        hit={panel.group.hit}
        testId="panel-group"
        role={groupRole(group, keys.playing)}
        handlers={{ onClick: () => session.pressGroup() }}
      >
        Group
      </PanelKey>
    </>
  );
}

/** The pattern group button changes groups only while the machine is stopped. */
export function groupRole(group: number, playing: boolean): KeyRole {
  const name = GROUP_NAMES[group]!;
  const other = GROUP_NAMES[group === 0 ? 1 : 0];
  return { name: `Pattern group ${name}. Press for group ${other}.`, text: `Group ${name}`, enabled: !playing };
}

export function RunKey({ panel }: ControlProps) {
  const runtime = useRuntime();
  const playing = useEditorState((state) => state.playing);
  return (
    <button
      type="button"
      className="sb-panel-transport sb-606-key"
      style={box(panel, panel.run.hit)}
      data-testid="panel-toggle"
      aria-label="Run/stop"
      aria-pressed={playing}
      onClick={() => void runtime.togglePlay()}
    >
      <span className="sb-panel-text">{panel.run.label}</span>
    </button>
  );
}

/** The lamps that are not over a step key: the machine running, and which pattern group it is on. */
export function StatusLamps({ panel, dim }: ControlProps & { dim: boolean }) {
  const playing = useEditorState((state) => state.playing);
  const group = useEditorState((state) => state.project.panel.group);
  const { lampRadius: radius } = panel;
  return (
    <>
      <Lamp panel={panel} at={panel.run.lamp} radius={radius} on={playing} dim={dim} testId="lamp-run" />
      <Lamp panel={panel} at={panel.group.lamps[0]} radius={radius} on={group === 0} dim={dim} testId="lamp-group-1" />
      <Lamp panel={panel} at={panel.group.lamps[1]} radius={radius} on={group === 1} dim={dim} testId="lamp-group-2" />
    </>
  );
}
