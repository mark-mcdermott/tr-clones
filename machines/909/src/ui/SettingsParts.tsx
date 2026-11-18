import { countHits, isEmptyPattern, isTrackMode, selectedPattern } from '../document';
import { remembersAnything, type State909 } from '../session';
import { useEditorState, useRuntime } from './context';

interface TrackSummary {
  number: number;
  measures: number;
}

/** The track the panel is on, in the modes that work on one. */
function trackSummary(state: State909): TrackSummary | null {
  const { panel, patternTracks } = state.project;
  if (!isTrackMode(panel.mode)) return null;
  return { number: panel.track + 1, measures: patternTracks[panel.track]!.measures.length };
}

function sameTrack(a: TrackSummary | null, b: TrackSummary | null): boolean {
  return a?.number === b?.number && a?.measures === b?.measures;
}

/** The 909's own buttons in settings, after undo and redo. */
export function SettingsActions() {
  const { session } = useRuntime();
  const empty = useEditorState((state) => isEmptyPattern(selectedPattern(state.project)));
  const remembers = useEditorState((state) => remembersAnything(state.project));
  return (
    <>
      <button type="button" className="sb-button" data-testid="starter" onClick={() => session.loadStarter()}>
        Starter patterns
      </button>
      <button
        type="button"
        className="sb-button sb-button-danger"
        data-testid="clear"
        disabled={empty}
        onClick={() => session.clearPattern()}
      >
        Clear pattern
      </button>
      <button
        type="button"
        className="sb-button sb-button-danger"
        data-testid="clear-everything"
        disabled={!remembers}
        onClick={() => session.clearEverything()}
      >
        Clear everything
      </button>
    </>
  );
}

/** The 909's own lines in the settings status list. */
export function StatusLines() {
  const hits = useEditorState((state) => countHits(selectedPattern(state.project)));
  const steps = useEditorState((state) => selectedPattern(state.project).lastStep);
  const track = useEditorState(trackSummary, sameTrack);
  return (
    <>
      <span data-testid="hit-count">
        {hits} {hits === 1 ? 'hit' : 'hits'} in {steps} {steps === 1 ? 'step' : 'steps'}
      </span>
      {track ? (
        <span data-testid="track-length">
          Track {track.number}: {track.measures === 0 ? 'empty' : `${track.measures} ${track.measures === 1 ? 'measure' : 'measures'}`}
        </span>
      ) : null}
    </>
  );
}

export function KeysHelp() {
  return (
    <>
      Keys: <kbd>Space</kbd> start or stop · arrows move between the step keys and turn knobs ·{' '}
      <kbd>Enter</kbd> presses a key · <kbd>Esc</kbd> lets SHIFT and the function keys up · <kbd>Ctrl</kbd>+
      <kbd>Z</kbd> undo
    </>
  );
}
