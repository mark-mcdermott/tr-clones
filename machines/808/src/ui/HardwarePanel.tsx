import { useRef, useState } from 'react';
import {
  DialHandle,
  FaceplateCreditLine,
  Knob,
  Lamp,
  PanelPending,
  PowerRocker,
  pressHandlers,
  PanelStage,
  PassiveKnob,
  box,
  useFaceplatePhoto,
} from '@tr-clones/panel';
import {
  BASIC_RHYTHMS,
  KNOB_PARAM_LABELS,
  MODES,
  PANEL,
  PART_STEPS,
  TEMPO_STOPS,
  TRACKS,
  composition,
  countSteps,
  getRole,
  getTrack,
  isPerformMode,
  isStepOn,
  isTrackMode,
  knobPosition,
  rhythmLength,
  tempoBpm,
  writePart,
  type Mode,
  type PanelKnob,
  type PanelManifest,
  type PanelSwitch,
} from '../document';
import { trackLabel } from '../engine';
import { Segmented } from '@boombapbot/editor';
import { editTarget } from '../session';
import { useEditorState, useRuntime } from './context';
import {
  AutoFillSelector,
  ClearButton,
  ModeSelector,
  PreScaleSwitch,
  StatusLamps,
  TapButton,
  VariationSwitches,
  clears,
  rhythmName,
  taps,
} from './PanelControls';

interface FaceplateProps {
  panel: PanelManifest;
  photo: string | null;
}

const PERCENT = { min: 0, max: 100, step: 2, perPixel: 0.5 } as const;

function useBpmText(): string {
  const bpm = useEditorState((state) => tempoBpm(state.project.tempo));
  return `${Math.round(bpm * 10) / 10} beats per minute`;
}

/** The tempo knob turns in click stops: forty of them across its travel. */
function TempoKnob({ panel, photo }: FaceplateProps) {
  const { session } = useRuntime();
  const stop = useEditorState((state) => state.project.tempo.coarse);
  const bpm = useBpmText();
  return (
    <Knob
      panel={panel}
      photo={photo}
      geometry={panel.tempo}
      label="Tempo"
      testId="panel-tempo"
      value={stop}
      min={0}
      max={TEMPO_STOPS - 1}
      step={1}
      // Its whole travel in 200 pixels.
      perPixel={(TEMPO_STOPS - 1) / 200}
      valueText={`${bpm}, stop ${stop + 1} of ${TEMPO_STOPS}`}
      onChange={(value) => session.setTempo({ coarse: value })}
    />
  );
}

/** The fine knob moves the tempo by up to one click stop either way. */
function FineKnob({ panel, photo }: FaceplateProps) {
  const { session } = useRuntime();
  const fine = useEditorState((state) => Math.round(state.project.tempo.fine * 100));
  const bpm = useBpmText();
  return (
    <Knob
      panel={panel}
      photo={photo}
      geometry={panel.fine}
      label="Fine tempo"
      testId="panel-fine"
      value={fine}
      min={-100}
      max={100}
      step={5}
      perPixel={1}
      valueText={bpm}
      onChange={(value) => session.setTempo({ fine: value / 100 })}
    />
  );
}

function MasterKnob({ panel, photo }: FaceplateProps) {
  const { session } = useRuntime();
  const percent = useEditorState((state) => Math.round(state.project.sound.master * 100));
  return (
    <Knob
      panel={panel}
      photo={photo}
      geometry={panel.master}
      label="Master volume"
      testId="panel-master"
      value={percent}
      {...PERCENT}
      valueText={`${percent}%`}
      onChange={(value) => session.setMasterVolume(value / 100)}
    />
  );
}

/** A knob of an instrument column: its level, or its tone, decay, tuning or snappy. */
function ColumnKnob({ panel, photo, knob }: FaceplateProps & { knob: PanelKnob }) {
  const { session } = useRuntime();
  const percent = useEditorState((state) =>
    Math.round(knobPosition(state.project.sound, knob.track, knob.param) * 100),
  );
  const name = useEditorState((state) => trackLabel(knob.track, state.project.sound));
  return (
    <Knob
      panel={panel}
      photo={photo}
      geometry={knob}
      label={`${name} ${KNOB_PARAM_LABELS[knob.param]}`}
      testId={`panel-knob-${knob.track}-${knob.param}`}
      value={percent}
      {...PERCENT}
      valueText={`${percent}%`}
      onChange={(value) => session.setKnob(knob.track, knob.param, value / 100)}
    />
  );
}

