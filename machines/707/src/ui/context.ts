import { EditorRuntime, useEditorState as useCoreState, useRuntime as useCoreRuntime } from '@boombapbot/editor';
import type { Project } from '../document';
import type { Session707, State707, Transient707 } from '../session';

export type Runtime707 = EditorRuntime<Project, Transient707, Session707>;

/** The runtime of the editor this panel is in. The panel is only ever mounted by the 707. */
export function useRuntime(): Runtime707 {
  return useCoreRuntime() as unknown as Runtime707;
}

/** Subscribes to one slice of the 707's state. */
export function useEditorState<Value>(selector: (state: State707) => Value, same?: (a: Value, b: Value) => boolean): Value {
  return useCoreState((state) => selector(state as State707), same);
}
