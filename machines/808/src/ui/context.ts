import { EditorRuntime, useEditorState as useCoreState, useRuntime as useCoreRuntime } from '@boombapbot/editor';
import type { Project } from '../document';
import type { Session808, State808, Transient808 } from '../session';

export type Runtime808 = EditorRuntime<Project, Transient808, Session808>;

/** The runtime of the editor this panel is in. The panel is only ever mounted by the 808. */
export function useRuntime(): Runtime808 {
  return useCoreRuntime() as unknown as Runtime808;
}

/** Subscribes to one slice of the 808's state. */
export function useEditorState<Value>(selector: (state: State808) => Value, same?: (a: Value, b: Value) => boolean): Value {
  return useCoreState((state) => selector(state as State808), same);
}
