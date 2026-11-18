import { EditorRuntime, useEditorState as useCoreState, useRuntime as useCoreRuntime } from '@boombapbot/editor';
import type { Project } from '../document';
import type { Session606, State606, Transient606 } from '../session';

export type Runtime606 = EditorRuntime<Project, Transient606, Session606>;

/** The runtime of the editor this panel is in. The panel is only ever mounted by the 606. */
export function useRuntime(): Runtime606 {
  return useCoreRuntime() as unknown as Runtime606;
}

/** Subscribes to one slice of the 606's state. */
export function useEditorState<Value>(selector: (state: State606) => Value, same?: (a: Value, b: Value) => boolean): Value {
  return useCoreState((state) => selector(state as State606), same);
}

/** Whether two values a selector made read the same, for slices that are built afresh on every change. */
export function sameJson<Value>(a: Value, b: Value): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
