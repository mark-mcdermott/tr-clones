import { useEffect, useState } from 'react';
import { Segmented } from '@boombapbot/editor';
import { PanelPending, PanelStage, box, useFaceplatePhoto } from '@tr-clones/panel';
import {
  GROUPS,
  MODES,
  PANEL,
  ROW_IDS,
  SCALE_NAMES,
  TRACK_NAMES,
  activeGroup,
  getPattern,
  getSound,
  isInstrumentId,
  isPaired,
  isTrackMode,
  patternName,
  rowSound,
  rowSounds,
  shownPattern,
  type Group,
  type Mode,
  type RowId,
  type SoundId,
} from '../document';
import { useEditorState, useRuntime } from './context';
import { DisplayCanvas } from './Display';
import {
  FaderBank,
  FunctionKeys,
  GroupKeys,
  PowerSwitch,
  ScaleLamps,
  StepKeys,
  TempoKnob,
  Transport,
  keyStates,
  useShown,
  type MachineKey,
} from './PanelControls';
import { MODE_NAMES, announce, describeDisplay, rowName, trackPosition, type Shown } from './show';

/** The modes as the phone strip names them, in the order of MODES. */
const MODE_SHORT: Record<Mode, string> = {
  track_play: 'Trk play',
  track_write: 'Trk write',
  pattern_play: 'Pat play',
  pattern_step: 'Step',
  pattern_tap: 'Tap',
};

/** The keys the phone strip repeats, in the order they stand on the machine. */
const STRIP_KEYS: MachineKey[] = ['shift', 'clear', 'scale', 'last_step', 'instrument', 'shuffle', 'tempo_measure', 'enter'];

/** What the machine last did that is worth saying aloud. */
function useSpoken(): string {
  const { store } = useRuntime();
  const [spoken, setSpoken] = useState('');
  useEffect(() => {
    let previous: Shown = store.getState();
    return store.subscribe(() => {
      const next = store.getState();
      const said = announce(previous, next);
      previous = next;
      if (said) setSpoken(said);
    });
  }, [store]);
  return spoken;
}

/** One line under the panel on a phone: where the machine is. */
function whereItIs(shown: Shown): { label: string; name: string; rest: string } {
  const { project, playing, currentPattern } = shown;
  if (isTrackMode(project.panel.mode)) {
    const { measure, of } = trackPosition(shown);
    const rest = of === 0 ? 'empty' : measure > of ? `${of} measures, at the end` : `measure ${measure} of ${of}`;
    return { label: 'Track', name: TRACK_NAMES[project.panel.track] ?? '', rest };
  }
  const at = shownPattern(project, playing ? currentPattern : -1);
  const pattern = getPattern(project, at);
  return {
    label: 'Pattern',
    name: patternName(at.group, at.pattern),
    rest: `${pattern.lastStep} steps of ${SCALE_NAMES[pattern.scale]}`,
  };
}

