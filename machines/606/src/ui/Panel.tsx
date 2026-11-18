import { useState } from 'react';
import { Segmented } from '@boombapbot/editor';
import { PanelPending, PanelStage, pressHandlers, useFaceplatePhoto } from '@tr-clones/panel';
import { MODES, PANEL, SCALES, TRACKS, isTrackMode, type Mode, type Scale } from '../document';
import { statusText } from '../lamps';
import {
  LevelKnob,
  ModeKeys,
  ModeSelector,
  PowerSwitch,
  RunKey,
  ScaleSwitch,
  StatusLamps,
  TempoKnob,
  VoiceSelector,
  VolumeKnob,
  chooseVoice,
  clearRole,
  functionRole,
  groupRole,
  scaleName,
  tapRole,
  useKeyState,
  type KeyRole,
} from './PanelControls';
import { StepKeys } from './StepKeys';
import { useEditorState, useRuntime } from './context';

/** The modes as the phone strip names them, in selector order. */
const MODE_SHORT: Record<Mode, string> = {
  track_write: 'Tr write',
  track_play: 'Tr play',
  pattern_play: 'Pt play',
  pattern_write: 'Pt write',
};

function StripKey({ role, testId, handlers }: { role: KeyRole; testId: string; handlers: ReturnType<typeof pressHandlers> | { onClick(): void } }) {
  return (
    <button type="button" className="sb-button" data-testid={testId} aria-label={role.name} aria-pressed={role.held} disabled={!role.enabled} {...handlers}>
      {role.text}
    </button>
  );
}

/** Touch-sized stand-ins for the controls that are too small to tap on a phone. */
function TouchStrip({ fit, onFit }: { fit: boolean; onFit(fit: boolean): void }) {
  const { session } = useRuntime();
  const keys = useKeyState();
  const power = useEditorState((state) => state.power);
  const selector = useEditorState((state) => state.project.panel.selector);
  const scale = useEditorState((state) => state.project.panel.scale);
  const group = useEditorState((state) => state.project.panel.group);
  const status = useEditorState(statusText);
  const tracks = isTrackMode(keys.mode);
  return (
    <div className="sb-panel-touch" inert={!power}>
      <Segmented
        label={tracks ? 'Track' : 'Instrument'}
        className="sb-segmented-fill sb-panel-strip"
        value={TRACKS[selector]!.id}
        onChange={(id) => chooseVoice(session, TRACKS.findIndex((track) => track.id === id), tracks)}
        options={TRACKS.map((track, index) => ({
          value: track.id,
          label: tracks ? String(index + 1) : track.short,
          name: tracks ? `Track ${index + 1}` : track.label,
          testId: `strip-voice-${track.id}`,
        }))}
      />
      <Segmented<Mode>
        label="Mode"
        className="sb-segmented-fill sb-panel-strip"
        value={keys.mode}
        onChange={(mode) => session.setMode(mode)}
        options={MODES.map((mode, index) => ({
          value: mode,
          label: MODE_SHORT[mode],
          name: PANEL.modeSelect.positions[index]!.label,
          testId: `strip-mode-${mode}`,
        }))}
      />
      <Segmented
        label="Scale"
        className="sb-segmented-fill sb-panel-strip"
        value={String(scale)}
        onChange={(value) => session.setScale(Number(value) as Scale)}
        options={SCALES.map((value) => ({
          value: String(value),
          label: `Scale ${value}`,
          name: scaleName(value),
          testId: `strip-scale-${value}`,
        }))}
      />
      <div className="sb-panel-info">
        <p data-testid="panel-status">{status}</p>
        <div className="sb-panel-buttons">
          <StripKey role={functionRole(keys)} testId="strip-function" handlers={{ onClick: () => session.pressFunction() }} />
          <StripKey role={clearRole(keys)} testId="strip-clear" handlers={{ onClick: () => session.pressClear() }} />
          <StripKey role={tapRole(keys)} testId="strip-tap" handlers={pressHandlers(() => session.pressTap())} />
          <StripKey role={groupRole(group, keys.playing)} testId="strip-group" handlers={{ onClick: () => session.pressGroup() }} />
          <button type="button" className="sb-button" aria-pressed={fit} onClick={() => onFit(!fit)}>
            {fit ? 'Zoom in' : 'Fit to screen'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The 606: its faceplate with every control live on it. The volume knob and
 * the power lettering beside it are the power switch, and stay live when
 * the machine is off; nothing else does.
 */
export function Panel() {
  const power = useEditorState((state) => state.power);
  const { photo, onPhotoError } = useFaceplatePhoto();
  const [fit, setFit] = useState(false);
  const panel = PANEL;
  const dim = !photo || panel.ledsLitInPhoto;

  return (
    <section className="sb-hardware sb-606" aria-label="606 drum machine" data-testid="hardware">
      <PanelStage panel={panel} photo={photo} onPhotoError={onPhotoError} power={power} fit={fit}>
        <div className="sb-panel-controls" inert={!power}>
          {panel.levels.map((knob) => (
            <LevelKnob key={knob.level} panel={panel} photo={photo} knob={knob} />
          ))}
          <TempoKnob panel={panel} photo={photo} />
          <VoiceSelector panel={panel} photo={photo} />
          <ModeSelector panel={panel} photo={photo} />
        </div>
        <VolumeKnob panel={panel} photo={photo} />
        <PowerSwitch panel={panel} />
        {/* With the power off nothing but its switch answers. */}
        <div className="sb-panel-controls" inert={!power}>
          <ModeKeys panel={panel} />
          <RunKey panel={panel} />
          <ScaleSwitch panel={panel} />
          <StatusLamps panel={panel} dim={dim} />
          <StepKeys panel={panel} photo={photo} />
        </div>
      </PanelStage>
      <TouchStrip fit={fit} onFit={setFit} />
    </section>
  );
}

/** Where the machine departs from the hardware. Shown in settings. */
export function PanelNotes() {
  return <PanelPending items={PANEL.pending} heading="How this differs from the machine, and what is unverified" />;
}
