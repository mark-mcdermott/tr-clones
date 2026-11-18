import { EditorRuntime, useEditorState as useCoreState, useRuntime as useCoreRuntime } from '@boombapbot/editor';
import type { Project } from '../document';
import type { Session909, State909, Transient909 } from '../session';

export type Runtime909 = EditorRuntime<Project, Transient909, Session909>;

/** The runtime of the editor this panel is in. The panel is only ever mounted by the 909. */
export function useRuntime(): Runtime909 {
  return useCoreRuntime() as unknown as Runtime909;
}

/** Subscribes to one slice of the 909's state. */
export function useEditorState<Value>(selector: (state: State909) => Value, same?: (a: Value, b: Value) => boolean): Value {
  return useCoreState((state) => selector(state as State909), same);
}

/** Whether two values worked out from the state say the same thing. For small views made anew at every reading. */
export function sameView<Value>(a: Value, b: Value): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
