import { TRACK_NAMES, countHits, getPattern, isEmptyPattern, isTrackMode, patternName, selectedTrack } from '../document';
import { editTarget, remembersAnything, type State707 } from '../session';
import { useEditorState, useRuntime } from './context';

/** The pattern the step keys are on, by name and by what it holds. */
function patternSummary(state: State707): string {
  const at = editTarget(state);
  const hits = countHits(getPattern(state.project, at));
  return `${hits} ${hits === 1 ? 'hit' : 'hits'} in pattern ${patternName(at.group, at.pattern)}`;
}

/** The track the panel is on, in the modes that work on one. */
function trackSummary(state: State707): string | null {
  const { panel } = state.project;
  if (!isTrackMode(panel.mode)) return null;
  const measures = selectedTrack(state.project).measures.length;
  const length = measures === 0 ? 'empty' : `${measures} ${measures === 1 ? 'measure' : 'measures'}`;
  return `Track ${TRACK_NAMES[panel.track]}: ${length}`;
}

/** The 707's own buttons in settings, after undo and redo. */
export function SettingsActions() {
  const { session } = useRuntime();
  const empty = useEditorState((state) => isEmptyPattern(getPattern(state.project, editTarget(state))));
  const remembers = useEditorState((state) => remembersAnything(state.project));
  return (
    <>
      <button type="button" className="sb-button" data-testid="starter" onClick={() => session.loadStarterBeat()}>
        Starter beat
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

/** The 707's own lines in the settings status list. */
export function StatusLines() {
  const pattern = useEditorState(patternSummary);
  const track = useEditorState(trackSummary);
  return (
    <>
      <span data-testid="hit-count">{pattern}</span>
      {track ? <span data-testid="track-length">{track}</span> : null}
    </>
  );
}

export function KeysHelp() {
  return (
    <>
      Keys: <kbd>Space</kbd> start or stop · arrows move between step keys and move the faders and the tempo knob ·{' '}
      <kbd>Enter</kbd> presses a key · <kbd>Esc</kbd> lets up a key that is down · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo
    </>
  );
}
