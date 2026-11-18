import { composition, countHits, isTrackMode, rhythmLength } from '../document';
import { editTarget, remembersAnything, type State808 } from '../session';
import { useEditorState, useRuntime } from './context';

/** Hits in the version of the rhythm the step buttons show. */
function selectedHits(state: State808): number {
  const { rhythm, variation } = editTarget(state.project);
  return countHits(state.project.rhythms[rhythm]!, variation);
}

interface TrackSummary {
  number: number;
  measures: number;
}

/** The rhythm track the selector is on, in the modes that work on one. */
function trackSummary(state: State808): TrackSummary | null {
  const { panel, rhythmTracks } = state.project;
  if (!isTrackMode(panel.mode)) return null;
  return { number: panel.selector + 1, measures: composition(rhythmTracks, panel.selector).length };
}

function sameTrack(a: TrackSummary | null, b: TrackSummary | null): boolean {
  return a?.number === b?.number && a?.measures === b?.measures;
}

/** The 808's own buttons in settings, after undo and redo. */
export function SettingsActions() {
  const { session } = useRuntime();
  const hits = useEditorState(selectedHits);
  const remembers = useEditorState((state) => remembersAnything(state.project));
  return (
    <>
      <button type="button" className="sb-button" data-testid="starter" onClick={() => session.loadStarterRhythms()}>
        Starter rhythms
      </button>
      <button
        type="button"
        className="sb-button sb-button-danger"
        data-testid="clear"
        disabled={hits === 0}
        onClick={() => session.clearRhythm()}
      >
        Clear rhythm
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

/** The 808's own lines in the settings status list. */
export function StatusLines() {
  const track = useEditorState(trackSummary, sameTrack);
  const steps = useEditorState((state) => rhythmLength(state.project.rhythms[editTarget(state.project).rhythm]!));
  const hits = useEditorState(selectedHits);
  return (
    <>
      <span data-testid="hit-count">
        {hits} {hits === 1 ? 'hit' : 'hits'} in {steps} steps
      </span>
      {track ? (
        <span data-testid="track-length">
          Rhythm track {track.number}: {track.measures === 0 ? 'empty' : `${track.measures} measures`}
        </span>
      ) : null}
    </>
  );
}

export function KeysHelp() {
  return (
    <>
      Keys: <kbd>Space</kbd> start or stop · arrows move between steps and turn knobs and switches ·{' '}
      <kbd>Enter</kbd> presses a step · <kbd>Esc</kbd> lets CLEAR up · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo
    </>
  );
}
