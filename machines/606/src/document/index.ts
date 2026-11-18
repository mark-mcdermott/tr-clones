import type { DocumentKind } from '@boombapbot/contracts';
import { MACHINE_ID, createProject, parseProject, serializeProject, type Project } from './project';

export * from './machine';
export * from './project';
export * from './starter';
export * from './hardware';

/** The 606's documents. Each says it is a 606's, and its draft has a place of its own. */
export const document606: DocumentKind<Project> = {
  machine: MACHINE_ID,
  draftKey: 'tr-clones.606.draft.v1',
  earlierDraftKeys: [],
  owns: (header) => header.machine === MACHINE_ID,
  parse: parseProject,
  serialize: serializeProject,
  create: ({ id, now }) => createProject({ id, now, name: 'Starter beat', bpm: 126 }),
};

/** The name a host imports, whichever machine its build is. */
export { document606 as documentKind };
