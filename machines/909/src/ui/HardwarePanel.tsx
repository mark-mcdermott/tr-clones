import { useRef, useState, type ReactNode } from 'react';
import { Segmented } from '@boombapbot/editor';
import { BarLamp, Lamp, PanelPending, PanelStage, PowerRocker, box, pressHandlers, useFaceplatePhoto } from '@tr-clones/panel';
import {
  MODES,
  PANEL,
  SCALES,
  STEPS,
  TRACKS,
  activeGroup,
  isTrackMode,
  type Group,
  type Mode,
  type TrackId,
} from '../document';
import type { Session909 } from '../session';
import { sameView, useEditorState, useRuntime } from './context';
import { SevenSegment } from './Display';
import {
  displayView,
  isTapping,
  keyActions,
  keyLamps,
  shownScale,
  statusLine,
  stepKeyViews,
  stepKeysLabel,
  type KeyActions,
} from './keys';
import { PanelKnob, SmallKey, TempoKnob } from './PanelParts';

/** The modes as the phone strip names them, in the order of MODES. */
const MODE_NAMES: Record<Mode, { short: string; name: string }> = {
  track_play: { short: 'Track', name: 'Track play' },
  track_write: { short: 'Trk write', name: 'Track write' },
  pattern_play: { short: 'Pattern', name: 'Pattern play' },
  pattern_write: { short: 'Ptn write', name: 'Pattern write' },
};

/** The choices of a numbered strip: the tracks, or the pattern groups. */
/** A small key that is one of a kind: where the manifest has it, what is lettered by it, and what pressing it asks. */
interface SingleKey {
  key: Exclude<keyof KeyActions, 'tracks' | 'groups' | 'enter'>;
  testId: string;
  text: string;
  press(session: Session909): void;
}

/** The keys between the PATTERN keys and ENTER. */
const DISPLAY_KEYS: SingleKey[] = [
  { key: 'tempo', testId: 'tempo', text: 'Tempo', press: (session) => session.pressTempoKey() },
  { key: 'back', testId: 'back', text: 'Back', press: (session) => session.pressBack() },
  { key: 'forward', testId: 'forward', text: 'Fwd', press: (session) => session.pressForward() },
  { key: 'available', testId: 'available', text: 'Avail', press: (session) => session.pressAvailable() },
  { key: 'cycle', testId: 'cycle', text: 'Cycle', press: (session) => session.pressCycle() },
];

/** The keys in the frame at the left of the step keys. */
const FUNCTION_KEYS: SingleKey[] = [
  { key: 'lastStep', testId: 'last-step', text: 'Last', press: (session) => session.pressFunction('last_step') },
  { key: 'scale', testId: 'scale', text: 'Scale', press: (session) => session.pressScale() },
  { key: 'shuffle', testId: 'shuffle', text: 'Shuf', press: (session) => session.pressFunction('shuffle') },
  { key: 'clear', testId: 'clear', text: 'Clear', press: (session) => session.pressFunction('clear') },
  { key: 'instrument', testId: 'instrument', text: 'Inst', press: (session) => session.pressFunction('instrument') },
  { key: 'shift', testId: 'shift', text: 'Shift', press: (session) => session.pressShift() },
];

const numbered = (count: number, testId: string, name: string) =>
  Array.from({ length: count }, (_, index) => ({
    value: String(index),
    label: `${name} ${index + 1}`,
    testId: `${testId}-${index}`,
  }));