export function HardwarePanel() {
  const runtime = useRuntime();
  const { session } = runtime;
  const shown = useShown();
  const power = useEditorState((state) => state.power);
  const { photo, onPhotoError } = useFaceplatePhoto();
  const [fit, setFit] = useState(false);
  const spoken = useSpoken();

  const panel = PANEL;
  const { project } = shown;
  const { mode, row, track } = project.panel;
  const tracks = isTrackMode(mode);
  const keys = keyStates(shown, runtime);
  const where = whereItIs(shown);
  const stripLabel = (id: RowId) => (isInstrumentId(id) ? getSound(rowSound(id, project.sounds)).short : 'AC');

  return (
    <section className="sb-hardware" aria-label={`${panel.id} drum machine`} data-testid="hardware">
      <PanelStage panel={panel} photo={photo} onPhotoError={onPhotoError} power={power} fit={fit}>
        {!photo
          ? [...panel.steps, ...panel.keys, ...panel.groups].map((entry, index) => (
              <span key={index} className="sb-panel-key" aria-hidden="true" style={box(panel, entry.button)} />
            ))
          : null}

        <PowerSwitch panel={panel} />
        {/* With the power off nothing else on the machine answers. */}
        <div className="sb-panel-controls" inert={!power}>
          <div
            className="sb-707-display"
            style={box(panel, panel.display)}
            role="img"
            aria-label={`Display. ${describeDisplay(shown)}`}
            data-testid="panel-display"
          >
            <DisplayCanvas testId="display-canvas" />
          </div>
          <FaderBank panel={panel} />
          <TempoKnob panel={panel} photo={photo} />
          <Transport panel={panel} />
          <FunctionKeys panel={panel} shown={shown} />
          <GroupKeys panel={panel} shown={shown} dim={!photo} />
          <ScaleLamps panel={panel} shown={shown} dim={!photo} />
          <StepKeys panel={panel} shown={shown} dim={!photo} />
        </div>
      </PanelStage>

      <p className="sb-visually-hidden" aria-live="polite" data-testid="spoken">
        {spoken}
      </p>

      {/* On a phone the display is too small to read and the small keys too small to press. */}
      <div className="sb-panel-touch" inert={!power}>
        <div className="sb-707-strip-display" aria-hidden="true">
          <DisplayCanvas compact testId="strip-display" />
        </div>
        <Segmented<Mode>
          label="Mode"
          className="sb-segmented-fill sb-panel-strip"
          value={mode}
          onChange={(next) => session.setMode(next)}
          options={MODES.map((entry) => ({
            value: entry,
            label: MODE_SHORT[entry],
            name: MODE_NAMES[entry],
            testId: `strip-mode-${entry}`,
          }))}
        />
        {tracks ? (
          <Segmented
            label="Track"
            className="sb-segmented-fill sb-panel-strip"
            value={String(track)}
            onChange={(next) => session.selectTrack(Number(next))}
            options={TRACK_NAMES.map((name, index) => ({
              value: String(index),
              label: name,
              name: `Track ${name}`,
              testId: `strip-track-${index}`,
            }))}
          />
        ) : null}
        {mode !== 'track_play' ? (
          <Segmented<Group>
            label="Pattern group"
            className="sb-segmented-fill sb-panel-strip"
            value={activeGroup(project)}
            onChange={(next) => session.selectGroup(next)}
            options={GROUPS.map((group) => ({
              value: group,
              label: group.toUpperCase(),
              name: `Pattern group ${group.toUpperCase()}`,
              testId: `strip-group-${group}`,
            }))}
          />
        ) : null}
        <Segmented<RowId>
          label="Instrument"
          className="sb-segmented-fill sb-panel-strip"
          value={row}
          onChange={(next) => session.selectRow(next)}
          options={ROW_IDS.map((id) => ({
            value: id,
            label: stripLabel(id),
            name: rowName(id, project),
            testId: `strip-row-${id}`,
          }))}
        />
        {isPaired(row) ? (
          <Segmented<SoundId>
            label="Sound"
            className="sb-segmented-fill sb-panel-strip"
            value={project.sounds[row]}
            onChange={(next) => session.chooseSound(next)}
            options={rowSounds(row).map((sound) => ({
              value: sound,
              label: getSound(sound).name,
              testId: `strip-sound-${sound}`,
            }))}
          />
        ) : null}
        <div className="sb-panel-buttons sb-707-strip-keys">
          {STRIP_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="sb-button"
              data-testid={`strip-key-${key}`}
              aria-label={keys[key].name}
              aria-pressed={keys[key].pressed}
              disabled={keys[key].disabled}
              onClick={keys[key].press}
            >
              {keys[key].short}
            </button>
          ))}
        </div>
        <div className="sb-panel-info">
          <p data-testid="panel-where">
            <span className="sb-label">{where.label}</span> <strong>{where.name}</strong> · {where.rest}
          </p>
          <div className="sb-panel-buttons">
            <button type="button" className="sb-button" data-testid="strip-fit" aria-pressed={fit} onClick={() => setFit(!fit)}>
              {fit ? 'Zoom in' : 'Fit to screen'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Where the panel departs from the machine. Shown in settings. */
export function PanelNotes() {
  return <PanelPending items={PANEL.pending} heading="How this differs from the machine, and what is unverified" />;
}