/** Lever height and the gap it keeps from the ends of its slot, in faceplate pixels. */
const LEVER = { height: 20, inset: 3, gap: 5 };

/** A slide switch that gives a column its alternate sound when pushed up. */
function VoiceSwitch({ panel, entry }: { panel: PanelManifest; entry: PanelSwitch }) {
  const runtime = useRuntime();
  const on = useEditorState((state) => state.project.sound.alternates[entry.track]);
  const track = getTrack(entry.track);
  const [x, y, width, height] = entry.slot;
  const top = on ? y + LEVER.gap : y + height - LEVER.gap - LEVER.height;
  return (
    <>
      <button
        type="button"
        role="switch"
        className="sb-panel-switch"
        style={box(panel, entry.hit)}
        data-testid={`panel-switch-${entry.track}`}
        aria-checked={on}
        aria-label={`${getRole(track.alternate!).name} in place of ${getRole(track.sound!).name}`}
        onClick={() => {
          runtime.session.setAlternate(entry.track, !on);
          runtime.session.auditionIfRunning(entry.track);
        }}
      >
        <span className="sb-panel-text">{getRole(track.alternate!).short}</span>
      </button>
      <span
        className="sb-panel-lever"
        aria-hidden="true"
        style={box(panel, [x + LEVER.inset, top, width - LEVER.inset * 2, LEVER.height])}
      />
    </>
  );
}

