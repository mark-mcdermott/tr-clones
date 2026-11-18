import { Knob, Lamp, box } from '@tr-clones/panel';
import { BPM_MAX, BPM_MIN, getKnob, type PanelKey, type PanelKnob, type PanelManifest } from '../document';
import { useEditorState, useRuntime } from './context';
import type { KeyLamp } from './keys';

/** The parts the 909's panel is put together from: its switch, its keys, its lamps and its knobs. */

interface FaceplateProps {
  panel: PanelManifest;
  photo: string | null;
}

export interface SmallKeyProps {
  panel: PanelManifest;
  place: PanelKey;
  testId: string;
  /** What pressing it does now, for a screen reader. */
  label: string;
  /** What is lettered by it, for the drawn stand-in. */
  text: string;
  /** The lamp in it, for a key that has something to show. */
  lamp?: KeyLamp;
  /** Whether an unlit lamp has to be painted: only on the drawn stand-in. */
  dim: boolean;
  disabled?: boolean;
  onPress(): void;
}

/** One of the small square keys, and the lamp that shines through it. */
export function SmallKey({ panel, place, testId, label, text, lamp, dim, disabled, onPress }: SmallKeyProps) {
  const { hit, lampRadius } = panel.keys;
  const [x, y] = place.at;
  return (
    <>
      <button
        type="button"
        className="sb-panel-transport sb-909-key"
        style={box(panel, [x - hit / 2, y - hit / 2, hit, hit])}
        data-testid={testId}
        aria-label={label}
        aria-pressed={lamp ? lamp.on : undefined}
        disabled={disabled}
        onClick={onPress}
      >
        <span className="sb-panel-text">{text}</span>
      </button>
      {lamp ? (
        <Lamp
          panel={panel}
          at={place.at}
          radius={lampRadius}
          on={lamp.on}
          flash={lamp.on && lamp.flash === true}
          dim={dim}
          testId={`${testId}-lamp`}
        />
      ) : null}
    </>
  );
}

const PERCENT = { min: 0, max: 100, step: 2, perPixel: 0.5 } as const;

/** A level, a sound knob, the total accent or the volume. */
export function PanelKnob({ panel, photo, knob }: FaceplateProps & { knob: PanelKnob }) {
  const { session } = useRuntime();
  const percent = useEditorState((state) => Math.round(state.project.knobs[knob.knob] * 100));
  return (
    <Knob
      panel={panel}
      photo={photo}
      geometry={knob}
      label={getKnob(knob.knob).label}
      testId={`panel-knob-${knob.knob}`}
      value={percent}
      {...PERCENT}
      valueText={`${percent}%`}
      onChange={(value) => session.setKnob(knob.knob, value / 100)}
    />
  );
}

/** The tempo knob: a beat a minute for each step, as the display counts them. */
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
      perPixel={1}
      valueText={`${bpm} beats per minute`}
      onChange={(value) => session.setTempo(value)}
    />
  );
}