export function HardwarePanel() {
  const runtime = useRuntime();
  const { session } = runtime;
  const panel = PANEL;
  const power = useEditorState((state) => state.power);
  const playing = useEditorState((state) => state.playing);
  const mode = useEditorState((state) => state.project.panel.mode);
  const track = useEditorState((state) => state.project.panel.track);
  const group = useEditorState((state) => activeGroup(state.project));
  const instrument = useEditorState((state) => state.project.panel.instrument);
  const write = useEditorState((state) => state.project.panel.write);
  const steps = useEditorState(stepKeyViews, sameView);
  const stepsLabel = useEditorState(stepKeysLabel);
  const lamps = useEditorState(keyLamps, sameView);
  const actions = useEditorState(keyActions, sameView);
  const display = useEditorState(displayView, sameView);
  const scale = useEditorState(shownScale);
  const tapping = useEditorState(isTapping);
  const status = useEditorState(statusLine);
  const { photo, onPhotoError } = useFaceplatePhoto();
  const [fit, setFit] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const dim = !photo;
  const { keys } = panel;
  const single = ({ key, testId, text, press }: SingleKey) => (
    <SmallKey
      key={key}
      panel={panel}
      place={keys[key]}
      testId={`panel-key-${testId}`}
      text={text}
      dim={dim}
      lamp={key === 'forward' || key === 'scale' ? undefined : lamps[key]}
      label={actions[key].label}
      disabled={actions[key].idle}
      onPress={() => press(session)}
    />
  );
  const focusStep = (step: number) =>
    panelRef.current?.querySelector<HTMLButtonElement>(`[data-panel-step="${step}"]`)?.focus();

  return (
    <section className="sb-hardware sb-909" aria-label={`${panel.name} drum machine`} data-testid="hardware">
      <PanelStage panel={panel} photo={photo} onPhotoError={onPhotoError} power={power} fit={fit} ref={panelRef}>
        {!photo
          ? panel.steps.map((step, index) => (
              <span key={index} className="sb-panel-key" aria-hidden="true" style={box(panel, step.button)} />
            ))
          : null}

        <PowerRocker panel={panel} hit={panel.power.hit} rocker={panel.power.rocker} />
        {/* With the power off nothing else on the machine answers. */}
        <div className="sb-panel-controls" inert={!power}>
          {panel.knobs.map((knob) => (
            <PanelKnob key={knob.knob} panel={panel} photo={photo} knob={knob} />
          ))}

          {panel.transport.map((control) => (
            <button
              key={control.action}
              type="button"
              className="sb-panel-transport sb-909-key"
              style={box(panel, control.hit)}
              data-testid={`panel-${control.action}`}
              aria-label={control.action === 'start' ? 'Start' : 'Stop'}
              aria-pressed={control.action === 'start' ? playing : undefined}
              onClick={() => {
                if (control.action === 'start') void runtime.play();
                else runtime.stop();
              }}
            >
              <span className="sb-panel-text">{control.label}</span>
            </button>
          ))}
          <SevenSegment
            panel={panel}
            rect={panel.display.digits}
            digits={display.digits}
            label={display.label}
            testId="panel-display"
          />
          <TempoKnob panel={panel} photo={photo} />

          <div className="sb-panel-layer" role="group" aria-label="Tracks">
            {keys.tracks.map((place, index) => (
              <SmallKey
                key={index}
                panel={panel}
                place={place}
                testId={`panel-track-${index}`}
                label={actions.tracks[index]!.label}
                text={String(index + 1)}
                lamp={lamps.tracks[index]}
                dim={dim}
                onPress={() => session.pressTrack(index)}
              />
            ))}
          </div>
          <div className="sb-panel-layer" role="group" aria-label="Pattern groups">
            {keys.groups.map((place, index) => (
              <SmallKey
                key={index}
                panel={panel}
                place={place}
                testId={`panel-group-${index}`}
                label={actions.groups[index]!.label}
                text={String(index + 1)}
                lamp={lamps.groups[index]}
                dim={dim}
                onPress={() => session.pressGroup(index as Group)}
              />
            ))}
          </div>
          {DISPLAY_KEYS.map(single)}

          <button
            type="button"
            className="sb-panel-transport sb-909-key"
            style={box(panel, panel.enter.hit)}
            data-testid="panel-enter"
            aria-label={actions.enter.label}
            disabled={actions.enter.idle}
            {...pressHandlers(() => session.pressEnter(), tapping)}
          >
            <span className="sb-panel-text">Enter</span>
          </button>
          <BarLamp className="sb-909-window" panel={panel} rect={panel.enter.lamp} on={lamps.enter.on} dim={dim} testId="panel-enter-lamp" />

          {FUNCTION_KEYS.map(single)}

          {panel.scales.lamps.map((at, index) => (
            <Lamp
              key={index}
              panel={panel}
              at={at}
              radius={panel.scales.radius}
              on={scale === SCALES[index]}
              dim={dim}
              testId={`lamp-scale-${SCALES[index]}`}
            />
          ))}

          <div className="sb-panel-layer" role="group" aria-label={stepsLabel}>
            {panel.steps.map((step, index) => (
              <button
                key={index}
                type="button"
                className="sb-panel-step sb-909-step"
                style={box(panel, step.hit)}
                data-panel-step={index}
                data-on={steps[index]!.lit}
                aria-pressed={steps[index]!.lit}
                aria-label={steps[index]!.label}
                disabled={steps[index]!.idle}
                {...pressHandlers(() => session.pressStep(index), tapping)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    focusStep((index + 1) % STEPS);
                  } else if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    focusStep((index - 1 + STEPS) % STEPS);
                  }
                }}
              >
                <span className="sb-panel-text">{index + 1}</span>
              </button>
            ))}
          </div>
          {panel.steps.map((step, index) => (
            <BarLamp className="sb-909-window"
              key={index}
              panel={panel}
              rect={step.lamp}
              step={index}
              on={steps[index]!.lit}
              now={steps[index]!.now}
              flash={steps[index]!.flash}
              dim={dim}
            />
          ))}
        </div>
      </PanelStage>

      {/* What the machine is doing, for a screen reader: the lamps say it to the eye. */}
      <p className="sb-visually-hidden" role="status" data-testid="panel-status">
        {power ? status : 'The power is off'}
      </p>

      {/* On a phone the faceplate's small keys are too small to tap. */}
      <div className="sb-panel-touch" inert={!power}>
        <Segmented<Mode>
          label="Mode"
          className="sb-segmented-fill sb-panel-strip"
          value={mode}
          onChange={(next) => session.setMode(next)}
          options={MODES.map((entry) => ({
            value: entry,
            label: MODE_NAMES[entry].short,
            name: MODE_NAMES[entry].name,
            testId: `strip-mode-${entry}`,
          }))}
        />
        {isTrackMode(mode) ? (
          <Segmented
            label="Track"
            className="sb-segmented-fill sb-panel-strip"
            value={String(track)}
            onChange={(next) => session.chooseTrack(Number(next))}
            options={numbered(keys.tracks.length, 'strip-track', 'Track')}
          />
        ) : null}
        {mode !== 'track_play' ? (
          <Segmented
            label={mode === 'track_write' ? 'Pattern group of the track' : 'Pattern group'}
            className="sb-segmented-fill sb-panel-strip"
            value={String(group)}
            onChange={(next) => session.chooseGroup(Number(next) as Group)}
            options={numbered(keys.groups.length, 'strip-group', 'Group')}
          />
        ) : null}
        {mode === 'pattern_write' ? (
          <Segmented<TrackId>
            label="Instrument"
            className="sb-segmented-fill sb-panel-strip"
            value={instrument}
            onChange={(next) => session.chooseInstrument(next)}
            options={TRACKS.map((entry) => ({
              value: entry.id,
              label: entry.short,
              name: entry.label,
              testId: `strip-voice-${entry.id}`,
            }))}
          />
        ) : null}
        <div className="sb-panel-info">
          <p data-testid="strip-status" aria-hidden="true">
            {status}
          </p>
          <div className="sb-panel-buttons">
            {mode === 'pattern_write' ? (
              <>
                <StripButton
                  testId="strip-tap"
                  pressed={write === 'tap'}
                  onPress={() => session.setWriteMode(write === 'tap' ? 'step' : 'tap')}
                >
                  Tap write
                </StripButton>
                <StripButton testId="strip-last-step" pressed={lamps.lastStep.on} onPress={() => session.pressFunction('last_step')}>
                  Last step
                </StripButton>
                <StripButton testId="strip-shuffle" pressed={lamps.shuffle.on} onPress={() => session.pressFunction('shuffle')}>
                  Shuffle
                </StripButton>
                <StripButton testId="strip-scale" label={actions.scale.label} onPress={() => session.pressScale()}>
                  Scale
                </StripButton>
              </>
            ) : null}
            {mode === 'track_write' ? (
              <>
                <StripButton testId="strip-back" label={actions.back.label} onPress={() => session.pressBack()}>
                  Back
                </StripButton>
                <StripButton testId="strip-enter" label={actions.enter.label} onPress={() => session.pressEnter()}>
                  Enter
                </StripButton>
                <StripButton testId="strip-forward" label={actions.forward.label} onPress={() => session.pressForward()}>
                  Fwd
                </StripButton>
              </>
            ) : null}
            {isTrackMode(mode) ? (
              <StripButton
                testId="strip-cycle"
                label={actions.cycle.label}
                pressed={lamps.cycle.on}
                onPress={() => session.pressCycle()}
              >
                Cycle
              </StripButton>
            ) : null}
            {mode === 'pattern_write' || mode === 'track_write' ? (
              <StripButton
                testId="strip-clear"
                label={actions.clear.label}
                pressed={mode === 'pattern_write' ? lamps.clear.on : undefined}
                onPress={() => session.pressFunction('clear')}
              >
                Clear
              </StripButton>
            ) : null}
            <StripButton testId="strip-shift" pressed={lamps.shift.on} onPress={() => session.pressShift()}>
              Shift
            </StripButton>
            <StripButton pressed={fit} onPress={() => setFit(!fit)}>
              {fit ? 'Zoom in' : 'Fit to screen'}
            </StripButton>
          </div>
        </div>
      </div>
    </section>
  );
}

/** A touch-sized button of the strip under the faceplate. */
function StripButton(props: {
  testId?: string;
  /** What it does now, where its lettering does not say. */
  label?: string;
  pressed?: boolean;
  onPress(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="sb-button"
      data-testid={props.testId}
      aria-label={props.label}
      aria-pressed={props.pressed}
      onClick={props.onPress}
    >
      {props.children}
    </button>
  );
}

/** Where the panel departs from the machine. Shown in settings. */
export function PanelNotes() {
  return <PanelPending items={PANEL.pending} heading="How this differs from the machine, and what is unverified" />;
}