export function HardwarePanel() {
  const runtime = useRuntime();
  const { store, session } = runtime;
  const target = useEditorState((state) => editTarget(state.project, state.currentPattern), sameTarget);
  const rhythm = useEditorState((state) => state.project.rhythms[editTarget(state.project).rhythm]!);
  const playing = useEditorState((state) => state.playing);
  const currentStep = useEditorState((state) => state.currentStep);
  const mode = useEditorState((state) => state.project.panel.mode);
  const basicRhythm = useEditorState((state) => state.project.panel.basicRhythm);
  const fillRhythm = useEditorState((state) => state.project.panel.fillRhythm);
  const clearArmed = useEditorState((state) => state.transient.clearArmed);
  const fillArmed = useEditorState((state) => state.transient.fillArmed);
  const power = useEditorState((state) => state.power);
  const playingRhythm = useEditorState((state) => (state.currentPattern < 0 ? -1 : state.currentPattern >> 1));
  const selector = useEditorState((state) => state.project.panel.selector);
  const trackLength = useEditorState((state) => composition(state.project.rhythmTracks, state.project.panel.selector).length);
  const { photo, onPhotoError } = useFaceplatePhoto();
  const [fit, setFit] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const panel = PANEL;
  const trackName = useEditorState((state) => trackLabel(target.track, state.project.sound));
  const row = rhythm[target.variation][target.track];
  const select = panel.voiceSelect;
  const activePosition = select.positions.find((position) => position.track === target.track);
  // In a write mode the buttons are steps of the selected track. In every
  // other mode they choose a rhythm, and their lamps show the choice.
  const writing = writePart(mode) !== null;
  const lamp = playing && currentStep >= 0 ? currentStep % PART_STEPS : -1;
  const lampPart = currentStep >= PART_STEPS ? PART_STEPS : 0;
  const tracks = isTrackMode(mode);
  const chosen = (button: number) => {
    if (mode === 'pattern_clear') return button === target.rhythm;
    // Playing a rhythm track, the lamp follows the rhythm of each measure.
    if (mode === 'play') return button === playingRhythm;
    return button === basicRhythm || button === fillRhythm;
  };
  const lit = (button: number) => (writing ? isStepOn(row, target.offset + button) : chosen(button));
  // The lamp runs across the part being written, or across any part while choosing rhythms.
  const running = (button: number) => lamp === button && (!writing || lampPart === target.offset);
  // In a play mode the rhythm with priority flashes: the intro/fill-in once
  // TAP has armed it, otherwise the Basic Rhythm while the machine waits.
  const flashing = (button: number) =>
    isPerformMode(mode) && (fillArmed ? button === fillRhythm : !playing && button === basicRhythm);
  const stepLabel = (button: number) => {
    if (mode === 'play') return `${rhythmName(button)}${chosen(button) ? ', playing' : ''}`;
    if (!writing) return `${rhythmName(button)}${chosen(button) ? ', selected' : ''}`;
    if (clearArmed) return `Make step ${button + 1} the last step`;
    return `${trackName}, step ${button + 1}, ${lit(button) ? 'on' : 'off'}`;
  };
  // In the track modes the selector chooses a rhythm track, and makes no sound.
  const selectTrack = (id: typeof target.track) => {
    session.selectTrack(id);
    if (!tracks) void runtime.session.audition(id);
  };

  const focusStep = (step: number) =>
    panelRef.current?.querySelector<HTMLButtonElement>(`[data-panel-step="${step}"]`)?.focus();

  return (
    <section className="sb-hardware" aria-label={`${panel.name} drum machine`} data-testid="hardware">
      <PanelStage panel={panel} photo={photo} onPhotoError={onPhotoError} power={power} fit={fit} ref={panelRef}>
        {!photo
          ? panel.steps.map((step, index) => (
              <span key={index} className="sb-panel-key" aria-hidden="true" style={box(panel, step.button)} />
            ))
          : null}

        <PowerRocker panel={panel} hit={panel.power.hit} rocker={panel.power.rocker} />
        {/* With the power off nothing else on the machine answers. */}
        <div className="sb-panel-controls" inert={!power}>
          <TempoKnob panel={panel} photo={photo} />
          <FineKnob panel={panel} photo={photo} />
          <MasterKnob panel={panel} photo={photo} />
          {panel.knobs.map((knob) => (
            <ColumnKnob key={`${knob.track}-${knob.param}`} panel={panel} photo={photo} knob={knob} />
          ))}
          {panel.switches.map((entry) => (
            <VoiceSwitch key={entry.track} panel={panel} entry={entry} />
          ))}
          {!photo ? (
            <span
              className="sb-panel-caption"
              style={box(panel, [panel.tempo.cx - 60, panel.tempo.cy - panel.tempo.r - 26, 120, 18])}
            >
              {panel.tempo.label}
            </span>
          ) : null}

          {select.knob ? (
            <>
              <PassiveKnob panel={panel} photo={photo} knob={select.knob} deg={activePosition?.deg ?? 0} />
              <DialHandle
                panel={panel}
                knob={select.knob}
                degs={select.positions.map((position) => position.deg ?? 0)}
                testId="panel-dial-voice"
                onPick={(index) => {
                  const picked = select.positions[index]!.track;
                  if (picked !== target.track) selectTrack(picked);
                }}
              />
            </>
          ) : null}
          <ModeSelector panel={panel} photo={photo} />
          <AutoFillSelector panel={panel} photo={photo} />
          <ClearButton panel={panel} />
          <PreScaleSwitch panel={panel} />
          <VariationSwitches panel={panel} />
          <StatusLamps panel={panel} dim={!photo || panel.ledsLitInPhoto} />
          <TapButton panel={panel} />

          <div className="sb-panel-layer" role="radiogroup" aria-label={tracks ? 'Rhythm track' : select.label || 'Instrument'}>
            {select.positions.map((position, index) => (
              <button
                key={position.track}
                type="button"
                role="radio"
                className="sb-panel-voice"
                style={box(panel, position.hit)}
                aria-checked={position.track === target.track}
                aria-label={tracks ? `Rhythm track ${index + 1}` : `${position.label}, ${getTrack(position.track).label}`}
                data-testid={`panel-voice-${position.track}`}
                onClick={() => selectTrack(position.track)}
              >
                <span className="sb-panel-text">{position.label}</span>
              </button>
            ))}
          </div>

          {panel.transport.map((control) => (
            <button
              key={control.action}
              type="button"
              className="sb-panel-transport"
              style={box(panel, control.hit)}
              data-testid={`panel-${control.action}`}
              aria-label={control.label}
              aria-pressed={control.action === 'stop' ? undefined : playing}
              onClick={() => {
                if (control.action === 'toggle') void runtime.togglePlay();
                else if (control.action === 'start') void runtime.play();
                else runtime.stop();
              }}
            >
              <span className="sb-panel-text">{control.label}</span>
            </button>
          ))}

          <div
            className="sb-panel-layer"
            role="group"
            aria-label={writing ? `${trackName} steps` : 'Rhythms'}
          >
            {panel.steps.map((step, index) => (
              <button
                key={index}
                type="button"
                className="sb-panel-step"
                style={box(panel, step.hit)}
                data-panel-step={index}
                data-on={lit(index)}
                aria-pressed={lit(index)}
                aria-label={stepLabel(index)}
                onClick={() => {
                  const press = session.pressStep(index);
                  if (press.kind === 'step' && press.on && !store.getState().playing) {
                    runtime.session.auditionIfRunning(target.track);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    focusStep((index + 1) % PART_STEPS);
                  } else if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    focusStep((index - 1 + PART_STEPS) % PART_STEPS);
                  }
                }}
              >
                <span className="sb-panel-text">{index < BASIC_RHYTHMS ? index + 1 : index + 1 - BASIC_RHYTHMS}</span>
              </button>
            ))}
          </div>

          {panel.steps.map((step, index) => (
            <Lamp
              key={index}
              panel={panel}
              at={step.led}
              radius={panel.ledRadius}
              step={index}
              on={lit(index)}
              now={running(index)}
              flash={flashing(index)}
              dim={!photo || panel.ledsLitInPhoto}
            />
          ))}
        </div>
      </PanelStage>

      {/* On a phone the faceplate's own selector is too small to tap. */}
      <div className="sb-panel-touch" inert={!power}>
        <Segmented
          label="Instrument"
          className="sb-segmented-fill sb-panel-strip"
          value={target.track}
          onChange={selectTrack}
          options={TRACKS.map((entry) => ({
            value: entry.id,
            label: entry.short,
            name: entry.label,
            testId: `strip-voice-${entry.id}`,
          }))}
        />
        <Segmented<Mode>
          label="Mode"
          className="sb-segmented-fill sb-panel-strip"
          value={mode}
          onChange={(next) => session.setMode(next)}
          options={MODES.map((entry, index) => ({
            value: entry,
            label: MODE_SHORT[index]!,
            name: panel.modeSelect.positions[index]!.label,
            testId: `strip-mode-${entry}`,
          }))}
        />
        <div className="sb-panel-info">
          <p data-testid="panel-voice">
            {writing ? (
              <>
                <span className="sb-label">Instrument</span> <strong>{trackName}</strong> ·{' '}
                {countSteps(row, rhythmLength(rhythm))} steps on
              </>
            ) : tracks ? (
              <>
                <span className="sb-label">Rhythm track</span> <strong>{selector + 1}</strong> ·{' '}
                {trackLength === 0 ? 'empty' : `${trackLength} ${trackLength === 1 ? 'measure' : 'measures'}`}
              </>
            ) : (
              <>
                <span className="sb-label">Rhythm</span> <strong>{rhythmName(target.rhythm)}</strong>, version{' '}
                {target.variation.toUpperCase()}
              </>
            )}
          </p>
          <div className="sb-panel-buttons">
            <button
              type="button"
              className="sb-button"
              data-testid="strip-clear"
              aria-pressed={writing ? clearArmed : undefined}
              disabled={!clears(mode)}
              onClick={() => session.pressClear()}
            >
              Clear
            </button>
            <button
              type="button"
              className="sb-button"
              data-testid="strip-tap"
              aria-pressed={isPerformMode(mode) ? fillArmed : undefined}
              disabled={!taps(mode)}
              {...pressHandlers(() => runtime.session.tap())}
            >
              {isPerformMode(mode) ? 'Fill in' : 'Tap'}
            </button>
            <button type="button" className="sb-button" aria-pressed={fit} onClick={() => setFit(!fit)}>
              {fit ? 'Zoom in' : 'Fit to screen'}
            </button>
          </div>
        </div>
      </div>

      {photo && panel.faceplate.credit ? <FaceplateCreditLine credit={panel.faceplate.credit} /> : null}
    </section>
  );
}

/** What the panel does not model yet. Shown in settings. */
export function PanelNotes() {
  return <PanelPending items={PANEL.pending} />;
}

/** The modes as the phone strip names them, in selector order. */
const MODE_SHORT = ['Erase', '1st', '2nd', 'Manual', 'Play', 'Comp'];

function sameTarget(a: ReturnType<typeof editTarget>, b: ReturnType<typeof editTarget>): boolean {
  return a.rhythm === b.rhythm && a.variation === b.variation && a.track === b.track && a.offset === b.offset;
}
