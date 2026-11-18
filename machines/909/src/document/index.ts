import type { DocumentKind } from '@boombapbot/contracts';
import { MACHINE_ID, createProject, parseProject, serializeProject, type Project } from './project';

export * from './machine';
export * from './project';
export * from './starter';
export * from './hardware';

/** The 909's documents. Each names its machine, and its draft has a place of its own. */
export const document909: DocumentKind<Project> = {
  machine: MACHINE_ID,
  draftKey: 'tr-clones.909.draft.v1',
  earlierDraftKeys: [],
  owns: (header) => header.machine === MACHINE_ID,
  parse: parseProject,
  serialize: serializeProject,
  create: ({ id, now }) => createProject({ id, now, name: 'Starter beat' }),
};

/** The name a host imports, whichever machine its build is. */
export { document909 as documentKind };
