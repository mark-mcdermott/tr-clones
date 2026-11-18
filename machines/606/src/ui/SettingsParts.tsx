import { GROUP_NAMES, countHits, isCleared, patternAt } from '../document';
import { statusText } from '../lamps';
import { remembersAnything, shownPattern, type State606 } from '../session';
import { useEditorState, useRuntime } from './context';

/** Hits in the pattern the step keys show. */
function shownHits(state: State606): number {
  return countHits(patternAt(state.project, shownPattern(state)));
}

/** The 606's own buttons in settings, after undo and redo. */
export function SettingsActions() {
  const { session } = useRuntime();
  const blank = useEditorState((state) => isCleared(patternAt(state.project, shownPattern(state))));
  const remembers = useEditorState((state) => remembersAnything(state.project));
  return (
    <>
      <button type="button" className="sb-button" data-testid="starter" onClick={() => session.loadStarter()}>
        Starter beat
      </button>
      <button type="button" className="sb-button sb-button-danger" data-testid="clear" disabled={blank} onClick={() => session.clearPattern()}>
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

/** The 606's own lines in the settings status list. */
export function StatusLines() {
  const hits = useEditorState(shownHits);
  const number = useEditorState((state) => shownPattern(state) + 1);
  const group = useEditorState((state) => GROUP_NAMES[state.project.panel.group]);
  const status = useEditorState(statusText);
  return (
    <>
      <span data-testid="hit-count">
        {hits} {hits === 1 ? 'hit' : 'hits'} in pattern {number} of group {group}
      </span>
      <span data-testid="machine-status">{status}</span>
    </>
  );
}

export function KeysHelp() {
  return (
    <>
      Keys: <kbd>Space</kbd> run or stop · arrows move between step keys and turn knobs, dials and switches ·{' '}
      <kbd>Enter</kbd> presses a key · <kbd>Shift</kbd>+<kbd>Enter</kbd> chains patterns up to that key · <kbd>Esc</kbd> lets
      FUNCTION and CLEAR up · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo
    </>
  );
}
